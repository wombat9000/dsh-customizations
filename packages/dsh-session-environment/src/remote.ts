import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionEnvironmentRequest, SessionEnvironmentSnapshot } from './types.js'
import { sessionEnvironmentRequestSchema, sessionEnvironmentSnapshotSchema } from './schemas.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$73657373696f6e456e7669726f6e6d656e74 {
    read: (request: SessionEnvironmentRequest, signal?: AbortSignal) => Promise<RemoteResult<SessionEnvironmentSnapshot>>
  }
  interface TypertRemoteMap {
    'sessionEnvironment/read': (request: SessionEnvironmentRequest, signal?: AbortSignal) => Promise<RemoteResult<SessionEnvironmentSnapshot>>
  }
  interface TypertRemoteNamespaceMap {
    sessionEnvironment: TypertRemoteNamespace$73657373696f6e456e7669726f6e6d656e74
  }
}

export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: '@local/dsh-session-environment',
  descriptors: [
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
}

export default TYPERT_REMOTE
