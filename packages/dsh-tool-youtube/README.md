# Local DSH YouTube Tools

Gemini-backed tools for understanding public YouTube videos in DSH. The package registers ordinary tools and therefore also appears automatically in Programmatic Tool Calling (PTC) as `tools.youtube_watch`, `tools.youtube_transcript`, `tools.youtube_transcript_read`, and `tools.youtube_transcript_search`.

## Tools

### youtube_watch

Accepts a public YouTube URL and a specific question. The host verifies video metadata, classifies the question as targeted, global, or exhaustive, and selects a capability-gated strategy. Short videos use a direct request; long videos use low-resolution or agentic processing only when explicitly enabled, otherwise balanced clipped intervals are analyzed and reduced through a text-only call. Returned evidence is normalized against the verified duration, cross-boundary duplicates are removed, and processing metadata reports strategy, coverage, provider-call count, and conservative token estimates.

    {
      "url": "https://www.youtube.com/watch?v=...",
      "question": "What changes after the presenter clicks Save?"
    }

### youtube_transcript

Accepts a public YouTube URL and returns chronological sentence-level segments with integer seconds, display timestamps, and speaker labels. Complete validated transcripts are archived in host-level SQLite and reused across Agent sessions; concurrent misses share one process-local generation. The returned `transcriptId` addresses the immutable archive record, while `truncated` and `inlineComplete` describe only the bounded inline page. The tool independently checks YouTube's embedded duration metadata and supplies that authoritative bound in both the prompt and structured response schema. Videos up to 20 minutes use one native YouTube Gemini Interactions call; longer videos use balanced static-media Interactions calls with core windows no longer than 15 minutes and 15 seconds of boundary overlap. If an Interaction returns an out-of-range timestamp, the tool makes one text-only correction turn through `previous_interaction_id` rather than ingesting the video again, then deletes the temporarily stored interactions. A filtered long-video chunk retries only that interval through `generateContent`, where allowlisted prompt and candidate metadata select a bounded response: neutral wording for `BLOCKLIST`/`OTHER`, smaller sub-intervals for `RECITATION`/`MAX_TOKENS`, and immediate failure for safety or prohibited-content reasons. Timestamp correction after a `generateContent` fallback is also text-only. Independent chunk pipelines share one concurrency limit, completed chunks are not retried, and all successful leaves merge chronologically. If Gemini explicitly rejects clipping support, videos up to one hour may instead retry once as a native full-video interaction. The configured output limit is applied at segment boundaries and reported through the truncated field.

Use youtube_watch for targeted questions, especially visual ones. Use youtube_transcript when the calling model needs spoken text for further analysis. A full Gemini transcript is usually slower and more expensive.

### youtube_transcript_read

Reads a bounded page or timestamp range from an immutable archived transcript by `transcriptId`. Continue a truncated `youtube_transcript` result with its `nextCursor`; reading never calls Gemini.

### youtube_transcript_search

Runs bounded FTS5 search within one archived transcript and returns timestamped matching segments. Search falls back to bounded substring matching when FTS5 is unavailable and never calls Gemini.

In the Web GUI, all four tools share a compact, expandable YouTube card. Cards lead with the operation outcome, video or transcript context, evidence/segment/match counts, paging state, and useful error text. Transcript calls retain live interval progress through the plugin-owned read-only Connection RPC; unknown progress is indeterminate and repeated polling failures are shown as degraded rather than as a false percentage. Expanded cards provide timestamp links, archive continuation details, and an accessible processing timeline. Colors use DSH semantic theme tokens, decorative intervals are removed from the tab order, and durable presentation metadata is used when available with defensive fallback for historical calls.

## Install

