import type { PublicTrivyStatus, StatusEndpoints, StatusResponse } from '../../shared/contracts.js'

type Assert<T extends true> = T
type Rejects<T, U> = T extends U ? false : true
export type ClientContracts = [
  Assert<Rejects<'scan', keyof StatusEndpoints>>,
  Assert<Rejects<{ target: string }, StatusEndpoints['get']['input']>>,
  Assert<Rejects<{ force: true }, StatusEndpoints['recheck']['input']>>,
  Assert<Rejects<{ ok: true; value: unknown }, StatusResponse>>,
  Assert<
    Rejects<
      { state: 'ready'; checkedAt: string; minimumVersion: string; message: string },
      PublicTrivyStatus
    >
  >,
  Assert<
    Rejects<
      {
        state: 'ready'
        version: string
        path: undefined
        checkedAt: string
        minimumVersion: string
        message: string
      },
      PublicTrivyStatus
    >
  >,
]
