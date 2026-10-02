// A separate rootDir proves that exported contracts do not pull sibling host sources in.
import type { LinearReads, LinearIssuePage, LinearReadRuntime } from '@local/dsh-linear/reads'
import { createLinearReads, LINEAR_READ_SERVICE } from '@local/dsh-linear/reads'

declare const runtime: LinearReadRuntime
const facade: Readonly<LinearReads> = createLinearReads(runtime).service
const result: Promise<LinearIssuePage> = facade.listIssues({ priorities: [2], limit: 10 })
const serviceName: 'localLinearReads' = LINEAR_READ_SERVICE
// @ts-expect-error The published read facade carries no mutation authority.
facade.createProject({ name: 'Not authorized', teams: ['ENG'] })
// @ts-expect-error Published pagination limits accept numbers, not strings.
facade.listIssues({ limit: '10' })
void result
void serviceName
