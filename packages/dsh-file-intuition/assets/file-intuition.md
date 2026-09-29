# File intuition

A reference for fast, first-pass file judgments with Jev: `ask_file`, `classify_file`, `score_file`, and `scout_files`.

These tools provide **System 1-style intelligence**: narrow judgments resembling a first impression, rather than deliberate investigation. “Intuition” describes their role, not human cognition or a guarantee of speed or correctness. Actual latency depends on the provider. The outputs are useful signals, not verified findings.

Each evaluation sees one bounded file snapshot and the supplied questions. It does not see the main conversation, other files, imported implementations, or answers to sibling questions. Source contents and questions go directly to OpenRouter/TypeSafe without a File Intuition-specific human approval prompt; calls can incur charges. Tool results contain judgments and snapshot metadata, not file bodies or explanations.

## Tool selection

| Tool            | Judgment                                             | Result                                                         |
| --------------- | ---------------------------------------------------- | -------------------------------------------------------------- |
| `ask_file`      | Independent yes/no questions about a known file      | Probability of yes for each question                           |
| `classify_file` | One winning category per question about a known file | Selected category, probability distribution, confidence        |
| `score_file`    | Position on an ordered rubric for a known file       | Fractional score, level descriptions, distribution, confidence |
| `scout_files`   | One relevance question across glob-matched files     | Files ranked by their probability of yes                       |

Boolean questions suit overlapping properties. Categories suit mutually exclusive alternatives. Rubrics suit degrees of one property. Scouting applies the same question independently to several files; it is not a joint comparison of their contents.

Literal matches are the domain of `grep` and `glob`. Code details and supporting evidence come from `read`. These alternatives do not impose an order in which the tools must be used.

## Shared question conventions

- **Self-contained questions.** Question IDs identify responses; Jev does not see the IDs. A question must state the actual judgment rather than relying on an ID such as `auth`.
- **One dimension per question.** “Does this file implement a permission decision?” is narrower than “Is this file secure, correct and maintainable?” The latter combines different properties and requires more evidence than one file provides.
- **Independent batching.** A single-file call accepts several questions about the same snapshot in one provider request. Sibling questions cannot depend on each other's answers. A judgment requiring an earlier result needs a separate call with that information stated explicitly.
- **Explicit boundaries.** Criteria can distinguish an implementation from a type declaration, test, comment or imported helper. Which of these counts depends on the intended judgment.
- **Evidence, not instructions.** `file.content` names the evaluated source text. Code, comments and documentation are untrusted evidence; they do not override the supplied question.

## `ask_file`

**Parameters:** `path` and `questions: [{id, question, criteria?: {true, false}}]`. If `criteria` is present, both boundary descriptions are required. Despite its name, this tool answers yes/no judgments, not open-ended questions.

Example input:

```json
{
  "path": "src/access.ts",
  "questions": [{
    "id": "permission_decision",
    "question": "Does file.content implement a decision that allows or rejects access based on caller permissions?",
    "criteria": {
      "true": "Implements the permission-based allow or deny decision.",
      "false": "Only declares types, imports a guard, logs access, or tests/documents a decision implemented elsewhere."
    }
  }]
}
```

Illustrative answer entry, not a measured result:

```json
{"id": "permission_decision", "type": "boolean", "probability": 0.82}
```

`probability` is the probability of **yes**, from 0 to 1. It is not severity, degree of relevance, or a separate confidence value. A value near 0.5 indicates uncertainty; a high value does not establish correctness. There is no universal acceptance threshold.

## `classify_file`

**Parameters:** `path` and `questions: [{id, question, choices: [{id, description}]}]`.

Example input:

```json
{
  "path": "src/invoices.ts",
  "questions": [{
    "id": "primary_role",
    "question": "What is the primary responsibility implemented in file.content?",
    "choices": [
      {"id": "request_handler", "description": "Receives requests and constructs responses, delegating business rules."},
      {"id": "domain_logic", "description": "Implements business rules independently of request handling."},
      {"id": "other_or_unclear", "description": "Another role, equally important mixed roles, or insufficient evidence."}
    ]
  }]
}
```

