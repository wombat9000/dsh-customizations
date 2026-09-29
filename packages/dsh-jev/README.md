# Jev decisions through OpenRouter

Jev evaluates typed questions about supplied context. This host plugin calls OpenRouter's [Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request), not chat completions. It adds no agent-facing tool and no browser evaluation endpoint.

## Configure

The bundle requires the [shared OpenRouter plugin](../dsh-openrouter/README.md). After an approved profile application and restart:

1. In **Plugins**, open the `@local/dsh-openrouter` bundle and select **Configure** for its `local-openrouter` row. Configure the shared key, if needed.
2. Return to **Plugins**, open the `@local/dsh-jev` bundle, and select **Configure** for its `local-jev` row. Confirm the shared credential status and choose the Jev model ID.
3. Select **Save Jev model**. Saving validates the local model identifier without sending an evaluation. After changing credentials in another card, select **Refresh credential status**.

The default is `typesafe/jev-1.13`. The alias `~typesafe/jev-latest` follows future releases; use it only when that change is intentional. The plugin accepts Jev model IDs only and never changes its fixed OpenRouter endpoint. Jev has no key input or independent credential copy.

## Settings migration

The bundle targets DSH `0.1.7-rc.2`. Its `model` Config field is volatile: the host reads the live reference with `.get()`, and profile updates take effect without remounting the service. A model change cancels pending evaluations. The custom page uses the `plugins.row.config` key `@local/dsh-jev#local-jev`. Settings writes address the owning Loader entry, `local-jev` in the bundled composition, rather than the former `jev` section.

If your old `settings.yaml` contains a `jev` section, do not assume DSH imports its model selection. The upstream importer matches section names to entry IDs and does not map `jev` to `local-jev`. It renames the file to `settings.yaml.imported` before attempting imports; rejected sections remain there for recovery and are not retried automatically. After migration, verify the model on the configuration page and save the intended value. Credentials remain owned by the shared OpenRouter plugin.

## Host contract

```js
const result = await ctx.jev.evaluate({
  state: { conversation: visibleHistory },
  questions: {
    decision: {
      type: 'noul',
      instructions: 'Does the conversation contain an explicit decision that remains current?',
      criteria: {
        true: 'Explicitly agreed and not subsequently reversed.',
        false: 'Only proposed, rejected, superseded, or absent.',
      },
    },
  },
  signal,
})
const probability = result.answers.decision.noul
```

`settings()` returns the current model configuration. `status()` returns the model, availability, and shared credential metadata. Neither sends a remote request. `evaluate()` resolves the shared key again on each call and sends the supplied state and questions to OpenRouter/TypeSafe, which can incur charges. Consumers must obtain any required user consent before sending conversation data.

Supported question types are `noul` (yes/no probability), `choice` (one defined option), and `score` (an ordered rubric). This first version uses text instructions and text criteria. State must be JSON data. The service validates inputs and returned question IDs, types, values, and probability distributions. Type correctness does not establish that a judgment is accurate. Keep untrusted content in state, write explicit criteria, and test classifications on representative examples.

## Bounds and failures

- Encoded requests are bounded to 256 KiB; responses remain bounded to 64 KiB. Input snapshots also have a 256 KiB byte budget, a 65,536-node traversal limit, and a depth limit of 64. There are at most 32 questions and 32 options per choice or score.
- These are local byte/memory guards, not token guarantees. [TypeSafe documents Jev 1.13](https://docs.typesafe.ai/models) as supporting 32k tokens for `state` plus the longest question and 64k for `state` plus all questions. [OpenRouter advertises 32,000-token context](https://openrouter.ai/typesafe/jev-1.13). Callers must allow for question overhead and varying token density; fitting the local byte guard does not guarantee provider acceptance.
- At most four evaluations run concurrently. A 15-second deadline covers credential resolution, HTTP, and response reading.
- Caller cancellation and plugin disposal abort pending evaluations. Redirects are rejected; the plugin sends credentials only to `https://openrouter.ai/api/alpha/decisions`.
- There are no automatic retries. Errors are sanitized and never include keys, request text, or provider response bodies.
- The plugin keeps no persistent evaluation history and does not cache keys. OpenRouter and TypeSafe apply their own data-handling policies.

## Development

The package ships plain JavaScript and uses native HTTP facilities, not a new SDK. Its dependencies use the repository's existing pinned DSH/schema packages. Unit tests inject HTTP/credential fixtures. Host integration tests use real Settings, ConfigEditor, and Loader services to verify persistence, live references, cancellation, and optional Settings-service replacement. Browser and real-shell tests save model settings without making paid calls. Live endpoint compatibility and model judgment quality require a separately approved live test.

The `personal-web` recipe orders OpenRouter before Jev. Source changes and commits do not apply the recipe or restart a live profile.
