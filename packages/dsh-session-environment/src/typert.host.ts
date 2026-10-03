import { TYPERT_REMOTE } from './remote.js'

export const TYPERT = {
  package: '@local/dsh-session-environment',
  face: 'host',
  schemas: [],
  // Both faces use the protocol-checked descriptors, including lazy codec factories.
  invocations: TYPERT_REMOTE.descriptors,
  model: {
    services: [
      {
        key: 'sessionEnvironment',
        exportName: 'SessionEnvironmentService',
        tags: [],
        description: 'Reads bounded CWD and Git state for one live Session.',
        members: [
          {
            name: 'readCI',
            kind: 'method',
            signature:
              'readCI(request: SessionCIRequest, signal: AbortSignal): Promise<SessionCISnapshot>',
            summary: 'Read optional commit-bound CI for the verified current checkout.',
          },
          {
            name: 'read',
            kind: 'method',
            signature:
              'read(request: SessionEnvironmentRequest, signal: AbortSignal): Promise<SessionEnvironmentSnapshot>',
            summary: 'Read the current environment for one live Session.',
          },
        ],
        types: [
          {
            name: 'SessionEnvironmentRequest',
            declaration:
              'export interface SessionEnvironmentRequest { readonly sessionId: SessionId }',
          },
          {
            name: 'SessionEnvironmentSnapshot',
            declaration:
              'export interface SessionEnvironmentSnapshot { readonly cwd: string | null; readonly home: string; readonly repo: boolean | null; readonly hasHead: boolean | null; readonly branch: string | null; readonly upstream: string | null; readonly ahead: number | null; readonly behind: number | null; readonly dirtyFiles: number | null; readonly additions: number | null; readonly deletions: number | null; readonly checkoutKey?: string; readonly error?: string }',
          },
        ],
      },
    ],
    events: [],
    objects: [],
  },
}
