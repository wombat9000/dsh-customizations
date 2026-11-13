import type { AssignmentRecord, ProposalRecord, ReportRecord, WorkerRecord } from './contracts.js'
import { RECORD_VERSION } from './contracts.js'
import type { KvTableLike, RecordSchema, StorageDomainLike } from './types.js'
import { isRecord } from './types.js'

export interface Table<V> {
  get(key: string): V | undefined
  values(): V[]
  put(key: string, value: V): Promise<void>
}

export interface Tables {
  proposals: Table<ProposalRecord>
  workers: Table<WorkerRecord>
  assignments: Table<AssignmentRecord>
  reports: Table<ReportRecord>
}

/**
 * Plugin-owned durable records. All mutations go through `transaction`, which
 * serializes every coordinator in this Host: ownership checks and the writes
 * they justify cannot interleave. Domain writes and Git/session effects are not
 * one transaction; callers persist reservations and checkpoints before effects.
 */
export class DispatchStore {
  private chain: Promise<unknown> = Promise.resolve()
  private closed = false
  readonly tables: Tables
  private readonly onClose: () => Promise<void>
  constructor(tables: Tables, onClose: () => Promise<void> = async () => {}) {
    this.tables = tables
    this.onClose = onClose
  }

  transaction<T>(operation: (tables: Tables) => Promise<T> | T): Promise<T> {
    const run = this.chain
      .catch(() => undefined)
      .then(() => {
        if (this.closed) throw new Error('Dispatch storage is closed.')
        return operation(this.tables)
      })
    this.chain = run
    return run
  }

  async close() {
    this.closed = true
    await this.chain.catch(() => undefined)
    await this.onClose()
  }
}

class MemoryTable<V> implements Table<V> {
  private readonly map = new Map<string, V>()
  get(key: string) {
    const value = this.map.get(key)
    return value === undefined ? undefined : structuredClone(value)
  }
  values() {
    return [...this.map.values()].map((value) => structuredClone(value))
  }
  async put(key: string, value: V) {
    this.map.set(key, structuredClone(value))
  }
}

/** In-memory tables for tests and Hosts composed without `storageDomain`. */
export function memoryStore(): DispatchStore {
  return new DispatchStore({
    proposals: new MemoryTable(),
    workers: new MemoryTable(),
    assignments: new MemoryTable(),
    reports: new MemoryTable(),
  })
}

// dsh-storage-domain validates stored records with `parse`/`safeParse` at open.
// A structural validator avoids a zod runtime dependency in this bundle.
function versioned<T>(name: string, fields: readonly string[]): RecordSchema<T> {
  const check = (value: unknown): T => {
    if (!isRecord(value) || value.version !== RECORD_VERSION)
      throw new Error(`Invalid Dispatch ${name} record version.`)
    for (const field of fields)
      if (!Object.hasOwn(value, field)) throw new Error(`Dispatch ${name} record lacks ${field}.`)
    return value as T
  }
  return {
    parse: check,
    safeParse(value) {
      try {
        return { success: true, data: check(value) }
      } catch (error) {
        return { success: false, error: error as Error }
      }
    },
  }
}

export const DOMAIN_SPEC = {
  name: 'local_dispatch',
  version: RECORD_VERSION,
  tables: {
    proposals: {
      valueSchema: versioned<ProposalRecord>('proposal', [
        'id',
        'coordinatorId',
        'digest',
        'state',
      ]),
    },
    workers: {
      valueSchema: versioned<WorkerRecord>('worker', ['workerId', 'coordinatorId', 'generation']),
    },
    assignments: {
      valueSchema: versioned<AssignmentRecord>('assignment', ['id', 'workerId', 'workState']),
    },
    reports: {
      valueSchema: versioned<ReportRecord>('report', ['id', 'workerId', 'delivery']),
    },
  },
}

class DomainTable<V> implements Table<V> {
  private readonly table: KvTableLike<unknown>
  constructor(table: KvTableLike<unknown>) {
    this.table = table
  }
  get(key: string) {
    const value = this.table.get(key)
    return value === undefined ? undefined : (structuredClone(value) as V)
  }
  values() {
    return [...this.table.entries()].map(([, value]) => structuredClone(value) as V)
  }
  put(key: string, value: V) {
    return this.table.put(key, structuredClone(value))
  }
}

/** Durable tables in DSH's plugin storage domain; nothing is written to repositories or session logs. */
export async function domainStore(storage: StorageDomainLike): Promise<DispatchStore> {
  const domain = await storage.open(DOMAIN_SPEC)
  return new DispatchStore(
    {
      proposals: new DomainTable(domain.table('proposals')),
      workers: new DomainTable(domain.table('workers')),
      assignments: new DomainTable(domain.table('assignments')),
      reports: new DomainTable(domain.table('reports')),
    },
    () => domain.close(),
  )
}
