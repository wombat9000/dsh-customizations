import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SessionEnvironmentRequest,
  SessionEnvironmentSnapshot,
  SessionCIRequest,
  SessionCISnapshot,
  WorktreePreferenceRequest,
  WorktreePreferenceChange,
  WorktreePreferenceSnapshot,
} from './types.js'
import {
  sessionEnvironmentRequestSchema,
  sessionEnvironmentSnapshotSchema,
  sessionCIRequestSchema,
  sessionCISnapshotSchema,
  worktreePreferenceChangeSchema,
  worktreePreferenceSnapshotSchema,
} from './schemas.js'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$73657373696f6e456e7669726f6e6d656e74 {
    readWorktreePreference: (
      request: WorktreePreferenceRequest,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorktreePreferenceSnapshot>>
    setWorktreePreference: (
      request: WorktreePreferenceChange,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorktreePreferenceSnapshot>>
    readCI: (
      request: SessionCIRequest,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<SessionCISnapshot>>
    read: (
      request: SessionEnvironmentRequest,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<SessionEnvironmentSnapshot>>
  }
  interface TypertRemoteMap {
    'sessionEnvironment/readWorktreePreference': (
      request: WorktreePreferenceRequest,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorktreePreferenceSnapshot>>
    'sessionEnvironment/setWorktreePreference': (
      request: WorktreePreferenceChange,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<WorktreePreferenceSnapshot>>
    'sessionEnvironment/readCI': (
      request: SessionCIRequest,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<SessionCISnapshot>>
    'sessionEnvironment/read': (
      request: SessionEnvironmentRequest,
      signal?: AbortSignal,
    ) => Promise<RemoteResult<SessionEnvironmentSnapshot>>
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
            create: () => sessionEnvironmentRequestSchema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@local/dsh-session-environment/types#SessionEnvironmentSnapshot',
        create: () => sessionEnvironmentSnapshotSchema,
      },
    },
    {
      id: '@local/dsh-session-environment#sessionEnvironment/readCI',
      service: 'sessionEnvironment',
      namespace: 'sessionEnvironment',
      method: 'readCI',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          source: 'json',
          codec: {
            mode: 'strict',
            typeSymbol: '@local/dsh-session-environment/types#SessionCIRequest',
            create: () => sessionCIRequestSchema,
          },
        },
      ],
      cancellation: { parameter: 'signal' },
      result: {
        mode: 'strict',
        typeSymbol: '@local/dsh-session-environment/types#SessionCISnapshot',
        create: () => sessionCISnapshotSchema,
      },
    },
    ...(['readWorktreePreference', 'setWorktreePreference'] as const).map((method) => ({
      id: `@local/dsh-session-environment#sessionEnvironment/${method}`,
      service: 'sessionEnvironment',
      namespace: 'sessionEnvironment',
      method,
      invocation: { kind: 'direct' as const },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          source: 'json' as const,
          codec: {
            mode: 'strict' as const,
            typeSymbol: `@local/dsh-session-environment/types#${method === 'readWorktreePreference' ? 'WorktreePreferenceRequest' : 'WorktreePreferenceChange'}`,
            create: () =>
              method === 'readWorktreePreference'
                ? sessionEnvironmentRequestSchema
                : worktreePreferenceChangeSchema,
          },
        },
      ],
      cancellation: { parameter: 'signal' as const },
      result: {
        mode: 'strict' as const,
        typeSymbol: '@local/dsh-session-environment/types#WorktreePreferenceSnapshot',
        create: () => worktreePreferenceSnapshotSchema,
      },
    })),
  ],
}

export default TYPERT_REMOTE
