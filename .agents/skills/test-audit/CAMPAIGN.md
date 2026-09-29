# Subsystem test-audit campaign

Use campaign mode to audit a subsystem's complete test surface as one coherent review unit. Split delivery if repository limits or risk require smaller changes. The value bar, retention bar, candidate evidence, and validation in [the test-audit skill](<skills/test-audit/SKILL.md>) apply throughout.

Each step has a completion criterion. If prerequisites prevent completion, record the blocker rather than silently skipping the step.

## 1. Record the baseline

Pin the baseline revision using the repository's version-control system. Record production, test, and support line counts separately. Inventory every in-scope test file and scenario, then record its baseline result. In frameworks with embedded tests, use the owning module or runner-discovered test group instead of assuming separate test files.

Keep baseline failures in a separate list. Investigate them as possible product, environment, or test defects rather than assuming they are stale tests. Mark unavailable live or platform-specific tests as blocked, with the reason.

**Complete when:** every in-scope test file or equivalent group has a recorded result. Blocked validation remains an explicit limitation, not a passing result.

## 2. Assign ownership groups

Divide the surface into **lanes**: groups defined by production ownership, not just path prefixes. Examples include configuration, dispatch, persistence, transport, shared utilities, and test infrastructure. Include subsystem cases in shared suites, integration scenarios, end-to-end scenarios, and live verification harnesses.

**Complete when:** every owned test and scenario belongs to exactly one lane, including shared-boundary cases.

## 3. Build a read-only ledger

Read every assigned test in full, including parameter tables. Read its production owners, entry points, callers, history, and CI routing. If authorized parallel review is available, assign disjoint lanes to reviewers; otherwise process them sequentially.

Record each test declaration in a written **ledger** with one mark. Treat a parameterized test as one declaration unless its cases need different marks; then record the cases separately.

- **R — Retain:** name the contract and the regression it catches. A test that only moves to a clearer location remains R; note the move.
- **F — Fix the assertion:** retain the contract but repair a weak or incorrect assertion, such as a negative check that passes when only one of several required results is missing.
- **C — Consolidate:** name the owner that absorbs the assertion before the original is removed. This may be a parameterized case, a stronger boundary suite, or a shared owner in another component.
- **D — Delete:** name the proof that remains, or explain why no independent contract exists.

Judge tests by their assertions, not their names. A test named for resource cleanup may only assert that the resource still exists.

**Complete when:** every declaration has a mark and evidence, and every deletion candidate satisfies the skill's candidate-evidence requirements.

## 4. Plan which layers to retain

Use the ledger as input, not as an automatic edit list. Make a second read-only pass to identify redundant testing layers. Several suites may replay the same mocked collaborator while a stronger suite exercises the real production boundary.

Name the **keeper suite** for each contract: the suite that retains its primary proof. Prefer a real production interface with controlled external dependencies over a mock that implements the behavior being asserted. Do not force every contract into an end-to-end test; choose the boundary that independently proves it. Correct ledger errors found in this pass.

**Complete when:** every lane plan names retired files or groups, keepers, assertions to carry into keepers, and test-only production seams that can be removed.

## 5. Apply the plan

Edit one lane at a time. Assign shared fixtures and support files to one editing owner, or serialize changes to them. Remove obsolete seams as each lane makes them unnecessary, subject to consumer and compatibility checks.

Register moved suites in CI routing and inventories where required. If the repository tracks test-size budgets, update them according to its policy; do not weaken gates to hide failures. Record durable test-ownership rules in the repository's established contributor documentation, based on findings from this campaign.

**Complete when:** every lane plan is applied and its keeper suites pass, with baseline failures tracked separately.

## 6. Review preservation of contracts

Compare deleted coverage against the keeper suites. Prefer independent reviewers per boundary group when available and authorized. If independent review is unavailable, perform a separate review pass and disclose that limitation.

Look for contracts that lost their only proof and assertions that cannot fail, including rejection cases the production path never reaches.

For each restored contract, make a deliberate, reversible **mutation**: a small production change that violates that contract. Confirm that the keeper fails for the intended reason. Use an isolated checkout or a precisely recorded patch, and restore the exact pre-mutation state without discarding unrelated edits. Do not mutate shared files during another validation run. Confirm that the restored version passes.

**Complete when:** every reported gap is restored or rejected with source evidence, and each restored contract catches its mutation. If a mutation cannot safely run, document the missing proof and do not claim full preservation validation.

## 7. Resolve confirmed product defects

A baseline failure that persists in a keeper needs investigation. If it is a product defect and repair is authorized, fix it at its production owner as a separate change or commit. Prove the repair through the real behavior with a **control** run: remove only the fix and demonstrate the old failure, then restore the fix and demonstrate success on the same harness.

Track unrelated defects as follow-ups. Do not expand the campaign into unrelated repairs.

**Complete when:** each repaired defect has a failing control and a passing candidate. Unrepaired defects remain explicit follow-ups with their impact on validation.

## 8. Reconcile and hand off

If the target branch advances, integrate updates using repository policy; do not prescribe merge or rebase universally. If upstream changes a test that the campaign removes, review the new contract and port it into the keeper before deciding whether the deletion remains valid. Do not discard upstream coverage automatically.

Rerun the full subsystem suite on the final integrated revision. Repeat authorized live verification where relevant, or state why it remains unavailable. Check whether review tools truncate large diffs or file lists; use a complete local inventory to verify coverage. Record approved exceptions instead of silently weakening review gates.

Use the skill's handoff report and add:

- Baseline and final test/support line counts, with production/tooling counted separately.
- Ownership lanes, retired layers, and keeper suites.
- Preservation gaps and mutation results.
- Product defects, control results, and candidate results.
- Blocked validation and any independent-review limitations.

**Complete when:** the final inventory reconciles with the ledger, validation results are recorded, and the handoff distinguishes completed work from remaining limitations.
