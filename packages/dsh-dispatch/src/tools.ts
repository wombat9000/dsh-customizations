import { DispatchError } from './contracts.js'
import type { DispatchService } from './service.js'
import type { Dispose, ToolDefinition, ToolExecution, ToolsRegistry } from './types.js'
import { isRecord } from './types.js'

const output = {
  schema: { type: 'string' },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
}

type Properties = Record<string, object>

function args(value: unknown, properties: Properties, required: readonly string[]) {
  if (!isRecord(value)) throw new DispatchError('invalid', 'Pass arguments as an object.')
  for (const key of Object.keys(value))
    if (!Object.hasOwn(properties, key))
      throw new DispatchError('invalid', `Unknown argument ${key}.`)
  for (const key of required)
    if (value[key] === undefined) throw new DispatchError('invalid', `Missing argument ${key}.`)
  return value
}

function tool(
  name: string,
  description: string,
  properties: Properties,
  required: readonly string[],
  run: (input: Record<string, unknown>, exec: ToolExecution) => Promise<unknown>,
): ToolDefinition {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required: [...required],
      additionalProperties: false,
    },
    output,
    async execute(raw, exec) {
      try {
        return JSON.stringify(await run(args(raw, properties, required), exec))
      } catch (error) {
        if (error instanceof DispatchError) throw new Error(`${error.code}: ${error.message}`)
        throw error
      }
    },
  }
}

const str = (description: string) => ({ type: 'string', description })
const workerId = str('Managed worker session ID from dispatch_list_sessions.')

export const COORDINATOR_TOOL_NAMES = [
  'dispatch_list_workspaces',
  'dispatch_list_presets',
  'dispatch_list_sessions',
  'dispatch_find_sessions',
  'dispatch_create_session',
  'dispatch_send_message',
  'dispatch_get_session_status',
  'dispatch_read_session',
  'dispatch_wait_session',
  'dispatch_interrupt_session',
  'dispatch_update_session',
  'dispatch_add_session',
  'dispatch_remove_session',
  'dispatch_refresh_base',
] as const

/** Global helpers a coordinator keeps; everything else is denied for its scope. */
export const COORDINATOR_HELPERS = ['ask_user_question', 'todo_write', 'skill'] as const

/** Orchestration routes a managed worker must not use instead of approved Dispatch creation. */
export const WORKER_DENIED = new Set([
  'subagent',
  'subagent_fork',
  'send_message',
  'list_agents',
  'wait_agent',
  'interrupt_agent',
  'workflow',
  'ralph',
  'plugin_manager',
  'plugin_market',
  ...COORDINATOR_TOOL_NAMES,
])
export function workerDenied(name: string) {
  return WORKER_DENIED.has(name) || name.startsWith('team_') || name.startsWith('agent_team')
}

