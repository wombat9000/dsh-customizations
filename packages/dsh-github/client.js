window.__ModuleLoader__.load({
  id: '@local/dsh-github',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const TOOL = 'github_request_issue_management'
    const labels = { setProjectItemField: 'Update supported board fields for granted issue memberships', addIssueDependency: 'Add a dependency between two granted issues' }
    const exclusions = 'No deletion, transfer, new issues, issues outside this grant, project configuration, repository settings, or project membership changes.'
    const unavailable = 'Issue title/description editing, labels, assignees, closing/reopening, and dependency removal are not available through this integration.'
    const expiry = 'Access applies only to this live requesting session and account. It does not transfer to other sessions or subagents. Restart, session restoration, account change, or service disposal requires fresh approval. Revocation prevents future dispatch, not writes already dispatched.'
    const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    const text = value => typeof value === 'string' ? value : ''
    const id = value => typeof value === 'string' && value.length > 0 && value.length <= 4096
    function safeUrl(value) {
      if (typeof value !== 'string') return undefined
      try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.port ? url.href : undefined } catch { return undefined }
    }
    function validScope(scope) {
      return object(scope) && object(scope.account) && id(scope.account.id) && id(scope.account.login)
        && Array.isArray(scope.operations) && scope.operations.length > 0 && scope.operations.length <= 2 && scope.operations.every(op => Object.hasOwn(labels, op))
        && Array.isArray(scope.issues) && scope.issues.length > 0 && scope.issues.length <= 50
        && scope.issues.every(issue => object(issue) && id(issue.id) && id(issue.repositoryId) && id(issue.repositoryOwnerId) && id(issue.nameWithOwner) && Number.isSafeInteger(issue.issueNumber) && issue.issueNumber > 0)
        && Array.isArray(scope.projects) && scope.projects.length <= 20 && scope.projects.every(project => object(project) && id(project.id) && id(project.ownerId) && id(project.owner) && Number.isSafeInteger(project.projectNumber) && project.projectNumber > 0)
        && Array.isArray(scope.memberships) && scope.memberships.length <= 5000 && scope.memberships.every(item => object(item) && id(item.id) && id(item.issueId) && id(item.projectId))
    }
    function validStatus(value, callId) {
      return object(value) && value.version === 1 && id(value.phase)
        && (value.callId === undefined || value.callId === callId)
        && (value.toolName === undefined || value.toolName === TOOL)
        && (value.scope === undefined || validScope(value.scope))
        && (value.exactPreview === undefined || typeof value.exactPreview === 'string')
        && Array.isArray(value.grants) && value.grants.length <= 100 && value.grants.every(grant => object(grant) && id(grant.id) && id(grant.state) && validScope(grant.scope))
        && Array.isArray(value.history) && value.history.length <= 1000 && value.history.every(row => object(row) && id(row.id) && id(row.operation) && id(row.outcome))
    }
    async function api(action, body, signal) {
      if (!['status', 'revoke'].includes(action)) throw new Error('Unsupported GitHub card action.')
      const response = await fetch(`/api/plugins/github/${action}`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-dsh-github': '1' }, body: JSON.stringify(body), signal })
      if (!response.ok) throw new Error('GitHub access status is unavailable. No new access was requested.')
      const result = await response.json()
      if (result?.ok !== true) throw new Error('GitHub access status is unavailable. No new access was requested.')
      return result.value
    }
    const css = `.gh-grant{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-tertiary,transparent);border:1px solid var(--dsw-alias-border-standard,#8885);border-radius:12px;padding:14px;margin:8px 0;min-width:0;font-size:14px;line-height:1.5;overflow-wrap:anywhere}.gh-grant h3,.gh-grant h4{margin:0 0 8px}.gh-grant p{margin:8px 0}.gh-grant ul{padding-left:22px;margin:8px 0}.gh-grant li{margin:6px 0}.gh-grant a{color:var(--dsw-alias-brand-primary,#486ed4);text-decoration:underline}.gh-grant button,.gh-grant summary{font:inherit;cursor:pointer}.gh-grant button{color:inherit;background:transparent;border:1px solid var(--dsw-alias-border-standard,#8888);border-radius:7px;padding:7px 12px;white-space:normal}.gh-grant button:disabled{opacity:.6;cursor:default}.gh-grant :is(button,summary,a):focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#486ed4);outline-offset:3px}.gh-grant details{margin:10px 0}.gh-grant pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:320px;overflow:auto;padding:8px;background:var(--dsw-specific-input-major,transparent)}.gh-grant small{display:block;color:var(--dsw-alias-label-secondary);font-size:12px}.gh-grant [role=alert]{color:var(--dsw-alias-state-error-primary,#b33)}.gh-grant .gh-scroll{max-height:340px;overflow:auto;padding:2px 6px}.gh-grant section+section{border-top:1px solid var(--dsw-alias-border-standard,#8885);margin-top:12px;padding-top:12px}.gh-grant .gh-note{color:var(--dsw-alias-label-secondary)}`
    function Link({ url, children }) {
      const href = safeUrl(url)
      return href ? h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, children) : h('span', null, children)
    }
    function Scope({ scope }) {
      if (!validScope(scope)) return h('p', { role: 'alert' }, 'Verified grant details are unavailable. Use the complete native approval preview; no scope is inferred from tool arguments.')
      return h('div', null,
        h('p', null, h('strong', null, 'Account: '), scope.account.login, h('small', null, `Account ID: ${scope.account.id}`)),
        h('h4', null, `Selected issues (${scope.issues.length})`),
        h('div', { className: 'gh-scroll', tabIndex: 0, role: 'group', 'aria-label': 'Selected issues' }, h('ul', null, scope.issues.map(issue => h('li', { key: issue.id },
          h(Link, { url: issue.url }, `${issue.nameWithOwner} #${issue.issueNumber}${text(issue.title) ? ` — ${issue.title}` : ''}`),
          h('small', null, `Issue ID: ${issue.id}; Repository ID: ${issue.repositoryId}; Repository owner ID: ${issue.repositoryOwnerId}`))))),
        h('h4', null, `Selected projects (${scope.projects.length})`),
        scope.projects.length ? h('ul', null, scope.projects.map(project => h('li', { key: project.id },
          h(Link, { url: project.url }, `${project.owner} project #${project.projectNumber}${text(project.title) ? ` — ${project.title}` : ''}`),
          h('small', null, `Project ID: ${project.id}; Owner ID: ${project.ownerId}`)))) : h('p', null, 'No projects selected.'),
        h('h4', null, 'Included operations'), h('ul', null, scope.operations.map(op => h('li', { key: op }, labels[op], h('small', null, op)))),
        h('details', null, h('summary', null, `Exact existing project memberships (${scope.memberships.length})`), scope.memberships.length ? h('ul', null, scope.memberships.map(item => h('li', { key: item.id }, `Item ID: ${item.id}; Issue ID: ${item.issueId}; Project ID: ${item.projectId}`))) : h('p', null, 'None.')),
        h('p', null, h('strong', null, 'Excluded: '), exclusions),
        h('p', null, h('strong', null, 'Unavailable capabilities: '), unavailable),
        h('p', { className: 'gh-note' }, h('strong', null, 'Expiry and revocation: '), expiry))
    }
    function rawDetails(block) {
      const args = text(block?.call?.argsRaw) || text(block?.argsRaw)
      const result = Array.isArray(block?.content) ? block.content.filter(part => part?.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n') : ''
      return [args && `Arguments\n${args}`, result && `Result\n${result}`, block?.error && `Error\n${text(block.error.name)}: ${text(block.error.code)}`].filter(Boolean).join('\n\n')
    }
    function phaseLabel(phase) {
      return ({ prepared: 'Verified scope prepared', approved: 'Approved — access is not yet confirmed', unattempted: 'Not executed', preparing: 'Preparing verified scope', pending: 'Awaiting approval', 'awaiting-approval': 'Awaiting approval', running: 'Running — access is not yet confirmed', active: 'Active access', granted: 'Access granted', confirmed: 'Grant confirmed', denied: 'Denied', rejected: 'Denied', failed: 'Failed', cancelled: 'Cancelled', uncertain: 'Outcome uncertain', expired: 'Expired — fresh approval required', revoked: 'Revoked', 'renewal-required': 'Renewal required', 'account-changed': 'Account changed — fresh approval required' })[phase] ?? 'Status unknown — access is not confirmed'
    }
    function GrantCard({ sessionId, callId, block, inspect, useSessionPendingInteraction, request = api }) {
      const pending = typeof useSessionPendingInteraction === 'function' ? useSessionPendingInteraction(map => {
        const value = map.get(sessionId)
        return value?.kind === 'approval' && value.callId === callId && value.toolName === TOOL ? value : undefined
      }) : undefined
      const [loaded, setLoaded] = React.useState(null), [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false)
      const [revision, refresh] = React.useReducer(n => n + 1, 0)
      const generation = React.useRef(0), action = React.useRef(null)
      const status = loaded?.sessionId === sessionId && loaded?.callId === callId ? loaded.value : null
      React.useEffect(() => {
        const token = ++generation.current, controller = new AbortController()
        let timer, failures = 0
        setLoaded(null); setError(''); setBusy(false)
        async function load() {
          if (generation.current !== token) return
          try {
            const value = await request('status', { sessionId, callId }, controller.signal)
            if (generation.current !== token) return
            if (!validStatus(value, callId)) throw new Error('Invalid GitHub grant status. Access is not confirmed.')
            setLoaded({ sessionId, callId, value }); setError(''); failures = 0
            // Continue observing active authority so revocation/account changes elsewhere become visible.
            if (['preparing', 'prepared', 'approved', 'pending', 'awaiting-approval', 'running'].includes(value.phase) || value.grants.some(grant => grant.state === 'active')) timer = setTimeout(load, 1500)
          } catch (failure) {
            if (generation.current !== token || controller.signal.aborted) return
            setLoaded(null); setError(failure.message || 'GitHub status is unavailable. Access is not confirmed.')
            if (++failures <= 3) timer = setTimeout(load, 1500)
          }
        }
        void load()
        return () => { generation.current++; controller.abort(); action.current?.abort(); action.current = null; clearTimeout(timer) }
      }, [sessionId, callId, request, revision, pending?.key, block?.kind])
      async function revoke(grantId) {
        if (action.current || !status?.grants.some(grant => grant.id === grantId && grant.state === 'active')) return
        // Fence older status requests/polls before revocation. A lost revoke response stays explicit until a fresh status check.
        const controller = new AbortController(), token = ++generation.current
        action.current = controller; setBusy(true); setError('')
        try {
          await request('revoke', { sessionId, callId, grantId }, controller.signal)
          if (generation.current !== token) return
          // The status endpoint, never a successful HTTP response alone, confirms current authority.
          refresh()
        } catch {
          if (generation.current !== token) return
          setLoaded(null); setError('Revocation could not be confirmed. Refresh status before relying on it. This action did not request a GitHub write.')
        } finally { if (generation.current === token) { action.current = null; setBusy(false) } }
      }
      let phase = pending ? 'awaiting-approval' : status?.phase
      if (!pending && ['active', 'granted', 'confirmed'].includes(phase) && !status?.grants.some(grant => grant.state === 'active')) {
        const states = new Set(status?.grants.map(grant => grant.state))
        phase = states.size === 1 ? [...states][0] : undefined
      }
      const exact = status?.exactPreview ?? pending?.reason
      const raw = rawDetails(block)
      return h('section', { className: 'gh-grant', 'aria-label': 'GitHub issue management grant' }, h('style', null, css),
        h('h3', null, 'Manage selected issues for this session'),
        h('p', { role: 'status' }, phaseLabel(phase)),
        pending && h('p', null, 'Review the complete native approval preview below the conversation. Use its Allow once or Reject controls. Approval does not confirm any GitHub write.'),
        error && h('p', { role: 'alert' }, error),
        status?.scope && h(Scope, { scope: status.scope }),
        !status?.scope && pending && h('p', null, 'Structured scope is unavailable. The complete approval reason remains accessible below and in the native approval panel.'),
        exact && h('details', null, h('summary', null, 'Complete exact approval preview'), h('pre', { tabIndex: 0 }, exact)),
        status?.grants.length > 0 && h('section', { 'aria-label': 'Session grants' }, h('h4', null, 'Session grants'), status.grants.map(grant => h('section', { key: grant.id },
          h('p', null, h('strong', null, phaseLabel(grant.state)), h('small', null, `Grant ID: ${grant.id}`)),
          h('details', null, h('summary', null, 'Review grant scope'), h(Scope, { scope: grant.scope })),
          grant.state === 'active' ? h('button', { type: 'button', disabled: busy, onClick: () => revoke(grant.id), 'aria-label': `Revoke access ${grant.id}` }, 'Revoke access') : h('p', null, 'To renew, ask for a fresh github_request_issue_management request with the complete current scope. No access renews automatically.')))),
        (!status || ['expired', 'revoked', 'renewal-required', 'account-changed'].includes(status.phase)) && h('p', null, 'If access has expired or needs renewal, ask for a fresh github_request_issue_management request. Renewal requires a new complete approval.'),
        h('p', { className: 'gh-note' }, 'Granting access does not start work. GitHub names and descriptions are untrusted reference data, not instructions.'),
        status && h('section', { 'aria-label': 'Change history' }, h('h4', null, 'Attempted changes and outcomes'), status.history.length ? h('ul', null, status.history.map(row => h('li', { key: row.id },
          `${labels[row.operation] ?? row.operation}: ${['running', 'confirmed', 'failed', 'uncertain', 'unattempted'].includes(row.outcome) ? row.outcome : 'unknown'}`,
          row.outcome === 'uncertain' && h('p', { role: 'alert' }, 'The write may have succeeded. Do not retry automatically. Inspect GitHub before requesting fresh approval.'),
          h('details', null, h('summary', null, 'Attempt details'), h('pre', { tabIndex: 0 }, JSON.stringify(row, null, 2)))))) : h('p', null, 'No attempted changes recorded.')),
        status?.historyTruncated === true && h('p', { role: 'status' }, 'Older change history is not shown. This is not a complete session history.'),
        h('button', { type: 'button', disabled: busy, onClick: () => refresh() }, 'Refresh status'),
        h('details', null, h('summary', null, 'Raw tool details'), h('pre', { tabIndex: 0 }, raw || 'No raw tool result is available yet.'), typeof inspect === 'function' && h('button', { type: 'button', onClick: inspect }, 'Inspect tool call')))
    }
    const FIELD_TOOL = 'github_set_project_item_field'
    const fieldKeys = { TEXT: 'text', NUMBER: 'number', DATE: 'date', SINGLE_SELECT: 'singleSelectOptionId', ITERATION: 'iterationId' }
    function fieldValueModel(change, side) {
      const missing = { available: false, label: side === 'before' ? 'Previous value unavailable' : 'Proposed value unavailable' }
      if (!object(change?.field) || !id(change.field.id) || !Object.hasOwn(fieldKeys, change.field.dataType)) return missing
      const value = change[side], type = change.field.dataType
      if (side === 'before' && value === null) return { available: true, label: 'Not set' }
      if (!object(value) || (side === 'before' && value.field && (value.field.id !== change.field.id || value.field.dataType && value.field.dataType !== type))) return missing
      const key = side === 'before' && type === 'SINGLE_SELECT' ? 'optionId' : fieldKeys[type]
      if (side === 'after' && (Object.keys(value).length !== 1 || !Object.hasOwn(value, key))) return missing
      const leaf = value[key]
      if (type === 'TEXT') return typeof leaf === 'string' ? { available: true, label: JSON.stringify(leaf) } : missing
      if (type === 'NUMBER') return typeof leaf === 'number' && Number.isFinite(leaf) ? { available: true, label: String(leaf) } : missing
      if (type === 'DATE') return typeof leaf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(leaf) && !Number.isNaN(Date.parse(leaf)) && new Date(leaf).toISOString().slice(0, 10) === leaf ? { available: true, label: leaf } : missing
      if (!id(leaf)) return missing
      const selected = side === 'before' ? value : change.selectedOption?.id === leaf ? change.selectedOption : null
      const friendly = text(type === 'SINGLE_SELECT' ? selected?.name : selected?.title)
      return { available: true, label: friendly || leaf, identity: leaf, ...(type === 'ITERATION' && selected ? { detail: [text(selected.startDate), Number.isFinite(selected.duration) ? `${selected.duration} days` : ''].filter(Boolean).join(' · ') } : {}) }
    }
    function validFieldStatus(value, callId) {
      if (!object(value) || value.version !== 1 || !id(value.phase)) return false
      if (value.toolName === undefined && value.callId === undefined) return value.phase === 'expired' && value.change === undefined && value.targets === undefined
      return value.toolName === FIELD_TOOL && value.callId === callId
        && (value.exactPreview === undefined || typeof value.exactPreview === 'string')
        && (value.change === undefined || object(value.change)) && (value.targets === undefined || object(value.targets))
    }
    function fieldResult(block) {
      if (block?.kind !== 'tool-result' || !Array.isArray(block.content)) return undefined
      const parts = block.content.filter(part => part?.type === 'text' && typeof part.text === 'string')
      if (parts.length !== 1 || parts[0].text.length > 262144) return undefined
      try { const value = JSON.parse(parts[0].text); return object(value) && value.host === 'github.com' && (value.operation === 'setProjectItemField' || value.operation === undefined && value.outcome === 'failed' && object(value.error)) && ['failed', 'confirmed', 'uncertain'].includes(value.outcome) ? value : undefined } catch { return undefined }
    }
    function fieldPhase(status, block, pending) {
      const result = fieldResult(block), recorded = object(status?.result) ? status.result : undefined
      if (result?.outcome === 'uncertain' || recorded?.outcome === 'uncertain' || status?.phase === 'uncertain' || block?.isError === true && (result?.outcome === 'confirmed' || status?.phase === 'confirmed')) return 'uncertain'
      if (result?.outcome) return result.outcome
      if (pending) return 'awaiting-approval'
      if (block?.kind === 'tool-result' && !['confirmed', 'denied', 'failed', 'unattempted'].includes(status?.phase)) return 'unknown'
      return status?.phase ?? 'unknown'
    }
    function fieldPhaseLabel(phase) {
      return ({ prepared: 'Proposed change prepared', preparing: 'Preparing change', approved: 'Approved — write not yet confirmed', 'authorized-by-grant': 'Authorized by session grant — write not yet confirmed', running: 'Running — write not yet confirmed', 'awaiting-approval': 'Awaiting approval', denied: 'Denied — not executed', unattempted: 'Not executed', failed: 'Failed before execution', confirmed: 'GitHub confirmed the update', uncertain: 'Outcome uncertain — the write may have succeeded', expired: 'Prepared details expired — outcome unknown' })[phase] ?? 'Outcome unknown — no success is inferred'
    }
    function FieldChangeCard({ sessionId, callId, block, inspect, useSessionPendingInteraction, request = api }) {
      const pending = typeof useSessionPendingInteraction === 'function' ? useSessionPendingInteraction(map => {
        const value = map.get(sessionId)
        return value?.kind === 'approval' && value.callId === callId && value.toolName === FIELD_TOOL ? value : undefined
      }) : undefined
      const [loaded, setLoaded] = React.useState(null), [error, setError] = React.useState('')
      const generation = React.useRef(0)
      const status = loaded?.sessionId === sessionId && loaded?.callId === callId ? loaded.value : null
      React.useEffect(() => {
        const token = ++generation.current, controller = new AbortController()
        let timer, failures = 0
        setLoaded(null); setError('')
        async function load() {
          if (generation.current !== token) return
          try {
            const value = await request('status', { sessionId, callId }, controller.signal)
            if (generation.current !== token) return
            if (!validFieldStatus(value, callId)) throw new Error('Invalid prepared change')
            setLoaded({ sessionId, callId, value }); setError(''); failures = 0
            if (['preparing', 'prepared', 'approved', 'authorized-by-grant', 'running', 'awaiting-approval'].includes(value.phase)) timer = setTimeout(load, 1500)
          } catch {
            if (generation.current !== token || controller.signal.aborted) return
            setLoaded(null); setError('Prepared change details are unavailable. See the native approval preview and raw tool details; no previous value or outcome is inferred.')
            if (++failures <= 3) timer = setTimeout(load, 1500)
          }
        }
        void load()
        return () => { generation.current++; controller.abort(); clearTimeout(timer) }
      }, [sessionId, callId, request, pending?.key, block?.kind])
      const change = status?.change, field = change?.field, project = status?.targets?.project, item = status?.targets?.item
      const content = item?.content, before = fieldValueModel(change, 'before'), after = fieldValueModel(change, 'after')
      const phase = fieldPhase(status, block, pending), result = fieldResult(block) ?? status?.result
      const target = content?.__typename === 'Issue' ? `Issue #${content.number ?? content.id ?? 'unknown'}` : content?.__typename === 'PullRequest' ? `Pull request #${content.number ?? content.id ?? 'unknown'}` : content?.__typename === 'DraftIssue' ? `Draft issue ${text(content.id)}` : `Item ${text(item?.id) || 'unavailable'}`
      const exact = pending?.reason ?? status?.exactPreview
      return h('section', { className: 'gh-grant', 'aria-label': 'GitHub project field change' }, h('style', null, css),
        h('h3', null, 'GitHub · Project field change'), h('p', { role: 'status' }, fieldPhaseLabel(phase)),
        error && h('p', { role: 'alert' }, error),
        h('p', null, h(Link, { url: content?.url }, `${target}${text(content?.title) ? ` — ${content.title}` : ''}`)),
        h('p', null, h(Link, { url: project?.url }, text(project?.title) || `Project ${project?.number ?? (text(project?.id) || 'unavailable')}`)),
        h('p', null, h('strong', null, text(field?.name) || `Field ${text(field?.id) || 'unavailable'}`)),
        h('small', null, `Project ID: ${text(project?.id) || 'unavailable'}; Item ID: ${text(item?.id) || 'unavailable'}; Field ID: ${text(field?.id) || 'unavailable'}`),
        h('p', { className: 'gh-note' }, 'Prepared change (not a fresh read of the field):'),
        h('pre', { tabIndex: 0, 'aria-label': 'Prepared before and after values' }, before.available && after.available ? `${before.label} → ${after.label}` : `Before: ${before.label}\nAfter: ${after.label}`),
        [before, after].map((value, index) => value.identity && h('small', { key: index }, `${index ? 'After' : 'Before'} ID: ${value.identity}${value.detail ? `; ${value.detail}` : ''}`)),
        pending && h('p', null, 'The native approval panel keeps the complete exact preview and Allow once / Reject controls. Approval is not confirmation that this write succeeded.'),
        phase === 'uncertain' && h('p', { role: 'alert' }, 'Do not retry automatically. Inspect the explicit GitHub targets before requesting a fresh change. No rollback is implied.'),
        typeof result?.message === 'string' && h('p', null, result.message), typeof result?.cleanupWarning === 'string' && h('p', { role: 'alert' }, result.cleanupWarning),
        exact && h('details', null, h('summary', null, 'Complete exact approval preview'), h('pre', { tabIndex: 0 }, exact)),
        h('details', null, h('summary', null, 'Raw tool details'), h('pre', { tabIndex: 0 }, rawDetails(block) || 'No raw tool result is available yet.'), typeof inspect === 'function' && h('button', { type: 'button', onClick: inspect }, 'Inspect tool call')))
    }
    return { inject: ['slots'], api, safeUrl, validScope, validStatus, rawDetails, phaseLabel, Scope, GrantCard, fieldValueModel, validFieldStatus, fieldResult, fieldPhase, fieldPhaseLabel, FieldChangeCard,
      apply(ctx) { ctx.slots.inject('tool.call.toolview', () => {
        const disposers = [ctx.slots.register({ name: 'tool.call.toolview', key: TOOL }, GrantCard), ctx.slots.register({ name: 'tool.call.toolview', key: FIELD_TOOL }, FieldChangeCard)]
        return () => { for (const dispose of disposers.toReversed()) dispose() }
      }) },
    }
  },
})
