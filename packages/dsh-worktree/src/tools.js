import { defineTool } from '@deepseek-ai/dsh-tools'
import { markIntegrationTool } from './capability.js'

export const name = 'worktree-tools'
export const inject = ['tools', 'worktreeWorkers']

export function apply(ctx) {
  const output = {
    schema: { type: 'string' },
    render(_args, value) { return [{ type: 'text', text: value }] },
  }
  const register = (name, description, parameters, execute) => ctx.tools.register(markIntegrationTool(defineTool({
    name, description, parameters, output,
    async execute(args, exec) {
      if (!exec.agent) throw new Error('Worktree tools require a calling agent')
      // Service results are explicitly owned result objects, never live Agents,
      // Sessions, job snapshots, or other registry references.
      return JSON.stringify(await execute(args, exec), null, 2)
    },
  })))
  register('worktree_create',
    'Create a retained Git worktree on a new worktree/<name> branch from this checkout HEAD. Does not switch this session or copy uncommitted changes. Requires Full access for shared Git metadata; never automatically escalates, merges, or deletes. Worktrees are stored under the original checkout .dsh/worktrees/.',
    { name: { type: 'string', required: true, description: 'Unique lowercase slug: 1–48 letters, digits, or hyphens; starts with a letter or digit.' } },
    (args, exec) => ctx.worktreeWorkers.create(exec.agent, args.name, exec.signal))
  register('worktree_list',
    'List this repository’s Git worktrees, checkout paths, branches, busy status, and this agent’s latest assignments. Read-only. Background job state is process-local; worktrees persist independently.',
    {}, (_args, exec) => ctx.worktreeWorkers.list(exec.agent, exec.signal))
  register('worktree_dispatch',
    'Start a fresh one-shot worker in a linked worktree and immediately return a background job ID. Multiple worktrees may run concurrently; only one assignment per worktree is allowed in this host. Use job_output, job_list, and job_kill; DSH sends completion notices. The worker may use many steps but cannot be continued with send_message. Dispatch a fresh worker for review or fixes. Optional context_from supplies a previous report as reference input, not forked conversation history. No automatic commits, merges, or cleanup.',
    {
      worktree: { type: 'string', required: true, description: 'Checkout path returned by worktree_create/list; must be a registered linked worktree in this repository, not the parent or original checkout.' },
      task: { type: 'string', required: true, description: 'Standalone assignment, acceptance criteria, and relevant context. Maximum 32,000 characters.' },
      mode: { type: 'string', enum: ['write', 'read-only'], description: 'Defaults to read-only. Write permits implementation within the worktree; read-only is for review. Worker permissions never exceed the caller’s authority.' },
      context_from: { type: 'string', description: 'Optional completed job ID from this parent and worktree. Includes its assignment and bounded report as reference material. Available only while retained in this process.' },
    }, (args, exec) => ctx.worktreeWorkers.dispatch(exec.agent, args, exec.signal))
}