export function coordinatorTools(service: DispatchService, wait: WaitFn): ToolDefinition[] {
  return [
    tool(
      'dispatch_list_workspaces',
      'List repositories you manage workers in, with eligibility. Pass a directory to check whether it is a Git repository usable as a worker base. Never reads other conversations.',
      { directory: str('Optional absolute directory to check.') },
      [],
      async (input, exec) => {
        const listed = await service.list(exec.agent)
        const repositories = [...new Set(listed.workers.map((worker) => worker.repositoryRoot))]
        if (typeof input.directory !== 'string') return { repositories }
        return {
          repositories,
          checked: await service.inspectDirectory(exec.agent, input.directory),
        }
      },
    ),
    tool(
      'dispatch_list_presets',
      'List agent presets available for workers. New workers default to dispatch-worker; any other preset must be chosen explicitly and is shown on the approval card.',
      {},
      [],
      async (_input, exec) => {
        service.coordinatorOf(exec.agent)
        return service.presets()
      },
    ),
    tool(
      'dispatch_list_sessions',
      'List the workers you manage with runtime state, explicit work state, branch, and checkout eligibility, plus your unfinished proposals.',
      {},
      [],
      (_input, exec) => service.list(exec.agent),
    ),
    tool(
      'dispatch_find_sessions',
      'Check one session ID for Dispatch eligibility using metadata only (preset, runtime, linked worktree, ownership). Never returns transcript content; use dispatch_read_session for your managed workers.',
      { sessionId: str('Session ID to check.') },
      ['sessionId'],
      (input, exec) => service.describeCandidate(exec.agent, input.sessionId),
    ),
    tool(
      'dispatch_create_session',
      'Prepare a new worker assignment for user approval. Creates nothing: returns a pending proposal shown as an approval card. After the user approves, Dispatch creates an ordinary session on its own new linked Git worktree and branch at the pinned base, then sends the exact prompt. Requires a base snapshot from dispatch_refresh_base.',
      {
        intent: str('One-line purpose shown on the card.'),
        prompt: str('Complete first message for the worker. Sent exactly as approved.'),
        base: { type: 'object', description: 'Exact snapshot returned by dispatch_refresh_base.' },
        branch: str('Optional new branch name; generated when omitted.'),
        preset: str('Optional worker preset; defaults to dispatch-worker.'),
        model: str('Optional provider/model; defaults to the DSH default model.'),
      },
      ['intent', 'prompt', 'base'],
      (input, exec) =>
        service.prepareCreate(exec.agent, exec.callId, {
          intent: input.intent,
          prompt: input.prompt,
          base: input.base,
          branch: input.branch,
          preset: input.preset,
          model: input.model,
        }),
    ),
    tool(
      'dispatch_send_message',
      'Send an attributed follow-up to one of your workers within its current approved assignment (queue, or steer the current turn). With newAssignment true, prepare a new assignment approval card instead; nothing is delivered until the user approves.',
      {
        workerId,
        assignmentId: str('Current assignment ID (required unless newAssignment).'),
        message: str('Message text; for a new assignment, the complete prompt.'),
        mode: { type: 'string', enum: ['queue', 'steer'] },
        newAssignment: { type: 'boolean' },
        intent: str('One-line purpose for a new assignment.'),
      },
      ['workerId', 'message'],
      async (input, exec) =>
        input.newAssignment === true
          ? service.prepareAssign(exec.agent, exec.callId, {
              workerId: input.workerId,
              intent: input.intent,
              prompt: input.message,
            })
          : service.send(exec.agent, {
              workerId: input.workerId,
              assignmentId: input.assignmentId,
              message: input.message,
              mode: input.mode,
            }),
    ),
    tool(
      'dispatch_get_session_status',
      'Get one worker’s runtime state, explicit work state, latest report, and checkout eligibility. Idle is not completion.',
      { workerId },
      ['workerId'],
      (input, exec) => service.status(exec.agent, input.workerId),
    ),
    tool(
      'dispatch_read_session',
      'Read paginated text history of one managed, eligible worker. Returns a cursor and whether more remains.',
      {
        workerId,
        cursor: { type: 'integer', description: 'Cursor from a previous read.' },
        limit: { type: 'integer', description: 'Items, 1–50 (default 20).' },
      },
      ['workerId'],
      (input, exec) => service.read(exec.agent, input),
    ),
    tool(
      'dispatch_wait_session',
      'Wait up to timeoutSeconds for a worker to stop running. Distinguishes idle, waiting-for-user, and timeout. Idle is not task completion; reports arrive without waiting.',
      { workerId, timeoutSeconds: { type: 'integer', description: '1–600 (default 60).' } },
      ['workerId'],
      (input, exec) => wait(exec, input.workerId, input.timeoutSeconds),
    ),
    tool(
      'dispatch_interrupt_session',
      'Interrupt a worker’s current turn. Pending input is kept. Acknowledgement is reported separately from actual quiescence.',
      { workerId },
      ['workerId'],
      (input, exec) => service.interrupt(exec.agent, input),
    ),
    tool(
      'dispatch_update_session',
      'Rename a worker or record an attributed administrative work state/summary. Does not forge worker reports, archive, or resume work.',
      {
        workerId,
        title: str('New display title.'),
        workState: {
          type: 'string',
          enum: ['working', 'waiting-for-user', 'ready-for-review', 'done', 'failed'],
        },
        summary: str('Administrative summary, recorded as coordinator-authored.'),
      },
      ['workerId'],
      (input, exec) => service.update(exec.agent, input),
    ),
    tool(
      'dispatch_add_session',
      'Prepare user-approved adoption of an existing, idle dispatch-worker session that sits on its own registered linked worktree. Creates nothing until approved; refuses sessions another coordinator manages.',
      {
        sessionId: str('Existing session ID.'),
        intent: str('One-line purpose shown on the card.'),
        prompt: str('Complete first assignment message.'),
      },
      ['sessionId', 'intent', 'prompt'],
      (input, exec) =>
        service.prepareAdopt(exec.agent, exec.callId, {
          sessionId: input.sessionId,
          intent: input.intent,
          prompt: input.prompt,
        }),
    ),
    tool(
      'dispatch_remove_session',
      'Release management of an idle worker. Keeps its session, history, branch, and checkout; drops undelivered reports.',
      { workerId },
      ['workerId'],
      (input, exec) => service.release(exec.agent, input),
    ),
    tool(
      'dispatch_refresh_base',
      'Fetch one configured remote branch of a repository into its remote-tracking ref and return a pinned base snapshot (commit and fetchedAt). Never pulls, resets, or changes any checkout.',
      {
        directory: str('Absolute path inside the repository.'),
        remote: str('Configured remote name; required when there is more than one.'),
        branch: str('Remote branch; defaults to the remote HEAD branch.'),
      },
      ['directory'],
      (input, exec) =>
        service.refreshBase(exec.agent, input as { directory: unknown }, exec.signal),
    ),
  ]
}