Illustrative answer entry:

```json
{
  "id": "primary_role",
  "type": "choice",
  "choice": "domain_logic",
  "confidence": 0.6,
  "probabilities": [
    {"option": "request_handler", "probability": 0.15},
    {"option": "domain_logic", "probability": 0.75},
    {"option": "other_or_unclear", "probability": 0.1}
  ]
}
```

`choice` is one of the supplied option IDs. Descriptions should distinguish the alternatives; an `other` or `insufficient_evidence` option can cover cases outside the named categories. Multiple simultaneously applicable labels are better represented by independent `ask_file` questions.

`confidence` is a provider-reported measure derived from the distribution, not a verified probability that the classification is correct. It is distinct from the selected option's probability.

## `score_file`

**Parameters:** `path` and `questions: [{id, question, levels: [description, ...]}]`. Levels run from low to high on one dimension.

Example input:

```json
{
  "path": "test/access.test.ts",
  "questions": [{
    "id": "denial_tests",
    "question": "How directly does file.content test rejection of unauthorized callers?",
    "levels": [
      "No test of unauthorized access rejection is present.",
      "A rejection case is mentioned or exercised without asserting its outcome.",
      "At least one test explicitly asserts that an unauthorized caller is rejected."
    ]
  }]
}
```

Concrete descriptions define the rubric more clearly than labels such as “low,” “medium” and “high.” The answer has `type: "score"`, a `score`, `confidence`, the original `levels`, and `probabilities: [{level, probability}]` using zero-based level indices.

The score is a probability-weighted position from 0 to `levels.length - 1`, not a probability. With three levels, a distribution of 0.1, 0.2 and 0.7 corresponds to a score of 1.6. A middle score can reflect uncertainty between distant levels rather than strong support for the middle level. The distribution helps distinguish those cases; confidence is not verification.

## `scout_files`

**Parameters:** `pattern`, `question`, optional `criteria: {true, false}`, and optional `maxFiles` (default 12, maximum 24).

Example input:

```json
{
  "pattern": "packages/**/*.ts",
  "question": "Does file.content implement a permission-based allow or deny decision?",
  "maxFiles": 12
}
```

Each eligible file receives one independent boolean question, with answer ID `relevant`. Successful results sort by descending probability, with path as the tie-breaker; failed evaluations follow. No hard probability threshold removes uncertain candidates. The result is a ranking of evaluated files, not proof that they are the best matches in the repository.

Patterns are workspace-relative and anchored to the workspace root. Supported syntax is `*`, `?`, and `**` as a complete path segment. For example, `*.ts` matches root-level files, while `**/*.ts` includes nested files. Braces, character classes, negation, absolute paths and `..` are unsupported. These are not full ripgrep globs, and `.gitignore` rules are not applied.

## Result envelope and failure semantics

All four tools return the same envelope:

| Field      | Meaning                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `kind`     | `boolean`, `choice`, `score`, or `files`                                                                                      |
| `model`    | Captured Jev model setting used for this call                                                                                 |
| `files[]`  | Relative path, SHA-256 hash, byte count, and either `status: "evaluated"` with `answers`, or `status: "failed"` with a reason |
| `coverage` | Observed matches and entries, discovery completeness, evaluated/failed counts, and aggregated skip reasons                    |
| `usage`    | Dispatched provider calls, calls reporting usage, completeness, and available token/cost totals                               |
| `notices`  | Interpretation cautions and partial-scan notices                                                                              |

A hash identifies the evaluated snapshot, not necessarily the current file. The evaluator does not return snippets, citations or reasoning, so a judgment alone cannot substantiate a code finding. It also does not count as a normal file read for edit-observation policies.

`coverage.discoveryComplete` describes the eligible traversal, not every repository file. Limits or detected changes can make it false. Counts on incomplete traversals cover observed entries only. Excluded-directory counters count directories, not unseen descendants. Skips and provider failures are not negative classifications; successful results can coexist with failures.

