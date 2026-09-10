import assert from 'node:assert/strict'
import test from 'node:test'
import { openSeededSession } from './session-navigation.mjs'

// Locator double for the CI accessibility tree. It models group visibility,
// strict matching and loaded content, not Playwright's browser auto-waiting.
function fixture({ expanded = true, age = '8mo', seed = true, content = true, duplicate = false } = {}) {
  const clicks = []
  const waits = []
  let selected
  const workspace = { role: 'treeitem', name: 'workspace', expanded }
  const blank = { role: 'treeitem', name: 'New Session', parent: workspace }
  const persisted = { role: 'treeitem', name: `workspace ${age}`, parent: workspace }
  const tree = { role: 'tree', name: 'Sessions', children: [workspace, blank, ...(seed ? [persisted] : [])] }
  if (duplicate) tree.children.push({ ...persisted })
  const message = { text: 'Review the Session recap interface.' }
  const nodes = [tree, ...tree.children,
    // An identical row in another tree must not affect scoped navigation.
    { role: 'treeitem', name: `workspace ${age}` }]
  function matches(value, name, exact) {
    return name instanceof RegExp ? name.test(value) : exact ? value === name : value.includes(name)
  }
  function locator(resolve) {
    function one() {
      const found = resolve()
      assert.equal(found.length, 1, 'locator must resolve exactly one element')
      return found[0]
    }
    function visible(node) {
      return node === message ? selected === persisted && content : !node.parent || node.parent.expanded
    }
    return {
      getByRole(role, { name, exact }) {
        return locator(() => one().children.filter(node => node.role === role && matches(node.name, name, exact)))
      },
      async waitFor({ state }) {
        assert.equal(state, 'visible')
        const node = one()
        assert.ok(visible(node), 'element must be visible')
        waits.push(node.name ?? node.text)
      },
      async getAttribute(name) {
        assert.equal(name, 'aria-expanded')
        return String(one().expanded)
      },
      async click() {
        const node = one()
        assert.ok(visible(node), 'cannot click a hidden session')
        clicks.push(node.name)
        if (node === workspace) node.expanded = !node.expanded
        else selected = node
      },
    }
  }
  const page = {
    getByRole(role, { name, exact }) {
      return locator(() => nodes.filter(node => node.role === role && matches(node.name, name, exact)))
    },
    getByText(text, { exact }) {
      assert.equal(exact, true)
      return locator(() => matches(message.text, text, exact) ? [message] : [])
    },
  }
  return { page, clicks, waits }
}

for (const age of ['8mo', '1y', 'just now']) {
  test(`selects the persisted session (${age}) without collapsing the expanded workspace`, async () => {
    const { page, clicks, waits } = fixture({ age })
    await openSeededSession(page)
    assert.deepEqual(clicks, [`workspace ${age}`])
    assert.deepEqual(waits, ['workspace', 'Review the Session recap interface.'])
  })
}

test('expands a collapsed workspace before selecting the persisted session', async () => {
  const { page, clicks } = fixture({ expanded: false })
  await openSeededSession(page)
  assert.deepEqual(clicks, ['workspace', 'workspace 8mo'])
})

test('does not substitute the workspace, blank session or an out-of-tree row for a missing seed', async () => {
  const { page, clicks } = fixture({ seed: false })
  await assert.rejects(openSeededSession(page), /exactly one element/)
  assert.deepEqual(clicks, [])
})

test('refuses ambiguous persisted rows instead of choosing the first', async () => {
  const { page, clicks } = fixture({ duplicate: true })
  await assert.rejects(openSeededSession(page), /exactly one element/)
  assert.deepEqual(clicks, [])
})

test('requires the seeded conversation content after navigation', async () => {
  const { page, clicks } = fixture({ content: false })
  await assert.rejects(openSeededSession(page), /element must be visible/)
  assert.deepEqual(clicks, ['workspace 8mo'])
})
