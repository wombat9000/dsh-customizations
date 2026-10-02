import type {
  PublicTrivyStatus,
  TrivyStatus,
  ScanOptions,
  TrivyResult,
} from '../../shared/contracts.js'
import type { TrivySubprocess } from '../../src/contracts.js'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

type Assert<T extends true> = T
type Rejects<T, U> = T extends U ? false : true
export type HostContracts = [
  Assert<SubprocessRuntime extends TrivySubprocess ? true : false>,
  Assert<
    Rejects<
      { state: 'ready'; checkedAt: string; minimumVersion: string; message: string },
      TrivyStatus
    >
  >,
  Assert<
    Rejects<
      {
        state: 'ready'
        version: string
        path: string
        checkedAt: string
        minimumVersion: string
        message: string
      },
      PublicTrivyStatus
    >
  >,
  Assert<Rejects<'secret', ScanOptions['scanners'][number]>>,
  Assert<Rejects<'EXTREME', ScanOptions['severities'][number]>>,
  Assert<Rejects<string, TrivyResult['totals']['bySeverity']['HIGH']>>,
  Assert<Rejects<unknown, TrivyResult>>,
]