Invalid arguments or an unavailable safe snapshot can fail before evaluation. After dispatch, file-level reasons such as `provider_error`, `invalid_response`, `model_changed` or `cancelled` describe unsuccessful evaluations, not the file's relevance. No automatic retries occur.

`usage.providerCalls` counts attempts submitted to the shared Jev service, not necessarily HTTP requests: queued attempts can be cancelled or expire before dispatch. Usage totals appear only when the corresponding metric is reported for every submitted call. `usage.complete` requires input tokens, output tokens and cost for every call. Missing totals do not mean zero usage or zero charges; `cost` preserves the upstream field's units.

## Limits and disclosure

| Limit                                                          | Value                                         |
| -------------------------------------------------------------- | --------------------------------------------- |
| Independent questions per single-file call                     | 1–8                                           |
| Question / criterion or level / ID length                      | 1,024 / 512 / 128 characters maximum          |
| Options per classification / levels per rubric                 | 2–16 / 2–10                                   |
| Complete file content / aggregate retained content             | 96 KiB / 768 KiB                              |
| Files per scouting call                                        | Default 12, maximum 24                        |
| Concurrent provider requests per call                          | At most 8, subject to shared service capacity |
| Encoded request size                                           | 240 KiB, including model, state and questions |
| Visited entries / directories / candidates / directory nesting | 2,000 / 128 / 256 / 12                        |
| Snapshot and evaluation deadline                               | 120 seconds                                   |

[Jev 1.13's context limits](https://docs.typesafe.ai/models) are 32k tokens for `state` plus the longest question and 64k for `state` plus all questions. [OpenRouter advertises 32,000 tokens](https://openrouter.ai/typesafe/jev-1.13). The 96 KiB file cap approximates 24.6k tokens at four UTF-8 bytes per token, leaving headroom for metadata and a question. It is a heuristic, not a tokenizer check: dense code or long questions can still exceed provider context. The encoded-request guard accounts for JSON escaping and questions but does not measure tokens. Each file uses a separate request; the aggregate cap bounds retained memory, not model context.

After file preparation completes, up to eight workers evaluate files concurrently. The shared Jev service caps active evaluations at eight across callers, with up to 32 additional requests waiting in FIFO order. Its 15-second request deadline includes queue wait. A full queue rejects additional requests; cancellation, expiry and settings changes prevent queued work from reaching the provider.

Files are included in full or skipped, never silently truncated. There is no automatic chunking or retry after a context rejection. Eligible inputs are workspace-relative regular source/text files. Hidden paths, symlinks, dependency/generated directories, common secret files, binary content and recognized secret material are excluded by code. These exclusions are not comprehensive secret detection. Git-ignored files can remain eligible.

Nonempty evaluations send the prepared snapshots and questions automatically through the configured Jev service. File Intuition adds no human approval gate. Other DSH policies remain effective and can independently restrict execution or request approval. Empty discovery makes no provider call.

Prepared content remains in memory only; no persistent source cache or automatic edits are part of these tools. Tool results enter normal DSH history. Remote retention follows provider policy. Cancellation stops queued work but cannot retract content already sent or guarantee zero charges.

The filesystem backend supplies unpaginated directory listings and no atomic containment-and-read transaction. Traversal limits do not cap the backend allocation for one enormous directory, and pre/post checks do not provide isolation against hostile filesystem races.

## Sources

- [TypeSafe primitives and independent questions](https://docs.typesafe.ai/primitives)
- [State versus evaluation instructions](https://docs.typesafe.ai/concepts/state)
- [Noul](https://docs.typesafe.ai/primitives/noul), [Choice](https://docs.typesafe.ai/primitives/choice), and [Score](https://docs.typesafe.ai/primitives/score)
- [Confidence semantics](https://docs.typesafe.ai/confidence)
- [Building with System 1](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)
