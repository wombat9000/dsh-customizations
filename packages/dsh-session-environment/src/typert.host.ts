import { sessionEnvironmentRequestSchema, sessionEnvironmentSnapshotSchema } from './schemas.js'

export const TYPERT = {
  package: '@local/dsh-session-environment',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: '@local/dsh-session-environment#sessionEnvironment/read',
      service: 'sessionEnvironment',
      namespace: 'sessionEnvironment',
      method: 'read',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@local/dsh-session-environment/types#SessionEnvironmentRequest',
            schema: sessionEnvironmentRequestSchema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@local/dsh-session-environment/types#SessionEnvironmentSnapshot',
        schema: sessionEnvironmentSnapshotSchema,
      },
    },
  ],
  model: {
    services: [
      {
        key: 'sessionEnvironment',
        exportName: 'SessionEnvironmentService',
        tags: [],
        description: 'Reads bounded CWD and Git state for one live Session.',
        members: [
          {
            name: 'read',
            kind: 'method',
            signature: 'read(request: SessionEnvironmentRequest, signal: AbortSignal): Promise<SessionEnvironmentSnapshot>',
            summary: 'Read the current environment for one live Session.',
          },
        ],
        types: [
          {
            name: 'SessionEnvironmentRequest',
            declaration: 'export interface SessionEnvironmentRequest { readonly sessionId: SessionId }',
          },
          {
            name: 'SessionEnvironmentSnapshot',
            declaration: 'export interface SessionEnvironmentSnapshot { readonly cwd: string | null; readonly home: string; readonly repo: boolean | null; readonly hasHead: boolean | null; readonly branch: string | null; readonly upstream: string | null; readonly ahead: number | null; readonly behind: number | null; readonly dirtyFiles: number | null; readonly additions: number | null; readonly deletions: number | null; readonly error?: string }',
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}
