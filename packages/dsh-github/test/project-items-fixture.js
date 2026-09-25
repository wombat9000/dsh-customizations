// Synthetic historical data only; no GitHub calls or credentials.
export const itemConnection = (nodes, more = false) => ({
  nodes,
  totalCount: nodes.length,
  pageInfo: { hasNextPage: more, endCursor: more ? 'fixture-next' : null },
  nextCursor: more ? 'fixture-next' : null,
  truncated: more,
})
export const projectItems = Array.from({ length: 6 }, (_, index) => {
  const number = index + 1,
    repository = {
      nameWithOwner: `fixture-org/${index % 2 ? 'other' : 'demo'}`,
      url: `https://github.com/fixture-org/${index % 2 ? 'other' : 'demo'}`,
    }
  const title = `Compact project item ${number}`
  return {
    id: `PVTI_compact_${number}`,
    project: { id: 'P_compact' },
    isArchived: index === 4,
    content: {
      __typename: 'Issue',
      id: `I_compact_${number}`,
      number,
      title,
      state: index % 2 ? 'CLOSED' : 'OPEN',
      url: `${repository.url}/issues/${number}`,
    },
    fieldValues: itemConnection([
      { field: { name: 'Title', dataType: 'TEXT' }, text: title },
      {
        field: { name: 'Status', dataType: 'SINGLE_SELECT' },
        name: index % 2 ? 'In progress' : 'Done',
        optionId: `O_${index}`,
      },
      { field: { name: 'Repository', dataType: 'REPOSITORY' }, repository },
      {
        field: { name: 'Linked pull requests', dataType: 'PULL_REQUEST' },
        pullRequests: itemConnection(
          index === 0
            ? [{ number: 20, title: 'Implement compact rows', url: `${repository.url}/pull/20` }]
            : [],
        ),
      },
      { field: { name: 'Notes', dataType: 'TEXT' }, text: '' },
      { field: { name: 'Estimate', dataType: 'NUMBER' }, number: 0 },
    ]),
  }
})
export const projectItemsBlock = (data = itemConnection(projectItems), extra = {}) => ({
  kind: 'tool-result',
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        host: 'github.com',
        untrusted: true,
        data,
        truncated: false,
        truncations: [],
        ...extra,
      }),
    },
  ],
})
