// All documents are fixed read-only queries. User input is passed only as variables.
export const PAGE = 'totalCount pageInfo { hasNextPage endCursor }'
export const REPOSITORY = `id name nameWithOwner url description visibility isFork isArchived owner { login } defaultBranchRef { name } viewerPermission parent { id nameWithOwner url }`
export const ISSUE = 'id number title url state createdAt updatedAt repository { nameWithOwner }'
export const PROJECT = 'id number title url shortDescription template public closed createdAt updatedAt owner { ... on User { login } ... on Organization { login } }'
const field = `... on ProjectV2FieldCommon { id name dataType }`
const fields = `nodes { __typename ${field} ... on ProjectV2SingleSelectField { options { id name color description } } ... on ProjectV2IterationField { configuration { duration startDay iterations { id title startDate duration } completedIterations { id title startDate duration } } } ... on ProjectV2MultiSelectField { multiSelectOptions { id name } } } ${PAGE}`
const values = `nodes { __typename
 ... on ProjectV2ItemFieldTextValue { text field { ${field} } }
 ... on ProjectV2ItemFieldNumberValue { number field { ${field} } }
 ... on ProjectV2ItemFieldDateValue { date field { ${field} } }
 ... on ProjectV2ItemFieldSingleSelectValue { name optionId field { ${field} } }
 ... on ProjectV2ItemFieldMultiSelectValue { value options { id name } field { ${field} } }
 ... on ProjectV2ItemIssueFieldValue { field { ${field} } issueFieldValue { __typename ... on IssueFieldDateValue { date: value } ... on IssueFieldTextValue { text: value } ... on IssueFieldNumberValue { number: value } ... on IssueFieldSingleSelectValue { name optionId value } ... on IssueFieldMultiSelectValue { value } } }
 ... on ProjectV2ItemFieldIterationValue { title iterationId startDate duration field { ${field} } }
 ... on ProjectV2ItemFieldMilestoneValue { milestone { title number url } field { ${field} } }
 ... on ProjectV2ItemFieldRepositoryValue { repository { nameWithOwner url } field { ${field} } }
 ... on ProjectV2ItemFieldLabelValue { field { ${field} } labels(first:$nestedLimit,after:$valueCursor) { nodes { id name } ${PAGE} } }
 ... on ProjectV2ItemFieldUserValue { field { ${field} } users(first:$nestedLimit,after:$valueCursor) { nodes { login } ${PAGE} } }
 ... on ProjectV2ItemFieldPullRequestValue { field { ${field} } pullRequests(first:$nestedLimit,after:$valueCursor) { nodes { number title url } ${PAGE} } }
 ... on ProjectV2ItemFieldReviewerValue { field { ${field} } reviewers(first:$nestedLimit,after:$valueCursor) { nodes { __typename ... on User { login } ... on Team { name slug } } ${PAGE} } }
 } ${PAGE}`
const item = `id type isArchived createdAt updatedAt project { id } content { __typename ... on Issue { ${ISSUE} } ... on PullRequest { id number title url state repository { nameWithOwner } } ... on DraftIssue { id title body } } fieldValues(first:$fieldValuesLimit,after:$fieldValuesCursor) { ${values} }`
const ownerProject = selection => `repositoryOwner(login:$owner) { ... on User { projectV2(number:$projectNumber) { ${selection} } } ... on Organization { projectV2(number:$projectNumber) { ${selection} } } }`
export const QUERIES = Object.freeze({
 connectionStatus: 'query { viewer { login } }',
 getRepository: `query($owner:String!,$repo:String!) { repository(owner:$owner,name:$repo) { ${REPOSITORY} } }`,
 listRepositories: `query($owner:String!,$limit:Int!,$cursor:String) { repositoryOwner(login:$owner) { repositories(first:$limit,after:$cursor,orderBy:{field:UPDATED_AT,direction:DESC}) { nodes { ${REPOSITORY} } ${PAGE} } } }`,
 listProjects: `query($owner:String!,$limit:Int!,$cursor:String) { repositoryOwner(login:$owner) { ... on User { projectsV2(first:$limit,after:$cursor) { nodes { ${PROJECT} } ${PAGE} } } ... on Organization { projectsV2(first:$limit,after:$cursor) { nodes { ${PROJECT} } ${PAGE} } } } }`,
 getProject: `query($owner:String!,$projectNumber:Int!,$limit:Int!,$fieldsCursor:String,$repositoriesCursor:String) { ${ownerProject(`${PROJECT} readme fields(first:$limit,after:$fieldsCursor) { ${fields} } repositories(first:$limit,after:$repositoriesCursor) { nodes { ${REPOSITORY} } ${PAGE} }`)} }`,
 listProjectItems: `query($owner:String!,$projectNumber:Int!,$limit:Int!,$cursor:String,$fieldValuesLimit:Int!,$fieldValuesCursor:String,$nestedLimit:Int!,$valueCursor:String) { ${ownerProject(`id items(first:$limit,after:$cursor) { nodes { ${item} } ${PAGE} }`)} }`,
 projectItem: `query($owner:String!,$projectNumber:Int!,$itemId:ID!,$fieldValuesLimit:Int!,$fieldValuesCursor:String,$nestedLimit:Int!,$valueCursor:String) { ${ownerProject('id')} node(id:$itemId) { ... on ProjectV2Item { ${item} } } }`,
 listIssues: `query($owner:String!,$repo:String!,$limit:Int!,$cursor:String,$states:[IssueState!],$labels:[String!],$assignee:String) { repository(owner:$owner,name:$repo) { issues(first:$limit,after:$cursor,states:$states,labels:$labels,filterBy:{assignee:$assignee},orderBy:{field:UPDATED_AT,direction:DESC}) { nodes { ${ISSUE} } ${PAGE} } } }`,
 searchIssues: `query($searchText:String!,$limit:Int!,$cursor:String) { search(query:$searchText,type:ISSUE,first:$limit,after:$cursor) { issueCount pageInfo { hasNextPage endCursor } nodes { ... on Issue { ${ISSUE} } } } }`,
 getIssue: `query($owner:String!,$repo:String!,$issueNumber:Int!,$limit:Int!,$labelsCursor:String,$assigneesCursor:String,$subIssuesCursor:String,$blockedByCursor:String,$blockingCursor:String) { repository(owner:$owner,name:$repo) { issue(number:$issueNumber) { ${ISSUE} body closedAt stateReason author { login } milestone { number title url } parent { ${ISSUE} } labels(first:$limit,after:$labelsCursor) { nodes { id name description color } ${PAGE} } assignees(first:$limit,after:$assigneesCursor) { nodes { login } ${PAGE} } subIssues(first:$limit,after:$subIssuesCursor) { nodes { ${ISSUE} } ${PAGE} } blockedBy(first:$limit,after:$blockedByCursor) { nodes { ${ISSUE} } ${PAGE} } blocking(first:$limit,after:$blockingCursor) { nodes { ${ISSUE} } ${PAGE} } } } }`,
 getIssueComments: `query($owner:String!,$repo:String!,$issueNumber:Int!,$limit:Int!,$cursor:String) { repository(owner:$owner,name:$repo) { issue(number:$issueNumber) { comments(first:$limit,after:$cursor) { nodes { id url body createdAt updatedAt author { login } } ${PAGE} } } } }`,
})
