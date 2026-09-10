export const TEAM_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true }, key: { type: 'string', required: true },
    name: { type: 'string', required: true }, private: { type: 'boolean', required: true },
  },
}

export const USER_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true }, name: { type: 'string', required: true },
    displayName: { type: 'string' }, email: { type: 'string' }, active: { type: 'boolean' },
    isMe: { type: 'boolean' }, url: { type: 'string' },
  },
}

export const STATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true }, name: { type: 'string', required: true },
    type: { type: 'string', required: true }, color: { type: 'string' },
  },
}

export const LABEL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true }, name: { type: 'string', required: true },
    color: { type: 'string' }, description: { type: 'string' },
  },
}

export const PAGE_INFO_SCHEMA = {
  type: 'object', required: true, additionalProperties: false,
  properties: {
    hasNextPage: { type: 'boolean', required: true },
    nextCursor: { type: 'string' },
  },
}

export const CYCLE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true }, number: { type: 'integer', required: true },
    name: { type: 'string' }, description: { type: 'string' }, teamId: { type: 'string' },
    team: TEAM_SCHEMA, isActive: { type: 'boolean', required: true },
    isFuture: { type: 'boolean', required: true }, isPast: { type: 'boolean', required: true },
    isPrevious: { type: 'boolean', required: true }, isNext: { type: 'boolean', required: true },
    progress: { type: 'number', required: true }, startsAt: { type: 'string', required: true },
    endsAt: { type: 'string', required: true }, updatedAt: { type: 'string', required: true },
  },
}

export const PROJECT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true }, name: { type: 'string', required: true },
    description: { type: 'string' }, content: { type: 'string' }, url: { type: 'string', required: true },
    slugId: { type: 'string', required: true }, priority: { type: 'integer', required: true },
    priorityLabel: { type: 'string', required: true }, progress: { type: 'number', required: true },
    health: { type: 'string' }, state: { type: 'string' }, leadId: { type: 'string' },
    statusId: { type: 'string' }, lead: USER_SCHEMA,
    status: {
      type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'string', required: true }, name: { type: 'string', required: true },
        type: { type: 'string', required: true },
      },
    },
    teams: { type: 'array', items: TEAM_SCHEMA },
    startDate: { type: 'string' }, targetDate: { type: 'string' },
    createdAt: { type: 'string', required: true }, updatedAt: { type: 'string', required: true },
  },
}

export const PROJECT_UPDATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true }, projectId: { type: 'string', required: true },
    body: { type: 'string', required: true },
    health: { type: 'string', required: true }, url: { type: 'string', required: true },
    userId: { type: 'string' }, author: USER_SCHEMA,
    createdAt: { type: 'string', required: true }, updatedAt: { type: 'string', required: true },
  },
}

export const ISSUE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true }, identifier: { type: 'string', required: true },
    title: { type: 'string', required: true }, description: { type: 'string' },
    url: { type: 'string', required: true }, priority: { type: 'integer', required: true },
    priorityLabel: { type: 'string', required: true }, teamId: { type: 'string' },
    stateId: { type: 'string' }, assigneeId: { type: 'string' }, projectId: { type: 'string' },
    cycleId: { type: 'string' }, labelIds: { type: 'array', items: { type: 'string' } },
    dueDate: { type: 'string' }, state: STATE_SCHEMA, team: TEAM_SCHEMA, assignee: USER_SCHEMA,
    project: PROJECT_SCHEMA, cycle: CYCLE_SCHEMA,
    labels: { type: 'array', items: LABEL_SCHEMA },
    createdAt: { type: 'string', required: true }, updatedAt: { type: 'string', required: true },
  },
}

export const COMMENT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', required: true }, body: { type: 'string', required: true },
    url: { type: 'string', required: true }, issueId: { type: 'string' }, parentId: { type: 'string' },
    userId: { type: 'string' }, author: USER_SCHEMA, editedAt: { type: 'string' },
    resolvedAt: { type: 'string' }, createdAt: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
  },
}

export const PAGE_PARAMETERS = {
  limit: { type: 'integer', description: 'Maximum results, 1–50.' },
  cursor: { type: 'string', description: 'Opaque nextCursor from a previous call.' },
}