export function reportTool(service: DispatchService): ToolDefinition {
  return tool(
    'dispatch_report',
    'Report to the Dispatch coordinator that assigned your current work: progress, input-required, ready-for-review, done, or failed, with a bounded summary and evidence references (paths, commits, PR links). The recipient and assignment come from your approved association.',
    {
      kind: {
        type: 'string',
        enum: ['progress', 'input-required', 'ready-for-review', 'done', 'failed'],
      },
      summary: str('What changed, what is blocked, or what is ready.'),
      evidence: {
        type: 'array',
        items: { type: 'string' },
        description: 'Up to 20 short references.',
      },
    },
    ['kind', 'summary'],
    (input, exec) => service.report(exec.agent, input as { kind: unknown; summary: unknown }),
  )
}

export type WaitFn = (
  exec: ToolExecution,
  workerId: unknown,
  timeoutSeconds: unknown,
) => Promise<unknown>

/**
 * Install coordinator tools and a monotonic execution guard in one preset
 * scope. The guard denies every other name for agents of this preset,
 * including agent-scoped tools other plugins add later and nested calls.
 * Schema visibility is narrowed per Agent by {@link restrictCoordinatorAgent}.
 */
export function installCoordinator(
  tools: ToolsRegistry,
  service: DispatchService,
  wait: WaitFn,
): Dispose {
  const allowed = new Set<string>([...COORDINATOR_TOOL_NAMES, ...COORDINATOR_HELPERS])
  const disposers: Dispose[] = []
  try {
    for (const definition of coordinatorTools(service, wait))
      disposers.push(tools.register(definition))
    disposers.push(
      tools.guard((execution) =>
        allowed.has(execution.name)
          ? undefined
          : `Dispatch coordinates workers and cannot run ${execution.name}. Ask a worker to do it.`,
      ),
    )
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

export function installWorker(tools: ToolsRegistry, service: DispatchService): Dispose {
  const disposers: Dispose[] = []
  try {
    disposers.push(tools.register(reportTool(service)))
    disposers.push(
      tools.guard((execution) => {
        const id = execution.agent?.id
        if (id !== undefined && service.isProvisioning(id))
          return 'This Dispatch worker is still being provisioned onto its worktree; no tools run until it is verified.'
        if (workerDenied(execution.name))
          return `Dispatch workers cannot use ${execution.name}. Ask the coordinator through dispatch_report.`
        return undefined
      }),
    )
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => {
    for (const dispose of disposers.reverse()) dispose()
  }
}

/**
 * Narrow one coordinator Agent's visible tools to Dispatch tools and helpers.
 * A restriction in the preset scope would also mask the preset's own rows for
 * its Agents (0.2.2-rc.3 `ToolsService.view`), so it is installed in each
 * Agent's own scope on `agent/created`, before its first step. The allowlist is
 * live: globals registered later stay hidden. A missing helper fails closed.
 */
export function restrictCoordinatorAgent(tools: ToolsRegistry): Dispose {
  return tools.restrict({ allow: [...COORDINATOR_TOOL_NAMES, ...COORDINATOR_HELPERS] })
}
