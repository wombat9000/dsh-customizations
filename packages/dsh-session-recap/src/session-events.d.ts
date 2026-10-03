import type { RecapSession, SessionEvent } from './host-types.js'

// Narrow consumed event adapter. Verified against dsh-session 0.2.0-rc.2
// lib/types/index.d.ts: session/event is post-commit fire-and-forget;
// session/disposed releases published sessions. dsh-session is provided by
// the host, not a directly resolvable dependency of this installable bundle.
declare module '@deepseek-ai/cordis' {
  interface Events {
    'session/event'(session: RecapSession & { id: string }, event: SessionEvent): void
    'session/disposed'(session: RecapSession & { id: string }): void
  }
}
