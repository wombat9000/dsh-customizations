import { GitHubError, runCollected, sanitize, isGitHubBackendFenced } from './runtime.js'
import { WRITE_READS, MUTATIONS } from './write-queries.js'

const str = description => ({ type: 'string', description })
const num = description => ({ type: 'integer', description })
const owner = { owner: str('Explicit github.com user or organization login.') }
const repository = { ...owner, repo: str('Explicit repository name.') }
const project = { ...owner, projectNumber: num('Positive project number under this owner.') }
const existingIssue = { repositoryOwner: str('Explicit issue repository owner, independent of project owner.'), repo: repository.repo, issueNumber: num('Positive issue number.') }
export const WRITE_OPERATIONS = Object.freeze({
 createProject: { name: 'github_create_project', required: ['owner', 'title'], properties: { ...owner, title: str('Exact new project title, 1–256 characters.'), templateOwner: str('Explicit source template owner; requires templateNumber.'), templateNumber: num('Explicit source template project number; requires templateOwner.'), includeDraftIssues: { type: 'boolean', description: 'Copy source draft issues. Template copies only; default false.' } }, description: 'Create one project with a title, optionally copying an explicit template. Approves the source, destination and copy behavior; other metadata edits require another call.' },
 updateProject: { name: 'github_update_project', required: ['owner', 'projectNumber'], properties: { ...project, title: str('Replacement title, 1–256 characters.'), description: str('Replacement short description, up to 1,024 characters. Empty clears it.'), readme: str('Replacement README, up to 20,000 characters. Empty clears it.') }, description: 'Update selected project title, short description or README after an exact before/after preview.' },
 linkProjectRepository: { name: 'github_link_project_repository', required: ['owner', 'projectNumber', 'repositoryOwner', 'repo'], properties: { ...project, repositoryOwner: existingIssue.repositoryOwner, repo: repository.repo }, description: 'Link an explicit repository to an explicit project. Rejects an existing link; requires project update and repository write permission.' },
 createIssue: { name: 'github_create_issue', required: ['owner', 'repo', 'title', 'body'], properties: { ...repository, title: str('Exact issue title, 1–256 characters.'), body: str('Exact issue body, up to 20,000 characters; may be empty.') }, description: 'Create one issue with the complete approved title and body in an explicit repository.' },
 addProjectItem: { name: 'github_add_project_item', required: ['owner', 'projectNumber', 'repositoryOwner', 'repo', 'issueNumber'], properties: { ...project, ...existingIssue }, description: 'Add an existing issue to a project. Rejects an existing membership, including archived items.' },
 setProjectItemField: { name: 'github_set_project_item_field', required: ['owner', 'projectNumber', 'itemId', 'fieldId', 'value'], properties: { ...project, itemId: str('Exact project item node ID, verified against the project.'), fieldId: str('Exact field ID from this project’s field definitions.'), value: { type: 'object', additionalProperties: false, properties: { text: str('TEXT value, up to 20,000 characters.'), number: { type: 'number', description: 'Finite NUMBER value.' }, date: str('DATE value as a real YYYY-MM-DD calendar date.'), singleSelectOptionId: str('Exact option ID in the project SINGLE_SELECT field, including Status.'), iterationId: str('Exact active or completed ITERATION ID in this field.') }, description: 'Exactly one typed value. TEXT, NUMBER, DATE, SINGLE_SELECT and ITERATION only; no clearing, multiselect, issue fields or other built-in field updates.' } }, description: 'Set one item field using the project’s actual type and option/iteration IDs, with its complete before/after value.' },
 addIssueDependency: { name: 'github_add_issue_dependency', required: ['owner', 'repo', 'issueNumber', 'blockingOwner', 'blockingRepo', 'blockingIssueNumber'], properties: { ...repository, issueNumber: num('Issue that will be blocked.'), blockingOwner: str('Explicit blocking issue repository owner.'), blockingRepo: repository.repo, blockingIssueNumber: num('Issue that blocks the first issue.') }, description: 'Add GitHub’s native blocked-by relationship between two explicit issues. Rejects self-dependencies and duplicate relationships.' },
})
const messages = {
 INVALID_ARGUMENT: 'Invalid GitHub write arguments. Use explicit targets and the documented bounded values.',
 UNSAFE_CONTENT: 'The exact content contains credential-looking or unsafe text. It cannot be shown or written by this tool; no mutation was dispatched.',
 APPROVAL_REQUIRED: 'This GitHub write has no unused preparation for this exact approved call.',
 CONTEXT_CHANGED: 'The calling agent or working directory changed after preparation. Request new approval.',
 CONFLICT: 'The authenticated identity, resolved target, permission or relevant remote state changed after approval. No mutation was dispatched. Request a new preview.',
 PERMISSION_DENIED: 'Known GitHub permissions do not allow this operation. No mutation was dispatched.',
 NOT_FOUND: 'A GitHub target is missing or inaccessible; these cases may be indistinguishable. No mutation was dispatched.',
 ALREADY_EXISTS: 'The requested relationship or value already exists. No mutation was dispatched.',
 BOUND_EXCEEDED: 'The exact preview or relevant collection exceeds the safe bound. No mutation was dispatched; use a smaller resource or inspect it outside this write tool.',
 INVALID_RESPONSE: 'GitHub returned an incomplete or malformed response. No mutation was dispatched.',
 AUTH_REQUIRED: 'GitHub authentication is missing or invalid in the managed backend. No mutation was dispatched.',
 READ_FAILED: 'GitHub preflight failed in the managed backend. No mutation was dispatched; no raw diagnostic is exposed.',
 CLI_UNAVAILABLE: 'GitHub CLI is unavailable in the managed backend. No mutation was dispatched.',
 RATE_LIMITED: 'GitHub rate limited the preflight read. No mutation was dispatched.',
 CANCELLED: 'The GitHub write was cancelled before mutation dispatch.',
 TIMEOUT: 'The GitHub write timed out before mutation dispatch.',
}
const fail = code => { throw new GitHubError(code, messages[code] ?? messages.READ_FAILED) }
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function clone(value) { return JSON.parse(JSON.stringify(value)) }
function freeze(value) { if (value && typeof value === 'object') { for (const entry of Object.values(value)) freeze(entry); Object.freeze(value) } return value }
function record(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_RESPONSE'); return value }
function present(value) { if (value == null) fail('NOT_FOUND'); return record(value) }
function clean(value) {
  const serialized = JSON.stringify(value)
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 262144) fail('BOUND_EXCEEDED')
  const inspect = entry => {
    if (typeof entry === 'string') {
      if (sanitize(entry) !== entry || /-----BEGIN [A-Z ]*PRIVATE KEY-----|Authorization\s*:\s*Basic\b|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/i.test(entry)) fail('UNSAFE_CONTENT')
    } else if (entry && typeof entry === 'object') for (const [key, child] of Object.entries(entry)) { inspect(key); inspect(child) }
  }
  inspect(value)
  return value
}
function checkedEntity(value, numbered = false) {
  present(value)
  if (typeof value.id !== 'string' || !value.id || typeof value.url !== 'string' || !/^https:\/\/github\.com\//.test(value.url) || (numbered && (!Number.isSafeInteger(value.number) || value.number < 1))) fail('INVALID_RESPONSE')
  return value
}
function complete(connection) {
  record(connection)
  if (!Array.isArray(connection.nodes) || !connection.pageInfo || typeof connection.pageInfo.hasNextPage !== 'boolean') fail('INVALID_RESPONSE')
  if (connection.pageInfo.hasNextPage || connection.nodes.length > 100) fail('BOUND_EXCEEDED')
  return connection.nodes
}
function id(value) { return typeof value === 'string' && /^[A-Za-z0-9_=-]{1,256}$/.test(value) }
export function validateWriteArguments(operation, input) {
  const spec = WRITE_OPERATIONS[operation]
  if (!spec || !input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !Object.hasOwn(spec.properties, key))) fail('INVALID_ARGUMENT')
  for (const key of spec.required) if (!Object.hasOwn(input, key)) fail('INVALID_ARGUMENT')
  for (const [key, value] of Object.entries(input)) {
    const type = spec.properties[key].type
    if (type === 'integer' ? !Number.isSafeInteger(value) || value < 1 || value > 2147483647 : type === 'object' ? !value || typeof value !== 'object' || Array.isArray(value) : typeof value !== type) fail('INVALID_ARGUMENT')
    if (type === 'string' && (value.length > 20000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))) fail('INVALID_ARGUMENT')
    if (/Owner$/.test(key) || key === 'owner') if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(value)) fail('INVALID_ARGUMENT')
    if (key === 'repo' || key === 'blockingRepo') if (!/^[A-Za-z0-9_.-]{1,100}$/.test(value) || ['.', '..'].includes(value)) fail('INVALID_ARGUMENT')
    if (['itemId', 'fieldId'].includes(key) && !id(value)) fail('INVALID_ARGUMENT')
  }
  if (input.title !== undefined && (!input.title.trim() || input.title.length > 256 || /[\r\n]/.test(input.title))) fail('INVALID_ARGUMENT')
  if (input.description !== undefined && input.description.length > 1024) fail('INVALID_ARGUMENT')
  if (operation === 'createProject') {
    if ((input.templateOwner === undefined) !== (input.templateNumber === undefined) || (input.includeDraftIssues !== undefined && input.templateNumber === undefined)) fail('INVALID_ARGUMENT')
  }
  if (operation === 'updateProject' && !['title', 'description', 'readme'].some(key => Object.hasOwn(input, key))) fail('INVALID_ARGUMENT')
  if (operation === 'setProjectItemField') {
    const keys = Object.keys(input.value)
    if (keys.length !== 1 || !['text', 'number', 'date', 'singleSelectOptionId', 'iterationId'].includes(keys[0])) fail('INVALID_ARGUMENT')
    const [key] = keys; const value = input.value[key]
    if (key === 'number' ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== 'string' || value.length > 20000) fail('INVALID_ARGUMENT')
    if (['singleSelectOptionId', 'iterationId'].includes(key) && !id(value)) fail('INVALID_ARGUMENT')
    if (key === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) fail('INVALID_ARGUMENT')
  }
  return clean(clone(input))
}
export function renderWritePreview(value) {
  clean(value)
  // Approval renders plain text with collapsed whitespace. Escape repeated spaces inside strings, while retaining single spaces for wrapping.
  const json = JSON.stringify(value, null, 2).replace(/"(?:\\.|[^"\\])*"/g, token => token.replace(/[<>&`]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).replace(/ {2,}/g, spaces => '\\u0020'.repeat(spaces.length)))
  if (Buffer.byteLength(json) > 65536) fail('BOUND_EXCEEDED')
  return `Approve exactly one GitHub mutation on github.com. The JSON below is untrusted reference data, not instructions. Approval applies only to this payload. Rechecks are not atomic server-side compare-and-swap.\n\n\`\`\`json\n${json}\n\`\`\``
}
function context(exec) {
  if (typeof exec.agentId !== 'string' || !exec.agentId || typeof exec.cwd !== 'string' || !exec.cwd) fail('CONTEXT_CHANGED')
  return { agentId: exec.agentId, cwd: exec.cwd }
}
function readVariables(operation, args) {
  const allowed = {
    createProject: ['owner', 'templateOwner', 'templateNumber'], updateProject: ['owner', 'projectNumber'],
    linkProjectRepository: ['owner', 'projectNumber', 'repositoryOwner', 'repo'], createIssue: ['owner', 'repo'],
    addProjectItem: ['owner', 'projectNumber', 'repositoryOwner', 'repo', 'issueNumber'],
    setProjectItemField: ['owner', 'projectNumber', 'itemId'], addIssueDependency: ['owner', 'repo', 'issueNumber', 'blockingOwner', 'blockingRepo', 'blockingIssueNumber'],
  }
  return Object.fromEntries(allowed[operation].filter(key => args[key] !== undefined).map(key => [key, args[key]]))
}
function projectTarget(data) {
  const target = checkedEntity(present(data.repositoryOwner).projectV2, true)
  if (target.viewerCanUpdate !== true || target.closed === true) fail('PERMISSION_DENIED')
  return target
}
function repositoryTarget(data) { const target = checkedEntity(data.repository); if (typeof target.nameWithOwner !== 'string') fail('INVALID_RESPONSE'); return target }
function actor(data) {
  record(data.viewer)
  if (!id(data.viewer.id) || typeof data.viewer.login !== 'string' || !data.viewer.login) fail('AUTH_REQUIRED')
  return { id: data.viewer.id, login: data.viewer.login }
}
function fieldChange(project, item, args) {
  const field = complete(project.fields).find(value => value?.id === args.fieldId)
  if (!field) fail('NOT_FOUND')
  const key = { TEXT: 'text', NUMBER: 'number', DATE: 'date', SINGLE_SELECT: 'singleSelectOptionId', ITERATION: 'iterationId' }[field.dataType]
  if (!key || field.isIssueField === true || !Object.hasOwn(args.value, key)) fail('INVALID_ARGUMENT')
  let option = null
  if (key === 'singleSelectOptionId') {
    if (!Array.isArray(field.options) || field.options.length > 100) fail('BOUND_EXCEEDED')
    option = field.options.find(value => value.id === args.value[key]); if (!option) fail('INVALID_ARGUMENT')
  }
  if (key === 'iterationId') {
    if (!Array.isArray(field.configuration?.iterations) || !Array.isArray(field.configuration?.completedIterations)) fail('INVALID_RESPONSE')
    const iterations = [...field.configuration.iterations, ...field.configuration.completedIterations]
    if (iterations.length > 100) fail('BOUND_EXCEEDED')
    option = iterations.find(value => value.id === args.value[key]); if (!option) fail('INVALID_ARGUMENT')
  }
  const before = complete(item.fieldValues).find(value => value?.field?.id === field.id) ?? null
  const previousKey = key === 'singleSelectOptionId' ? 'optionId' : key
  if (before && before[previousKey] === args.value[key]) fail('ALREADY_EXISTS')
  return { field, before, after: args.value, selectedOption: option }
}
function resolve(operation, args, data) {
  record(data); clean(data)
  const account = actor(data)
  let payload; let targets; let change; let mutation = operation
  if (operation === 'createProject') {
    const destination = checkedEntity(data.repositoryOwner)
    if (destination.__typename === 'User' ? destination.isViewer !== true : destination.__typename !== 'Organization' || destination.viewerIsAMember !== true) fail('PERMISSION_DENIED')
    payload = { ownerId: destination.id, title: args.title }
    targets = { destination }
    change = { title: args.title, creationPermission: 'GitHub exposes no definitive owner project-creation capability; membership and identity are rechecked, and the server decides.' }
    if (args.templateNumber !== undefined) {
      const template = checkedEntity(present(data.templateOwner).projectV2, true)
      if (template.template !== true) fail('INVALID_ARGUMENT')
      mutation = 'copyProject'; payload = { ...payload, projectId: template.id, includeDraftIssues: args.includeDraftIssues ?? false }
      targets.template = template
      change.copyBehavior = { includeDraftIssues: payload.includeDraftIssues, sourceTemplate: template.id, ordinaryNewProject: true, copied: 'Source fields, views, insights and workflows except auto-add workflows; draft issues only when explicitly enabled.', notCopied: 'Ordinary issues/pull requests, collaborators and linked repositories. Visibility follows GitHub copy defaults; this call does not set it.' }
    }
  } else if (operation === 'createIssue') {
    const target = repositoryTarget(data)
    if (target.viewerCanCreateIssues !== true || target.hasIssuesEnabled !== true || target.isArchived === true || target.isDisabled === true) fail('PERMISSION_DENIED')
    targets = { repository: target }; payload = { repositoryId: target.id, title: args.title, body: args.body }; change = { title: args.title, body: args.body }
  } else if (operation === 'addIssueDependency') {
    const target = checkedEntity(present(data.repository).issue, true)
    const blocking = checkedEntity(present(data.blockingRepository).issue, true)
    if (target.id === blocking.id) fail('INVALID_ARGUMENT')
    if (target.viewerCanUpdate !== true || blocking.viewerCanUpdate !== true) fail('PERMISSION_DENIED')
    const before = complete(target.blockedBy)
    if (before.some(value => value.id === blocking.id)) fail('ALREADY_EXISTS')
    targets = { blockedIssue: target, blockingIssue: blocking }; payload = { issueId: target.id, blockingIssueId: blocking.id }; change = { before, addBlockedBy: blocking }
  } else {
    const target = projectTarget(data)
    targets = { project: target }
    if (operation === 'updateProject') {
      payload = { projectId: target.id }; change = {}
      for (const [arg, field] of [['title', 'title'], ['description', 'shortDescription'], ['readme', 'readme']]) {
        if (!Object.hasOwn(args, arg)) continue
        if (!(target[field] === null || typeof target[field] === 'string')) fail('INVALID_RESPONSE')
        payload[field] = args[arg]; change[field] = { before: target[field], after: args[arg] }
      }
      if (Object.values(change).every(value => value.before === value.after)) fail('ALREADY_EXISTS')
    } else if (operation === 'linkProjectRepository') {
      const repository = repositoryTarget(data)
      if (!['WRITE', 'MAINTAIN', 'ADMIN'].includes(repository.viewerPermission) || repository.isArchived || repository.isDisabled) fail('PERMISSION_DENIED')
      const before = complete(target.repositories)
      if (before.some(value => value.id === repository.id)) fail('ALREADY_EXISTS')
      targets.repository = repository; payload = { projectId: target.id, repositoryId: repository.id }; change = { before, link: repository }
    } else if (operation === 'addProjectItem') {
      const issue = checkedEntity(present(data.repository).issue, true)
      const before = complete(issue.projectItems)
      if (before.some(value => value.project?.id === target.id)) fail('ALREADY_EXISTS')
      targets.issue = issue; payload = { projectId: target.id, contentId: issue.id }; change = { addIssue: issue, existingProjectItems: before }
    } else if (operation === 'setProjectItemField') {
      const item = present(data.node)
      if (item.id !== args.itemId || item.project?.id !== target.id) fail('NOT_FOUND')
      if (item.isArchived !== false || typeof item.updatedAt !== 'string') fail('PERMISSION_DENIED')
      change = fieldChange(target, item, args)
      targets.item = { id: item.id, content: item.content, project: item.project, updatedAt: item.updatedAt }
      payload = { projectId: target.id, itemId: item.id, fieldId: args.fieldId, value: args.value }
    }
  }
  return { actor: account, mutation, payload, targets, change }
}
function readError(response) {
  const text = `${response.stderr}\n${response.stdout}`
  if (/rate.limit|HTTP 429/i.test(text)) fail('RATE_LIMITED')
  if (/HTTP 401|bad credentials|authentication|gh auth login/i.test(text)) fail('AUTH_REQUIRED')
  if (/HTTP 404|not.found|could not resolve to/i.test(text)) fail('NOT_FOUND')
  if (/HTTP 403|forbidden|insufficient|scope|resource not accessible/i.test(text)) fail('PERMISSION_DENIED')
  fail('READ_FAILED')
}
function checkSignal(signal) { if (signal?.aborted) fail('CANCELLED') }
function raceSignal(promise, signal) {
  checkSignal(signal)
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const abort = () => reject(new GitHubError('CANCELLED', messages.CANCELLED))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
function confirmed(operation, prepared, data) {
  record(data)
  const roots = { createProject: 'createProjectV2', copyProject: 'copyProjectV2', updateProject: 'updateProjectV2', linkProjectRepository: 'linkProjectV2ToRepository', createIssue: 'createIssue', addProjectItem: 'addProjectV2ItemById', setProjectItemField: 'updateProjectV2ItemFieldValue', addIssueDependency: 'addBlockedBy' }
  const result = record(data[roots[prepared.mutation]])
  let resource
  if (['createProject', 'updateProject'].includes(operation)) {
    resource = checkedEntity(result.projectV2, true)
    if (operation === 'createProject') {
      if (resource.owner?.id !== prepared.payload.ownerId || resource.title !== prepared.payload.title || resource.template !== false) fail('INVALID_RESPONSE')
    } else if (resource.id !== prepared.payload.projectId) fail('INVALID_RESPONSE')
    if (operation === 'updateProject') for (const key of ['title', 'shortDescription', 'readme']) if (Object.hasOwn(prepared.payload, key) && resource[key] !== prepared.payload[key]) fail('INVALID_RESPONSE')
  } else if (operation === 'linkProjectRepository') {
    const repository = checkedEntity(result.repository)
    if (repository.id !== prepared.payload.repositoryId) fail('INVALID_RESPONSE')
    resource = { repository, project: prepared.knownTargets.project }
  } else if (operation === 'createIssue') {
    resource = checkedEntity(result.issue, true)
    if (resource.repository?.id !== prepared.payload.repositoryId || resource.title !== prepared.payload.title || resource.body !== prepared.payload.body) fail('INVALID_RESPONSE')
  } else if (operation === 'addProjectItem' || operation === 'setProjectItemField') {
    resource = record(result.item ?? result.projectV2Item)
    if (!id(resource.id) || resource.project?.id !== prepared.payload.projectId || typeof resource.project?.url !== 'string') fail('INVALID_RESPONSE')
    if (operation === 'setProjectItemField' ? resource.id !== prepared.payload.itemId : resource.content?.id !== prepared.payload.contentId) fail('INVALID_RESPONSE')
    resource = { ...resource, url: resource.project.url }
  } else {
    checkedEntity(result.issue, true); checkedEntity(result.blockingIssue, true)
    if (result.issue.id !== prepared.payload.issueId || result.blockingIssue.id !== prepared.payload.blockingIssueId) fail('INVALID_RESPONSE')
    resource = result
  }
  clean(resource)
  return { outcome: 'confirmed', operation, host: 'github.com', untrusted: true, resource, atomicConcurrencyGuarantee: false }
}
export function uncertainWriteResult(prepared, data) {
  const observedResources = []
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const root of Object.values(data)) {
      if (!root || typeof root !== 'object') continue
      for (const key of ['projectV2', 'repository', 'issue', 'blockingIssue', 'item', 'projectV2Item']) {
        const value = root[key]
        const url = value?.url ?? value?.project?.url
        if (!id(value?.id) || typeof url !== 'string' || !/^https:\/\/github\.com\//.test(url)) continue
        const identity = { kind: key, id: value.id, url }
        try { clean(identity); observedResources.push(identity) } catch { /* Never expose unsafe partial response text. */ }
      }
    }
  }
  return { outcome: 'uncertain', operation: prepared.operation, host: 'github.com', untrusted: true, knownTargets: prepared.knownTargets, ...(observedResources.length ? { observedResources } : {}), message: 'The mutation was dispatched and may have succeeded. Do not retry automatically. Inspect the explicit targets and any unconfirmed observed identities with read tools before requesting fresh approval. No rollback was attempted.' }
}
export function createGitHubWriteRuntime(subprocess, config = {}) {
  const timeoutMs = Math.max(1, Math.min(120000, config.timeoutMs ?? 30000))
  const maxOutputBytes = Math.max(1, Math.min(2097152, config.maxOutputBytes ?? 1048576))
  const issued = new WeakSet()
  let queue = Promise.resolve()
  async function timed(exec, task) {
    checkSignal(exec.signal)
    const controller = new AbortController(); let timedOut = false
    const abort = () => controller.abort()
    exec.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    try { return await task({ ...exec, signal: controller.signal }) }
    catch (error) { if (timedOut && error?.code === 'CANCELLED') fail('TIMEOUT'); throw error }
    finally { clearTimeout(timer); exec.signal?.removeEventListener('abort', abort) }
  }
  async function transport(document, variables, exec, onDispatch) {
    if (isGitHubBackendFenced(subprocess)) throw new GitHubError('CLEANUP_FAILED', 'This GitHub backend is fenced because a prior process range could not be confirmed stopped. Verify and replace or restart the backend before proceeding.')
    checkSignal(exec.signal)
    let executable
    try { executable = await raceSignal(Promise.resolve(subprocess.resolveExecutable('gh', undefined, exec.signal)), exec.signal) }
    catch (error) { if (exec.signal?.aborted) fail('CANCELLED'); fail('CLI_UNAVAILABLE') }
    if (typeof executable !== 'string' || !executable) fail('CLI_UNAVAILABLE')
    checkSignal(exec.signal)
    return runCollected(subprocess, { argv: [executable, 'api', 'graphql', '--hostname', 'github.com', '--method', 'POST', '--input', '-'], stdinData: JSON.stringify({ query: document, variables }), cwd: exec.cwd, signal: exec.signal, timeoutMs, maxOutputBytes, onDispatch })
  }
  async function preflight(operation, args, exec) {
    const read = operation === 'createProject' && args.templateNumber !== undefined ? 'copyProject' : operation
    const response = await transport(WRITE_READS[read], readVariables(operation, args), exec)
    if (response.exitCode !== 0) readError(response)
    let parsed
    try { parsed = JSON.parse(response.stdout) } catch { fail('INVALID_RESPONSE') }
    if (parsed?.errors?.length) readError(response)
    record(parsed?.data)
    const resolved = resolve(operation, args, parsed.data)
    return { ...resolved, snapshot: parsed.data }
  }
  async function prepare(operation, input, exec = {}) {
    const args = validateWriteArguments(operation, input)
    const caller = context(exec)
    return timed(exec, async current => {
      const resolved = await preflight(operation, args, current)
      const knownTargets = Object.fromEntries(Object.entries(resolved.targets).map(([key, value]) => [key, { id: value.id, ...(value.url ? { url: value.url } : {}) }]))
      const preview = renderWritePreview({ operation, host: 'github.com', actor: resolved.actor, caller, targets: resolved.targets, change: resolved.change, mutation: resolved.mutation, exactPayload: resolved.payload })
      const prepared = freeze({ operation, args, ...caller, ...resolved, knownTargets, preview })
      issued.add(prepared)
      return prepared
    })
  }
  async function execute(prepared, exec = {}, { onDispatch } = {}) {
    if (!prepared || !issued.has(prepared)) fail('APPROVAL_REQUIRED')
    issued.delete(prepared)
    const caller = context(exec)
    if (caller.agentId !== prepared.agentId || caller.cwd !== prepared.cwd) fail('CONTEXT_CHANGED')
    return timed(exec, async current => {
      const work = queue.then(async () => {
        checkSignal(current.signal)
        let fresh
        try { fresh = await preflight(prepared.operation, prepared.args, current) }
        catch (error) { if (['ALREADY_EXISTS', 'NOT_FOUND', 'PERMISSION_DENIED', 'INVALID_ARGUMENT'].includes(error?.code)) fail('CONFLICT'); throw error }
        if (canonical(fresh.snapshot) !== canonical(prepared.snapshot) || canonical(fresh.payload) !== canonical(prepared.payload) || canonical(fresh.actor) !== canonical(prepared.actor)) fail('CONFLICT')
        let dispatched = false
        let observedData
        try {
          const response = await transport(MUTATIONS[prepared.mutation], { input: prepared.payload }, current, () => { dispatched = true; onDispatch?.(prepared) })
          let parsed
          try { parsed = JSON.parse(response.stdout) } catch { return uncertainWriteResult(prepared) }
          observedData = parsed?.data
          if (response.exitCode !== 0 || parsed?.errors?.length) return uncertainWriteResult(prepared, observedData)
          return confirmed(prepared.operation, prepared, observedData)
        } catch (error) {
          if (dispatched) return { ...uncertainWriteResult(prepared, observedData), ...(isGitHubBackendFenced(subprocess) ? { backendFenced: true, cleanupWarning: 'The managed process range could not be confirmed stopped. No further GitHub operation may run through this backend until it is verified and replaced or restarted.' } : {}) }
          throw error
        }
      })
      queue = work.catch(() => {})
      // Do not race dispatch completion: after dispatch a cancellation must return uncertainty.
      return work
    })
  }
  return Object.freeze({ prepare, execute })
}
