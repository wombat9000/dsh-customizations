import { QUERIES } from './queries.js'

export class GitHubError extends Error {
  constructor(code, message) { super(message); this.name = 'GitHubError'; this.code = code }
}
const MESSAGES = {
 INVALID_ARGUMENT: 'Invalid GitHub arguments. Use the explicit targets and bounded parameters documented by the tool.',
 CLI_UNAVAILABLE: 'The required CLI is unavailable in the managed subprocess backend. DSH does not install or authenticate it.',
 AUTH_REQUIRED: 'GitHub authentication is missing or invalid in the managed backend. Configure gh authentication for github.com outside this tool.',
 PERMISSION_DENIED: 'GitHub denied this read. The account may lack the required repository or project permissions.',
 NOT_FOUND: 'The GitHub resource is missing or inaccessible to this account; GitHub may not distinguish these cases.',
 RATE_LIMITED: 'GitHub rate limited this read. Wait before trying again.',
 NETWORK_ERROR: 'The managed backend could not reach GitHub. Check connectivity before trying again.',
 TIMEOUT: 'The GitHub read exceeded its time limit.',
 CANCELLED: 'The GitHub read was cancelled.',
 OUTPUT_TOO_LARGE: 'The GitHub response exceeded the output bound. Reduce the page size or narrow the target; no partial JSON is returned.',
 INVALID_RESPONSE: 'GitHub returned an invalid or unsupported response. No raw response or diagnostic is exposed.',
 READ_FAILED: 'The managed GitHub read failed. No raw CLI diagnostic is exposed.',
 WORKSPACE_REQUIRED: 'Repository discovery requires the calling session working directory.',
}
const fail = code => { throw new GitHubError(code, MESSAGES[code]) }
export function sanitize(value) {
  return String(value)
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[REDACTED]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, '[REDACTED]')
    .replace(/\bAuthorization\s*:\s*token\s+[^\s"'<>]+/gi, '[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:access_token|token|auth|key)=)[^&#\s]+/gi, '$1[REDACTED]')
}
function classify(text) {
  if (/rate.limit|secondary rate|abuse detection|HTTP 429/i.test(text)) return 'RATE_LIMITED'
  if (/HTTP 401|bad credentials|not logged|authentication|unauthorized|gh auth login/i.test(text)) return 'AUTH_REQUIRED'
  if (/HTTP 404|not.found|could not resolve to/i.test(text)) return 'NOT_FOUND'
  if (/HTTP 403|forbidden|insufficient|scope|resource not accessible/i.test(text)) return 'PERMISSION_DENIED'
  if (/ECONN|ENOTFOUND|ETIMEDOUT|network|connection|TLS|HTTP 50[234]|temporarily unavailable/i.test(text)) return 'NETWORK_ERROR'
  return 'READ_FAILED'
}
export function normalizeRemoteUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) return null
  let path
  const scp = /^git@github\.com:([^?#\s]+)$/i.exec(value)
  if (scp) path = scp[1]
  else {
    let url
    try { url = new URL(value) } catch { return null }
    if (url.hostname.toLowerCase() !== 'github.com' || url.port || url.search || url.hash || !['https:', 'ssh:'].includes(url.protocol)) return null
    if (url.protocol === 'ssh:' && url.username && url.username !== 'git') return null
    path = url.pathname.replace(/^\//, '')
  }
  const match = /^([A-Za-z0-9][A-Za-z0-9-]{0,99})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/.exec(path)
  if (!match || ['.', '..'].includes(match[2])) return null
  return { owner: match[1], repo: match[2], nameWithOwner: `${match[1]}/${match[2]}`, url: `https://github.com/${match[1]}/${match[2]}` }
}
const string = description => ({ type: 'string', description })
const integer = description => ({ type: 'integer', description })
const OWNER = { owner: string('Explicit GitHub user or organization login; github.com only.') }
const REPO = { ...OWNER, repo: string('Explicit repository name, not a URL or owner/repo shorthand.') }
const PAGE = { limit: integer('Page size 1–50; default 20.'), cursor: string('Opaque endCursor from this same connection and target.') }
const PROJECT = { ...OWNER, projectNumber: integer('Positive project number under this explicit owner.') }
const ISSUE = { ...REPO, issueNumber: integer('Positive issue number in this explicit repository.') }
export const OPERATIONS = Object.freeze({
 connectionStatus: { properties: {}, required: [], description: 'Report managed gh availability and authenticated github.com login. Token scopes remain unknown; successful reads never establish write access.' },
 detectRepositories: { properties: {}, required: [], description: 'Discover candidates from Git remotes in the calling session directory. No selection, persistence, recursive scan, or remote changes.' },
 listRepositories: { properties: { ...OWNER, ...PAGE }, required: ['owner'], description: 'List accessible repositories belonging to an explicit owner.' },
 getRepository: { properties: REPO, required: ['owner', 'repo'], description: 'Read repository metadata, visibility, default branch, fork parent, and available viewer permission.' },
 listProjects: { properties: { ...OWNER, ...PAGE, templateOnly: { type: 'boolean', description: 'Filter this bounded page to templates. Follow nextCursor even when the filtered page is empty.' } }, required: ['owner'], description: 'List owner projects with template flags. Template filtering applies to each fetched page, not the entire collection.' },
 getProject: { properties: { ...PROJECT, limit: PAGE.limit, fieldsCursor: PAGE.cursor, repositoriesCursor: PAGE.cursor }, required: ['owner', 'projectNumber'], description: 'Read project metadata, README, fields/status options and linked repositories. Fields and repositories have independent cursors. Non-paginated option/iteration arrays may be explicitly truncated.' },
 listProjectItems: { properties: { ...PROJECT, ...PAGE, itemId: string('Optional project item node ID to continue its nested fields; verified against the explicit project.'), fieldValuesLimit: integer('Field values per item, 1–20; default 10. Use 1 with valueCursor.'), fieldValuesCursor: PAGE.cursor, nestedLimit: integer('Values inside a field, 1–50; default 20.'), valueCursor: string('Continue a labels/users/pullRequests/reviewers connection in one field. Requires itemId and fieldValuesLimit=1. Keep fieldValuesCursor at the position before that field.') }, required: ['owner', 'projectNumber'], description: 'Read project items and field values. Continue outer items with cursor; nested field values require itemId. For a nested value connection select its one field using fieldValuesCursor and fieldValuesLimit=1. Check all nested pageInfo and truncation notices.' },
 listIssues: { properties: { ...REPO, ...PAGE, state: { type: 'string', enum: ['open', 'closed', 'all'] }, labels: { type: 'array', items: { type: 'string' }, description: 'Up to 20 exact label names; all must match.' }, assignee: string('Exact GitHub login to filter assignee.') }, required: ['owner', 'repo'], description: 'List repository issues using structured state, labels and assignee filters. Default state is open.' },
 searchIssues: { properties: { ...OWNER, repo: REPO.repo, ...PAGE, query: string('Literal search text, 1–500 characters. Search operators, qualifiers, quotes, parentheses and backslashes are rejected to preserve the explicit scope.') }, required: ['owner', 'query'], description: 'Search literal issue text in one explicit repository or owner scope. Pull requests are excluded. GitHub search exposes at most 1,000 matches; narrow the query for exhaustive results.' },
 getIssue: { properties: { ...ISSUE, limit: PAGE.limit, labelsCursor: PAGE.cursor, assigneesCursor: PAGE.cursor, subIssuesCursor: PAGE.cursor, blockedByCursor: PAGE.cursor, blockingCursor: PAGE.cursor }, required: ['owner', 'repo', 'issueNumber'], description: 'Read issue details, parent, sub-issues, blocked-by and blocking issues. Each nested collection has its own cursor; repeat the explicit target with the matching cursor parameter.' },
 getIssueComments: { properties: { ...ISSUE, ...PAGE }, required: ['owner', 'repo', 'issueNumber'], description: 'Read a bounded chronological page of issue comments.' },
})
export function validateArguments(operation, args = {}) {
  const spec = OPERATIONS[operation]
  if (!spec || !args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !Object.hasOwn(spec.properties, key))) fail('INVALID_ARGUMENT')
  for (const key of spec.required) if (args[key] === undefined) fail('INVALID_ARGUMENT')
  for (const [key, value] of Object.entries(args)) {
    const type = spec.properties[key].type
    if (type === 'integer' ? !Number.isSafeInteger(value) || value < 1 : type === 'array' ? !Array.isArray(value) : typeof value !== type) fail('INVALID_ARGUMENT')
    if (type === 'string' && (!value.length || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value))) fail('INVALID_ARGUMENT')
  }
  if (args.owner !== undefined && !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(args.owner)) fail('INVALID_ARGUMENT')
  if (args.repo !== undefined && (!/^[A-Za-z0-9_.-]{1,100}$/.test(args.repo) || ['.', '..'].includes(args.repo))) fail('INVALID_ARGUMENT')
  if (args.assignee !== undefined && !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(args.assignee)) fail('INVALID_ARGUMENT')
  for (const key of ['limit', 'nestedLimit', 'fieldValuesLimit']) if (args[key] > (key === 'fieldValuesLimit' ? 20 : 50)) fail('INVALID_ARGUMENT')
  for (const key of ['issueNumber', 'projectNumber']) if (args[key] > 2147483647) fail('INVALID_ARGUMENT')
  if (args.state !== undefined && !['open', 'closed', 'all'].includes(args.state)) fail('INVALID_ARGUMENT')
  if (args.labels !== undefined && (args.labels.length < 1 || args.labels.length > 20 || args.labels.some(label => typeof label !== 'string' || !label.length || label.length > 100 || /[\u0000-\u001f]/.test(label)))) fail('INVALID_ARGUMENT')
  if (args.query !== undefined && (args.query.length > 500 || !args.query.trim() || /[:"\\()\r\n]|\b(?:AND|OR|NOT)\b/i.test(args.query))) fail('INVALID_ARGUMENT')
  if ((args.fieldValuesCursor || args.valueCursor) && !args.itemId) fail('INVALID_ARGUMENT')
  if (args.valueCursor && args.fieldValuesLimit !== 1) fail('INVALID_ARGUMENT')
  if (args.itemId && args.cursor) fail('INVALID_ARGUMENT')
  return { ...args }
}

const unquiescentBackends = new WeakSet()
export function isGitHubBackendFenced(subprocess) { return unquiescentBackends.has(subprocess) }
function cleanupFailure(subprocess) {
  unquiescentBackends.add(subprocess)
  throw new GitHubError('CLEANUP_FAILED', 'The managed process range could not be confirmed stopped. This GitHub backend is fenced against further operations; verify and replace or restart the backend before proceeding.')
}
function awaitSignal(promise, signal) {
  if (signal.aborted) { Promise.resolve(promise).catch(() => {}); return Promise.reject(new GitHubError('CANCELLED', MESSAGES.CANCELLED)) }
  return new Promise((resolve, reject) => {
    const abort = () => reject(new GitHubError('CANCELLED', MESSAGES.CANCELLED))
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
// Reader output never includes spill paths, raw stderr, executable paths, or credentials.
// Command completion does not prove provider-managed range quiescence.
export async function runCollected(subprocess, { argv, cwd, signal, timeoutMs = 30000, maxOutputBytes = 1048576, stdinData, onDispatch, cleanupTimeoutMs = 5000 }) {
  if (isGitHubBackendFenced(subprocess)) cleanupFailure(subprocess)
  if (signal?.aborted) fail('CANCELLED')
  const controller = new AbortController()
  let timedOut = false
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
  let handle
  try {
    onDispatch?.()
    handle = subprocess.spawn({ argv, cwd, signal: controller.signal, graceMs: 1000, stdio: { stdin: stdinData === undefined ? 'ignore' : { data: stdinData }, stdout: { maxBytes: maxOutputBytes }, stderr: { maxBytes: 16384 } } })
    let outcome
    try { outcome = await awaitSignal(handle.done, controller.signal) }
    finally {
      const cleanup = new AbortController()
      const cleanupTimer = setTimeout(() => cleanup.abort(), Math.max(1, Math.min(10000, cleanupTimeoutMs)))
      try {
        if (typeof handle.terminate !== 'function' || typeof handle.waitForExit !== 'function') cleanupFailure(subprocess)
        handle.terminate()
        if (await awaitSignal(handle.waitForExit(cleanup.signal), cleanup.signal) !== true) cleanupFailure(subprocess)
      } catch { cleanupFailure(subprocess) }
      finally { clearTimeout(cleanupTimer) }
    }
    if (signal?.aborted) fail('CANCELLED')
    if (timedOut) fail('TIMEOUT')
    const stdout = handle.collected?.stdout?.readFrom(0)
    const stderr = handle.collected?.stderr?.readFrom(0)
    if (stdout?.lossy || Buffer.byteLength(stdout?.text ?? '') > maxOutputBytes) fail('OUTPUT_TOO_LARGE')
    return { exitCode: outcome.exitCode, stdout: stdout?.text ?? '', stderr: stderr?.text ?? '' }
  } catch (error) {
    if (error?.code === 'CLEANUP_FAILED') throw error
    // A provider that throws before publishing its handle leaves no observable range.
    if (!handle && !(error instanceof GitHubError)) cleanupFailure(subprocess)
    if (signal?.aborted) fail('CANCELLED')
    if (timedOut) fail('TIMEOUT')
    if (error instanceof GitHubError) throw error
    fail('READ_FAILED')
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
}
function required(value) { if (value == null) fail('NOT_FOUND'); if (typeof value !== 'object' || Array.isArray(value)) fail('INVALID_RESPONSE'); return value }
function entity(value, kind) {
  required(value)
  if (typeof value.id !== 'string' || !value.id || typeof value.url !== 'string' || !/^https:\/\/github\.com\//i.test(value.url)) fail('INVALID_RESPONSE')
  if (kind === 'repository') {
    if (typeof value.nameWithOwner !== 'string' || !value.nameWithOwner.includes('/')) fail('INVALID_RESPONSE')
    value.viewerPermission ??= 'unknown'
  }
  if (['issue', 'project'].includes(kind) && (!Number.isSafeInteger(value.number) || value.number < 1)) fail('INVALID_RESPONSE')
  return value
}
function entities(value, kind) { connection(value); for (const node of value.nodes) entity(node, kind); return value }
function connection(value) {
  required(value)
  if (!Array.isArray(value.nodes) || !value.pageInfo || typeof value.pageInfo.hasNextPage !== 'boolean' || (value.pageInfo.hasNextPage && (typeof value.pageInfo.endCursor !== 'string' || !value.pageInfo.endCursor)) || (value.pageInfo.endCursor != null && typeof value.pageInfo.endCursor !== 'string')) fail('INVALID_RESPONSE')
  return value
}
export function boundedResult(data, { maxResultBytes = 196608, maxTextChars = 8192 } = {}) {
  const truncations = []
  let textBudget = Math.floor(maxResultBytes / 3)
  function visit(value, path = 'data', key = '') {
    if (typeof value === 'string') {
      const clean = sanitize(value)
      if (/Cursor$/.test(key) || ['id', 'url'].includes(key)) return clean
      const size = Math.max(0, Math.min(maxTextChars, textBudget))
      textBudget -= Math.min(clean.length, size)
      if (clean.length > size) truncations.push({ path, kind: 'text', returnedCharacters: size, totalCharacters: clean.length, continuation: null, reason: 'Output text bound; GitHub has no text cursor.' })
      return clean.slice(0, size)
    }
    if (Array.isArray(value)) {
      if (value.length > 50) truncations.push({ path, kind: 'array', totalCount: value.length, continuation: null, reason: 'Non-paginated array output bound.' })
      return value.slice(0, 50).map((entry, i) => visit(entry, `${path}[${i}]`))
    }
    if (value && typeof value === 'object') {
      const result = Object.fromEntries(Object.entries(value).map(([k, v]) => [sanitize(k), visit(v, `${path}.${sanitize(k)}`, k)]))
      if (value.pageInfo) {
        connection(value)
        result.truncated = value.pageInfo.hasNextPage
        result.nextCursor = value.pageInfo.hasNextPage ? result.pageInfo.endCursor : null
        if (result.truncated) truncations.push({ path, kind: 'connection', nextCursor: result.nextCursor, continuation: 'Repeat the same explicit target using this connection’s cursor parameter.' })
      }
      return result
    }
    return value
  }
  const result = { host: 'github.com', untrusted: true, data: visit(data), truncated: false, truncations }
  result.truncated = truncations.length > 0
  if (Buffer.byteLength(JSON.stringify(result)) > maxResultBytes) fail('OUTPUT_TOO_LARGE')
  return result
}
export function createGitHubRuntime(subprocess, config = {}) {
  const timeoutMs = Math.min(120000, Math.max(1, config.timeoutMs ?? 30000))
  const maxRetries = Math.min(2, Math.max(0, config.maxRetries ?? 1))
  const maxOutputBytes = Math.min(2097152, Math.max(1, config.maxOutputBytes ?? 1048576))
  const outputConfig = { maxResultBytes: Math.min(262144, Math.max(256, config.maxResultBytes ?? 196608)), maxTextChars: Math.min(16384, Math.max(1, config.maxTextChars ?? 8192)) }
  async function command(binary, argv, exec) {
    if (isGitHubBackendFenced(subprocess)) cleanupFailure(subprocess)
    let executable
    const controller = new AbortController()
    const abort = () => controller.abort()
    if (exec.signal?.aborted) fail('CANCELLED')
    exec.signal?.addEventListener('abort', abort, { once: true })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try { executable = await subprocess.resolveExecutable(binary, undefined, controller.signal) }
    catch { if (exec.signal?.aborted) fail('CANCELLED'); if (timedOut) fail('TIMEOUT'); fail('CLI_UNAVAILABLE') }
    finally { clearTimeout(timer); exec.signal?.removeEventListener('abort', abort) }
    if (exec.signal?.aborted) fail('CANCELLED')
    if (timedOut) fail('TIMEOUT')
    if (typeof executable !== 'string' || !executable) fail('CLI_UNAVAILABLE')
    return runCollected(subprocess, { argv: [executable, ...argv], cwd: exec.cwd, signal: exec.signal, timeoutMs, maxOutputBytes })
  }
  async function graphql(operation, variables, exec) {
    const argv = ['api', 'graphql', '--hostname', 'github.com', '--method', 'POST', '--raw-field', `query=${QUERIES[operation]}`]
    for (const [key, value] of Object.entries(variables)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) for (const entry of value) argv.push('--raw-field', `${key}[]=${entry}`)
      else argv.push(typeof value === 'number' || typeof value === 'boolean' ? '--field' : '--raw-field', `${key}=${value}`)
    }
    for (let attempt = 0; ; attempt++) {
      const response = await command('gh', argv, exec)
      let parsed
      try { parsed = JSON.parse(response.stdout) } catch {
        if (response.exitCode !== 0) { const code = classify(response.stderr); if (code === 'NETWORK_ERROR' && attempt < maxRetries) continue; fail(code) }
        fail('INVALID_RESPONSE')
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('INVALID_RESPONSE')
      if (response.exitCode !== 0 || parsed.errors?.length) {
        const code = classify(`${response.stderr}\n${JSON.stringify(parsed.errors ?? [])}`)
        if (code === 'NETWORK_ERROR' && attempt < maxRetries) continue
        fail(code)
      }
      return required(parsed.data)
    }
  }
  const runtime = {}
  for (const operation of Object.keys(OPERATIONS)) runtime[operation] = async (input = {}, exec = {}) => {
    const args = validateArguments(operation, input)
    if (operation === 'connectionStatus') {
      try {
        const data = await graphql(operation, {}, exec)
        if (typeof data.viewer?.login !== 'string') fail('INVALID_RESPONSE')
        return boundedResult({ cliAvailable: true, authenticated: true, account: data.viewer.login, permissions: { tokenScopes: 'unknown', writeAccess: 'unknown' } }, outputConfig)
      } catch (error) {
        if (!(error instanceof GitHubError) || ['CANCELLED', 'TIMEOUT'].includes(error.code)) throw error
        return boundedResult({ cliAvailable: error.code === 'CLI_UNAVAILABLE' ? false : true, authenticated: error.code === 'AUTH_REQUIRED' ? false : 'unknown', account: null, permissions: { tokenScopes: 'unknown', writeAccess: 'unknown' }, diagnostic: { code: error.code, message: error.message } }, outputConfig)
      }
    }
    if (operation === 'detectRepositories') {
      if (typeof exec.cwd !== 'string' || !exec.cwd) fail('WORKSPACE_REQUIRED')
      const root = await command('git', ['rev-parse', '--show-toplevel'], exec)
      if (root.exitCode !== 0) {
        if (/not a git repository/i.test(root.stderr)) return boundedResult({ gitRepository: false, candidates: [], nonGitHubRemotes: [], ambiguous: false }, outputConfig)
        fail('READ_FAILED')
      }
      const remotes = await command('git', ['remote', '-v'], exec)
      if (remotes.exitCode !== 0) fail('READ_FAILED')
      const candidates = new Map(); const nonGitHubRemotes = []
      const lines = remotes.stdout.trim().split('\n').filter(Boolean)
      if (lines.length > 100) fail('OUTPUT_TOO_LARGE')
      for (const line of lines) {
        const match = /^(\S+)\s+(.+)\s+\((fetch|push)\)$/.exec(line.trim())
        if (!match) fail('INVALID_RESPONSE')
        const remote = normalizeRemoteUrl(match[2])
        const source = { name: sanitize(match[1]), direction: match[3] }
        if (!remote) { nonGitHubRemotes.push({ ...source, reason: 'Not a supported github.com SSH/HTTPS remote; raw URL omitted.' }); continue }
        const key = remote.nameWithOwner.toLowerCase()
        if (!candidates.has(key)) candidates.set(key, { ...remote, sourceRemotes: [] })
        candidates.get(key).sourceRemotes.push(source)
      }
      if (candidates.size > 20) fail('OUTPUT_TOO_LARGE')
      for (const candidate of candidates.values()) {
        try { candidate.repository = entity((await graphql('getRepository', { owner: candidate.owner, repo: candidate.repo }, exec)).repository, 'repository') }
        catch (error) { if (!(error instanceof GitHubError) || ['TIMEOUT', 'CANCELLED'].includes(error.code)) throw error; candidate.diagnostic = { code: error.code, message: error.message } }
      }
      return boundedResult({ gitRepository: true, candidates: [...candidates.values()], nonGitHubRemotes, ambiguous: candidates.size > 1, selectedRepository: null, note: 'No repository is selected or persisted. Fork parents are alternatives, not automatic selections.' }, outputConfig)
    }
    const variables = { ...args }
    delete variables.templateOnly; delete variables.state
    if (Object.hasOwn(OPERATIONS[operation].properties, 'limit')) variables.limit ??= 20
    if (operation === 'listIssues') variables.states = args.state === 'all' ? undefined : [(args.state ?? 'open').toUpperCase()]
    if (operation === 'searchIssues') {
      variables.searchText = `is:issue ${args.repo ? `repo:${args.owner}/${args.repo}` : `user:${args.owner}`} "${args.query.trim()}"`
      delete variables.query; delete variables.owner; delete variables.repo
    }
    if (operation === 'listProjectItems') {
      variables.fieldValuesLimit ??= 10; variables.nestedLimit ??= 20
      if (args.itemId) { delete variables.limit; delete variables.cursor }
    }
    const data = await graphql(operation === 'listProjectItems' && args.itemId ? 'projectItem' : operation, variables, exec)
    let result
    switch (operation) {
      case 'getRepository': result = entity(data.repository, 'repository'); result = { ...result, viewerPermission: result.viewerPermission ?? 'unknown' }; break
      case 'listRepositories': result = entities(required(data.repositoryOwner).repositories, 'repository'); break
      case 'listProjects': {
        result = entities(required(data.repositoryOwner).projectsV2, 'project')
        const scannedCount = result.nodes.length
        result = { ...result, nodes: args.templateOnly ? result.nodes.filter(node => node?.template === true) : result.nodes, scannedCount, templateOnly: args.templateOnly ?? false, totalCountMeaning: 'Unfiltered owner projects' }
        break
      }
      case 'getProject': result = entity(required(data.repositoryOwner).projectV2, 'project'); connection(result.fields); entities(result.repositories, 'repository'); break
      case 'listProjectItems': {
        const project = required(required(data.repositoryOwner).projectV2)
        if (args.itemId) { result = required(data.node); if (!project.id || result.project?.id !== project.id) fail('NOT_FOUND'); connection(result.fieldValues) }
        else { result = connection(project.items); for (const item of result.nodes) connection(required(item).fieldValues) }
        break
      }
      case 'listIssues': result = entities(required(data.repository).issues, 'issue'); break
      case 'searchIssues': result = entities(data.search, 'issue'); result = { ...result, searchLimit: 1000, exhaustive: result.issueCount <= 1000 && !result.pageInfo.hasNextPage }; break
      case 'getIssue': result = entity(required(data.repository).issue, 'issue'); for (const key of ['labels', 'assignees']) connection(result[key]); for (const key of ['subIssues', 'blockedBy', 'blocking']) entities(result[key], 'issue'); if (result.parent) entity(result.parent, 'issue'); break
      case 'getIssueComments': result = connection(required(required(data.repository).issue).comments); break
      default: fail('INVALID_ARGUMENT')
    }
    const bounded = boundedResult(result, outputConfig)
    if (operation === 'searchIssues' && result.issueCount > 1000) {
      bounded.truncated = true
      bounded.truncations.push({ path: 'data', kind: 'search-cap', continuation: null, reason: 'GitHub exposes at most 1,000 search matches. Narrow the literal query or repository scope.' })
    }
    return bounded
  }
  // One deadline covers resolution, all discovery candidates, and retry attempts.
  for (const operation of Object.keys(runtime)) {
    const read = runtime[operation]
    runtime[operation] = async (args = {}, exec = {}) => {
      if (exec.signal?.aborted) fail('CANCELLED')
      const controller = new AbortController()
      let timedOut = false
      const abort = () => controller.abort()
      exec.signal?.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
      try {
        const result = await read(args, { ...exec, signal: controller.signal })
        if (exec.signal?.aborted) fail('CANCELLED')
        if (timedOut) fail('TIMEOUT')
        return result
      } catch (error) {
        if (exec.signal?.aborted) fail('CANCELLED')
        if (timedOut) fail('TIMEOUT')
        throw error
      } finally { clearTimeout(timer); exec.signal?.removeEventListener('abort', abort) }
    }
  }
  return Object.freeze(runtime)
}
