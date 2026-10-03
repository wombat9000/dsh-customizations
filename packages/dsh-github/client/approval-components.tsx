import React, { type ReactNode } from 'react'
import type { NativeApprovalDetailProps } from '../shared/contracts.ts'
import { object, text, safeUrl } from './validation.ts'
import { fieldValueModel } from './field-model.ts'
import { Link } from './common.tsx'
import { css, approvalCss } from './styles.ts'
import { selectApproval, type ApprovalModel } from './approval-model.ts'

export function NativeApprovalDetail({
  sessionId,
  callId,
  useSessionStatus,
  useChat,
}: NativeApprovalDetailProps) {
  const pendingInteraction =
    typeof useSessionStatus === 'function'
      ? useSessionStatus((map) => map.get(sessionId)?.pendingInteraction)
      : undefined
  // RC2's single seat has no next-renderer protocol. Retain its shipped
  // ApprovalCommand fallback for unrelated or malformed requests.
  const command =
    typeof useChat === 'function'
      ? useChat((snapshot) => {
          for (const node of snapshot.nodes.values()) {
            const root =
              object(node) && node.kind === 'tool-call' && object(node.data)
                ? node.data.root
                : undefined
            if (object(root) && root.callId === callId && !('kind' in root)) {
              try {
                if (typeof root.argsRaw !== 'string') return undefined
                const args: unknown = JSON.parse(root.argsRaw)
                return object(args) && typeof args.command === 'string' ? args.command : undefined
              } catch {
                return undefined
              }
            }
          }
          return undefined
        })
      : undefined
  const model = selectApproval({ pendingInteraction, callId })
  return model ? <ApprovalPreview model={model} /> : (command ?? null)
}

