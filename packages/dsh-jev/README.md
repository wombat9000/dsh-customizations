# Jev decisions through OpenRouter

Jev evaluates typed questions about supplied context. This host plugin calls OpenRouter's [Decisions API](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request), not chat completions. It adds no agent-facing tool and no browser evaluation endpoint.

## Configure

The bundle requires the [shared OpenRouter plugin](../dsh-openrouter/README.md). After an approved profile application and restart:

1. Open **Settings → Plugins → Plugin configuration → OpenRouter** and configure the shared key, if needed.
2. Open the **Jev** card. Confirm the shared credential status and choose the Jev model ID.
3. Select **Save Jev model**. Saving validates the local model identifier without sending an evaluation. After changing credentials in another card, select **Refresh credential status**.

The default is `typesafe/jev-1.13`. The alias `~typesafe/jev-latest` follows future releases; use it only when that change is intentional. The plugin accepts Jev model IDs only and never changes its fixed OpenRouter endpoint. Jev has no key input or independent credential copy.

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

- Requests and responses are bounded to 64 KiB each, with at most 32 questions and 32 options per choice or score.
- At most four evaluations run concurrently. A 15-second deadline covers credential resolution, HTTP, and response reading.
- Caller cancellation and plugin disposal abort pending evaluations. Redirects are rejected; the plugin sends credentials only to `https://openrouter.ai/api/alpha/decisions`.
- There are no automatic retries. Errors are sanitized and never include keys, request text, or provider response bodies.
- The plugin keeps no persistent evaluation history and does not cache keys. OpenRouter and TypeSafe apply their own data-handling policies.

## Development

The package ships plain JavaScript and uses native HTTP facilities, not a new SDK. Its dependencies use the repository's existing pinned DSH/schema packages. Unit tests inject HTTP/credential fixtures; browser and real-shell tests save model settings without making paid calls. Live endpoint compatibility and model judgment quality require a separately approved live test.

The `personal-web` recipe orders OpenRouter before Jev. Source changes and commits do not apply the recipe or restart a live profile.
