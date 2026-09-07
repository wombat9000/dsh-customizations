import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const IDENTITY_SCOPES = Object.freeze(['openid', 'https://www.googleapis.com/auth/userinfo.email']);
const canonicalScope = (scope) => scope === 'email' ? 'https://www.googleapis.com/auth/userinfo.email'
  : scope === 'profile' ? 'https://www.googleapis.com/auth/userinfo.profile' : scope;
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const USERINFO = 'https://openidconnect.googleapis.com/v1/userinfo';
const fail = (message) => new Error(message);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const same = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b)
  && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const validScope = (scope) => text(scope, 2048) && (['openid', 'email', 'profile'].includes(scope)
  || /^https:\/\/www\.googleapis\.com\/auth\/[A-Za-z0-9._/-]+$/.test(scope));
// Google expands the OIDC email/profile aliases in token responses. Use the
// same canonical names in requests, persisted grants and consumer comparisons.
export function normalizeScopes(value) {
  if (!Array.isArray(value) || value.length > 100 || !Array.from(value).every(validScope)) throw fail('Invalid Google scopes.');
  return [...new Set(value.map(canonicalScope))];
}
const scopes = normalizeScopes;
const includes = (granted, required) => {
  const normalized = normalizeScopes(granted);
  return normalizeScopes(required).every((scope) => normalized.includes(scope));
};
const accountValid = (account) => text(account?.id, 1024);
const connected = (record) => text(record?.refreshToken, 16_384) && accountValid(record?.account)
  && Array.isArray(record?.scopes) && record.scopes.length <= 100 && Array.from(record.scopes).every(validScope);
const accountCopy = (account) => ({ id: account.id, ...(text(account.email, 320) ? { email: account.email } : {}) });

