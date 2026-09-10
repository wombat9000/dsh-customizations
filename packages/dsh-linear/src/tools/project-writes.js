import { defineTool } from '@deepseek-ai/dsh-tools'
import { PROJECT_SCHEMA, PROJECT_UPDATE_SCHEMA } from './schemas.js'

export const PROJECT_WRITE_TOOL_NAMES = Object.freeze([
  'linear_create_project',
  'linear_update_project',
  'linear_create_project_update',
])

const PREPARE_METHODS = Object.freeze({
  linear_create_project: 'prepareCreate',
  linear_update_project: 'prepareUpdate',
  linear_create_project_update: 'prepareProjectUpdate',
})

const EXECUTE_METHODS = Object.freeze({
  linear_create_project: 'executeCreate',
  linear_update_project: 'executeUpdate',
  linear_create_project_update: 'executeProjectUpdate',
})

function projectText(project, verb) {
  return [
    `${verb}: [${project.name}](${project.url})`,
    `Status: ${project.status?.name ?? project.state ?? 'Unknown'}`,
    `Priority: ${project.priorityLabel}`,
    `Updated: ${project.updatedAt}`,
  ].join('\n')
}

export function registerProjectWriteTools(ctx, writes, config) {
  const prepared = new Map()

  ctx.on('tools/pre-execute', async (exec, next) => {
    const method = PREPARE_METHODS[exec.name]
    if (method === undefined) return next()
    const value = await writes[method](exec.arguments, exec.signal)
    prepared.set(exec.token, value)
    const downstream = await next()
    if (downstream.kind !== 'allow') return downstream
    return { kind: 'ask', reason: value.reason }
  })

  ctx.on('tools/result', (exec) => {
    prepared.delete(exec.token)
  })

  const execute = (name) => async (_args, exec) => {
    const value = prepared.get(exec.token)
    prepared.delete(exec.token)
    if (value === undefined || value.kind !== ({
      linear_create_project: 'create-project',
      linear_update_project: 'update-project',
      linear_create_project_update: 'create-project-update',
    })[name]) {
      throw new Error('Linear write approval was not prepared for this exact tool call.')
    }
    return writes[EXECUTE_METHODS[name]](value, exec.signal)
  }

  ctx.tools.register(defineTool({
    name: 'linear_create_project',
    description: 'Create a Linear project after showing an exact one-shot approval preview.',
    parameters: {
      name: { type: 'string', required: true, description: 'Project name.' },
      teams: { type: 'array', required: true, items: { type: 'string' }, description: 'One or more team IDs, keys, or exact names.' },
      description: { type: 'string', description: 'Short project description, up to 2,000 characters.' },
      content: { type: 'string', description: 'Project Markdown content.' },
      status: { type: 'string', description: 'Project status ID, exact name, or type.' },
      lead: { type: 'string', description: 'Lead user ID, email, exact name, or “me”.' },
      priority: { type: 'integer', description: '0 none, 1 urgent, 2 high, 3 medium, 4 low.' },
      startDate: { type: 'string', description: 'Planned start date as YYYY-MM-DD.' },
      targetDate: { type: 'string', description: 'Planned target date as YYYY-MM-DD.' },
    },
    output: {
      schema: PROJECT_SCHEMA,
      render: (_args, project) => [{ type: 'text', text: projectText(project, 'Created project') }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => false,
    execute: execute('linear_create_project'),
    presentCall: (args) => ({ card: 'generic', title: `Create ${args.name}`, kind: 'edit' }),
  }))

  ctx.tools.register(defineTool({
    name: 'linear_update_project',
    description: 'Update selected Linear project fields after an approval diff and optimistic-concurrency check.',
    parameters: {
      project: { type: 'string', required: true, description: 'Project UUID, API slug ID, exact name, full project URL, or browser path slug.' },
      expectedUpdatedAt: { type: 'string', description: 'Optional updatedAt timestamp from a prior read.' },
      name: { type: 'string', description: 'Replacement project name.' },
      description: { type: 'string', description: 'Replacement short description.' },
      content: { type: 'string', description: 'Replacement Markdown project content.' },
      status: { type: 'string', description: 'Replacement status ID, exact name, or type.' },
      lead: { type: 'string', description: 'Replacement lead ID, email, exact name, or “me”.' },
      priority: { type: 'integer', description: '0 none, 1 urgent, 2 high, 3 medium, 4 low.' },
      startDate: { type: 'string', description: 'Replacement start date as YYYY-MM-DD.' },
      targetDate: { type: 'string', description: 'Replacement target date as YYYY-MM-DD.' },
      teams: { type: 'array', items: { type: 'string' }, description: 'Replacement non-empty team set.' },
      clearFields: {
        type: 'array',
        items: { type: 'string', enum: ['description', 'content', 'lead', 'startDate', 'targetDate'] },
        description: 'Fields to clear explicitly. A field cannot be set and cleared together.',
      },
    },
    output: {
      schema: PROJECT_SCHEMA,
      render: (_args, project) => [{ type: 'text', text: projectText(project, 'Updated project') }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => false,
    execute: execute('linear_update_project'),
    presentCall: (args) => ({ card: 'generic', title: `Update ${args.project}`, kind: 'edit' }),
  }))

  ctx.tools.register(defineTool({
    name: 'linear_create_project_update',
    description: 'Post a Linear project status report after one-shot approval and a concurrency check.',
    parameters: {
      project: { type: 'string', required: true, description: 'Project UUID, API slug ID, exact name, full project URL, or browser path slug.' },
      health: { type: 'string', required: true, enum: ['onTrack', 'atRisk', 'offTrack'], description: 'Reported project health.' },
      body: { type: 'string', required: true, description: 'Markdown status-report body.' },
    },
    output: {
      schema: PROJECT_UPDATE_SCHEMA,
      render: (_args, update) => [{
        type: 'text',
        text: `Posted project update: [${update.health}](${update.url})\n\n${update.body}`,
      }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => false,
    execute: execute('linear_create_project_update'),
    presentCall: (args) => ({ card: 'generic', title: `Post update to ${args.project}`, kind: 'edit' }),
  }))
}
