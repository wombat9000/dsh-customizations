import type { SettingsProps, ToolCardProps, RegistrationContext } from '../../client/contracts.ts'
import { apiKeyFailure, youtubeCardModel } from '../../client/model.ts'
import { YoutubeToolCard } from '../../client/tool-card.tsx'

declare const settings: SettingsProps
declare const context: RegistrationContext
declare const rpc: NonNullable<ToolCardProps['rpc']>

settings.api.credentials.describe(['GEMINI_API_KEY'])
settings.api.credentials.set('GEMINI_API_KEY', 'example')
// @ts-expect-error Credential writes accept strings, never an object containing secrets.
settings.api.credentials.set('GEMINI_API_KEY', { value: 'secret' })
// @ts-expect-error Credential status uses a list of references.
settings.api.credentials.describe('GEMINI_API_KEY')
// @ts-expect-error The owner supplies only the published summary/page views.
const invalidView: SettingsProps['view'] = 'inline'
// @ts-expect-error A tool card requires a call identity.
const invalidCall: ToolCardProps = {}
// @ts-expect-error Exact optional properties distinguish omission from explicit undefined.
const invalidTransport: ToolCardProps = { callId: 'call', rpc: undefined }
// @ts-expect-error Inspect remains a callback, not a URL.
const invalidInspect: ToolCardProps = { callId: 'call', inspect: 'https://example.com' }
// @ts-expect-error The key validator requires a string.
apiKeyFailure({ key: 'secret' })
// @ts-expect-error Tool completion failures use a boolean.
youtubeCardModel('youtube_watch', { kind: 'tool-result', isError: 'yes' }, undefined)
context.slots.register(
  {
    name: 'tool.call.toolview',
    key: 'youtube_watch',
    // @ts-expect-error The tool seat must use the conversation locale.
    locale: 'settings',
    inject: () => ({ rpc }),
  },
  YoutubeToolCard,
)

rpc.call('/youtube-transcript-progress', 'get', { callId: 'call' })
// @ts-expect-error Progress is scoped to the existing channel, not arbitrary RPC.
rpc.call('/other', 'get', { callId: 'call' })
// @ts-expect-error Progress requests require the call identity, not a session identity.
rpc.call('/youtube-transcript-progress', 'get', { sessionId: 'session' })
// @ts-expect-error Progress has one read endpoint; no mutation endpoint is exposed.
rpc.call('/youtube-transcript-progress', 'set', { callId: 'call' })

void [invalidView, invalidCall, invalidInspect, invalidTransport]
