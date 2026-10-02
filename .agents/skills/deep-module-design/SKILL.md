---
name: deep-module-design
description: Design and review deep module boundaries for substantial implementations, refactors, and architecture reviews; reduce caller knowledge and lifecycle coordination without speculative abstractions.
---

# Deep module design

Use this skill for substantial implementations, refactors, and architecture reviews. For a small fix within an established boundary, follow the existing design and run focused validation instead. Classify by responsibility and risk, not lines changed.

A **deep module** provides useful behavior through an interface that requires relatively little caller knowledge. Its implementation owns the complexity needed to deliver that behavior. A module can be a function, class, hook, or service; creating another file does not make it deep.

Follow the [engineering guide](../../../docs/engineering.md) for coding standards. This skill supplies a design process, not a second set of language or framework rules. It grants no permission to install dependencies, expand scope, commit, or deploy. If the request is review-only, do not edit.

## 1. Identify caller knowledge

Read the affected entrypoints, callers, implementation, and relevant tests before proposing a boundary. Reuse established contracts; inspect an upstream dependency when the design depends on an unfamiliar or changed contract.

Ask:

> What must callers know or coordinate today? What will this change let them stop knowing or coordinating?

Look for repeated knowledge about provider formats, selector resolution, operation ordering, state transitions, pagination, cancellation, cleanup, or failure recovery. Identify the production owner: the component responsible for enforcing the behavior. Do not assume that repetition alone justifies a shared abstraction.

## 2. Choose a cohesive operation

Name the outcome the caller needs. Keep the rules required to deliver that outcome with one owner.

- Prefer an operation such as revalidating a prepared write or resolving an issue query over a list of internal steps the caller must assemble.
- Put related state transitions and lifecycle rules together. Moving preparation while leaving callers responsible for its cleanup does not hide that coordination.
- Keep domain behavior separate from transport, host registration, and presentation when that reduces their knowledge of one another. Do not impose layers on every function.
- Pass effects through narrow interfaces where useful. Avoid handing a module the entire host context when it needs only a transport or persistence operation.
- Preserve information callers genuinely need, such as cancellation, authorization requirements, collection completeness, and uncertain outcomes. Hiding complexity must not hide safety obligations or fabricate success.

Sketch the smallest useful interface before changing the implementation. Compare it with leaving the code where it is. If the proposed wrapper exposes the same internal concepts or requires more coordination, simplify it or keep the existing boundary.

## 3. Preserve contracts and lifetime

Identify the affected public APIs, payloads, settings, labels, error semantics, persistence behavior, and generated artifacts. Separate intentional behavior changes from structural changes. Keep unrelated migrations outside the approved scope.

For stateful operations, establish who owns creation, consumption, cancellation, and disposal. Check signals and caller identity at the point of execution, not only during preparation. A transport or execution wrapper can replace a signal later in the lifecycle. Ensure that late completion cannot restore expired state or bypass a guard.

Keep policy decisions explicit. Encapsulating retries or recovery does not authorize adding them, especially for mutations with uncertain outcomes.

## 4. Implement and validate at the owner boundary

Implement one coherent boundary at a time. Keep call sites readable and remove obsolete coordination rather than retaining parallel paths.

Use the [test-audit skill](../test-audit/SKILL.md) when writing or changing tests. Observe behavior through the production owner's interface. Preserve existing regression cases when moving tests. Use another test layer only for a distinct risk, such as real host policy composition, transport cancellation, or generated-bundle loading. For a bug fix, demonstrate failure before the repair and success after it when practical; disclose missing negative-control evidence.

Follow [repository setup](../repository-setup/SKILL.md) for validation prerequisites. Run focused checks during development and consolidate broader checks before publication. Report actual results and distinguish fixtures from real provider or host evidence.

## 5. Review the result

Compare the changed call sites with the originals:

- What knowledge or coordination disappeared from callers?
- Does one owner enforce the related invariants, including failure and cleanup paths?
- Can callers use the operation without reconstructing its internal sequence?
- Are necessary safety and completeness signals still visible?
- Does the abstraction justify its interface and maintenance cost?

Reject changes justified only by smaller files, fewer lines, a method-count target, or a preferred layering diagram. Avoid pass-through helpers, generic frameworks for hypothetical reuse, and unrelated rewrites. Keeping a cohesive implementation together can be the better result.

Give a brief rationale in the existing plan or change summary: the owner, the reduced caller knowledge, preserved contracts, intentional changes, and validation limits. No separate design document or approval checkpoint is required by this skill.

## Repository example

Linear's [project observations](../../../packages/dsh-linear/src/project-observations.ts) encapsulate workspace, timestamp, and duplicate revalidation in `approved(prepared, signal)`. The [write operations](../../../packages/dsh-linear/src/project-writes.ts) request that outcome rather than each assembling the checks. The shared snapshot operation retains the distinction between a bounded read and a complete write preview.

The benefit is less duplicated knowledge and coordination, not merely a shorter write module. Use the example to evaluate a boundary, not as a mandatory architecture for other packages.
