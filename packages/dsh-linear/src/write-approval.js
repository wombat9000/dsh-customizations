const OPERATIONS = Object.freeze({
  linear_create_project: {
    prepare: 'prepareCreate',
    execute: 'executeCreate',
    kind: 'create-project',
  },
  linear_update_project: {
    prepare: 'prepareUpdate',
    execute: 'executeUpdate',
    kind: 'update-project',
  },
  linear_create_project_update: {
    prepare: 'prepareProjectUpdate',
    execute: 'executeProjectUpdate',
    kind: 'create-project-update',
  },
})

export const PROJECT_WRITE_TOOL_NAMES = Object.freeze(Object.keys(OPERATIONS))

// Owns call-bound, one-use preparations. Tool registration never handles this state.
export function createLinearWriteApproval(writes) {
  const pending = new Map()
  const lifetime = new AbortController()
  const unavailable = () => ({
    kind: 'deny',
    reason: 'Linear write preparation was cancelled or unloaded.',
  })
  const release = (exec) => {
    const entry = pending.get(exec.token)
    pending.delete(exec.token)
    entry?.controller.abort()
  }
  const live = (exec, entry) => pending.get(exec.token) === entry && !entry.signal.aborted
  const retire = (exec, entry) => {
    if (pending.get(exec.token) === entry) release(exec)
  }

  return {
    async prepare(exec, next) {
      const operation = Object.hasOwn(OPERATIONS, exec.name) ? OPERATIONS[exec.name] : undefined
      if (!operation) return next()
      if (lifetime.signal.aborted || exec.token == null || pending.has(exec.token))
        return unavailable()
      const controller = new AbortController()
      const entry = {
        operation,
        agent: exec.agent,
        session: exec.agent?.session,
        controller,
        signal: AbortSignal.any([
          lifetime.signal,
          controller.signal,
          ...[exec.signal].filter(Boolean),
        ]),
      }
      pending.set(exec.token, entry)
      try {
        entry.signal.throwIfAborted()
        entry.value = await writes[operation.prepare](exec.arguments, entry.signal)
        if (!live(exec, entry)) return unavailable()
        const downstream = await next()
        if (!live(exec, entry)) return unavailable()
        if (downstream.kind !== 'allow' && downstream.kind !== 'ask') {
          release(exec)
          return downstream
        }
        return {
          kind: 'ask',
          reason:
            entry.value.reason +
            (downstream.kind === 'ask' && downstream.reason
              ? `\nAdditional policy reason (untrusted JSON string): ${JSON.stringify(downstream.reason)}`
              : ''),
        }
      } catch (error) {
        retire(exec, entry)
        throw error
      } finally {
        if (!live(exec, entry)) retire(exec, entry)
      }
    },
    async execute(name, exec) {
      const entry = pending.get(exec.token)
      pending.delete(exec.token)
      if (
        !entry ||
        entry.signal.aborted ||
        entry.operation !== OPERATIONS[name] ||
        entry.value?.kind !== entry.operation.kind ||
        entry.agent !== exec.agent ||
        entry.session !== exec.agent?.session
      ) {
        entry?.controller.abort()
        throw new Error('Linear write approval was not prepared for this exact tool call.')
      }
      // Tools execution wrappers can install a new timeout/cancellation signal
      // after approval. Keep it as well as preparation and plugin lifetime signals.
      const signal = AbortSignal.any([entry.signal, ...[exec.signal].filter(Boolean)])
      signal.throwIfAborted()
      // Mutable execution arguments never replace the immutable approved action.
      return writes[entry.operation.execute](entry.value, signal)
    },
    release,
    dispose() {
      lifetime.abort()
      pending.clear()
    },
  }
}
