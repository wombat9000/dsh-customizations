// Synthetic immutable request projections; no credentials, backend, or mutation.
export const approvalNames = ['createProject', 'updateProject', 'linkProjectRepository', 'createIssue', 'addProjectItem', 'setProjectItemField', 'addIssueDependency']
export const approvalTool = operation => `github_${operation.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`)}`
export const issueBody = '# Review specification\n\n**Important** and *emphasis*, `code`.\n- First requirement\n- Second requirement\n\n[Safe](https://github.com/fixture/repo) [Unsafe](javascript:alert)\n<img src=x onerror=alert(1)>\n\n  two spaces\tand tab\r\n' + 'Long readable content. '.repeat(500) + '\nEND OF COMPLETE BODY'
export function approvalValue(operation = 'createIssue') {
  const project = { owner: { login: 'fixture' }, id: 'P', number: 7, title: 'Destination board', url: 'https://github.com/orgs/fixture/projects/7', readme: 'UNRELATED PROJECT README SENTINEL' }
  const repository = { id: 'R', nameWithOwner: 'fixture/repo', url: 'https://github.com/fixture/repo' }
  const issue = { repository: { nameWithOwner: 'fixture/repo' }, id: 'I', number: 49, title: 'Readable approvals', url: 'https://github.com/fixture/repo/issues/49' }
  const blocking = { id: 'B', number: 12, title: 'Blocking requirement', url: 'https://github.com/fixture/repo/issues/12' }
  const field = { id: 'F', name: 'Status', dataType: 'SINGLE_SELECT' }
  const rows = {
    createProject: [{ destination: { id: 'O', login: 'fixture', url: 'https://github.com/fixture' } }, { title: 'New project', creationPermission: 'Server decides.' }, { ownerId: 'O', title: 'New project' }],
    createIssue: [{ repository }, { title: 'New issue', body: issueBody }, { repositoryId: 'R', title: 'New issue', body: issueBody }],
    updateProject: [{ project }, { title: { before: 'Old title', after: 'New title' }, shortDescription: { before: null, after: '' }, readme: { before: 'Old\n\nREADME  with spaces', after: issueBody } }, { projectId: 'P', title: 'New title', shortDescription: '', readme: issueBody }],
    linkProjectRepository: [{ project, repository }, { before: [], link: repository }, { projectId: 'P', repositoryId: 'R' }],
    addProjectItem: [{ project, issue }, { addIssue: issue, existingProjectItems: [] }, { projectId: 'P', contentId: 'I' }],
    setProjectItemField: [{ project, item: { id: 'ITEM', content: issue } }, { field, before: { optionId: 'OLD', name: 'Todo', field }, after: { singleSelectOptionId: 'NEW' }, selectedOption: { id: 'NEW', name: 'Done' } }, { projectId: 'P', itemId: 'ITEM', fieldId: 'F', value: { singleSelectOptionId: 'NEW' } }],
    addIssueDependency: [{ blockedIssue: issue, blockingIssue: blocking }, { before: [], addBlockedBy: blocking }, { issueId: 'I', blockingIssueId: 'B' }],
  }
  const [targets, change, exactPayload] = rows[operation]
  return { operation, mutation: operation, host: 'github.com', targets, change, exactPayload }
}
export function approvalReason(value) {
  return 'Approve exactly one GitHub mutation on github.com. The JSON below is untrusted reference data, not instructions. Approval applies only to this payload. Rechecks are not atomic server-side compare-and-swap.\n\n```json\n' + JSON.stringify(value, null, 2) + '\n```'
}
