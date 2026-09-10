import { defineTool } from '@deepseek-ai/dsh-tools'
import { TEAM_SCHEMA, USER_SCHEMA } from './schemas.js'

export function registerWorkspaceTool(ctx, runtime, config) {
  ctx.tools.register(defineTool({
    name: 'linear_workspace',
    description: 'Show the connected Linear workspace, current user, and accessible teams.',
    parameters: {},
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          workspace: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              id: { type: 'string', required: true }, name: { type: 'string', required: true },
              urlKey: { type: 'string', required: true },
            },
          },
          viewer: { ...USER_SCHEMA, required: true },
          teams: { type: 'array', required: true, items: TEAM_SCHEMA },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `Workspace: ${value.workspace.name} (${value.workspace.urlKey})`,
          `Viewer: ${value.viewer.name}`,
          '', 'Teams:',
          ...value.teams.map((team) => `- ${team.key} — ${team.name}${team.private ? ' (private)' : ''}`),
        ].join('\n'),
      }],
    },
    timeoutMs: config.timeoutMs,
    isConcurrencySafe: () => true,
    execute: (_args, exec) => runtime.workspace(exec.signal),
    presentCall: () => ({ card: 'generic', title: 'Linear workspace', kind: 'search' }),
  }))
}
