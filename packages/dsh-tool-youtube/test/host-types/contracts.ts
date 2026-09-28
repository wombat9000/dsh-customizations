import type {
  TranscriptOutput,
  TranscriptReadOutput,
  TranscriptSearchOutput,
  WatchOutput,
} from '../../src/tool-schemas.js'
import type {
  TranscriptReadInput,
  TranscriptSearchInput,
  TranscriptProcessing,
} from '../../src/archive.js'
import type { SaveTranscriptInput, StoredSegment } from '../../src/transcript-store.js'
import type { GeminiClient } from '../../src/gemini-transport.js'

type Assert<T extends true> = T
type Rejects<T, Contract> = T extends Contract ? false : true

// These are negative compile-time assertions, not suppressed diagnostics.
export type RejectStringCursor = Assert<
  Rejects<{ transcriptId: string; cursor: string }, TranscriptReadInput>
>
export type RejectMissingArchiveId = Assert<Rejects<{ query: string }, TranscriptSearchInput>>
export type RejectExplicitUndefinedCursor = Assert<
  Rejects<{ transcriptId: string; cursor: undefined }, TranscriptReadInput>
>
export type RejectUnorderedSegmentShape = Assert<
  Rejects<{ text: string; ordinal: number }, StoredSegment>
>
export type RejectUnvalidatedArchiveWrite = Assert<Rejects<unknown, SaveTranscriptInput>>
export type RejectMissingSavedProcessing = Assert<
  Rejects<{ strategy: 'direct' }, TranscriptProcessing>
>
export type RejectUnsupportedTranscriptStrategy = Assert<
  Rejects<'agentic', TranscriptProcessing['strategy']>
>
export type RejectUnsupportedArchiveSource = Assert<
  Rejects<'remote-cache', TranscriptProcessing['source']>
>
export type RejectUnsupportedEvidenceModality = Assert<
  Rejects<'inferred', WatchOutput['evidence'][number]['modality']>
>
export type RejectMissingTranscriptSegmentTimestamp = Assert<
  Rejects<{ startSeconds: number; text: string }, TranscriptOutput['segments'][number]>
>
export type RejectMissingReadCompleteness = Assert<
  Rejects<
    { transcriptId: string; videoId: string; durationSeconds: number; segments: [] },
    TranscriptReadOutput
  >
>
export type RejectMissingSearchScore = Assert<
  Rejects<
    { startSeconds: number; timestamp: string; text: string },
    TranscriptSearchOutput['matches'][number]
  >
>

// The store's {} default is allowed only by contracts without required fields.
type SpecializedWrite = SaveTranscriptInput<{ required: string }>
export type RejectMissingSpecializedProcessing = Assert<
  Rejects<Omit<SpecializedWrite, 'processing'>, SpecializedWrite>
>
export type DefaultProcessingMayBeOmitted = Assert<
  Omit<SaveTranscriptInput, 'processing'> extends SaveTranscriptInput ? true : false
>

// Transport results must be validated before consuming provider fields.
type ProviderResponse = Awaited<ReturnType<GeminiClient['interactions']['create']>>
export type ProviderResponseRemainsUnknown = Assert<unknown extends ProviderResponse ? true : false>
export type ProviderResponseIsNotUnchecked = Assert<0 extends 1 & ProviderResponse ? false : true>
