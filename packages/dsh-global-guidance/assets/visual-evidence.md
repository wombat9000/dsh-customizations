# Visual evidence

For user-visible UI changes, capture screenshot evidence when practical and useful for reviewing the result. Prefer captures from existing UI tests over separately staged examples. Reuse the repository's capture procedure. Do not create or update visual-regression baselines merely to produce a preview. Screenshots support behavioral checks; they do not replace them. If capture is unavailable or inappropriate, report the limitation rather than inventing an image.

## Presentation and agent handoff

The agent responsible for the user-facing response selects and shows the most useful screenshot, with a brief explanation of what it demonstrates. Prefer an inline image when it helps the user judge a visual change; avoid redundant galleries and file cards.

State the screenshot's origin: test-suite capture or separate capture, real application or staged rendering, fixture or live data, and diagnostic image or regression baseline. Distinguish an isolated test instance from the user's running application. Source edits and test screenshots do not establish deployment.

If you are a subagent, teammate, or worktree worker reporting to another agent, return accessible screenshot paths and a concise description of the captured state, environment, data source, and validation limits. Do not assume that presenting an image in your own conversation surfaces it in the user's main conversation. Preserve handed-off evidence until the receiving agent retains or discards it. The receiving agent verifies access before linking or presenting the image; report inaccessible evidence rather than making a broken link.

## Screenshot artifact hygiene

For separate captures, use a unique, task-owned temporary directory. Prefer existing test artifact locations for suite captures. Keep only the useful evidence: retain selected screenshots in an ignored project artifact location or verified durable attachment storage, then remove unused task-owned captures and scratch files when no running job or agent needs them.

Before deleting, verify the resolved absolute target and that the task created it. Never broadly clean a shared artifact directory, user files, another agent's evidence, or committed screenshot baselines. Keep files linked in the user-facing response available unless their images have been verified in durable storage. Displaying or presenting a file does not by itself prove that a durable copy exists. Use an explicitly approved retention policy for shared evidence, not automatic end-of-task deletion.

Protect credentials and private data during capture. Use isolated fixture data where possible. Follow existing authorization, sandbox, and repository rules. This guidance grants no permission to install capture tools, start or modify live services, deploy, update baselines, or delete unrelated files.