This bundle is maintained in `packages/dsh-tool-youtube` and selected by the `personal-web` recipe. Follow the [repository setup and profile application procedure](../../README.md#apply-the-starter-profile). Installing dependencies, applying a profile, and restarting DSH require separate approval; tests do not perform those actions.

After an approved profile update, restart the existing DSH Web process and refresh its existing URL. Open Settings → YouTube to configure Gemini. Do not start a second Web server expecting it to replace the existing GUI.

The package includes the transcript archive as the `@local/dsh-tool-youtube/transcript-store` export. Its separate host row retains the `local-youtube-transcript-store` ID and `youtubeTranscriptStore` service. It uses Node's bundled `node:sqlite`; no SQLite package or separate companion installation is required. The archive remains shared across sessions at `$DSH_HOME/archives/youtube-transcripts.sqlite`, with the same schema and transcript IDs. Do not move this service into an agent preset.

## Credentials

Open Settings → YouTube and save the Gemini API key in the Gemini card. The browser sends a new key only on save; DSH returns only configured, source, and writable status. The key is never read back into browser state, model-facing arguments, schemas, tool values, render output, or provider errors. Saved and rotated keys are used by the next YouTube operation without another restart.

For headless use, the provider also resolves GEMINI_API_KEY from the environment that launches DSH:

    GEMINI_API_KEY='...' ./node_modules/.bin/dsh --profile personal-web

Environment and .env credentials are read-only in Settings and take precedence over the managed credential store. An optional literal apiKey plugin setting exists for headless composition but should not be committed.

## Configuration

| Key | Default | Meaning |
|---|---:|---|
| model | gemini-3.7-flash | Gemini model used for both operations. |
| timeoutMs | 180000 | Gemini request timeout in milliseconds, applied to each direct or clipped call. |
| longOperationTimeoutMs | 900000 | Outer DSH timeout for the complete transcript operation. |
| maxQuestionChars | 8000 | Maximum accepted watch question length. |
| maxEvidenceItems | 24 | Maximum returned evidence entries. |
| maxWatchOutputChars | 30000 | Maximum answer characters before an explicit truncation caveat. |
| maxTranscriptOutputChars | 60000 | Approximate inline-page limit, enforced at segment boundaries; the archive retains every canonical segment. |
| directTranscriptMaxSeconds | 1200 | Preferred maximum duration before clipped calls; a rejected clip may use the fixed one-hour direct fallback. |
| maximumTranscriptCoreSeconds | 900 | Maximum non-overlap core covered by each long-video call. |
| chunkOverlapSeconds | 15 | Context added on each side of internal transcript boundaries. |
| maxChunkConcurrency | 2 | Maximum concurrent provider calls across primary chunks and recovery sub-intervals. |
| adaptiveWatch | true | Inspect and plan watch requests by duration and deterministic question intent. |
| enableWatchLowResolution | false | Permit the capability-gated low-resolution direct strategy. Enable only for model/API combinations verified to support it. |
| enableWatchAgentic | false | Permit the capability-gated agentic strategy for long targeted questions. |
| enableWatchChunking | true | Permit balanced clipped watch analysis followed by a text-only reduction. |
| directWatchMaxSeconds | 1200 | Longest video handled with default direct watch processing. |
| lowResolutionWatchMaxSeconds | 7200 | Longest video eligible for explicitly enabled low-resolution processing. |
| maximumWatchCoreSeconds | 900 | Maximum non-overlap interval for chunked watch analysis. |
| watchChunkOverlapSeconds | 15 | Context added around watch interval boundaries. |
| maxWatchChunks | 16 | Maximum planned watch intervals before provider work begins. |
| maxVideoDurationSeconds | 14400 | Hard duration ceiling for new provider-backed watch or transcript generation. |
| maxProviderCalls | 64 | Exact per-operation provider-attempt ceiling, including explicit retries and recovery calls. |
| maxEstimatedInputTokens | 3000000 | Conservative per-operation input-token estimate ceiling. |
| videoTokensPerSecond | 300 | Configurable conservative media-token estimate. |
| providerRequestRetries | 1 | Explicit retry count for retryable HTTP/network failures; SDK-internal retries are disabled. |
| estimatedInputCostPerMillionTokensUsd | 0 | Optional operator-supplied input rate used only for planning; zero disables cost estimation. |
| maxEstimatedCostUsd | 0 | Optional estimated cost ceiling; zero disables it. |
| statefulTranscriptCorrections | true | Temporarily store transcript Interactions so one timestamp correction can use cached continuation; stored interaction IDs are deleted after each attempt. Disable for stateless text-only correction. |
| watch | true | Register youtube_watch. |
| transcript | true | Register youtube_transcript. |
| apiKey | unset | Secret literal fallback; prefer GEMINI_API_KEY. |

Transcript chunk-policy limits may be lowered for stricter deployments but cannot exceed their documented defaults. Global duration, provider-call, token, and optional cost ceilings apply before new paid work; local archive reads do not consume them.

Example profile override:

    - id: local-tool-youtube
      config:
        model: gemini-3.7-flash
        timeoutMs: 240000
        maxTranscriptOutputChars: 80000

## Security and limitations

- Only exact HTTPS youtube.com and youtu.be URL forms are accepted and canonicalized.
- Gemini direct YouTube input supports public videos, not private or unlisted videos.
- Gemini samples video at roughly one frame per second, so rapid visual events may be missed.
- Video text, audio, and generated analysis are untrusted source data. Provider and DSH prompts prohibit following embedded instructions.
- Client-side cancellation forwards an AbortSignal, but Gemini may continue provider-side processing and charge usage.
- Transcript Interactions are temporarily created with `store: true` so a single timestamp correction can use `previous_interaction_id`; the plugin deletes every returned Interaction ID in a `finally` block. Deletion is best-effort, so a failed deletion remains subject to the Gemini project's configured retention. Set `statefulTranscriptCorrections: false` to keep these requests stateless; correction remains text-only but cannot use server-side implicit caching.
- Sanitized provider usage totals are logged for each request (`input`, `cached`, and `output` tokens) so operators can verify cache behavior without exposing video content or interaction IDs.
- Structured responses are validated locally. Malformed output and timestamps beyond independently fetched duration fail after at most one bounded correction turn instead of being silently accepted.
- Duration planning uses public YouTube watch-page metadata through Node's built-in `fetch`. If YouTube changes that page format or blocks the lookup, transcription fails safely rather than sending a video of unknown length through the direct path.
- Long transcripts prefer Gemini Interactions static-media processing to clip the public YouTube URL. Filtered chunks use a per-chunk diagnostic fallback without weakening safety settings or reflecting arbitrary provider text. Safety and prohibited-content diagnostics stop; only recitation/output-size diagnostics can recursively split a chunk, with fixed depth and minimum-size limits. An explicit clipping-unsupported error may retry videos up to one hour as one full-video interaction, but generic HTTP 400 never triggers that costly fallback.
- The persistent archive is local to the DSH Host at `$DSH_HOME/archives/youtube-transcripts.sqlite`. It retains successful transcript versions until explicitly deleted; it never stores API keys, watch questions, failed output, or partial transcripts.
- This package still has no YouTube Data API, caption scraper, downloader, or Whisper backend.

References: [Video understanding](https://ai.google.dev/gemini-api/docs/video-understanding) and [Interactions API](https://ai.google.dev/api/interactions-api).

## Test

After the repository's approved dependency setup, run these commands from the repository root. The tests use mocked providers and temporary SQLite archives; they do not call Gemini or consume credits. `test:integration` checks package/recipe wiring and a dormant RPC handler, not a live DSH Loader or browser:

    pnpm --filter @local/dsh-tool-youtube test
    pnpm --filter @local/dsh-tool-youtube test:integration

A live smoke test requires GEMINI_API_KEY and a short public video. Avoid asserting exact wording from live model responses.
