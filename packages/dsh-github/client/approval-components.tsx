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
  useSessionPendingInteraction,
  useChat,
}: NativeApprovalDetailProps) {
  const pendingInteraction =
    typeof useSessionPendingInteraction === 'function'
      ? useSessionPendingInteraction((map) => map.get(sessionId))
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
          ['Proposed project title', 'Proposed issue title', 'Proposed issue body'].includes(
            label,
          ) ||
          operation === 'updateProject' ||
          (operation === 'setProjectItemField' &&
            field?.dataType === 'TEXT' &&
            ['Before', 'After'].includes(label))
        }
      />,
    )
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
    <section className="gh-grant gh-approval-valid" aria-label="GitHub approval preview">
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
