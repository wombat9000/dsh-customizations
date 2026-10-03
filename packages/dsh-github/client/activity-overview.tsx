import React, { useMemo, useSyncExternalStore } from 'react'
import type { ActivityOverviewProps } from '../shared/contracts.ts'
import { Link } from './common.tsx'
import {
  githubActivityModel,
  type ActivityModel,
  type ActivityResource,
  type ActivityOutcome,
  type ActivityAction,
} from './activity-model.ts'

const outcomeLabels: Record<ActivityOutcome, string> = {
  inspected: 'Inspected · read only',
  confirmed: 'Confirmed',
  'no-change': 'No change · not dispatched',
  denied: 'Denied / not executed',
  failed: 'Failed',
  uncertain: 'Uncertain · success not established',
}
const css = `
.gh-activity{box-sizing:border-box;max-width:100%;min-width:0;padding:12px 14px;border:1px solid var(--dsw-alias-border-primary,rgba(128,128,128,.3));border-radius:var(--dsw-radius-md,10px);font-size:13px;line-height:1.5;overflow-wrap:anywhere;background:var(--dsw-alias-interactive-bg-hover,transparent);color:var(--dsw-alias-label-primary,inherit)}
.gh-activity h3{font-size:14px;margin:0 0 4px}.gh-activity p{margin:4px 0}.gh-activity ul{margin:5px 0;padding-left:18px}.gh-activity li{margin:3px 0}.gh-activity .gh-activity-resource{margin:8px 0}.gh-activity .gh-activity-caption{color:var(--dsw-alias-label-tertiary,inherit);font-size:12px}.gh-activity [role=note]{border-left:2px solid var(--dsw-alias-label-secondary,currentColor);padding-left:8px}.gh-activity summary{cursor:pointer}.gh-activity .gh-activity-outcome{font-weight:600}.gh-activity a{color:inherit;text-decoration:underline}
`
function Actions({ actions }: { actions: ActivityAction[] }) {
  return (
    <ul>
      {actions.map((action, index) => (
        <li key={index}>
          <span className="gh-activity-outcome">{outcomeLabels[action.outcome]}</span>
          {' — '}
          {action.mode === 'write'
            ? 'Write: '
            : action.mode === 'access'
              ? 'Access: '
              : action.mode === 'unknown'
                ? 'Unclassified operation: '
                : ''}
          {action.label}
          {action.count > 1 ? ` (${action.count} calls)` : ''}
        </li>
      ))}
    </ul>
  )
}
// Lead with unresolved outcomes and actual changes, not the first read in the
// turn. This presentation order does not discard or reinterpret any evidence.
const actionPriority = (action: ActivityAction) =>
  action.outcome === 'uncertain' || action.outcome === 'failed' ? 0 : action.mode !== 'read' ? 1 : 2
function Resource({ resource }: { resource: ActivityResource }) {
  const actions = resource.actions.toSorted((a, b) => actionPriority(a) - actionPriority(b))
  return (
    <li className="gh-activity-resource">
      <strong>
        <Link url={resource.url}>{resource.label}</Link>
      </strong>
      <Actions actions={actions.slice(0, 3)} />
      {resource.actions.length > 3 && (
        <details>
          <summary>More actions ({resource.actions.length - 3})</summary>
          <Actions actions={actions.slice(3)} />
        </details>
      )}
    </li>
  )
}
function ActivitySummary({ model }: { model: ActivityModel | null }) {
  if (!model) return null
  const resources = model.resources.toSorted(
    (a, b) =>
      Math.min(...a.actions.map(actionPriority)) - Math.min(...b.actions.map(actionPriority)),
  )
  const first = resources.slice(0, 3),
    rest = resources.slice(3)
  return (
    <section className="gh-activity" role="region" aria-label="GitHub activity overview">
      <style>{css}</style>
      <h3>GitHub activity</h3>
      <p className="gh-activity-caption">
        {model.calls} calls · {model.resources.length} resources · Loaded history, not live status
      </p>
      <p>{model.summary.join(' · ')}</p>
      {model.warnings.map((warning, index) => (
        <p role="note" key={index}>
          {warning}
        </p>
      ))}
      <ul>
        {first.map((resource) => (
          <Resource key={resource.key} resource={resource} />
        ))}
      </ul>
      {rest.length > 0 && (
        <details>
          <summary>More resources ({rest.length})</summary>
          <ul>
            {rest.map((resource) => (
              <Resource key={resource.key} resource={resource} />
            ))}
          </ul>
        </details>
      )}
      <p className="gh-activity-caption">
        Repeated calls are consolidated. Links identify supplied or requested targets, not write
        success. Full evidence and native approvals remain in tool details.
      </p>
    </section>
  )
}
export function ActivityOverview({ turn, useChat }: ActivityOverviewProps) {
  // RC2 turnTail is session scoped. useChat already belongs to the owning session;
  // the stable per-turn source observes hidden tool nodes without fetching history.
  const source = useChat((snapshot) => snapshot.nodes.turnDataSource(turn.turn, 'tool-call'))
  const data = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const model = useMemo(() => githubActivityModel(data, turn), [data, turn])
  return <ActivitySummary model={model} />
}
