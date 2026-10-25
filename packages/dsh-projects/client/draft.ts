import type {
  ProjectDefinition,
  ProjectSource,
  ProjectsConfig,
  SourceCandidate,
  SourceTarget,
} from '../shared/contracts.ts'
import { slug } from '../shared/slug.ts'

export type Destination =
  | { mode: 'separate' }
  | { mode: 'combined'; name: string }
  | { mode: 'existing'; projectId: string }

const MAX_SOURCES = 10
const SHORT_IDS: Record<SourceTarget['kind'], string> = {
  'github-repository': 'repo',
  'github-project': 'board',
  'linear-project': 'linear',
  'linear-team': 'team',
}

export class DraftError extends Error {}

// Parses the editor's JSON just far enough to edit it; the host validates fully on save.
export function parseDraft(draft: string): ProjectsConfig {
  let value: unknown
  try {
    value = JSON.parse(draft)
  } catch {
    throw new DraftError('Fix the JSON draft before adding sources.')
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('teams' in value) ||
    !Array.isArray(value.teams) ||
    !('projects' in value) ||
    !Array.isArray(value.projects) ||
    !value.projects.every(
      (project: unknown) =>
        !!project &&
        typeof project === 'object' &&
        'sources' in project &&
        Array.isArray(project.sources),
    )
  )
    throw new DraftError('Enter an object with teams and projects arrays.')
  return value as ProjectsConfig
}

function sameTarget(source: ProjectSource, target: SourceTarget) {
  switch (target.kind) {
    case 'github-repository':
      return (
        source.kind === target.kind &&
        source.owner.toLowerCase() === target.owner.toLowerCase() &&
        source.repo.toLowerCase() === target.repo.toLowerCase()
      )
    case 'github-project':
      return (
        source.kind === target.kind &&
        source.owner.toLowerCase() === target.owner.toLowerCase() &&
        source.projectNumber === target.projectNumber
      )
    case 'linear-project':
      return source.kind === target.kind && source.project === target.project
    case 'linear-team':
      return source.kind === target.kind && source.team === target.team
  }
}

/** Names the projects in the draft that already link this target. */
export function linkedIn(config: ProjectsConfig, target: SourceTarget): string[] {
  return config.projects
    .filter((project) => project.sources.some((source) => sameTarget(source, target)))
    .map((project) => project.name)
}

function unique(base: string, taken: Set<string>) {
  let value = base
  for (let n = 2; taken.has(value); n++) value = `${base.slice(0, 70)}-${n}`
  taken.add(value)
  return value
}

/** Returns a new configuration with the picked candidates linked at the destination. */
export function addSources(
  config: ProjectsConfig,
  picks: SourceCandidate[],
  destination: Destination,
): ProjectsConfig {
  if (!picks.length) throw new DraftError('Select at least one source.')
  const projects = config.projects.map((project) => ({
    ...project,
    sources: [...project.sources],
  }))
  const projectIds = new Set(projects.map((project) => project.id))
  const link = (project: ProjectDefinition, pick: SourceCandidate, preferShort: boolean) => {
    if (project.sources.length >= MAX_SOURCES)
      throw new DraftError(`A project can link at most ${MAX_SOURCES} sources.`)
    const ids = new Set(project.sources.map((source) => source.id))
    const base = preferShort ? SHORT_IDS[pick.target.kind] : pick.suggestedId
    project.sources.push({ id: unique(base, ids), ...pick.target } as ProjectSource)
  }
  if (destination.mode === 'separate') {
    for (const pick of picks) {
      const project: ProjectDefinition = {
        id: unique(pick.suggestedId, projectIds),
        name: pick.name.slice(0, 200),
        ...(pick.description ? { description: pick.description.slice(0, 4000) } : {}),
        conventions: {},
        sources: [],
      }
      link(project, pick, true)
      projects.push(project)
    }
  } else {
    let project: ProjectDefinition | undefined
    if (destination.mode === 'combined') {
      const name = destination.name.trim()
      if (!name) throw new DraftError('Name the new project.')
      project = {
        id: unique(slug(name, 'project'), projectIds),
        name: name.slice(0, 200),
        conventions: {},
        sources: [],
      }
      projects.push(project)
    } else project = projects.find((project) => project.id === destination.projectId)
    if (!project) throw new DraftError('Choose a project in the draft.')
    for (const pick of picks) link(project, pick, false)
  }
  return { ...config, projects }
}
