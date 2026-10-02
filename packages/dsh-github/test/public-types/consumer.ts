// This consumer owns a separate rootDir. Public types must resolve entirely to
// generated declarations rather than pulling another package's host sources in.
import type { GitHubReads, GitHubReadResult } from '@local/dsh-github/reads'
import { createGitHubReads, GITHUB_READ_SERVICE } from '@local/dsh-github/reads'
import { createGitHubRuntime } from '@local/dsh-github/runtime'

declare const subprocess: Parameters<typeof createGitHubRuntime>[0]
const facade: Readonly<GitHubReads> = createGitHubReads(createGitHubRuntime(subprocess)).service
const result: Promise<GitHubReadResult> = facade.getProject({ owner: 'acme', projectNumber: 4 })
const serviceName: 'localGitHubReads' = GITHUB_READ_SERVICE
void result
void serviceName