// The host supplies credential storage. Its adapter checks isValid under its
// storage lock immediately before committing; tokens never leave the host service.
export class GoogleOAuthClient {
  constructor({ clientId, clientSecret, credentials, fetch: fetchImpl = globalThis.fetch,
    timeoutMs = 300_000, requestTimeoutMs = 30_000 } = {}) {
    this.config = { clientId, clientSecret };
    if (!credentials || !['get', 'set', 'delete'].every((key) => typeof credentials[key] === 'function')) {
      throw fail('A credential adapter is required.');
    }
    if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000
      || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 120_000) {
      throw fail('Invalid Google client options.');
    }
    this.credentials = credentials;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.epoch = 0;
    this.queue = Promise.resolve();
    this.tokenQueue = Promise.resolve();
    this.controllers = new Set();
    this.flow = null;
    this.refresh = null;
    this.disposed = false;
    this.error = null;
  }

  configured() {
    return text(this.config.clientId, 1024) && (this.config.clientSecret === undefined
      || this.config.clientSecret === '' || text(this.config.clientSecret, 4096));
  }

  assertActive(epoch = this.epoch) {
    if (this.disposed || this.disconnecting || epoch !== this.epoch) throw fail('Google operation was cancelled.');
  }

  serialize(fn) {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }

  async readCredentials() {
    try { return await this.credentials.get(); }
    catch { throw fail('Google credentials could not be read.'); }
  }

  async saveCredentials(record, epoch, flow) {
    return this.serialize(async () => {
      this.assertActive(epoch);
      if (flow && this.flow !== flow) throw fail('Google sign-in was cancelled.');
      const isValid = () => {
        const valid = !this.disposed && !this.disconnecting && epoch === this.epoch
          && (!flow || this.flow === flow);
        // This is the commit point, not a pre-lock cancellation check.
        if (valid && flow) flow.committing = true;
        return valid;
      };
      try { await this.credentials.set(record, isValid); }
      catch { throw fail('Google credentials could not be saved.'); }
    });
  }

  async request(url, options = {}, signal, empty = false) {
    this.assertActive();
    if (![TOKEN, REVOKE, USERINFO].includes(url)) throw fail('Invalid Google endpoint.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    this.controllers.add(controller);
    let onAbort;
    const cancelled = new Promise((_resolve, reject) => {
      onAbort = () => reject(fail('Cancelled.'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    const timer = setTimeout(abort, this.requestTimeoutMs);
    let reader;
    try {
      const operation = (async () => {
        if (controller.signal.aborted) throw fail('Cancelled.');
        const response = await this.fetch(url, { ...options, redirect: 'error', signal: controller.signal });
        if (!response.ok || controller.signal.aborted) {
          void response.body?.cancel().catch(() => {});
          throw fail('Google request failed.');
        }
        reader = response.body?.getReader();
        const chunks = [];
        let length = 0;
        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (controller.signal.aborted) throw fail('Cancelled.');
            if (done) break;
            length += value.byteLength;
            if (length > 1_048_576) throw fail('Response too large.');
            chunks.push(Buffer.from(value));
          }
        }
        if (empty) return undefined;
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw fail('Invalid response.');
        return result;
      })();
      return await Promise.race([operation, cancelled]);
    } catch {
      throw fail('Google request failed. Try again or reconnect.');
    } finally {
      clearTimeout(timer);
      controller.abort();
      void reader?.cancel().catch(() => {});
      controller.signal.removeEventListener('abort', onAbort);
      signal?.removeEventListener('abort', abort);
      this.controllers.delete(controller);
    }
  }

  tokenParams(values) {
    return new URLSearchParams({ client_id: this.config.clientId,
      ...(this.config.clientSecret ? { client_secret: this.config.clientSecret } : {}), ...values });
  }

  tokenRecord(result, previous, requested) {
    if (!text(result.access_token, 16_384) || typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer'
      || !Number.isFinite(result.expires_in) || result.expires_in <= 0 || result.expires_in > 604_800) {
      throw fail('Google returned an invalid token response.');
    }
    let granted;
    try {
      granted = result.scope === undefined ? scopes(requested) : scopes(
        typeof result.scope === 'string' && result.scope.length <= 65_536
          ? (result.scope.trim() ? result.scope.trim().split(/ +/) : []) : null);
    } catch { throw fail('Google returned an invalid token response.'); }
    const refreshToken = result.refresh_token ?? previous?.refreshToken;
    if (!text(refreshToken, 16_384)) throw fail('Google did not provide offline access. Reconnect.');
    return { accessToken: result.access_token, refreshToken, expiresAt: Date.now() + result.expires_in * 1000,
      scopes: granted, ...(previous?.account ? { account: accountCopy(previous.account) } : {}) };
  }

  closeFlow(flow) {
    clearTimeout(flow.timer);
    flow.server?.close();
    flow.server?.closeAllConnections();
  }

  // Cancellation cannot undo an atomic write after its commit point.
  cancel({ force = false } = {}) {
    const flow = this.flow;
    if (!flow) return true;
    if (flow.committing && !force) return false;
    this.flow = null;
    flow.controller.abort();
    this.closeFlow(flow);
    return true;
  }

  async begin({ scopes: required } = {}) {
    this.assertActive();
    required = scopes(required);
    if (!this.configured()) throw fail('Configure a Google Desktop OAuth client first.');
    if (this.flow) throw fail('Google sign-in is already pending.');
    this.error = null;
    this.epoch++;
    this.refresh = null;
    for (const controller of this.controllers) controller.abort();
    const epoch = this.epoch;
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    const path = `/oauth/callback/${randomBytes(16).toString('hex')}`;
    const flow = { controller: new AbortController(), expiresAt: Date.now() + this.timeoutMs, accepted: false };
    this.flow = flow;
    let previous;
    let requested;
    try {
      previous = await this.readCredentials();
      this.assertActive(epoch);
      if (this.flow !== flow) throw fail('Cancelled.');
      if (!connected(previous)) previous = null;
      required = scopes([...required, ...IDENTITY_SCOPES]);
      requested = scopes([...required, ...(previous?.scopes ?? [])]);
    } catch {
      if (this.flow === flow) this.cancel();
      throw fail('Google sign-in could not start.');
    }
    flow.server = createServer({ maxHeaderSize: 8192, requestTimeout: 5000, headersTimeout: 5000 }, (req, res) => {
      const reply = (status, message) => {
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
          'Content-Security-Policy': "default-src 'none'", 'Connection': 'close' });
        res.end(message);
      };
      if (!flow.redirectUri) return reply(503, 'Sign-in listener is starting.');
      if (req.method !== 'GET') return reply(405, 'Method not allowed.');
      if (!req.url || req.url.length > 8192 || !req.url.startsWith('/')) return reply(400, 'Invalid callback.');
      let url;
      try { url = new URL(req.url, flow.redirectUri); } catch { return reply(400, 'Invalid callback.'); }
      const redirect = new URL(flow.redirectUri);
      if (req.url.split('?')[0] !== path || url.hash || req.headers.host !== redirect.host
        || url.origin !== redirect.origin || url.pathname !== path) return reply(404, 'Not found.');
      if (flow.accepted || this.flow !== flow) return reply(409, 'Sign-in is no longer pending.');
      if (url.searchParams.getAll('state').length !== 1 || !same(url.searchParams.get('state'), state)) {
        return reply(400, 'Invalid callback state.');
      }
      const code = url.searchParams.get('code');
      if (url.searchParams.has('error')) {
        flow.accepted = true;
        this.flow = null;
        this.error = 'Google sign-in was not authorized.';
        flow.controller.abort();
        clearTimeout(flow.timer);
        flow.server.close();
        res.once('finish', () => this.closeFlow(flow));
        res.once('close', () => this.closeFlow(flow));
        reply(400, 'Google sign-in was not authorized.');
        return;
      }
      if (url.searchParams.getAll('code').length !== 1 || !text(code, 4096)) return reply(400, 'Invalid callback.');
      flow.accepted = true;
      reply(200, 'Google sign-in received. You can close this tab.');
      flow.server.close();
      void (async () => {
        let safeError = 'Google sign-in failed. Try connecting again.';
        try {
          const result = await this.request(TOKEN, { method: 'POST', body: this.tokenParams({
            grant_type: 'authorization_code', code, redirect_uri: flow.redirectUri, code_verifier: verifier,
          }) }, flow.controller.signal);
          const record = this.tokenRecord(result, previous, requested);
          if (!includes(record.scopes, required)) {
            safeError = 'Google did not grant the required scopes. Connect again and approve the requested access.';
            throw fail(safeError);
          }
          const identity = await this.request(USERINFO, { headers: { Authorization: `Bearer ${record.accessToken}` } }, flow.controller.signal);
          if (!text(identity.sub, 1024)) throw fail('Invalid Google identity.');
          if (previous && previous.account.id !== identity.sub) {
            safeError = 'Google account does not match. Disconnect first to connect a different account.';
            throw fail(safeError);
          }
          record.account = { id: identity.sub,
            ...(identity.email_verified === true && text(identity.email, 320) ? { email: identity.email } : {}) };
          await this.saveCredentials(record, epoch, flow);
        } catch {
          if (this.flow === flow) this.error = safeError;
        } finally {
          if (this.flow === flow) { this.flow = null; this.closeFlow(flow); }
        }
      })();
    });
    flow.server.maxConnections = 16;
    flow.server.on('clientError', (_error, socket) => socket.destroy());
    flow.server.on('error', () => {
      if (this.flow === flow && this.cancel()) this.error = 'Google sign-in listener failed. Connect again.';
    });
    try {
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          flow.controller.signal.removeEventListener('abort', onAbort);
          flow.server.removeListener('error', onError);
        };
        const onAbort = () => { cleanup(); reject(fail('Cancelled.')); };
        const onError = () => { cleanup(); reject(fail('Listener failed.')); };
        flow.controller.signal.addEventListener('abort', onAbort, { once: true });
        flow.server.once('error', onError);
        flow.server.listen(0, '127.0.0.1', () => { cleanup(); resolve(); });
      });
      this.assertActive(epoch);
      if (this.flow !== flow) throw fail('Cancelled.');
      flow.redirectUri = `http://127.0.0.1:${flow.server.address().port}${path}`;
      flow.timer = setTimeout(() => {
        if (this.flow === flow && this.cancel()) this.error = 'Google sign-in timed out. Connect again.';
      }, this.timeoutMs);
      flow.timer.unref?.();
      const url = new URL(AUTHORIZE);
      url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: flow.redirectUri,
        response_type: 'code', scope: requested.join(' '), state, code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' }).toString();
      return { authorizationUrl: url.toString(), expiresAt: flow.expiresAt };
    } catch {
      if (this.flow === flow) this.cancel();
      else this.closeFlow(flow);
      throw fail('Google sign-in could not start.');
    }
  }

  async status() {
    this.assertActive();
    const epoch = this.epoch;
    const record = await this.readCredentials();
    this.assertActive(epoch);
    const isConnected = connected(record);
    return { configured: this.configured(), connected: isConnected, pending: Boolean(this.flow),
      grantedScopes: isConnected ? normalizeScopes(record.scopes) : [],
      ...(isConnected ? { account: accountCopy(record.account) } : {}),
      ...(this.flow ? { expiresAt: this.flow.expiresAt } : {}), ...(this.error ? { error: this.error } : {}) };
  }

  async getAccessToken({ scopes: required } = {}) {
    this.assertActive();
    required = scopes(required);
    if (this.flow) throw fail('Finish or cancel Google sign-in first.');
    if (!this.configured()) throw fail('Configure a Google Desktop OAuth client first.');
    const epoch = this.epoch;
    // Admission is independent of the storage queue: a delayed credential read
    // cannot race another token operation and later reuse a rotated refresh token.
    const operation = this.tokenQueue.then(() => this.accessTokenOperation(required, epoch));
    this.tokenQueue = operation.catch(() => {});
    return operation;
  }

  async accessTokenOperation(required, epoch) {
    this.assertActive(epoch);
    const record = await this.readCredentials();
    this.assertActive(epoch);
    if (!connected(record)) throw fail('Connect Google first.');
    if (!includes(record.scopes, required)) throw fail('Required Google scopes are missing. Connect Google and approve the requested access.');
    if (text(record.accessToken, 16_384) && Number.isFinite(record.expiresAt) && record.expiresAt > Date.now() + 60_000) {
      return record.accessToken;
    }
    if (!this.refresh) {
      const promise = (async () => {
        const result = await this.request(TOKEN, { method: 'POST', body: this.tokenParams({
          grant_type: 'refresh_token', refresh_token: record.refreshToken,
        }) });
        const updated = this.tokenRecord(result, record, record.scopes);
        // Persist narrowed grants, then check each caller separately. Concurrent
        // callers may require different scopes from the same shared refresh.
        await this.saveCredentials(updated, epoch);
        this.assertActive(epoch);
        return updated;
      })();
      this.refresh = promise;
      void promise.finally(() => { if (this.refresh === promise) this.refresh = null; }).catch(() => {});
    }
    const updated = await this.refresh;
    this.assertActive(epoch);
    if (!includes(updated.scopes, required)) throw fail('Required Google scopes are missing. Connect Google and approve the requested access.');
    return updated.accessToken;
  }

  async disconnect({ revoke = false } = {}) {
    this.assertActive();
    this.disconnecting = true;
    this.epoch++;
    this.cancel({ force: true });
    this.refresh = null;
    for (const controller of this.controllers) controller.abort();
    let record;
    try {
      record = await this.serialize(async () => {
        const value = revoke ? await this.readCredentials().catch(() => null) : null;
        try { await this.credentials.delete(); } catch { throw fail('Google credentials could not be removed.'); }
        return value;
      });
    } finally { this.disconnecting = false; }
    this.error = null;
    const token = record?.refreshToken || record?.accessToken;
    if (revoke && text(token, 16_384)) {
      try { await this.request(REVOKE, { method: 'POST', body: new URLSearchParams({ token }) }, undefined, true); }
      catch { throw fail('Local Google credentials were removed, but revocation failed. Revoke access in your Google account.'); }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    this.cancel({ force: true });
    for (const controller of this.controllers) controller.abort();
  }
}
