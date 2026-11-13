// Test-only Host plugin for the Dispatch real-shell journey. It registers a
// scripted in-process model route so real agent loops run without credentials
// or network, and creates a disposable Git repository with a bare remote.
// Everything else is the real DSH runtime.
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const cli = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
const { LlmAdapter } = await import(pathToFileURL(cli.resolve('@deepseek-ai/dsh-llm')).href)

export const name = 'dispatch-shell-fixture'
export const inject = ['llm']
export const PROVIDER = 'dispatch-fixture'
export const MODEL = 'scripted'
export const START = 'Start the fixture worker.'

const ASSIGNMENT = /Dispatch assignment ([0-9a-f-]{36})/u

function text(message) {
  const content = Array.isArray(message?.content) ? message.content : []
  return content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
}

function parse(value) {
  const start = value.indexOf('{')
  try {
    return JSON.parse(start >= 0 ? value.slice(start) : value)
  } catch {
    return undefined
  }
}

/**
 * Deterministic model: it reads only the request messages and answers with the
 * same tool calls a capable model would make for this journey.
 */
export function script(messages, repository) {
  // DSH appends model-visible context (reminders, sampled time) as user-role
  // messages after the human or relayed prompt; those are not the prompt.
  const context = (value) =>
    value.startsWith('<system-reminder>') || value.startsWith('Time sampled')
  let last = -1
  for (let index = messages.length - 1; index >= 0; index--)
    if (messages[index].role === 'user' && !context(text(messages[index]))) {
      last = index
      break
    }
  const prompt = last >= 0 ? text(messages[last]) : ''
  const after = messages.slice(last + 1)
  const calls = after.flatMap((message) =>
    message.role === 'assistant'
      ? (message.content ?? []).filter((part) => part?.type === 'tool-call')
      : [],
  )
  const results = after.filter((message) => message.role === 'tool')
  const lastResult = results.at(-1)
  const assignment = ASSIGNMENT.exec(prompt)
  if (prompt.includes('Dispatch report (')) {
    if (!calls.length) return { tool: 'dispatch_list_sessions', args: {} }
    return { text: 'Worker report received.' }
  }
  if (assignment) {
    if (!calls.length)
      return {
        tool: 'dispatch_report',
        args: {
          assignmentId: assignment[1],
          kind: 'ready-for-review',
          summary: 'Fixture worker reviewed README.md.',
          evidence: ['README.md'],
        },
      }
    return { text: 'Reported to the coordinator.' }
  }
  if (prompt.includes(START)) {
    if (!calls.length) return { tool: 'dispatch_refresh_base', args: { directory: repository } }
    if (calls.length === 1) {
      const base = parse(text(lastResult))
      if (!base?.commit) return { text: `Refresh failed: ${text(lastResult).slice(0, 300)}` }
      return {
        tool: 'dispatch_create_session',
        args: {
          intent: 'Review the fixture README',
          prompt: 'Review README.md and report back with dispatch_report.',
          base,
          branch: 'dispatch/journey',
        },
      }
    }
    return { text: 'The approval card is ready.' }
  }
  return { text: 'Fixture model reply.' }
}

let counter = 0
class ScriptedAdapter extends LlmAdapter {
  constructor(repository) {
    super()
    this.repository = repository
  }
  async listModels(provider) {
    return [{ provider, id: MODEL, name: 'Scripted fixture' }]
  }
  async *stream(options) {
    options.signal?.throwIfAborted()
    // Auxiliary calls such as session titles carry a purpose; answer plainly.
    const step = options.purpose
      ? { text: 'Dispatch fixture' }
      : script(options.messages, this.repository)
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    if (step.tool) {
      const id = `fixture-call-${++counter}`
      const args = JSON.stringify(step.args)
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id, name: step.tool, argumentsDelta: args }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id, name: step.tool, arguments: args },
      }
      yield { type: 'usage', usage }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: step.text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: step.text } }
    yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    },
  })

export async function apply(ctx) {
  const root = join(process.cwd(), '..', 'dispatch-fixture')
  const remote = join(root, 'remote.git')
  const repository = join(root, 'repository')
  await mkdir(repository, { recursive: true })
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['init', '-q', '-b', 'main', repository])
  await writeFile(join(repository, 'README.md'), '# Dispatch fixture\n')
  git(repository, 'add', '.')
  git(repository, 'commit', '-q', '-m', 'fixture')
  git(repository, 'remote', 'add', 'origin', remote)
  git(repository, 'push', '-q', '-u', 'origin', 'main')
  git(repository, 'remote', 'set-head', 'origin', 'main')
  const registration = ctx.llm.registerAdapter([PROVIDER], new ScriptedAdapter(repository))
  ctx.effect(() => registration)
}
