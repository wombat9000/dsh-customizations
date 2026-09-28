import { createHash } from 'node:crypto'
import type {
  Conventions,
  ProjectSource,
  ProjectsConfig,
  ProjectView,
} from '../shared/contracts.js'

const messages = {
  invalid: 'Invalid Projects input. Check identifiers, source targets, and configuration limits.',
  missing: 'The configured project or source was not found.',
  unavailable:
    'This tracker integration is not loaded. Enable the existing GitHub or Linear bundle.',
  conflict: 'Projects configuration changed. Reload it before saving your changes.',
  settings: 'Projects settings cannot be saved in this context.',
  failed:
    'The tracker read failed. Check the existing integration configuration and source access.',
  response: 'The tracker returned an unsupported response. No raw diagnostic is exposed.',
  stopped: 'The Projects service has stopped.',
  cancelled: 'The Projects request was cancelled or timed out.',
} as const
export class ProjectsError extends Error {
  readonly code: keyof typeof messages
  constructor(code: keyof typeof messages) {
    super(messages[code])
    this.code = code
    this.name = 'ProjectsError'
  }
}
export function fail(code: keyof typeof messages): never {
  throw new ProjectsError(code)
}
export const CONVENTION_KEYS = [
  'workSelection',
  'workflow',
  'issueStructure',
  'development',
  'agentBoundaries',
] as const
export function record(value: unknown): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail('invalid')
  return value as Record<string, unknown>
}
export function exact(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  const result = record(value)
  if (Object.keys(result).some((key) => !allowed.includes(key))) fail('invalid')
  return result
}
export function text(value: unknown, max = 200): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  )
    fail('invalid')
  return value
}
export function id(value: unknown): string {
  const result = text(value, 80)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/u.test(result)) fail('invalid')
  return result
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail('invalid')
  return value
}
function unique(values: { id: string }[]) {
  if (new Set(values.map((value) => value.id)).size !== values.length) fail('invalid')
}
function conventions(value: unknown): Conventions {
  const source = exact(value ?? {}, CONVENTION_KEYS)
  const result: Conventions = {}
  for (const key of CONVENTION_KEYS)
    if (source[key] !== undefined) {
      // An empty project value explicitly clears an inherited team convention.
      result[key] = source[key] === '' ? '' : text(source[key], 8000)
    }
  return result
}
function source(value: unknown): ProjectSource {
  const source = record(value)
  const key = id(source.id)
  if (source.kind === 'github-repository' || source.kind === 'github-project') {
    const owner = text(source.owner, 100)
    if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/u.test(owner)) fail('invalid')
    if (source.kind === 'github-repository') {
      exact(source, ['id', 'kind', 'owner', 'repo'])
      const repo = text(source.repo, 100)
      if (!/^[A-Za-z0-9_.-]+$/u.test(repo) || repo === '.' || repo === '..') fail('invalid')
      return { id: key, kind: source.kind, owner, repo }
    }
    exact(source, ['id', 'kind', 'owner', 'projectNumber'])
    if (
      !Number.isSafeInteger(source.projectNumber) ||
      Number(source.projectNumber) < 1 ||
      Number(source.projectNumber) > 2147483647
    )
      fail('invalid')
    return { id: key, kind: source.kind, owner, projectNumber: Number(source.projectNumber) }
  }
  if (source.kind === 'linear-project') {
    exact(source, ['id', 'kind', 'project'])
    // Stable UUIDs prevent a bound workspace/name change silently selecting another project.
    const project = text(source.project, 36)
    if (!UUID.test(project)) fail('invalid')
    return { id: key, kind: source.kind, project }
  }
  if (source.kind === 'linear-team') {
    exact(source, ['id', 'kind', 'team'])
    const team = text(source.team, 36)
    if (!UUID.test(team)) fail('invalid')
    return { id: key, kind: source.kind, team }
  }
  return fail('invalid')
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
export function configuration(value: unknown): ProjectsConfig {
  const input = exact(value, ['teams', 'projects'])
  const teams = array(input.teams, 100).map((value) => {
    const team = exact(value, ['id', 'name', 'conventions'])
    return { id: id(team.id), name: text(team.name), conventions: conventions(team.conventions) }
  })
  unique(teams)
  const projects = array(input.projects, 100).map((value) => {
    const project = exact(value, ['id', 'name', 'description', 'teamId', 'conventions', 'sources'])
    const sources = array(project.sources, 10).map(source)
    unique(sources)
    const teamId = project.teamId === undefined ? undefined : id(project.teamId)
    if (teamId && !teams.some((team) => team.id === teamId)) fail('invalid')
    return {
      id: id(project.id),
      name: text(project.name),
      sources,
      conventions: conventions(project.conventions),
      ...(project.description === undefined
        ? {}
        : { description: text(project.description, 4000) }),
      ...(teamId === undefined ? {} : { teamId }),
    }
  })
  unique(projects)
  const result = { teams, projects }
  if (Buffer.byteLength(JSON.stringify(result)) > 262144) fail('invalid')
  return result
}
export function parseConfiguration(value: string): ProjectsConfig {
  if (Buffer.byteLength(value) > 262144) fail('invalid')
  try {
    return configuration(JSON.parse(value))
  } catch {
    return fail('invalid')
  }
}
export const revisionOf = (value: ProjectsConfig) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')
export function projectViews(value: ProjectsConfig): ProjectView[] {
  return value.projects.map((project) => {
    const team = value.teams.find((team) => team.id === project.teamId)
    const effectiveConventions = { ...team?.conventions, ...project.conventions }
    const conventionOrigins: ProjectView['conventionOrigins'] = {}
    for (const key of CONVENTION_KEYS)
      if (effectiveConventions[key] !== undefined) {
        conventionOrigins[key] = Object.hasOwn(project.conventions, key) ? 'project' : 'team'
      }
    return {
      ...project,
      ...(team ? { teamName: team.name } : {}),
      effectiveConventions,
      conventionOrigins,
    }
  })
}
