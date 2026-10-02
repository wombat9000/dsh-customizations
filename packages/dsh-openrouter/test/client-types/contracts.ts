import type { OpenRouterStatus, RpcEndpoints, RpcResult } from '../../shared/contracts.js'

type Assert<T extends true> = T
type Rejects<Actual, Expected> = Actual extends Expected ? false : true

type SaveRequiresKey = Assert<Rejects<{ target: string }, RpcEndpoints['save']['input']>>
type SaveRequiresTarget = Assert<Rejects<{ apiKey: string }, RpcEndpoints['save']['input']>>
type ClearRequiresTarget = Assert<Rejects<{}, RpcEndpoints['clear']['input']>>
type StatusHasNoKey = Assert<'apiKey' extends keyof OpenRouterStatus ? false : true>
type ServiceMethodIsNotRpc = Assert<'resolveApiKey' extends keyof RpcEndpoints ? false : true>
type FailureHasNoValue = Assert<
  Rejects<{ ok: false; value: OpenRouterStatus }, RpcResult<OpenRouterStatus>>
>

export type ContractCases = [
  SaveRequiresKey,
  SaveRequiresTarget,
  ClearRequiresTarget,
  StatusHasNoKey,
  ServiceMethodIsNotRpc,
  FailureHasNoValue,
]
