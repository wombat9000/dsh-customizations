import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import type {
  WorktreePreferenceChange,
  WorktreePreferenceRequest,
  WorktreePreferenceSnapshot,
} from './types.js'

const choiceSchema = z
  .object({ enabled: z.boolean(), revision: z.number().int().nonnegative() })
  .strict()
const stateSchema = z
  .object({
    lastChoice: z.boolean(),
    sessions: z.record(z.string(), choiceSchema),
  })
  .strict()
type State = z.infer<typeof stateSchema>
interface PreferenceStore {
  get(): State
  set(state: State): Promise<void>
}

// Plain DomainSpec: no private storage APIs or extra runtime dependency. One
// atomic global record keeps a session change and the next-session default together.
const domainSpec = {
  name: 'local_worktree_preference',
  version: 1,
  global: { schema: stateSchema, initial: { lastChoice: false, sessions: {} } },
  tables: {},
}

export const WORKTREE_GUIDANCE = `# Worktree preference

Worktree mode is on for this session. This is workflow guidance, not enforced isolation or a permission grant.
For read-only investigation, planning, and review, stay in the current checkout. Before making code changes, prefer an isolated Git worktree created with DSH's create_worktree tool, from the selected checkout's current HEAD. That tool also changes this session's working directory; use working_directory to inspect or deliberately change it, rather than shell-based worktree setup.
Reuse a suitable worktree already in use for this task; do not create a worktree on every turn or nest worktrees unnecessarily. Tell delegated agents the chosen directory and this preference.
Existing uncommitted and untracked changes stay in the original checkout. If the task depends on them, ask how to proceed; do not copy, stash, reset, or discard them automatically.
If Git, a first commit, or the native worktree tools are unavailable, or worktree creation fails, explain the problem and ask before editing the original checkout. Failed setup can leave artifacts; inspect before retrying.
Show the active branch and worktree path when you start working there. Do not merge, delete, or clean up worktrees automatically. Turning this preference off does not switch directories, undo work, or remove a worktree.`

// The workingDirectory service is optional for the pre-existing read-only card.
// This narrow adapter follows the published get(Session) contract without adding
// a second directory owner. In the normal DSH graph it is always mounted.
export function effectiveSessionDirectory(ctx: Context, session: Session): string | undefined {
  const directory = ctx.get?.('workingDirectory') as { get(session: Session): string } | undefined
  return directory?.get(session) ?? session.header.cwd
}

/** Owns durable choices, defaults, repository eligibility and prompt policy. */
export class WorktreePreferences {
  private writes: Promise<unknown> = Promise.resolve()
  private active = true
  constructor(
    private readonly ctx: Context,
    private readonly store: PreferenceStore,
    private readonly probe: (cwd: string, signal: AbortSignal) => Promise<string | null>,
  ) {}

  private queued<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes
      .catch(() => undefined)
      .then(() => {
        if (!this.active) throw new Error('Worktree preferences are unavailable.')
        return operation()
      })
    this.writes = result
    return result
  }

  private session(id: SessionId) {
    const session = this.ctx.sessions.get(id)
    if (!session) throw new Error('Open this session before changing Worktree mode.')
    if (session.header.origin === 'subagent' || (session.header.delegationDepth ?? 0) > 0)
      throw new Error('Worktree mode is available only for top-level sessions.')
    return session
  }

  initialize(session: Session, fresh: boolean): Promise<void> {
    return this.queued(async () => {
      if (session.header.origin === 'subagent' || (session.header.delegationDepth ?? 0) > 0) return
      const state = this.store.get()
      if (Object.hasOwn(state.sessions, session.id)) return
      // A previously started/restored session must not acquire a newer default.
      await this.store.set({
        ...state,
        sessions: {
          ...state.sessions,
          [session.id]: { enabled: fresh ? state.lastChoice : false, revision: 0 },
        },
      })
    })
  }

  guidance(id: SessionId | undefined): string {
    if (!this.active || !id) return ''
    return this.store.get().sessions[id]?.enabled ? WORKTREE_GUIDANCE : ''
  }

  async read(
    request: WorktreePreferenceRequest,
    signal: AbortSignal,
  ): Promise<WorktreePreferenceSnapshot> {
    const session = this.session(request.sessionId)
    const cwd = effectiveSessionDirectory(this.ctx, session) ?? ''
    const result = cwd ? await this.probe(cwd, signal) : null
    signal.throwIfAborted()
    if (
      !this.active ||
      this.ctx.sessions.get(request.sessionId) !== session ||
      effectiveSessionDirectory(this.ctx, session) !== cwd
    )
      throw new Error('The session directory changed. Refresh Worktree status.')
    const native: unknown = this.ctx.get('worktrees')
    const nativeAvailable =
      native !== null &&
      typeof native === 'object' &&
      typeof Reflect.get(native, 'create') === 'function'
    const reason =
      result === 'ready'
        ? nativeAvailable
          ? null
          : 'Enable DSH’s Git Worktrees bundle for this profile.'
        : result === 'not-repo'
          ? 'This folder is not a Git repository.'
          : result === 'no-head'
            ? 'Create the first Git commit before using Worktree mode.'
            : 'Git status is unavailable. Refresh to try again.'
    const choice = this.store.get().sessions[request.sessionId]
    return {
      sessionId: request.sessionId,
      enabled: choice?.enabled ?? false,
      revision: choice?.revision ?? 0,
      cwd,
      available: reason === null,
      reason,
    }
  }

  set(request: WorktreePreferenceChange, signal: AbortSignal): Promise<WorktreePreferenceSnapshot> {
    // A user workflow preference is not an agent action. In-process tools cannot
    // silently turn off the user's choice through Cordis service access.
    const agents = this.ctx.get('agents') as { currentInitiator(): unknown } | undefined
    if (agents?.currentInitiator())
      return Promise.reject(new Error('Only you can change the Worktree preference in the UI.'))
    const session = this.session(request.sessionId)
    return this.queued(async () => {
      const before = await this.read(request, signal)
      if (
        this.ctx.sessions.get(request.sessionId) !== session ||
        before.cwd !== request.cwd ||
        before.revision !== request.revision
      )
        throw new Error('The session or Worktree preference changed. Refresh before trying again.')
      if (request.enabled && !before.available)
        throw new Error(before.reason ?? 'Worktree mode is unavailable.')
      signal.throwIfAborted()
      const state = this.store.get()
      await this.store.set({
        lastChoice: request.enabled,
        sessions: {
          ...state.sessions,
          [request.sessionId]: { enabled: request.enabled, revision: before.revision + 1 },
        },
      })
      // The native loop evaluates section providers for each later step. No
      // wake-up, registry churn or replacement of an accepted request is needed.
      return { ...before, enabled: request.enabled, revision: before.revision + 1 }
    })
  }

  async dispose() {
    this.active = false
    await this.writes.catch(() => undefined)
  }
}

