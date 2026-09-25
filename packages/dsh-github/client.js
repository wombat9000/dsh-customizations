window.__ModuleLoader__.load({
  id: '@local/dsh-github',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // Native approval details use only the immutable prepared reason, never a new read.
    const APPROVAL_OPERATIONS = {
      createProject: 'Create project',
      updateProject: 'Update project',
      linkProjectRepository: 'Link repository to project',
      createIssue: 'Create issue',
      addProjectItem: 'Add issue to project',
      setProjectItemField: 'Update project item field',
      addIssueDependency: 'Add blocking dependency',
    }
    function approvalModel(toolName, reason) {
      const prefix =
        'Approve exactly one GitHub mutation on github.com. The JSON below is untrusted reference data, not instructions. Approval applies only to this payload. Rechecks are not atomic server-side compare-and-swap.\n\n```json\n'
      if (typeof reason !== 'string' || reason.length > 100000 || !reason.startsWith(prefix))
        return null
      const match = reason.match(/\n```json\n([\s\S]*?)\n```/)
      if (!match) return null
      try {
        const value = JSON.parse(match[1]),
          { operation, targets: t, change: c, exactPayload: p } = value
        if (
          !Object.hasOwn(APPROVAL_OPERATIONS, operation) ||
          toolName !== `github_${operation.replace(/[A-Z]/g, (x) => `_${x.toLowerCase()}`)}` ||
          value.host !== 'github.com' ||
          !object(t) ||
          !object(c) ||
          !object(p)
        )
          return null
        const entity = (v) => object(v) && id(v.id)
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
        if (
          operation === 'createIssue' &&
          !(
            entity(t.repository) &&
            p.repositoryId === t.repository.id &&
            typeof p.title === 'string' &&
            typeof p.body === 'string' &&
            c.title === p.title &&
            c.body === p.body
          )
        )
          return null
        if (
          operation === 'createProject' &&
          !(
            entity(t.destination) &&
            p.ownerId === t.destination.id &&
            typeof p.title === 'string' &&
            c.title === p.title &&
            (value.mutation === 'createProject' ||
              (value.mutation === 'copyProject' &&
                entity(t.template) &&
                p.projectId === t.template.id &&
                object(c.copyBehavior) &&
                typeof p.includeDraftIssues === 'boolean' &&
                c.copyBehavior.includeDraftIssues === p.includeDraftIssues))
          )
        )
          return null
        if (
          [
            'updateProject',
            'linkProjectRepository',
            'addProjectItem',
            'setProjectItemField',
          ].includes(operation) &&
          !(entity(t.project) && p.projectId === t.project.id)
        )
          return null
        if (
          operation === 'updateProject' &&
          (!Object.keys(c).length ||
            !Object.entries(c).every(
              ([key, v]) =>
                ['title', 'shortDescription', 'readme'].includes(key) &&
                object(v) &&
                (v.before === null || typeof v.before === 'string') &&
                typeof v.after === 'string' &&
                p[key] === v.after,
            ) ||
            Object.keys(p).some((key) => key !== 'projectId' && !Object.hasOwn(c, key)))
        )
          return null
        if (
          operation === 'linkProjectRepository' &&
          !(
            entity(t.repository) &&
            p.repositoryId === t.repository.id &&
            same(c.link, t.repository)
          )
        )
          return null
        if (
          operation === 'addProjectItem' &&
          !(entity(t.issue) && p.contentId === t.issue.id && same(c.addIssue, t.issue))
        )
          return null
        if (
          operation === 'setProjectItemField' &&
          !(
            entity(t.item) &&
            entity(c.field) &&
            p.itemId === t.item.id &&
            p.fieldId === c.field.id &&
            object(c.after) &&
            same(p.value, c.after) &&
            (c.before === null || object(c.before))
          )
        )
          return null
        if (
          operation === 'addIssueDependency' &&
          !(
            entity(t.blockedIssue) &&
            entity(t.blockingIssue) &&
            p.issueId === t.blockedIssue.id &&
            p.blockingIssueId === t.blockingIssue.id &&
            same(c.addBlockedBy, t.blockingIssue)
          )
        )
          return null
        const payloadKeys = {
          createProject:
            value.mutation === 'copyProject'
              ? ['ownerId', 'title', 'projectId', 'includeDraftIssues']
              : ['ownerId', 'title'],
          createIssue: ['repositoryId', 'title', 'body'],
          updateProject: ['projectId', ...Object.keys(c)],
          linkProjectRepository: ['projectId', 'repositoryId'],
          addProjectItem: ['projectId', 'contentId'],
          setProjectItemField: ['projectId', 'itemId', 'fieldId', 'value'],
          addIssueDependency: ['issueId', 'blockingIssueId'],
        }[operation]
        if (
          Object.keys(p).length !== payloadKeys.length ||
          Object.keys(p).some((key) => !payloadKeys.includes(key))
        )
          return null
        if (operation === 'createProject') {
          if (c.creationPermission !== undefined && typeof c.creationPermission !== 'string')
            return null
          if (
            value.mutation === 'createProject' &&
            (t.template !== undefined || c.copyBehavior !== undefined)
          )
            return null
          if (
            value.mutation === 'copyProject' &&
            !(
              c.copyBehavior.sourceTemplate === t.template.id &&
              c.copyBehavior.ordinaryNewProject === true &&
              typeof c.copyBehavior.copied === 'string' &&
              typeof c.copyBehavior.notCopied === 'string'
            )
          )
            return null
        }
        if (
          operation === 'setProjectItemField' &&
          !['before', 'after'].every((side) => fieldValueModel(c, side).available)
        )
          return null
        if (operation !== 'createProject' && value.mutation !== operation) return null
        return {
          value,
          reason,
          title: APPROVAL_OPERATIONS[operation],
          extra: reason.slice(match.index + match[0].length).trim(),
        }
      } catch {
        return null
      }
    }
    function selectApproval({ pendingInteraction, callId }) {
      if (pendingInteraction?.kind !== 'approval' || pendingInteraction.callId !== callId)
        return null
      return approvalModel(pendingInteraction.toolName, pendingInteraction.reason)
    }
    function NativeApprovalDetail({ sessionId, callId, useSessionPendingInteraction, useChat }) {
      const pendingInteraction =
        typeof useSessionPendingInteraction === 'function'
          ? useSessionPendingInteraction((map) => map.get(sessionId))
          : undefined
      // RC2's single seat has no next-renderer protocol. Retain its shipped
      // ApprovalCommand fallback exactly for unrelated or malformed requests.
      const command =
        typeof useChat === 'function'
          ? useChat((snapshot) => {
              for (const node of snapshot.nodes.values()) {
                const root = node.kind === 'tool-call' ? node.data.root : undefined
                if (root !== undefined && root.callId === callId && !('kind' in root)) {
                  try {
                    const args = JSON.parse(root.argsRaw)
                    return typeof args.command === 'string' ? args.command : undefined
                  } catch {
                    return undefined
                  }
                }
              }
            })
          : undefined
      const model = selectApproval({ pendingInteraction, callId })
      return model ? h(ApprovalPreview, { model }) : (command ?? null)
    }
    // Safe Markdown subset: unsupported syntax remains literal, never HTML or embeds.
    // Exact source and JSON string views preserve otherwise invisible whitespace.
    function approvalInline(value) {
      return value
        .split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^\s)]+\))/g)
        .map((part, key) => {
          if (/^`[^`\n]+`$/.test(part)) return h('code', { key }, part.slice(1, -1))
          if (/^\*\*[^*\n]+\*\*$/.test(part)) return h('strong', { key }, part.slice(2, -2))
          if (/^\*[^*\n]+\*$/.test(part)) return h('em', { key }, part.slice(1, -1))
          const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
          return link ? h(Link, { key, url: link[2] }, link[1]) : part
        })
    }
    function ApprovalMarkdown({ value }) {
      const nodes = [],
        lines = value.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i],
          key = i
        if (/^```/.test(line)) {
          const code = []
          while (++i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i])
          nodes.push(h('pre', { key, tabIndex: 0 }, h('code', null, code.join('\n'))))
          continue
        }
        const heading = line.match(/^(#{1,6})\s+(.*)$/),
          list = line.match(/^\s*(?:[-*+] |\d+\. )(.*)$/)
        nodes.push(
          heading
            ? h(`h${Math.min(heading[1].length + 2, 6)}`, { key }, approvalInline(heading[2]))
            : list
              ? h('div', { key }, '• ', approvalInline(list[1]))
              : h(
                  'div',
                  { key, style: { minHeight: '1em', whiteSpace: 'pre-wrap' } },
                  approvalInline(line),
                ),
        )
      }
      return h('div', { className: 'gh-approval-markdown' }, nodes)
    }
    function ApprovalText({ label, value, markdown = false, exact = false }) {
      return h(
        'section',
        null,
        h('h4', null, label),
        value === null
          ? h('p', null, 'Not set (null)')
          : value === ''
            ? h('p', null, 'Empty string')
            : markdown
              ? h(ApprovalMarkdown, { value })
              : h('div', { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, value),
        exact &&
          h(
            'details',
            null,
            h('summary', null, `${label}: exact source and whitespace`),
            h('pre', { tabIndex: 0 }, value === null ? 'null' : value),
            h('pre', { tabIndex: 0, 'aria-label': `${label}: JSON string` }, JSON.stringify(value)),
          ),
      )
    }
    function ApprovalResource({ label, value }) {
      const identity = [
        text(value?.nameWithOwner) ||
          text(value?.repository?.nameWithOwner) ||
          text(value?.owner?.login) ||
          text(value?.login),
        Number.isSafeInteger(value?.number) ? `#${value.number}` : '',
      ]
        .filter(Boolean)
        .join(' · ')
      const title =
        text(value?.title) ||
        text(value?.name) ||
        identity ||
        'Name unavailable — see technical details'
      return h(
        'div',
        { className: 'gh-approval-resource' },
        h('small', null, label),
        h(
          Link,
          { url: value?.url },
          title,
          safeUrl(value?.url) && h('span', { 'aria-hidden': true }, ' ↗'),
        ),
        identity && identity !== title && h('small', null, identity),
      )
    }
    // RC2 prints reason before the detail slot. Hide that redundant sibling only
    // while this validated detail actually renders; native controls stay untouched.
    const approvalCss =
      '[data-approval-scroll]:has(.gh-approval-valid)>div:first-child{display:none}.gh-approval-valid{max-width:100%;text-align:left;font-family:system-ui,sans-serif;word-break:normal;white-space:normal}.gh-approval-valid .gh-approval-main{max-height:48vh;overflow:auto;overflow-wrap:anywhere}.gh-approval-valid .gh-approval-markdown{white-space:normal}.gh-approval-valid pre{white-space:pre-wrap;word-break:break-word}.gh-approval-valid h4{margin-top:8px}.gh-grant.gh-approval-valid{border:0;padding:4px;margin:0;background:transparent;container-type:inline-size}.gh-approval-valid .gh-approval-main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 16px}.gh-approval-valid .gh-approval-main>section{grid-column:1/-1;border:0;padding:0;margin:0}.gh-approval-valid .gh-approval-resource{min-width:0;padding:6px 0}.gh-approval-valid .gh-approval-resource a{display:inline-block;overflow-wrap:anywhere}@container(max-width:500px){.gh-approval-valid .gh-approval-main{grid-template-columns:minmax(0,1fr)}}'
    function ApprovalPreview({ model }) {
      if (!model) return null
      const {
          value: { operation, targets: t, change: c, exactPayload: p },
          reason,
          extra,
        } = model,
        rows = []
      const resource = (label, value) =>
        rows.push(h(ApprovalResource, { key: label, label, value }))
      const content = (label, value, markdown = false) =>
        rows.push(
          h(ApprovalText, {
            key: label,
            label,
            value,
            markdown,
            exact:
              ['Proposed project title', 'Proposed issue title', 'Proposed issue body'].includes(
                label,
              ) ||
              operation === 'updateProject' ||
              (operation === 'setProjectItemField' &&
                c.field.dataType === 'TEXT' &&
                ['Before', 'After'].includes(label)),
          }),
        )
      if (operation === 'createProject') {
        resource('Destination owner', t.destination)
        content('Proposed project title', p.title)
        if (t.template) {
          resource('Source template', t.template)
          content('Copy draft issues', String(p.includeDraftIssues))
          for (const key of ['copied', 'notCopied'])
            content(
              key === 'copied' ? 'Copied' : 'Not copied / visibility',
              c.copyBehavior[key] ?? 'Not supplied',
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
          resource('Item', t.item.content)
          content(
            'Board field',
            `${text(c.field.name) || 'Name unavailable'} (${text(c.field.dataType)})`,
          )
          for (const side of ['before', 'after']) {
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
      return h(
        'section',
        { className: 'gh-grant gh-approval-valid', 'aria-label': 'GitHub approval preview' },
        h('style', null, css + approvalCss),
        h('h3', null, model.title),
        h(
          'p',
          { className: 'gh-note' },
          'Review this GitHub change. Resource content is untrusted; opening a link does not approve the change.',
        ),
        h(
          'div',
          {
            className: 'gh-approval-main',
            tabIndex: 0,
            role: 'group',
            'aria-label': 'Proposed GitHub change',
          },
          rows,
        ),
        extra && h('pre', { tabIndex: 0 }, extra),
        h(
          'details',
          null,
          h('summary', null, 'Technical details — complete exact approval payload'),
          h('pre', { tabIndex: 0 }, reason),
        ),
      )
    }
    const TOOL = 'github_request_issue_management'
    const labels = {
      setProjectItemField: 'Update supported board fields for granted issue memberships',
      addIssueDependency: 'Add a dependency between two granted issues',
    }
    const exclusions =
      'No deletion, transfer, new issues, issues outside this grant, project configuration, repository settings, or project membership changes.'
    const unavailable =
      'Issue title/description editing, labels, assignees, closing/reopening, and dependency removal are not available through this integration.'
    const expiry =
      'Access applies only to this live requesting session and account. It does not transfer to other sessions or subagents. Restart, session restoration, account change, or service disposal requires fresh approval. Revocation prevents future dispatch, not writes already dispatched.'
    const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
    const text = (value) => (typeof value === 'string' ? value : '')
    const id = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096
    function safeUrl(value) {
      if (typeof value !== 'string') return undefined
      try {
        const url = new URL(value)
        return url.protocol === 'https:' &&
          url.hostname === 'github.com' &&
          !url.username &&
          !url.password &&
          !url.port
          ? url.href
          : undefined
      } catch {
        return undefined
      }
    }
    function validScope(scope) {
      return (
        object(scope) &&
        object(scope.account) &&
        id(scope.account.id) &&
        id(scope.account.login) &&
        Array.isArray(scope.operations) &&
        scope.operations.length > 0 &&
        scope.operations.length <= 2 &&
        scope.operations.every((op) => Object.hasOwn(labels, op)) &&
        Array.isArray(scope.issues) &&
        scope.issues.length > 0 &&
        scope.issues.length <= 50 &&
        scope.issues.every(
          (issue) =>
            object(issue) &&
            id(issue.id) &&
            id(issue.repositoryId) &&
            id(issue.repositoryOwnerId) &&
            id(issue.nameWithOwner) &&
            Number.isSafeInteger(issue.issueNumber) &&
            issue.issueNumber > 0,
        ) &&
        Array.isArray(scope.projects) &&
        scope.projects.length <= 20 &&
        scope.projects.every(
          (project) =>
            object(project) &&
            id(project.id) &&
            id(project.ownerId) &&
            id(project.owner) &&
            Number.isSafeInteger(project.projectNumber) &&
            project.projectNumber > 0,
        ) &&
        Array.isArray(scope.memberships) &&
        scope.memberships.length <= 5000 &&
        scope.memberships.every(
          (item) => object(item) && id(item.id) && id(item.issueId) && id(item.projectId),
        )
      )
    }
    function validStatus(value, callId) {
      return (
        object(value) &&
        value.version === 1 &&
        id(value.phase) &&
        (value.callId === undefined || value.callId === callId) &&
        (value.toolName === undefined || value.toolName === TOOL) &&
        (value.scope === undefined || validScope(value.scope)) &&
        (value.exactPreview === undefined || typeof value.exactPreview === 'string') &&
        Array.isArray(value.grants) &&
        value.grants.length <= 100 &&
        value.grants.every(
          (grant) => object(grant) && id(grant.id) && id(grant.state) && validScope(grant.scope),
        ) &&
        Array.isArray(value.history) &&
        value.history.length <= 1000 &&
        value.history.every(
          (row) => object(row) && id(row.id) && id(row.operation) && id(row.outcome),
        )
      )
    }
    async function api(action, body, signal) {
      if (!['status', 'revoke'].includes(action)) throw new Error('Unsupported GitHub card action.')
      const response = await fetch(`/api/plugins/github/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-dsh-github': '1' },
        body: JSON.stringify(body),
        signal,
      })
      if (!response.ok)
        throw new Error('GitHub access status is unavailable. No new access was requested.')
      const result = await response.json()
      if (result?.ok !== true)
        throw new Error('GitHub access status is unavailable. No new access was requested.')
      return result.value
    }
    const css = `.gh-grant{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-tertiary,transparent);border:1px solid var(--dsw-alias-border-standard,#8885);border-radius:12px;padding:14px;margin:8px 0;min-width:0;font-size:14px;line-height:1.5;overflow-wrap:anywhere}.gh-grant h3,.gh-grant h4{margin:0 0 8px}.gh-grant p{margin:8px 0}.gh-grant ul{padding-left:22px;margin:8px 0}.gh-grant li{margin:6px 0}.gh-grant a{color:var(--dsw-alias-brand-primary,#486ed4);text-decoration:underline}.gh-grant button,.gh-grant summary{font:inherit;cursor:pointer}.gh-grant button{color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-standard,#8888);border-radius:7px;padding:7px 12px;white-space:normal}.gh-grant button:disabled{opacity:.6;cursor:default}.gh-grant :is(button,summary,a):focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#486ed4);outline-offset:3px}.gh-grant details{margin:10px 0}.gh-grant pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:320px;overflow:auto;padding:8px;background:var(--dsw-specific-input-major,transparent)}.gh-grant small{display:block;color:var(--dsw-alias-label-secondary);font-size:12px}.gh-grant [role=alert]{color:var(--dsw-alias-state-error-primary,#b33)}.gh-grant .gh-scroll{max-height:340px;overflow:auto;padding:2px 6px}.gh-grant section+section{border-top:1px solid var(--dsw-alias-border-standard,#8885);margin-top:12px;padding-top:12px}.gh-grant .gh-note{color:var(--dsw-alias-label-secondary)}`
    function Link({ url, children }) {
      const href = safeUrl(url)
      return href
        ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, children)
        : h('span', null, children)
    }
    function Scope({ scope }) {
      if (!validScope(scope))
        return h(
          'p',
          { role: 'alert' },
          'Verified grant details are unavailable. Use the complete native approval preview; no scope is inferred from tool arguments.',
        )
      return h(
        'div',
        null,
        h(
          'p',
          null,
          h('strong', null, 'Account: '),
          scope.account.login,
          h('small', null, `Account ID: ${scope.account.id}`),
        ),
        h('h4', null, `Selected issues (${scope.issues.length})`),
        h(
          'div',
          { className: 'gh-scroll', tabIndex: 0, role: 'group', 'aria-label': 'Selected issues' },
          h(
            'ul',
            null,
            scope.issues.map((issue) =>
              h(
                'li',
                { key: issue.id },
                h(
                  Link,
                  { url: issue.url },
                  `${issue.nameWithOwner} #${issue.issueNumber}${text(issue.title) ? ` — ${issue.title}` : ''}`,
                ),
                h(
                  'small',
                  null,
                  `Issue ID: ${issue.id}; Repository ID: ${issue.repositoryId}; Repository owner ID: ${issue.repositoryOwnerId}`,
                ),
              ),
            ),
          ),
        ),
        h('h4', null, `Selected projects (${scope.projects.length})`),
        scope.projects.length
          ? h(
              'ul',
              null,
              scope.projects.map((project) =>
                h(
                  'li',
                  { key: project.id },
                  h(
                    Link,
                    { url: project.url },
                    `${project.owner} project #${project.projectNumber}${text(project.title) ? ` — ${project.title}` : ''}`,
                  ),
                  h('small', null, `Project ID: ${project.id}; Owner ID: ${project.ownerId}`),
                ),
              ),
            )
          : h('p', null, 'No projects selected.'),
        h('h4', null, 'Included operations'),
        h(
          'ul',
          null,
          scope.operations.map((op) => h('li', { key: op }, labels[op], h('small', null, op))),
        ),
        h(
          'details',
          null,
          h('summary', null, `Exact existing project memberships (${scope.memberships.length})`),
          scope.memberships.length
            ? h(
                'ul',
                null,
                scope.memberships.map((item) =>
                  h(
                    'li',
                    { key: item.id },
                    `Item ID: ${item.id}; Issue ID: ${item.issueId}; Project ID: ${item.projectId}`,
                  ),
                ),
              )
            : h('p', null, 'None.'),
        ),
        h('p', null, h('strong', null, 'Excluded: '), exclusions),
        h('p', null, h('strong', null, 'Unavailable capabilities: '), unavailable),
        h('p', { className: 'gh-note' }, h('strong', null, 'Expiry and revocation: '), expiry),
      )
    }
    function rawDetails(block) {
      const args = text(block?.call?.argsRaw) || text(block?.argsRaw)
      const result = Array.isArray(block?.content)
        ? block.content
            .filter((part) => part?.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('\n')
        : ''
      return [
        args && `Arguments\n${args}`,
        result && `Result\n${result}`,
        block?.error && `Error\n${text(block.error.name)}: ${text(block.error.code)}`,
      ]
        .filter(Boolean)
        .join('\n\n')
    }
    function phaseLabel(phase) {
      return (
        {
          prepared: 'Verified scope prepared',
          approved: 'Approved — access is not yet confirmed',
          unattempted: 'Not executed',
          preparing: 'Preparing verified scope',
          pending: 'Awaiting approval',
          'awaiting-approval': 'Awaiting approval',
          running: 'Running — access is not yet confirmed',
          active: 'Active access',
          granted: 'Access granted',
          confirmed: 'Grant confirmed',
          denied: 'Denied',
          rejected: 'Denied',
          failed: 'Failed',
          cancelled: 'Cancelled',
          uncertain: 'Outcome uncertain',
          expired: 'Expired — fresh approval required',
          revoked: 'Revoked',
          'renewal-required': 'Renewal required',
          'account-changed': 'Account changed — fresh approval required',
        }[phase] ?? 'Status unknown — access is not confirmed'
      )
    }
    function GrantCard({
      sessionId,
      callId,
      block,
      inspect,
      useSessionPendingInteraction,
      request = api,
    }) {
      const pending =
        typeof useSessionPendingInteraction === 'function'
          ? useSessionPendingInteraction((map) => {
              const value = map.get(sessionId)
              return value?.kind === 'approval' &&
                value.callId === callId &&
                value.toolName === TOOL
                ? value
                : undefined
            })
          : undefined
      const [loaded, setLoaded] = React.useState(null),
        [error, setError] = React.useState(''),
        [busy, setBusy] = React.useState(false)
      const [revision, refresh] = React.useReducer((n) => n + 1, 0)
      const generation = React.useRef(0),
        action = React.useRef(null)
      const status =
        loaded?.sessionId === sessionId && loaded?.callId === callId ? loaded.value : null
      React.useEffect(() => {
        const token = ++generation.current,
          controller = new AbortController()
        let timer,
          failures = 0
        setLoaded(null)
        setError('')
        setBusy(false)
        async function load() {
          if (generation.current !== token) return
          try {
            const value = await request('status', { sessionId, callId }, controller.signal)
            if (generation.current !== token) return
            if (!validStatus(value, callId))
              throw new Error('Invalid GitHub grant status. Access is not confirmed.')
            setLoaded({ sessionId, callId, value })
            setError('')
            failures = 0
            // Continue observing active authority so revocation/account changes elsewhere become visible.
            if (
              [
                'preparing',
                'prepared',
                'approved',
                'pending',
                'awaiting-approval',
                'running',
              ].includes(value.phase) ||
              value.grants.some((grant) => grant.state === 'active')
            )
              timer = setTimeout(load, 1500)
          } catch (failure) {
            if (generation.current !== token || controller.signal.aborted) return
            setLoaded(null)
            setError(failure.message || 'GitHub status is unavailable. Access is not confirmed.')
            if (++failures <= 3) timer = setTimeout(load, 1500)
          }
        }
        void load()
        return () => {
          generation.current++
          controller.abort()
          action.current?.abort()
          action.current = null
          clearTimeout(timer)
        }
      }, [sessionId, callId, request, revision, pending?.key, block?.kind])
      async function revoke(grantId) {
        if (
          action.current ||
          !status?.grants.some((grant) => grant.id === grantId && grant.state === 'active')
        )
          return
        // Fence older status requests/polls before revocation. A lost revoke response stays explicit until a fresh status check.
        const controller = new AbortController(),
          token = ++generation.current
        action.current = controller
        setBusy(true)
        setError('')
        try {
          await request('revoke', { sessionId, callId, grantId }, controller.signal)
          if (generation.current !== token) return
          // The status endpoint, never a successful HTTP response alone, confirms current authority.
          refresh()
        } catch {
          if (generation.current !== token) return
          setLoaded(null)
          setError(
            'Revocation could not be confirmed. Refresh status before relying on it. This action did not request a GitHub write.',
          )
        } finally {
          if (generation.current === token) {
            action.current = null
            setBusy(false)
          }
        }
      }
      let phase = pending ? 'awaiting-approval' : status?.phase
      if (
        !pending &&
        ['active', 'granted', 'confirmed'].includes(phase) &&
        !status?.grants.some((grant) => grant.state === 'active')
      ) {
        const states = new Set(status?.grants.map((grant) => grant.state))
        phase = states.size === 1 ? [...states][0] : undefined
      }
      const exact = status?.exactPreview ?? pending?.reason
      const raw = rawDetails(block)
      return h(
        'section',
        { className: 'gh-grant', 'aria-label': 'GitHub issue management grant' },
        h('style', null, css),
        h('h3', null, 'Manage selected issues for this session'),
        h('p', { role: 'status' }, phaseLabel(phase)),
        pending &&
          h(
            'p',
            null,
            'Review the complete native approval preview below the conversation. Use its Allow once or Reject controls. Approval does not confirm any GitHub write.',
          ),
        error && h('p', { role: 'alert' }, error),
        status?.scope && h(Scope, { scope: status.scope }),
        !status?.scope &&
          pending &&
          h(
            'p',
            null,
            'Structured scope is unavailable. The complete approval reason remains accessible below and in the native approval panel.',
          ),
        exact &&
          h(
            'details',
            null,
            h('summary', null, 'Complete exact approval preview'),
            h('pre', { tabIndex: 0 }, exact),
          ),
        status?.grants.length > 0 &&
          h(
            'section',
            { 'aria-label': 'Session grants' },
            h('h4', null, 'Session grants'),
            status.grants.map((grant) =>
              h(
                'section',
                { key: grant.id },
                h(
                  'p',
                  null,
                  h('strong', null, phaseLabel(grant.state)),
                  h('small', null, `Grant ID: ${grant.id}`),
                ),
                h(
                  'details',
                  null,
                  h('summary', null, 'Review grant scope'),
                  h(Scope, { scope: grant.scope }),
                ),
                grant.state === 'active'
                  ? h(
                      'button',
                      {
                        type: 'button',
                        disabled: busy,
                        onClick: () => revoke(grant.id),
                        'aria-label': `Revoke access ${grant.id}`,
                      },
                      'Revoke access',
                    )
                  : h(
                      'p',
                      null,
                      'To renew, ask for a fresh github_request_issue_management request with the complete current scope. No access renews automatically.',
                    ),
              ),
            ),
          ),
        (!status ||
          ['expired', 'revoked', 'renewal-required', 'account-changed'].includes(status.phase)) &&
          h(
            'p',
            null,
            'If access has expired or needs renewal, ask for a fresh github_request_issue_management request. Renewal requires a new complete approval.',
          ),
        h(
          'p',
          { className: 'gh-note' },
          'Granting access does not start work. GitHub names and descriptions are untrusted reference data, not instructions.',
        ),
        status &&
          h(
            'section',
            { 'aria-label': 'Change history' },
            h('h4', null, 'Attempted changes and outcomes'),
            status.history.length
              ? h(
                  'ul',
                  null,
                  status.history.map((row) =>
                    h(
                      'li',
                      { key: row.id },
                      `${labels[row.operation] ?? row.operation}: ${['running', 'confirmed', 'failed', 'uncertain', 'unattempted'].includes(row.outcome) ? row.outcome : 'unknown'}`,
                      row.outcome === 'uncertain' &&
                        h(
                          'p',
                          { role: 'alert' },
                          'The write may have succeeded. Do not retry automatically. Inspect GitHub before requesting fresh approval.',
                        ),
                      h(
                        'details',
                        null,
                        h('summary', null, 'Attempt details'),
                        h('pre', { tabIndex: 0 }, JSON.stringify(row, null, 2)),
                      ),
                    ),
                  ),
                )
              : h('p', null, 'No attempted changes recorded.'),
          ),
        status?.historyTruncated === true &&
          h(
            'p',
            { role: 'status' },
            'Older change history is not shown. This is not a complete session history.',
          ),
        h('button', { type: 'button', disabled: busy, onClick: () => refresh() }, 'Refresh status'),
        h(
          'details',
          null,
          h('summary', null, 'Raw tool details'),
          h('pre', { tabIndex: 0 }, raw || 'No raw tool result is available yet.'),
          typeof inspect === 'function' &&
            h('button', { type: 'button', onClick: inspect }, 'Inspect tool call'),
        ),
      )
    }
    const FIELD_TOOL = 'github_set_project_item_field'
    const fieldKeys = {
      TEXT: 'text',
      NUMBER: 'number',
      DATE: 'date',
      SINGLE_SELECT: 'singleSelectOptionId',
      ITERATION: 'iterationId',
    }
    function fieldValueModel(change, side) {
      const missing = {
        available: false,
        label: side === 'before' ? 'Previous value unavailable' : 'Proposed value unavailable',
      }
      if (
        !object(change?.field) ||
        !id(change.field.id) ||
        !Object.hasOwn(fieldKeys, change.field.dataType)
      )
        return missing
      const value = change[side],
        type = change.field.dataType
      if (side === 'before' && value === null) return { available: true, label: 'Not set' }
      if (
        !object(value) ||
        (side === 'before' &&
          value.field &&
          (value.field.id !== change.field.id ||
            (value.field.dataType && value.field.dataType !== type)))
      )
        return missing
      const key = side === 'before' && type === 'SINGLE_SELECT' ? 'optionId' : fieldKeys[type]
      if (side === 'after' && (Object.keys(value).length !== 1 || !Object.hasOwn(value, key)))
        return missing
      const leaf = value[key]
      if (type === 'TEXT')
        return typeof leaf === 'string' ? { available: true, label: JSON.stringify(leaf) } : missing
      if (type === 'NUMBER')
        return typeof leaf === 'number' && Number.isFinite(leaf)
          ? { available: true, label: String(leaf) }
          : missing
      if (type === 'DATE')
        return typeof leaf === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(leaf) &&
          !Number.isNaN(Date.parse(leaf)) &&
          new Date(leaf).toISOString().slice(0, 10) === leaf
          ? { available: true, label: leaf }
          : missing
      if (!id(leaf)) return missing
      const selected =
        side === 'before'
          ? value
          : change.selectedOption?.id === leaf
            ? change.selectedOption
            : null
      const friendly = text(type === 'SINGLE_SELECT' ? selected?.name : selected?.title)
      return {
        available: true,
        label: friendly || leaf,
        identity: leaf,
        ...(type === 'ITERATION' && selected
          ? {
              detail: [
                text(selected.startDate),
                Number.isFinite(selected.duration) ? `${selected.duration} days` : '',
              ]
                .filter(Boolean)
                .join(' · '),
            }
          : {}),
      }
    }
    function validFieldStatus(value, callId) {
      if (!object(value) || value.version !== 1 || !id(value.phase)) return false
      if (value.toolName === undefined && value.callId === undefined)
        return (
          value.phase === 'expired' && value.change === undefined && value.targets === undefined
        )
      return (
        value.toolName === FIELD_TOOL &&
        value.callId === callId &&
        (value.exactPreview === undefined || typeof value.exactPreview === 'string') &&
        (value.change === undefined || object(value.change)) &&
        (value.targets === undefined || object(value.targets))
      )
    }
    function validatedFieldResult(value) {
      if (
        !object(value) ||
        value.host !== 'github.com' ||
        !(
          value.operation === 'setProjectItemField' ||
          (value.operation === undefined && value.outcome === 'failed' && object(value.error))
        )
      )
        return undefined
      if (value.outcome === 'no-change')
        return value.dispatched === false && value.reason === 'FIELD_VALUE_ALREADY_SET'
          ? value
          : undefined
      return ['failed', 'confirmed', 'uncertain'].includes(value.outcome) ? value : undefined
    }
    function fieldSafeText(value) {
      return text(value)
        .slice(0, 4096)
        .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[REDACTED]')
        .replace(/\bBearer\s+[^\s"'<>]+/gi, '[REDACTED]')
        .replace(/\bAuthorization\s*:\s*token\s+[^\s"'<>]+/gi, '[REDACTED]')
        .replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/gi, '$1[REDACTED]@')
        .replace(/([?&](?:access_token|token|auth|key)=)[^&#\s]+/gi, '$1[REDACTED]')
    }
    function fieldFailureReason(block, result) {
      if (result?.outcome === 'failed')
        return fieldSafeText(result.error?.message || result.message)
      if (block?.isError === true && !result && Array.isArray(block.content))
        return fieldSafeText(
          block.content
            .filter((part) => part?.type === 'text')
            .map((part) => text(part.text))
            .join('\n'),
        )
      return ''
    }
    function fieldRequestedTarget(block) {
      try {
        const args = JSON.parse(block?.call?.argsRaw ?? block?.argsRaw ?? '')
        if (!object(args)) return ''
        return [
          typeof args.owner === 'string' && `Owner: ${fieldSafeText(args.owner)}`,
          Number.isSafeInteger(args.projectNumber) &&
            args.projectNumber > 0 &&
            `Project number: ${args.projectNumber}`,
          id(args.itemId) && `Item ID: ${fieldSafeText(args.itemId)}`,
          id(args.fieldId) && `Field ID: ${fieldSafeText(args.fieldId)}`,
        ]
          .filter(Boolean)
          .join('; ')
      } catch {
        return ''
      }
    }
    function fieldResult(block) {
      if (block?.kind !== 'tool-result' || !Array.isArray(block.content)) return undefined
      const parts = block.content.filter(
        (part) => part?.type === 'text' && typeof part.text === 'string',
      )
      if (parts.length !== 1 || parts[0].text.length > 262144) return undefined
      try {
        return validatedFieldResult(JSON.parse(parts[0].text))
      } catch {
        return undefined
      }
    }
    function fieldPhase(status, block, pending) {
      const result = fieldResult(block),
        recorded = validatedFieldResult(status?.result)
      if (
        result?.outcome === 'uncertain' ||
        recorded?.outcome === 'uncertain' ||
        status?.phase === 'uncertain' ||
        (block?.isError === true &&
          (result?.outcome === 'confirmed' || status?.phase === 'confirmed'))
      )
        return 'uncertain'
      if (block?.isError === true) return 'failed'
      if (result?.outcome) return result.outcome
      if (recorded?.outcome === 'no-change' && block?.kind !== 'tool-result') return 'no-change'
      if (status?.phase === 'no-change') return 'unknown'
      if (pending) return 'awaiting-approval'
      if (block?.kind === 'tool-result')
        return recorded?.outcome === 'confirmed'
          ? 'confirmed'
          : ['denied', 'failed', 'unattempted'].includes(status?.phase)
            ? status.phase
            : 'unknown'
      return status?.phase ?? 'unknown'
    }
    function fieldPhaseLabel(phase) {
      return (
        {
          prepared: 'Proposed change prepared',
          preparing: 'Preparing change',
          approved: 'Approved — write not yet confirmed',
          'authorized-by-grant': 'Authorized by session grant — write not yet confirmed',
          running: 'Running — write not yet confirmed',
          'awaiting-approval': 'Awaiting approval',
          denied: 'Denied — not executed',
          unattempted: 'Not executed',
          failed: 'Field change failed',
          'no-change': 'No change needed',
          confirmed: 'GitHub confirmed the update',
          uncertain: 'Outcome uncertain — the write may have succeeded',
          expired: 'Prepared details expired — outcome unknown',
        }[phase] ?? 'Outcome unknown — no success is inferred'
      )
    }
    function FieldChangeCard({
      sessionId,
      callId,
      block,
      inspect,
      useSessionPendingInteraction,
      request = api,
    }) {
      const pending =
        typeof useSessionPendingInteraction === 'function'
          ? useSessionPendingInteraction((map) => {
              const value = map.get(sessionId)
              return value?.kind === 'approval' &&
                value.callId === callId &&
                value.toolName === FIELD_TOOL
                ? value
                : undefined
            })
          : undefined
      const [loaded, setLoaded] = React.useState(null),
        [error, setError] = React.useState('')
      const generation = React.useRef(0)
      const status =
        loaded?.sessionId === sessionId && loaded?.callId === callId ? loaded.value : null
      React.useEffect(() => {
        const token = ++generation.current,
          controller = new AbortController()
        let timer,
          failures = 0
        setLoaded(null)
        setError('')
        async function load() {
          if (generation.current !== token) return
          try {
            const value = await request('status', { sessionId, callId }, controller.signal)
            if (generation.current !== token) return
            if (!validFieldStatus(value, callId)) throw new Error('Invalid prepared change')
            setLoaded({ sessionId, callId, value })
            setError('')
            failures = 0
            if (
              [
                'preparing',
                'prepared',
                'approved',
                'authorized-by-grant',
                'running',
                'awaiting-approval',
              ].includes(value.phase)
            )
              timer = setTimeout(load, 1500)
          } catch {
            if (generation.current !== token || controller.signal.aborted) return
            setLoaded(null)
            setError(
              'Prepared change details are unavailable. See the native approval preview and raw tool details; no previous value or outcome is inferred.',
            )
            if (++failures <= 3) timer = setTimeout(load, 1500)
          }
        }
        void load()
        return () => {
          generation.current++
          controller.abort()
          clearTimeout(timer)
        }
      }, [sessionId, callId, request, pending?.key, block?.kind])
      const change = status?.change,
        field = change?.field,
        project = status?.targets?.project,
        item = status?.targets?.item
      const content = item?.content,
        before = fieldValueModel(change, 'before'),
        after = fieldValueModel(change, 'after')
      const phase = fieldPhase(status, block, pending),
        result = fieldResult(block) ?? validatedFieldResult(status?.result)
      const reason = fieldFailureReason(block, result),
        requested = fieldRequestedTarget(block)
      const showValues = phase !== 'no-change' && (before.available || after.available)
      const target =
        content?.__typename === 'Issue'
          ? `Issue #${content.number ?? content.id ?? ''}`
          : content?.__typename === 'PullRequest'
            ? `Pull request #${content.number ?? content.id ?? ''}`
            : content?.__typename === 'DraftIssue'
              ? `Draft issue ${text(content.id)}`
              : text(item?.id)
                ? `Item ${item.id}`
                : ''
      const identities = [
        ['Project', project?.id],
        ['Item', item?.id],
        ['Field', field?.id],
      ]
        .filter(([, value]) => id(value))
        .map(([label, value]) => `${label} ID: ${value}`)
        .join('; ')
      const projectLabel =
        text(project?.title) ||
        (project?.number
          ? `Project ${project.number}`
          : text(project?.id)
            ? `Project ${project.id}`
            : '')
      const fieldLabel = text(field?.name) || (text(field?.id) ? `Field ${field.id}` : '')
      const exact = pending?.reason ?? status?.exactPreview
      return h(
        'section',
        { className: 'gh-grant', 'aria-label': 'GitHub project field change' },
        h('style', null, css),
        h('h3', null, 'GitHub · Project field change'),
        h('p', { role: 'status' }, fieldPhaseLabel(phase)),
        phase === 'no-change' &&
          h('p', null, 'The field already has the requested value. Nothing was changed.'),
        reason && h('p', { role: 'alert' }, reason),
        !reason && phase === 'unknown' && error && h('p', { role: 'alert' }, error),
        target &&
          h(
            'p',
            null,
            h(
              Link,
              { url: content?.url },
              `${target}${text(content?.title) ? ` — ${content.title}` : ''}`,
            ),
          ),
        projectLabel && h('p', null, h(Link, { url: project?.url }, projectLabel)),
        fieldLabel && h('p', null, h('strong', null, fieldLabel)),
        requested &&
          !identities &&
          h(
            'p',
            { className: 'gh-note' },
            `Requested target (call arguments, not verified resource metadata): ${requested}`,
          ),
        showValues &&
          h(
            React.Fragment,
            null,
            h('p', { className: 'gh-note' }, 'Prepared change (not a fresh read of the field):'),
            h(
              'pre',
              { tabIndex: 0, 'aria-label': 'Prepared before and after values' },
              before.available && after.available
                ? `${before.label} → ${after.label}`
                : before.available
                  ? `Before: ${before.label}`
                  : `After: ${after.label}`,
            ),
            [before, after].map(
              (value, index) =>
                value.identity &&
                h(
                  'small',
                  { key: index },
                  `${index ? 'After' : 'Before'} ID: ${value.identity}${value.detail ? `; ${value.detail}` : ''}`,
                ),
            ),
          ),
        pending &&
          h(
            'p',
            null,
            'The native approval panel keeps the complete exact preview and Allow once / Reject controls. Approval is not confirmation that this write succeeded.',
          ),
        phase === 'uncertain' &&
          h(
            'p',
            { role: 'alert' },
            'Do not retry automatically. Inspect the explicit GitHub targets before requesting a fresh change. No rollback is implied.',
          ),
        !['no-change', 'failed'].includes(phase) &&
          typeof result?.message === 'string' &&
          h('p', null, fieldSafeText(result.message)),
        typeof result?.cleanupWarning === 'string' &&
          h('p', { role: 'alert' }, fieldSafeText(result.cleanupWarning)),
        exact &&
          h(
            'details',
            null,
            h('summary', null, 'Complete exact approval preview'),
            h('pre', { tabIndex: 0 }, exact),
          ),
        h(
          'details',
          null,
          h('summary', null, 'Technical details'),
          identities && h('p', null, `Verified preparation identifiers: ${identities}`),
          h('pre', { tabIndex: 0 }, rawDetails(block) || 'No raw tool result is available yet.'),
          typeof inspect === 'function' &&
            h('button', { type: 'button', onClick: inspect }, 'Inspect tool call'),
        ),
      )
    }
    const READ_TOOLS = [
      'github_list_projects',
      'github_get_project',
      'github_list_project_items',
      'github_list_issues',
      'github_search_issues',
      'github_get_issue',
    ]
    const readTitles = {
      github_list_projects: 'Projects',
      github_get_project: 'Project details',
      github_list_project_items: 'Project items',
      github_list_issues: 'Issues',
      github_search_issues: 'Issue search',
      github_get_issue: 'Issue details',
    }
    function readWarnings(envelope, toolName) {
      const warnings = new Set(),
        seen = new Set()
      let budget = 10000
      function visit(value, path, depth) {
        if (--budget < 0 || depth > 20) {
          warnings.add(
            'Additional nested data exceeds the card inspection bound; inspect raw details. Completeness is unknown.',
          )
          return
        }
        if (!value || typeof value !== 'object' || seen.has(value)) return
        seen.add(value)
        if (
          Object.hasOwn(value, 'nodes') &&
          (!Array.isArray(value.nodes) ||
            !object(value.pageInfo) ||
            typeof value.pageInfo.hasNextPage !== 'boolean')
        )
          warnings.add(
            `${path}: pagination metadata is missing or malformed; completeness is unknown.`,
          )
        if (
          value.pageInfo?.hasNextPage === true &&
          !id(value.nextCursor) &&
          !id(value.pageInfo.endCursor)
        )
          warnings.add(`${path}: continuation cursor is unavailable; inspect raw details.`)
        if (
          value.truncated === true ||
          value.pageInfo?.hasNextPage === true ||
          (typeof value.nextCursor === 'string' && value.nextCursor.length > 0)
        )
          warnings.add(
            `${path}: more data or truncated output. Continue this exact target with its matching cursor where supplied; this view is not complete.`,
          )
        if (Array.isArray(value)) {
          if (value.length > 50)
            warnings.add(
              `${path}: nested sections display at most 50 entries; inspect raw details for additional entries.`,
            )
          if (value.length > 100)
            warnings.add(`${path}: only the first 100 entries are inspected by this card.`)
          value
            .slice(0, 100)
            .forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1))
        } else {
          const entries = Object.entries(value)
          if (entries.length > 100)
            warnings.add(`${path}: additional properties exceed the card inspection bound.`)
          for (const [key, entry] of entries.slice(0, 100))
            visit(entry, `${path}.${key}`, depth + 1)
        }
      }
      visit(envelope?.data, 'data', 0)
      if (envelope?.truncated === true)
        warnings.add(
          'GitHub returned bounded or incomplete output. See all continuation notices and raw details.',
        )
      if (Array.isArray(envelope?.truncations))
        for (const notice of envelope.truncations.slice(0, 100)) {
          if (object(notice))
            warnings.add(
              `${text(notice.path) || 'Output'}: ${text(notice.reason) || text(notice.kind) || 'truncated'}. ${text(notice.continuation)}`,
            )
        }
      if (envelope?.truncations?.length > 100)
        warnings.add('Additional truncation notices are available in raw details.')
      if (toolName === 'github_search_issues')
        warnings.add(
          'GitHub search exposes at most 1,000 matches. Narrow the query for exhaustive results.',
        )
      if (envelope?.data?.exhaustive === false)
        warnings.add('This search result is not exhaustive.')
      return [...warnings]
    }
    // Pure readCardModel(toolName, frozen tool block): returns supplied entries, counts,
    // rendering kind, conservative state, and always-visible incompleteness warnings.
    // It parses only bounded owned tool JSON; it never reads a Host service or fetches.
    function readCardModel(toolName, block) {
      const base = {
        title: readTitles[toolName] ?? 'GitHub read',
        warnings: [],
        entries: [],
        kind: 'unknown',
      }
      if (!READ_TOOLS.includes(toolName))
        return { ...base, error: 'Unsupported card. Use raw tool details.' }
      if (block?.kind !== 'tool-result') return { ...base, state: 'running' }
      let envelope
      try {
        const parts = Array.isArray(block.content)
          ? block.content.filter((part) => part?.type === 'text' && typeof part.text === 'string')
          : []
        if (parts.length !== 1 || parts[0].text.length > 524288) throw new Error()
        envelope = JSON.parse(parts[0].text)
        if (!object(envelope) || envelope.host !== 'github.com' || envelope.untrusted !== true)
          throw new Error()
      } catch {
        return {
          ...base,
          state: 'unknown',
          error:
            'Readable result unavailable. Inspect raw tool details; no success or completeness is inferred.',
        }
      }
      const warnings = readWarnings(envelope, toolName),
        data = envelope.data
      if (!object(data))
        return {
          ...base,
          warnings,
          state: 'unknown',
          error:
            'Readable result unavailable. Inspect raw tool details; no success or completeness is inferred.',
        }
      if (block.isError === true)
        return {
          ...base,
          warnings,
          state: 'failed',
          error: 'The tool reported an error. Inspect raw tool details.',
        }
      const kind = toolName.includes('project_items')
        ? 'items'
        : toolName.includes('project')
          ? 'projects'
          : 'issues'
      const singular =
        toolName === 'github_get_project' ||
        toolName === 'github_get_issue' ||
        (kind === 'items' && data.nodes === undefined && id(data.id))
      const entries = singular ? [data] : data.nodes
      const validEntry = (entry) =>
        object(entry) &&
        id(entry.id) &&
        (kind === 'items'
          ? (entry.content == null || object(entry.content)) &&
            (entry.fieldValues === undefined ||
              (object(entry.fieldValues) && Array.isArray(entry.fieldValues.nodes)))
          : typeof entry.title === 'string' &&
            Number.isSafeInteger(entry.number) &&
            entry.number > 0)
      if (!Array.isArray(entries) || entries.some((entry) => !validEntry(entry)))
        return {
          ...base,
          warnings,
          state: 'unknown',
          error: 'Malformed result entries. Inspect raw tool details; no entries are inferred.',
        }
      if (entries.length > 50)
        warnings.push(
          'Only the first 50 returned entries are displayed by this card. Remaining entries are in raw details.',
        )
      const count = toolName === 'github_search_issues' ? data.issueCount : data.totalCount
      const total = Number.isSafeInteger(count) && count >= 0 ? count : undefined
      return {
        ...base,
        warnings,
        truncationPaths: Array.isArray(envelope.truncations)
          ? envelope.truncations.map((notice) => text(notice?.path))
          : [],
        unlocalizedTruncation:
          envelope.truncated === true &&
          (!Array.isArray(envelope.truncations) ||
            !envelope.truncations.length ||
            envelope.truncations.some((notice) => !text(notice?.path).startsWith('data.'))),
        state: 'returned',
        kind,
        entries: entries.slice(0, 50),
        returnedCount: entries.length,
        total,
        totalMeaning: text(data.totalCountMeaning),
        scannedCount: data.scannedCount,
        templateOnly: data.templateOnly === true,
        singular,
      }
    }
    function shortIdentity(value) {
      return (
        text(value?.name) ||
        text(value?.title) ||
        text(value?.login) ||
        text(value?.nameWithOwner) ||
        text(value?.id) ||
        'Unnamed entry'
      )
    }
    function TextSection({ title, value }) {
      return typeof value === 'string' && value.length > 0
        ? h('details', null, h('summary', null, title), h('pre', { tabIndex: 0 }, value))
        : null
    }
    function SuppliedList({ title, connection }) {
      if (!object(connection)) return null
      if (!Array.isArray(connection.nodes))
        return h('p', null, `${title}: malformed supplied details; inspect raw data.`)
      return h(
        'details',
        null,
        h(
          'summary',
          null,
          `${title} (${connection.nodes.length} returned${Number.isSafeInteger(connection.totalCount) ? `; ${connection.totalCount} total reported` : ''})`,
        ),
        h(
          'ul',
          null,
          connection.nodes
            .slice(0, 50)
            .map((entry, index) =>
              h(
                'li',
                { key: index },
                object(entry)
                  ? h(
                      Link,
                      { url: entry.url },
                      `${Number.isSafeInteger(entry.number) ? `#${entry.number} — ` : ''}${shortIdentity(entry)}`,
                    )
                  : 'Malformed entry — see raw details',
              ),
            ),
        ),
      )
    }
    const itemCss = `.gh-grant .gh-item{padding:8px 0;margin:0;border-top:1px solid var(--dsw-alias-border-standard,#8885);min-width:0}.gh-grant .gh-item-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(100px,.32fr) minmax(100px,.32fr);gap:4px 16px;align-items:start}.gh-grant .gh-item h4{margin:0;font-size:14px}.gh-grant .gh-item p{margin:2px 0}.gh-grant .gh-item details{margin:4px 0 0}.gh-grant .gh-item summary{font-size:12px}.gh-grant .gh-item-pr{font-size:12px}.gh-grant .gh-item-fields{margin:4px 0;padding-left:20px}.gh-grant .gh-item-fields li{margin:2px 0}.gh-grant.gh-items{container-type:inline-size}@container (max-width:500px){.gh-grant .gh-item-head{grid-template-columns:minmax(0,1fr);gap:2px}}`
    function itemFieldModel(value) {
      if (!object(value)) return { label: 'Malformed field', value: 'See technical details' }
      const label = text(value.field?.name) || 'Unnamed field'
      const leaf = object(value.issueFieldValue) ? value.issueFieldValue : value
      const connections = ['labels', 'users', 'pullRequests', 'reviewers'].filter((key) =>
        Object.hasOwn(value, key),
      )
      if (Object.hasOwn(value, 'repository') || Object.hasOwn(value, 'milestone')) {
        const entry = Object.hasOwn(value, 'repository') ? value.repository : value.milestone
        return {
          label,
          value:
            entry === null
              ? 'Not set'
              : text(entry?.nameWithOwner) || text(entry?.title) || 'Value not supplied',
          url: entry?.url,
          connections,
        }
      }
      for (const key of ['text', 'number', 'date', 'name', 'title', 'value']) {
        if (!Object.hasOwn(leaf, key)) continue
        const supplied = leaf[key]
        if (supplied === null) return { label, value: 'Not set', connections }
        if (typeof supplied === 'string')
          return { label, value: supplied === '' ? 'Empty string' : supplied, connections }
        if (typeof supplied === 'number' && Number.isFinite(supplied))
          return { label, value: String(supplied), connections }
      }
      return {
        label,
        value: connections.length ? '' : 'Value not supplied or unsupported',
        connections,
      }
    }
    function projectItemModel(entry) {
      const content = entry.content,
        type = text(content?.__typename) || text(entry.type)
      const fields = (entry.fieldValues?.nodes ?? []).slice(0, 50)
      // Status is the supplied board field named Status, never the issue state.
      const statuses = fields.filter((value) => value?.field?.name === 'Status')
      const repositories = []
      for (const repository of [content?.repository, ...fields.map((value) => value?.repository)]) {
        if (
          text(repository?.nameWithOwner) &&
          !repositories.some((value) => value.nameWithOwner === repository.nameWithOwner)
        )
          repositories.push({ nameWithOwner: repository.nameWithOwner, url: repository.url })
      }
      const prs = fields.filter((value) => Object.hasOwn(value ?? {}, 'pullRequests'))
      return {
        type,
        title:
          typeof content?.title === 'string'
            ? content.title || 'Empty title'
            : 'Title not supplied',
        number: Number.isSafeInteger(content?.number) ? content.number : undefined,
        url: content?.url,
        issueState:
          type === 'Issue'
            ? text(content?.state) || 'Not supplied'
            : type === 'PullRequest' || type === 'DraftIssue'
              ? 'Not an issue'
              : 'Unknown item type',
        boardStatus: statuses.length
          ? statuses.map((value) => itemFieldModel(value).value).join(' · ')
          : 'Not supplied',
        repositories,
        prs,
        fields: fields.filter(
          (value) =>
            value?.field?.name !== 'Status' &&
            !(value?.field?.name === 'Title' && value?.text === content?.title) &&
            !Object.hasOwn(value ?? {}, 'pullRequests') &&
            !text(value?.repository?.nameWithOwner),
        ),
      }
    }
    function FieldValue({ value }) {
      const model = itemFieldModel(value)
      return h(
        'li',
        null,
        h('strong', null, `${model.label}: `),
        h(Link, { url: model.url }, model.value),
        model.connections?.map((key) =>
          h(SuppliedList, {
            key,
            title: {
              labels: 'Labels',
              users: 'People',
              reviewers: 'Reviewers',
              pullRequests: 'Pull requests',
            }[key],
            connection: value[key],
          }),
        ),
      )
    }
    function ProjectItem({ entry }) {
      const model = projectItemModel(entry)
      return h(
        'article',
        { className: 'gh-item' },
        h(
          'div',
          { className: 'gh-item-head' },
          h(
            'div',
            null,
            h(
              'h4',
              null,
              h(
                Link,
                { url: model.url },
                `${model.number === undefined ? '' : `#${model.number} — `}${model.title}`,
              ),
            ),
            model.repositories.map((repository) =>
              h(
                'small',
                { key: repository.nameWithOwner },
                h(Link, { url: repository.url }, repository.nameWithOwner),
              ),
            ),
            model.type !== 'Issue' && h('small', null, model.type || 'Content unavailable'),
            entry.isArchived === true && h('small', null, 'Archived'),
          ),
          h('p', null, 'Issue state: ', model.issueState),
          h('p', null, 'Board status: ', model.boardStatus),
        ),
        model.prs.map((value, index) =>
          h(
            'div',
            { key: index, className: 'gh-item-pr' },
            'Linked PRs: ',
            !Array.isArray(value.pullRequests?.nodes)
              ? 'Not supplied or malformed'
              : value.pullRequests.nodes.length === 0
                ? 'None returned'
                : value.pullRequests.nodes
                    .slice(0, 50)
                    .map((pr, i) =>
                      h(
                        React.Fragment,
                        { key: i },
                        i > 0 && ' · ',
                        h(
                          Link,
                          { url: pr?.url },
                          `${Number.isSafeInteger(pr?.number) ? `#${pr.number} — ` : ''}${text(pr?.title) || 'Title not supplied'}`,
                        ),
                      ),
                    ),
          ),
        ),
        h(
          'details',
          null,
          h(
            'summary',
            {
              'aria-label': `Additional fields for ${model.number === undefined ? model.title : `item #${model.number}`}`,
            },
            'Additional fields',
          ),
          entry.fieldValues === undefined
            ? h('p', null, 'Fields not supplied.')
            : model.fields.length
              ? h(
                  'ul',
                  { className: 'gh-item-fields' },
                  model.fields.map((value, index) => h(FieldValue, { key: index, value })),
                )
              : h('p', null, 'No additional fields returned.'),
          h(TextSection, { title: 'Item description', value: entry.content?.body }),
          h(
            'details',
            null,
            h('summary', null, 'Technical details'),
            h('pre', { tabIndex: 0 }, JSON.stringify(entry, null, 2)),
          ),
        ),
      )
    }
    const issueCss = `.gh-grant.gh-issues{container-type:inline-size}.gh-grant .gh-issue{padding:8px 0;min-width:0}.gh-grant .gh-issue-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px 16px}.gh-grant .gh-issue-head h4{margin:0;min-width:0}.gh-grant .gh-issue-state{font-size:12px;border:1px solid var(--dsw-alias-border-standard,#8885);border-radius:12px;padding:1px 8px;flex-shrink:0}.gh-grant .gh-issue p{margin:4px 0}.gh-grant .gh-issue-collection{margin:6px 0}.gh-grant .gh-issue-chips{display:inline-flex;flex-wrap:wrap;gap:4px}.gh-grant .gh-issue-chip{border:1px solid var(--dsw-alias-border-standard,#8885);border-radius:10px;padding:0 7px}.gh-grant .gh-issue-related{display:block}@container(max-width:500px){.gh-grant .gh-issue-head{flex-direction:column;gap:4px}}`
    function IssueRow({ entry, sharedRepository }) {
      const state =
        entry.state === 'OPEN' ? 'Open' : entry.state === 'CLOSED' ? 'Closed' : 'Unknown'
      return h(
        'section',
        { className: 'gh-issue' },
        h(
          'div',
          { className: 'gh-issue-head' },
          h('h4', null, h(Link, { url: entry.url }, `#${entry.number} — ${entry.title}`)),
          h(
            'span',
            { className: 'gh-issue-state', 'aria-label': `Issue state: ${state}` },
            `Issue: ${state}`,
          ),
        ),
        !sharedRepository &&
          h('small', null, text(entry.repository?.nameWithOwner) || 'Repository unavailable'),
      )
    }
    function IssueCollection({ title, connection, compact, incomplete }) {
      if (!object(connection) || !Array.isArray(connection.nodes))
        return h(
          'p',
          { role: 'note' },
          `${title}: details missing or malformed; completeness unknown.`,
        )
      const complete =
        !incomplete &&
        connection.pageInfo?.hasNextPage === false &&
        !connection.nextCursor &&
        connection.truncated !== true &&
        connection.totalCount === connection.nodes.length
      if (!connection.nodes.length)
        return complete
          ? null
          : h('p', { role: 'note' }, `${title}: no entries returned; completeness unknown.`)
      return h(
        'div',
        { className: 'gh-issue-collection' },
        h('strong', null, `${title}: `),
        h(
          'span',
          { className: compact ? 'gh-issue-chips' : '' },
          connection.nodes
            .slice(0, 50)
            .map((entry, index) =>
              h(
                'span',
                { key: index, className: compact ? 'gh-issue-chip' : 'gh-issue-related' },
                object(entry)
                  ? h(
                      Link,
                      { url: entry.url },
                      `${text(entry.repository?.nameWithOwner) ? `${entry.repository.nameWithOwner} ` : ''}${Number.isSafeInteger(entry.number) ? `#${entry.number} — ` : ''}${text(entry.name) || text(entry.login) || text(entry.title) || 'Name unavailable'}`,
                    )
                  : 'Malformed entry — see raw details',
              ),
            ),
        ),
        !complete &&
          h('small', null, `${title}: completeness unknown; inspect pagination and raw details.`),
      )
    }
    function IssueDetail({ entry, model }) {
      // A partial description or one relationship does not invalidate other
      // explicitly complete collections. Unlocalized bounds remain conservative.
      const incomplete = (key) =>
        model.unlocalizedTruncation ||
        model.truncationPaths.some(
          (path) => path === 'data' || path === `data.${key}` || path.startsWith(`data.${key}.`),
        ) ||
        model.warnings.some(
          (warning) =>
            warning.startsWith(`data.${key}:`) ||
            warning.startsWith(`data.${key}.`) ||
            warning.includes('inspection bound'),
        )
      const body = entry.body,
        long = typeof body === 'string' && body.length > 400
      return h(
        React.Fragment,
        null,
        h(IssueRow, { entry }),
        typeof body !== 'string'
          ? h('p', { role: 'note' }, 'Description unavailable.')
          : body === ''
            ? h('p', { className: 'gh-note' }, 'No description.')
            : h(
                'div',
                { className: 'gh-issue-description' },
                h(
                  'p',
                  { style: { whiteSpace: 'pre-wrap' } },
                  long ? `${body.slice(0, 400)}…` : body,
                ),
                long &&
                  h(
                    'details',
                    null,
                    h('summary', null, 'Full description — preview shortened'),
                    h('div', { style: { whiteSpace: 'pre-wrap' } }, body),
                  ),
              ),
        entry.parent === null
          ? null
          : object(entry.parent)
            ? h(
                'p',
                null,
                'Parent: ',
                h(
                  Link,
                  { url: entry.parent.url },
                  `${text(entry.parent.repository?.nameWithOwner) ? `${entry.parent.repository.nameWithOwner} ` : ''}${Number.isSafeInteger(entry.parent.number) ? `#${entry.parent.number} — ` : ''}${text(entry.parent.title) || 'Title unavailable'}`,
                ),
              )
            : h('p', { role: 'note' }, 'Parent: details missing or malformed.'),
        [
          ['Labels', 'labels', true],
          ['Assignees', 'assignees', true],
          ['Sub-issues', 'subIssues'],
          ['Blocked by', 'blockedBy'],
          ['Blocking', 'blocking'],
        ].map(([title, key, compact]) =>
          h(IssueCollection, {
            key,
            title,
            connection: entry[key],
            compact,
            incomplete: incomplete(key),
          }),
        ),
      )
    }
    function ReadEntry({ entry, kind }) {
      if (kind === 'items') return h(ProjectItem, { entry })
      const project = kind === 'projects'
      return h(
        'section',
        null,
        h(
          'h4',
          null,
          h(
            Link,
            { url: entry.url },
            `${project ? 'Project' : 'Issue'} #${entry.number} — ${entry.title}`,
          ),
        ),
        h(
          'small',
          null,
          `ID: ${entry.id}${text(entry.repository?.nameWithOwner) ? `; Repository: ${entry.repository.nameWithOwner}` : ''}${text(entry.owner?.login) ? `; Owner: ${entry.owner.login}` : ''}`,
        ),
        h(
          'p',
          null,
          project
            ? `Project: ${entry.closed === true ? 'closed' : entry.closed === false ? 'open' : 'state unavailable'}; ${entry.template === true ? 'template' : entry.template === false ? 'not a template' : 'template status unavailable'}`
            : `Issue state: ${text(entry.state) || 'unavailable'} (not board Status)`,
        ),
        text(entry.shortDescription) && h('p', null, entry.shortDescription),
        h(TextSection, {
          title: project ? 'Project README' : 'Issue description',
          value: project ? entry.readme : entry.body,
        }),
        project
          ? h(
              React.Fragment,
              null,
              h(SuppliedList, { title: 'Linked repositories', connection: entry.repositories }),
              entry.fields !== undefined &&
                h(
                  'details',
                  null,
                  h('summary', null, 'Project field definitions'),
                  Array.isArray(entry.fields?.nodes)
                    ? entry.fields.nodes.slice(0, 50).map((field, index) =>
                        object(field)
                          ? h(
                              'section',
                              { key: index },
                              h(
                                'strong',
                                null,
                                `${shortIdentity(field)} (${text(field.dataType) || 'type unavailable'})`,
                              ),
                              h('small', null, `Field ID: ${text(field.id) || 'unavailable'}`),
                              Array.isArray(field.options) &&
                                h(
                                  'ul',
                                  null,
                                  field.options
                                    .slice(0, 50)
                                    .map((option, i) =>
                                      h(
                                        'li',
                                        { key: i },
                                        `${shortIdentity(option)} — ID: ${text(option?.id) || 'unavailable'}`,
                                      ),
                                    ),
                                ),
                              ['iterations', 'completedIterations'].map(
                                (key) =>
                                  Array.isArray(field.configuration?.[key]) &&
                                  h(
                                    'div',
                                    { key },
                                    h(
                                      'p',
                                      null,
                                      key === 'iterations'
                                        ? 'Active iterations'
                                        : 'Completed iterations',
                                    ),
                                    h(
                                      'ul',
                                      null,
                                      field.configuration[key]
                                        .slice(0, 50)
                                        .map((iteration, i) =>
                                          h(
                                            'li',
                                            { key: i },
                                            `${shortIdentity(iteration)}; ID: ${text(iteration?.id) || 'unavailable'}; ${text(iteration?.startDate)}`,
                                          ),
                                        ),
                                    ),
                                  ),
                              ),
                            )
                          : h('p', { key: index }, 'Malformed field — inspect raw details'),
                      )
                    : h('p', null, 'Field definitions unavailable.'),
                ),
            )
          : h(
              React.Fragment,
              null,
              entry.parent &&
                h(
                  'p',
                  null,
                  'Parent: ',
                  h(
                    Link,
                    { url: entry.parent.url },
                    `#${entry.parent.number ?? '?'} — ${shortIdentity(entry.parent)}`,
                  ),
                ),
              [
                ['Labels', 'labels'],
                ['Assignees', 'assignees'],
                ['Sub-issues', 'subIssues'],
                ['Blocked by', 'blockedBy'],
                ['Blocking', 'blocking'],
              ].map(([title, key]) => h(SuppliedList, { key, title, connection: entry[key] })),
            ),
      )
    }
    function ReadCard({ toolName, block, inspect }) {
      const model = readCardModel(toolName, block)
      const issueList = model.kind === 'issues' && !model.singular
      const issueDetail = model.kind === 'issues' && model.singular
      const repositories = model.entries.map((entry) => text(entry.repository?.nameWithOwner))
      const sharedRepository =
        repositories.length &&
        repositories[0] &&
        repositories.every((name) => name === repositories[0])
          ? repositories[0]
          : ''
      return h(
        'section',
        {
          className: `gh-grant${model.kind === 'items' ? ' gh-items' : model.kind === 'issues' ? ' gh-issues' : ''}`,
          'aria-label': `GitHub ${model.title}`,
        },
        h(
          'style',
          null,
          css,
          model.kind === 'items' ? itemCss : model.kind === 'issues' ? issueCss : '',
        ),
        model.kind === 'items' && h('small', null, 'Historical tool result · no automatic refresh'),
        !issueDetail && h('h3', null, `GitHub · ${model.title}`),
        !issueDetail &&
          h(
            'p',
            { role: 'status' },
            model.state === 'running'
              ? 'Reading…'
              : model.state === 'returned'
                ? `${model.returnedCount} ${model.singular ? 'entry' : 'entries'} returned${model.total === undefined ? '' : `; ${model.total} total reported${model.totalMeaning ? ` (${model.totalMeaning})` : ''}`}`
                : 'Result unavailable',
          ),
        model.error && h('p', { role: 'alert' }, model.error),
        model.warnings.map((warning, index) => h('p', { key: index, role: 'note' }, warning)),
        model.templateOnly &&
          h(
            'p',
            null,
            `Template filtering applies only to this page${Number.isSafeInteger(model.scannedCount) ? `; ${model.scannedCount} projects scanned` : ''}. An empty page does not imply no templates exist.`,
          ),
        model.state === 'returned' &&
          model.entries.length === 0 &&
          h('p', null, 'No entries returned on this page.'),
        issueList && sharedRepository && h('p', { className: 'gh-note' }, sharedRepository),
        model.entries.map((entry, index) =>
          issueList
            ? h(IssueRow, { key: index, entry, sharedRepository })
            : issueDetail
              ? h(IssueDetail, { key: index, entry, model })
              : h(ReadEntry, { key: index, entry, kind: model.kind }),
        ),
        h(
          'details',
          null,
          h('summary', null, 'Raw tool details'),
          h('pre', { tabIndex: 0 }, rawDetails(block) || 'No raw tool result is available yet.'),
          typeof inspect === 'function' &&
            h('button', { type: 'button', onClick: inspect }, 'Inspect tool call'),
        ),
      )
    }
    return {
      inject: ['slots'],
      approvalModel,
      selectApproval,
      ApprovalPreview,
      NativeApprovalDetail,
      api,
      safeUrl,
      validScope,
      validStatus,
      rawDetails,
      phaseLabel,
      Scope,
      GrantCard,
      fieldValueModel,
      validFieldStatus,
      fieldResult,
      fieldPhase,
      fieldPhaseLabel,
      FieldChangeCard,
      READ_TOOLS,
      readWarnings,
      readCardModel,
      itemFieldModel,
      projectItemModel,
      ReadCard,
      apply(ctx) {
        // The optional native detail is a single seat, not a selector chain.
        // Unmatched requests retain RC2's command fallback and native reason.
        ctx.slots.inject('conversation.approval.detail', () =>
          ctx.slots.register(
            { name: 'conversation.approval.detail', priority: -10 },
            NativeApprovalDetail,
          ),
        )
        ctx.slots.inject('tool.call.toolview', () => {
          const disposers = [
            ctx.slots.register({ name: 'tool.call.toolview', key: TOOL }, GrantCard),
            ctx.slots.register({ name: 'tool.call.toolview', key: FIELD_TOOL }, FieldChangeCard),
            ...READ_TOOLS.map((key) =>
              ctx.slots.register({ name: 'tool.call.toolview', key }, ReadCard),
            ),
          ]
          return () => {
            for (const dispose of disposers.toReversed()) dispose()
          }
        })
      },
    }
  },
})
