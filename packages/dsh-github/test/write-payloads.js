import { connection } from './fixtures.js'

export const actor = { id: 'U_ACTOR', login: 'fixture-user' }
export const owner = { __typename: 'Organization', id: 'O_DEST', login: 'destination', url: 'https://github.com/destination', viewerIsAMember: true }
export const repository = { id: 'R_TARGET', nameWithOwner: 'source/example', url: 'https://github.com/source/example', isArchived: false, isDisabled: false, hasIssuesEnabled: true, viewerCanCreateIssues: true, viewerPermission: 'WRITE' }
export const project = { id: 'P_TARGET', number: 7, title: 'Original project', url: 'https://github.com/orgs/destination/projects/7', shortDescription: 'Original description', readme: 'Original README', updatedAt: '2026-01-01T00:00:00Z', template: false, public: false, closed: false, viewerCanUpdate: true, owner: { id: 'O_DEST', login: 'destination' } }
export const issue = { id: 'I_TARGET', number: 33, title: 'Target issue', url: 'https://github.com/source/example/issues/33', updatedAt: '2026-01-01T00:00:00Z', viewerCanUpdate: true, repository: { id: repository.id, nameWithOwner: repository.nameWithOwner, url: repository.url } }
export const blocker = { ...issue, id: 'I_BLOCKER', number: 34, url: 'https://github.com/blockers/other/issues/34', repository: { id: 'R_BLOCKER', nameWithOwner: 'blockers/other', url: 'https://github.com/blockers/other' } }
export const template = { ...project, id: 'P_TEMPLATE', number: 9, title: 'Source template', template: true, owner: { id: 'O_TEMPLATE', login: 'templates' }, url: 'https://github.com/orgs/templates/projects/9' }
export const fields = [
  { __typename: 'ProjectV2Field', id: 'F_TEXT', name: 'Notes', dataType: 'TEXT', isIssueField: false },
  { __typename: 'ProjectV2Field', id: 'F_NUMBER', name: 'Estimate', dataType: 'NUMBER', isIssueField: false },
  { __typename: 'ProjectV2Field', id: 'F_DATE', name: 'Due', dataType: 'DATE', isIssueField: false },
  { __typename: 'ProjectV2SingleSelectField', id: 'F_STATUS', name: 'Status', dataType: 'SINGLE_SELECT', isIssueField: false, options: [{ id: 'OPT_TODO', name: 'Todo' }, { id: 'OPT_READY', name: 'Ready' }] },
  { __typename: 'ProjectV2IterationField', id: 'F_ITERATION', name: 'Sprint', dataType: 'ITERATION', configuration: { iterations: [{ id: 'ITER_ACTIVE', title: 'Current sprint', startDate: '2026-01-01', duration: 14 }], completedIterations: [{ id: 'ITER_OLD', title: 'Old sprint', startDate: '2025-12-01', duration: 14 }] } },
]
export const item = { id: 'PI_TARGET', updatedAt: '2026-01-01T00:00:00Z', isArchived: false, project: { id: project.id }, content: { __typename: 'Issue', id: issue.id, number: issue.number, title: issue.title, url: issue.url }, fieldValues: connection([{ __typename: 'ProjectV2ItemFieldSingleSelectValue', optionId: 'OPT_TODO', name: 'Todo', field: { id: 'F_STATUS', name: 'Status', dataType: 'SINGLE_SELECT' } }]) }

export function snapshot(operation) {
  const common = { viewer: actor, repositoryOwner: { ...owner, projectV2: project } }
  const snapshots = {
    createProject: { viewer: actor, repositoryOwner: owner },
    copyProject: { viewer: actor, repositoryOwner: owner, templateOwner: { id: 'O_TEMPLATE', login: 'templates', projectV2: template } },
    updateProject: common,
    linkProjectRepository: { ...common, repositoryOwner: { ...owner, projectV2: { ...project, repositories: connection([]) } }, repository },
    createIssue: { viewer: actor, repository },
    addProjectItem: { ...common, repository: { ...repository, issue: { ...issue, projectItems: connection([]) } } },
    setProjectItemField: { ...common, repositoryOwner: { ...owner, projectV2: { ...project, fields: connection(fields) } }, node: item },
    addIssueDependency: { viewer: actor, repository: { ...repository, issue: { ...issue, blockedBy: connection([]) } }, blockingRepository: { ...blocker.repository, issue: blocker } },
  }
  return structuredClone(snapshots[operation])
}

export const args = {
  createProject: { owner: 'destination', title: 'New project' },
  copyProject: { owner: 'destination', title: 'Copied project', templateOwner: 'templates', templateNumber: 9, includeDraftIssues: false },
  updateProject: { owner: 'destination', projectNumber: 7, title: 'Updated project', description: 'Updated description', readme: 'Updated README' },
  linkProjectRepository: { owner: 'destination', projectNumber: 7, repositoryOwner: 'source', repo: 'example' },
  createIssue: { owner: 'source', repo: 'example', title: 'New issue', body: 'Complete issue specification' },
  addProjectItem: { owner: 'destination', projectNumber: 7, repositoryOwner: 'source', repo: 'example', issueNumber: 33 },
  setProjectItemField: { owner: 'destination', projectNumber: 7, itemId: 'PI_TARGET', fieldId: 'F_STATUS', value: { singleSelectOptionId: 'OPT_READY' } },
  addIssueDependency: { owner: 'source', repo: 'example', issueNumber: 33, blockingOwner: 'blockers', blockingRepo: 'other', blockingIssueNumber: 34 },
}

export function mutationResult(operation) {
  const results = {
    createProject: { createProjectV2: { projectV2: { ...project, id: 'P_CREATED', number: 8, title: args.createProject.title, url: 'https://github.com/orgs/destination/projects/8' } } },
    copyProject: { copyProjectV2: { projectV2: { ...project, id: 'P_COPIED', number: 10, title: args.copyProject.title, url: 'https://github.com/orgs/destination/projects/10' } } },
    updateProject: { updateProjectV2: { projectV2: { ...project, ...args.updateProject, shortDescription: args.updateProject.description } } },
    linkProjectRepository: { linkProjectV2ToRepository: { repository } },
    createIssue: { createIssue: { issue: { ...issue, id: 'I_CREATED', number: 35, title: args.createIssue.title, body: args.createIssue.body, url: 'https://github.com/source/example/issues/35' } } },
    addProjectItem: { addProjectV2ItemById: { item: { ...item, project: { id: project.id, url: project.url } } } },
    setProjectItemField: { updateProjectV2ItemFieldValue: { projectV2Item: { id: item.id, project: { id: project.id, url: project.url } } } },
    addIssueDependency: { addBlockedBy: { issue, blockingIssue: blocker } },
  }
  return structuredClone(results[operation])
}