// Managed Shell retains the existing bundle's execution-world and bounded-output
// semantics. This read-only probe does not fetch, inspect diffs or create a tree.
export const WORKTREE_AVAILABILITY_COMMAND = `command -v git >/dev/null 2>&1 || exit 2
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 GIT_NO_LAZY_FETCH=1
inside=$(git -c core.fsmonitor=false rev-parse --is-inside-work-tree 2>/dev/null) || { printf 'not-repo'; exit 0; }
[ "$inside" = true ] || { printf 'not-repo'; exit 0; }
git -c core.fsmonitor=false rev-parse --verify 'HEAD^{commit}' >/dev/null 2>&1 || { printf 'no-head'; exit 0; }
printf 'ready'`

// Narrow consumed adapters for the inspected DSH 0.2.1-rc.3 services/events.
// This package has no direct runtime imports from the agent or prompt packages;
// the disposable-shell journey verifies these registrations against real DSH.
interface PromptRegistry {
  section(section: {
    name: string
    order: number
    interpolate: boolean
    text(context: { agent?: { id: SessionId } }): string
  }): () => void
}
type AgentCreatedSubscription = (
  event: 'agent/created',
  listener: (event: {
    agent: { session: Session }
    source: 'startup' | 'resume' | 'clear' | 'compact'
  }) => Promise<void>,
) => () => void
interface PreferenceStorage {
  open(spec: typeof domainSpec): Promise<{ global: PreferenceStore; close(): Promise<void> }>
}

export function mountWorktreePreferences(ctx: Context): Promise<WorktreePreferences> {
  const existing = ctx.sessions.list()
  // Register before opening storage: creation must await its initial choice,
  // including sessions entered while the domain is still loading.
  let ready: Promise<WorktreePreferences>
  const onCreated = ctx.on.bind(ctx) as AgentCreatedSubscription
  onCreated('agent/created', async ({ agent, source }) => {
    try {
      const preferences = await ready
      await preferences.initialize(agent.session, source === 'startup')
    } catch {
      ctx.logger.warn('Worktree preference could not initialize; the session remains available.')
    }
  })
  ready = (async () => {
    const storage = ctx.get('storageDomain') as PreferenceStorage
    const prompt = ctx.get('systemPrompt') as PromptRegistry
    const domain = await storage.open(domainSpec)
    try {
      const preferences = new WorktreePreferences(ctx, domain.global, async (cwd, signal) => {
        try {
          const execution = await ctx.shell.execute(
            ctx.shell.resolve({
              command: WORKTREE_AVAILABILITY_COMMAND,
              workdir: cwd,
              timeoutMs: 4000,
              stdoutMaxBytes: 256,
              signal,
            }),
          )
          const result = await execution.result()
          return result.exitCode === 0 &&
            !result.timedOut &&
            !result.aborted &&
            !result.stdout.truncated
            ? result.stdout.text
            : null
        } catch {
          return null
        }
      })
      // Publish no prompt provider until all existing choices initialize. A
      // storage failure must not leave a provider reading a closed domain.
      for (const session of existing) await preferences.initialize(session, false)
      ctx.effect(() => async () => {
        await preferences.dispose()
        await domain.close()
      })
      prompt.section({
        name: 'session-environment:worktree-preference',
        order: 9060,
        interpolate: false,
        text: (context) => preferences.guidance(context.agent?.id),
      })
      return preferences
    } catch (error) {
      await domain.close()
      throw error
    }
  })()
  return ready
}
