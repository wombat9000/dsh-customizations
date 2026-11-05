import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// Use the root's exact-pinned DSH graph, with a detached in-memory Session.
// No Session store, AgentLoop, CLI process, real credentials, or network exists.
const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const installed = (name) => import(pathToFileURL(cli.resolve(name)).href)
const { Context } = await installed('@deepseek-ai/cordis')
const { Session } = await installed('@deepseek-ai/dsh-session')

export async function approvalHost(
  t,
  { policy = 'ask', approval = true, answer, cwd = '/fixture/session-a', openTurn = true } = {},
) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  for (const name of [
    'system-prompt',
    'tools',
    'tool-executor-native',
    ...(approval ? ['session-projection', 'user-approval'] : []),
  ]) {
    const module = await installed(`@deepseek-ai/dsh-${name}`)
    await ctx.plugin(module.default ?? module, name === 'user-approval' ? { policy } : {}).await()
  }
  const callerSession = Session.create('github-write-fixture', undefined, {
    version: 4,
    id: 'github-write-fixture',
    createdAt: 0,
    isSeeded: false,
    cwd,
  })
  if (openTurn) callerSession.append('turn/start', { turn: 1 })
  const agent = { id: 'github-write-fixture', session: callerSession }
  const requests = []
  if (answer !== undefined)
    ctx.on('approval/request', async (request) => {
      requests.push(request)
      return typeof answer === 'function' ? answer(request) : answer
    })
  let call = 0
  return {
    ctx,
    agent,
    session: callerSession,
    requests,
    tools: ctx.get('tools'),
    execute(name, args, overrides = {}) {
      return executeOne(ctx.get('tools'), name, args, {
        callId: `write-call-${++call}`,
        agent,
        ...overrides,
      })
    },
    audit() {
      return callerSession.snapshotEvents().filter((event) => event.type.startsWith('approval/'))
    },
  }
}

// DSH 0.2.2 executes complete model-call batches through the selected executor;
// run one call as a single-call batch and return its settled result.
export async function executeOne(
  tools,
  name,
  args,
  { callId = 'fixture-call', signal = new AbortController().signal, ...rest } = {},
) {
  const calls = [{ type: 'tool-call', id: callId, name, arguments: JSON.stringify(args) ?? '' }]
  const { results } = await tools.execute({ calls, signal, ...rest })
  return results[0].result
}