// Safe Markdown subset: unsupported syntax remains literal, never HTML or embeds.
// Exact source and JSON string views preserve otherwise invisible whitespace.
export function approvalInline(value: string): ReactNode[] {
  return value
    .split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g)
    .map((part, key) => {
      if (/^`[^`\n]+`$/.test(part)) return <code key={key}>{part.slice(1, -1)}</code>
      if (/^\*\*[^*\n]+\*\*$/.test(part)) return <strong key={key}>{part.slice(2, -2)}</strong>
      if (/^\*[^*\n]+\*$/.test(part)) return <em key={key}>{part.slice(1, -1)}</em>
      const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      return link ? (
        <Link key={key} url={link[2]}>
          {link[1]}
        </Link>
      ) : (
        part
      )
    })
}
export function ApprovalMarkdown({ value }: { value: string }) {
  const nodes: ReactNode[] = [],
    lines = value.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const key = i
    if (/^```/.test(line)) {
      const code: string[] = []
      while (++i < lines.length) {
        const next = lines[i]
        if (next === undefined || /^```\s*$/.test(next)) break
        code.push(next)
      }
      nodes.push(
        <pre key={key} tabIndex={0}>
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/),
      list = line.match(/^\s*(?:[-*+] |\d+\. )(.*)$/)
    if (heading && heading[1] !== undefined && heading[2] !== undefined) {
      const Heading =
        heading[1].length === 1
          ? 'h3'
          : heading[1].length === 2
            ? 'h4'
            : heading[1].length === 3
              ? 'h5'
              : 'h6'
      nodes.push(<Heading key={key}>{approvalInline(heading[2])}</Heading>)
    } else if (list && list[1] !== undefined) {
      nodes.push(<div key={key}>• {approvalInline(list[1])}</div>)
    } else {
      nodes.push(
        <div key={key} style={{ minHeight: '1em', whiteSpace: 'pre-wrap' }}>
          {approvalInline(line)}
        </div>,
      )
    }
  }
  return <div className="gh-approval-markdown">{nodes}</div>
}
export function ApprovalText({
  label,
  value,
  markdown = false,
  exact = false,
}: {
  label: string
  value: string | null
  markdown?: boolean
  exact?: boolean
}) {
  return (
    <section>
      <h4>{label}</h4>
      {value === null ? (
        <p>Not set (null)</p>
      ) : value === '' ? (
        <p>Empty string</p>
      ) : markdown ? (
        <ApprovalMarkdown value={value} />
      ) : (
        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value}</div>
      )}
      {exact && (
        <details>
          <summary>{`${label}: exact source and whitespace`}</summary>
          <pre tabIndex={0}>{value === null ? 'null' : value}</pre>
          <pre tabIndex={0} aria-label={`${label}: JSON string`}>
            {JSON.stringify(value)}
          </pre>
        </details>
      )}
    </section>
  )
}
export function ApprovalResource({ label, value }: { label: string; value: unknown }) {
  const resource = object(value) ? value : undefined
  const repository = object(resource?.repository) ? resource.repository : undefined
  const owner = object(resource?.owner) ? resource.owner : undefined
  const identity = [
    text(resource?.nameWithOwner) ||
      text(repository?.nameWithOwner) ||
      text(owner?.login) ||
      text(resource?.login),
    typeof resource?.number === 'number' && Number.isSafeInteger(resource.number)
      ? `#${resource.number}`
      : '',
  ]
    .filter(Boolean)
    .join(' · ')
  const title =
    text(resource?.title) ||
    text(resource?.name) ||
    identity ||
    'Name unavailable — see technical details'
  return (
    <div className="gh-approval-resource">
      <small>{label}</small>
      <Link url={resource?.url}>
        {title}
        {safeUrl(resource?.url) && <span aria-hidden={true}> ↗</span>}
      </Link>
      {identity && identity !== title && <small>{identity}</small>}
    </div>
  )
}
export function ApprovalPreview({ model }: { model: ApprovalModel | null | undefined }) {
  if (!model) return null
  const {
    value: { operation, targets: t, change: c, exactPayload: p },
    reason,
    extra,
  } = model
  const rows: ReactNode[] = []
  const field = object(c.field) ? c.field : undefined
  const resource = (label: string, value: unknown) =>
    rows.push(<ApprovalResource key={label} label={label} value={value} />)
  // The model validates all operation-specific text. Narrow again at the render
  // boundary rather than casting untrusted JSON to React children.
  const content = (label: string, value: unknown, markdown = false) =>
    rows.push(
      <ApprovalText
        key={label}
        label={label}
        value={value === null ? null : typeof value === 'string' ? value : ''}
        markdown={markdown}
        exact={
          [
            'Proposed project title',
            'Proposed issue title',
            'Proposed issue body',
            'Proposed PR title',
            'Proposed PR body',
            'Current PR title',
            'Current PR body',
            'Review body',
          ].includes(label) ||
          operation === 'updateProject' ||
          (operation === 'setProjectItemField' &&
            field?.dataType === 'TEXT' &&
            ['Before', 'After'].includes(label))
        }
      />,
    )
  const branches = (value: unknown, prefix = '') => {
    if (!object(value)) return
    for (const [key, label] of [
      ['head', 'Head branch (source)'],
      ['base', 'Base branch (destination)'],
    ] as const) {
      const branch = object(value[key]) ? value[key] : undefined
      rows.push(
        <div key={`${prefix}${key}`} className="gh-approval-resource">
          <small>
            {prefix}
            {label}
          </small>
          <code>{text(branch?.ref) || text(branch?.name)}</code>
          <small>Commit {text(branch?.sha)}</small>
        </div>,
      )
    }
  }
  const readiness = (value: unknown) => (value === true ? 'Draft' : 'Ready for review')
  if (operation === 'createProject') {
    resource('Destination owner', t.destination)
    content('Proposed project title', p.title)
    if (t.template) {
      resource('Source template', t.template)
      content('Copy draft issues', String(p.includeDraftIssues))
      const copy = object(c.copyBehavior) ? c.copyBehavior : undefined
      for (const key of ['copied', 'notCopied'])
        content(
          key === 'copied' ? 'Copied' : 'Not copied / visibility',
          copy?.[key] ?? 'Not supplied',
        )
      content('Template behavior', 'Creates an ordinary new project, not a template.')
    }
    content(
      'Creation permission',
      c.creationPermission ?? 'GitHub decides project creation permission.',
    )
  } else if (operation === 'createIssue') {
    resource('Destination repository', t.repository)
    content('Proposed issue title', p.title)
    content('Proposed issue body', p.body, true)
  } else if (operation === 'createPullRequest') {
    resource('Destination repository', t.repository)
    rows.push(
      <div key="state" className="gh-approval-resource">
        <small>State</small>
        <span>Draft</span>
        <small>No branch pushes or merge</small>
      </div>,
    )
    branches(t)
    content('Proposed PR title', p.title)
    content('Proposed PR body', p.body, true)
  } else if (operation === 'updatePullRequest') {
    resource('Destination repository', t.repository)
    resource('Pull request', t.pullRequest)
    const before = object(c.before) ? c.before : undefined
    const after = object(c.after) ? c.after : undefined
    if (Object.hasOwn(p, 'pullRequestId')) {
      content('State before', readiness(before?.draft))
      content('State after', readiness(after?.draft))
      content(
        'Change',
        after?.draft === true
          ? 'Convert this pull request to draft.'
          : 'Mark this pull request ready for review. This does not merge it.',
      )
    } else {
      for (const [key, title] of [
        ['title', 'PR title'],
        ['body', 'PR body'],
      ] as const) {
        if (!Object.hasOwn(p, key)) continue
        content(`Current ${title}`, before?.[key], key === 'body')
        content(`Proposed ${title}`, p[key], key === 'body')
      }
      content('Current state', readiness(object(t.pullRequest) ? t.pullRequest.isDraft : undefined))
      content(
        'Unchanged',
        'Only the selected title/body fields change. Readiness, branches and merge state stay unchanged.',
      )
    }
    branches(t.pullRequest)
  } else if (operation === 'submitPullRequestReview') {
    resource('Destination repository', t.repository)
    resource('Pull request', t.pullRequest)
    content(
      'Review action',
      p.event === 'APPROVE'
        ? 'Approve'
        : p.event === 'REQUEST_CHANGES'
          ? 'Request changes'
          : 'Comment',
    )
    content('Head commit', p.commit_id)
    content('Review body', p.body, true)
    if (Array.isArray(p.comments)) {
      rows.push(
        <section key="comments">
          <h4>Inline review comments ({p.comments.length})</h4>
          {p.comments.map((comment, index) => {
            if (!object(comment)) return null
            const side = comment.side === 'LEFT' ? 'LEFT (old/deleted)' : 'RIGHT (new/context)'
            const range =
              comment.start_line === undefined
                ? String(comment.line)
                : `${String(comment.start_line)}–${String(comment.line)}`
            return (
              <details key={index}>
                <summary>
                  {text(comment.path)} · {side} · Lines {range}
                </summary>
                <ApprovalText
                  label={`Inline comment ${index + 1}`}
                  value={text(comment.body)}
                  markdown
                  exact
                />
              </details>
            )
          })}
        </section>,
      )
    }
    content(
      'Review effect',
      'Submits one review on this exact head commit. It does not mark the PR ready or merge it.',
    )
  } else if (operation === 'createPullRequestStack' || operation === 'addPullRequestToStack') {
    resource('Destination repository', t.repository)
    if (operation === 'addPullRequestToStack') {
      resource('Existing stack', t.stack)
      content(
        'Before stack order',
        Array.isArray(c.before) ? c.before.map((number) => `#${String(number)}`).join(' → ') : '',
      )
    }
    content(
      operation === 'createPullRequestStack'
        ? 'Proposed stack order (bottom to top)'
        : 'After stack order',
      Array.isArray(c.after) ? c.after.map((number) => `#${String(number)}`).join(' → ') : '',
    )
    if (Array.isArray(t.pullRequests)) {
      for (const [index, pr] of t.pullRequests.entries()) {
        const label = `Layer ${index + 1}${index === 0 ? ' (bottom)' : index === t.pullRequests.length - 1 ? ' (top)' : ''}`
        resource(label, pr)
        branches(pr, `${label} · `)
      }
    }
    content(
      'Stack behavior',
      operation === 'createPullRequestStack'
        ? 'Creates a native stack in this bottom-to-top order. No branch base changes or merges.'
        : 'Appends the last listed PR to this existing stack. Existing members and their order stay unchanged; no branch base changes or merges.',
    )
  } else if (operation === 'addIssueDependency') {
    resource('Blocked issue', t.blockedIssue)
    resource('Blocking issue', t.blockingIssue)
    content(
      'Direction',
      'The blocked issue will depend on the blocking issue. Existing dependencies are retained.',
    )
  } else {
    resource('Destination project', t.project)
    if (operation === 'updateProject')
      for (const [key, change] of Object.entries(c)) {
        if (!object(change)) continue
        content(`${key} — Before`, change.before, key === 'readme')
        content(`${key} — After`, change.after, key === 'readme')
      }
    if (operation === 'linkProjectRepository') {
      resource('Repository to link', t.repository)
      content('Change', 'Add this repository link. Existing links are retained.')
    }
    if (operation === 'addProjectItem') {
      resource('Issue to add', t.issue)
      content(
        'Change',
        'Add this existing issue as a project item. The issue body and project README are not changed.',
      )
    }
    if (operation === 'setProjectItemField') {
      resource('Item', object(t.item) ? t.item.content : undefined)
      content(
        'Board field',
        `${text(field?.name) || 'Name unavailable'} (${text(field?.dataType)})`,
      )
      for (const side of ['before', 'after'] as const) {
        const shown = fieldValueModel(c, side)
        content(
          side === 'before' ? 'Before' : 'After',
          shown.identity === shown.label
            ? 'Name unavailable — see exact identifier in technical details'
            : shown.label,
        )
        if (shown.detail) content(`${side} iteration dates`, shown.detail)
      }
    }
  }
  return (
    <section
      className="gh-grant gh-approval-valid"
      aria-label="GitHub approval preview"
      onKeyDown={(event) => {
        // DSH 0.1.7's approval panel treats bubbling Enter as Allow once,
        // excluding buttons/links but not native details summaries. Let the
        // summary toggle normally without answering the surrounding approval.
        if (
          event.key === 'Enter' &&
          event.target instanceof Element &&
          event.target.closest('summary')
        ) {
          event.stopPropagation()
        }
      }}
    >
      <style>{css + approvalCss}</style>
      <h3>{model.title}</h3>
      <p className="gh-note">
        Review this GitHub change. Resource content is untrusted; opening a link does not approve
        the change.
      </p>
      <div
        className="gh-approval-main"
        tabIndex={0}
        role="group"
        aria-label="Proposed GitHub change"
      >
        {rows}
      </div>
      {extra && <pre tabIndex={0}>{extra}</pre>}
      <details>
        <summary>Technical details — complete exact approval payload</summary>
        <pre tabIndex={0}>{reason}</pre>
      </details>
    </section>
  )
}
