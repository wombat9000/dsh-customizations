// This closed registry is the only write-capable API surface. Never accept a document from a tool argument.
const actor = 'viewer { id login }'
const page = 'pageInfo { hasNextPage endCursor }'
const repo = 'id nameWithOwner url isArchived isDisabled hasIssuesEnabled viewerCanCreateIssues viewerPermission'
const project = 'id number title url shortDescription readme updatedAt template public closed viewerCanUpdate owner { ... on User { id login } ... on Organization { id login } }'
const issue = 'id number title url updatedAt viewerCanUpdate repository { id nameWithOwner url }'
const fieldIdentity = '... on ProjectV2FieldCommon { id name dataType }'
const fieldDefinitions = `fields(first:100) { nodes { __typename ${fieldIdentity} ... on ProjectV2Field { isIssueField } ... on ProjectV2SingleSelectField { isIssueField options { id name color description } } ... on ProjectV2IterationField { configuration { duration startDay iterations { id title startDate duration } completedIterations { id title startDate duration } } } } ${page} }`
const fieldValues = `fieldValues(first:100) { nodes { __typename ... on ProjectV2ItemFieldTextValue { text field { ${fieldIdentity} } } ... on ProjectV2ItemFieldNumberValue { number field { ${fieldIdentity} } } ... on ProjectV2ItemFieldDateValue { date field { ${fieldIdentity} } } ... on ProjectV2ItemFieldSingleSelectValue { optionId name field { ${fieldIdentity} } } ... on ProjectV2ItemFieldIterationValue { iterationId title startDate duration field { ${fieldIdentity} } } } ${page} }`
const projectOwner = (selection = project) => `repositoryOwner(login:$owner) { id login ... on User { projectV2(number:$projectNumber) { ${selection} } } ... on Organization { projectV2(number:$projectNumber) { ${selection} } } }`
const resultProject = 'id number title url template owner { ... on User { id login } ... on Organization { id login } }'
export const WRITE_READS = Object.freeze({
 createProject: `query($owner:String!) { ${actor} repositoryOwner(login:$owner) { __typename id login url ... on User { isViewer } ... on Organization { viewerIsAMember } } }`,
 copyProject: `query($owner:String!,$templateOwner:String!,$templateNumber:Int!) { ${actor} repositoryOwner(login:$owner) { __typename id login url ... on User { isViewer } ... on Organization { viewerIsAMember } } templateOwner:repositoryOwner(login:$templateOwner) { id login ... on User { projectV2(number:$templateNumber) { ${project} } } ... on Organization { projectV2(number:$templateNumber) { ${project} } } } }`,
 updateProject: `query($owner:String!,$projectNumber:Int!) { ${actor} ${projectOwner()} }`,
 linkProjectRepository: `query($owner:String!,$projectNumber:Int!,$repositoryOwner:String!,$repo:String!) { ${actor} ${projectOwner(`${project} repositories(first:100) { nodes { id nameWithOwner url } ${page} }`)} repository(owner:$repositoryOwner,name:$repo) { ${repo} } }`,
 createIssue: `query($owner:String!,$repo:String!) { ${actor} repository(owner:$owner,name:$repo) { ${repo} } }`,
 addProjectItem: `query($owner:String!,$projectNumber:Int!,$repositoryOwner:String!,$repo:String!,$issueNumber:Int!) { ${actor} ${projectOwner()} repository(owner:$repositoryOwner,name:$repo) { id nameWithOwner url issue(number:$issueNumber) { ${issue} projectItems(first:100,includeArchived:true) { nodes { id project { id } } ${page} } } } }`,
 setProjectItemField: `query($owner:String!,$projectNumber:Int!,$itemId:ID!) { ${actor} ${projectOwner(`${project} ${fieldDefinitions}`)} node(id:$itemId) { ... on ProjectV2Item { id updatedAt isArchived project { id } content { __typename ... on Issue { id number title url } ... on PullRequest { id number title url } ... on DraftIssue { id title } } ${fieldValues} } } }`,
 addIssueDependency: `query($owner:String!,$repo:String!,$issueNumber:Int!,$blockingOwner:String!,$blockingRepo:String!,$blockingIssueNumber:Int!) { ${actor} repository(owner:$owner,name:$repo) { id nameWithOwner url issue(number:$issueNumber) { ${issue} blockedBy(first:100) { nodes { id number title url } ${page} } } } blockingRepository:repository(owner:$blockingOwner,name:$blockingRepo) { id nameWithOwner url issue(number:$blockingIssueNumber) { ${issue} } } }`,
})
export const MUTATIONS = Object.freeze({
 createProject: `mutation($input:CreateProjectV2Input!) { createProjectV2(input:$input) { projectV2 { ${resultProject} } } }`,
 copyProject: `mutation($input:CopyProjectV2Input!) { copyProjectV2(input:$input) { projectV2 { ${resultProject} } } }`,
 updateProject: `mutation($input:UpdateProjectV2Input!) { updateProjectV2(input:$input) { projectV2 { ${resultProject} title shortDescription readme } } }`,
 linkProjectRepository: 'mutation($input:LinkProjectV2ToRepositoryInput!) { linkProjectV2ToRepository(input:$input) { repository { id nameWithOwner url } } }',
 createIssue: `mutation($input:CreateIssueInput!) { createIssue(input:$input) { issue { id number title body url repository { id nameWithOwner url } } } }`,
 addProjectItem: 'mutation($input:AddProjectV2ItemByIdInput!) { addProjectV2ItemById(input:$input) { item { id project { id url } content { ... on Issue { id number url } } } } }',
 setProjectItemField: 'mutation($input:UpdateProjectV2ItemFieldValueInput!) { updateProjectV2ItemFieldValue(input:$input) { projectV2Item { id project { id url } } } }',
 addIssueDependency: 'mutation($input:AddBlockedByInput!) { addBlockedBy(input:$input) { issue { id number url } blockingIssue { id number url } } }',
})
