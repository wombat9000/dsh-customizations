import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.metadata.readonly';
const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const REVOKE = 'https://oauth2.googleapis.com/revoke';
const FILES = 'https://www.googleapis.com/drive/v3/files';
const FIELDS = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed)';
const fail = (message) => new Error(message);
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const same = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b)
  && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// This class deliberately has no filesystem or credential discovery logic. The host
// supplies the DSH credential-store adapter and keeps getAccessToken host-only.
export class GoogleDriveClient {
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
      // Adapters with a storage lock must check this predicate inside their
      // transaction, immediately before committing. Checking before lock acquisition
      // cannot prevent a queued OAuth write from surviving cancel or disposal.
      const isValid = () => {
        const valid = !this.disposed && !this.disconnecting && epoch === this.epoch
          && (!flow || this.flow === flow);
        // This callback is the commit point. An adapter must invoke it under its
        // storage lock before mutating the record. User cancellation cannot undo
        // an atomic disk write after that mutation has started.
        if (valid && flow) flow.committing = true;
        return valid;
      };
      try { await this.credentials.set(record, isValid); }
      catch { throw fail('Google credentials could not be saved.'); }
    });
  }

  async request(url, options = {}, signal, empty = false) {
    this.assertActive();
    let target;
    try { target = new URL(url); } catch { throw fail('Invalid Google endpoint.'); }
    if (target.username || target.password || target.hash
      || ![TOKEN, REVOKE, FILES].includes(`${target.origin}${target.pathname}`)
      || ((target.origin + target.pathname) !== FILES && target.search)) throw fail('Invalid Google endpoint.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    this.controllers.add(controller);
    const timer = setTimeout(abort, this.requestTimeoutMs);
    try {
      const response = await this.fetch(url, { ...options, redirect: 'error', signal: controller.signal });
      // Never read or expose arbitrary provider error bodies, headers, or URLs.
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw fail('Google request failed.');
      }
      const reader = response.body?.getReader();
      const chunks = [];
      let length = 0;
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > 1_048_576) {
            await reader.cancel();
            throw fail('Google response exceeded its limit.');
          }
          chunks.push(Buffer.from(value));
        }
      }
      if (controller.signal.aborted) throw fail('Google request failed.');
      if (empty) return undefined;
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw fail('Invalid response.');
      return result;
    } catch {
      throw fail('Google request failed. Try again or reconnect.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      this.controllers.delete(controller);
    }
  }

  tokenParams(values) {
    return new URLSearchParams({ client_id: this.config.clientId,
      ...(this.config.clientSecret ? { client_secret: this.config.clientSecret } : {}), ...values });
  }

  tokenRecord(result, previous) {
    if (!text(result.access_token, 16_384) || typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer'
      || !Number.isFinite(result.expires_in) || result.expires_in <= 0 || result.expires_in > 604_800
      || (result.scope !== undefined && (typeof result.scope !== 'string'
        || !result.scope.split(' ').includes(DRIVE_SCOPE)))) {
      throw fail('Google returned an invalid token response.');
    }
    const refreshToken = result.refresh_token ?? previous?.refreshToken;
    if (!text(refreshToken, 16_384)) throw fail('Google did not provide offline access. Reconnect.');
    return { accessToken: result.access_token, refreshToken, expiresAt: Date.now() + result.expires_in * 1000 };
  }

  closeFlow(flow) {
    clearTimeout(flow.timer);
    flow.server.close();
    flow.server.closeAllConnections();
  }

  // Cancellation succeeds only before the credential adapter's commit point.
  // Forced cleanup is for disposal/disconnect, not a user-facing cancel action.
  cancel({ force = false } = {}) {
    const flow = this.flow;
    if (!flow) return true;
    if (flow.committing && !force) return false;
    this.flow = null;
    flow.controller.abort();
    this.closeFlow(flow);
    return true;
  }

  async begin() {
    this.assertActive();
    if (!this.configured()) throw fail('Configure a Google Desktop OAuth client first.');
    if (this.flow) throw fail('Google sign-in is already pending.');
    this.error = null;
    // A reconnect supersedes refresh/list work using the previous account.
    this.epoch++;
    this.refresh = null;
    for (const controller of this.controllers) controller.abort();
    const epoch = this.epoch;
    const verifier = randomBytes(32).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    const path = `/oauth/callback/${randomBytes(16).toString('hex')}`;
    const flow = { controller: new AbortController(), expiresAt: Date.now() + this.timeoutMs, accepted: false };
    this.flow = flow;
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
        // Flush the fixed response before destroying any remaining callback sockets.
        res.once('finish', () => this.closeFlow(flow));
        res.once('close', () => this.closeFlow(flow));
        reply(400, 'Google sign-in was not authorized.');
        return;
      }
      if (url.searchParams.getAll('code').length !== 1 || !text(code, 4096)) return reply(400, 'Invalid callback.');
      flow.accepted = true;
      reply(200, 'Google sign-in received. You can close this tab.');
      // Close only the listener; keep the timeout and cancellation active during exchange.
      flow.server.close();
      void (async () => {
        try {
          const result = await this.request(TOKEN, { method: 'POST', body: this.tokenParams({
            grant_type: 'authorization_code', code, redirect_uri: flow.redirectUri, code_verifier: verifier,
          }) }, flow.controller.signal);
          await this.saveCredentials(this.tokenRecord(result), epoch, flow);
        } catch {
          if (this.flow === flow) this.error = 'Google sign-in failed. Try connecting again.';
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
        response_type: 'code', scope: DRIVE_SCOPE, state, code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        access_type: 'offline', prompt: 'consent' }).toString();
      return { authorizationUrl: url.toString(), expiresAt: flow.expiresAt };
    } catch {
      if (this.flow === flow) this.cancel();
      else this.closeFlow(flow);
      throw fail('Google sign-in could not start.');
    }
  }

  async status() {
    this.assertActive();
    const record = await this.readCredentials();
    return { configured: this.configured(), connected: text(record?.refreshToken, 16_384),
      pending: Boolean(this.flow), ...(this.flow ? { expiresAt: this.flow.expiresAt } : {}),
      ...(this.error ? { error: this.error } : {}) };
  }

  async getAccessToken() {
    this.assertActive();
    if (this.flow) throw fail('Finish or cancel Google sign-in first.');
    if (!this.configured()) throw fail('Configure a Google Desktop OAuth client first.');
    const epoch = this.epoch;
    const record = await this.readCredentials();
    this.assertActive(epoch);
    if (!text(record?.refreshToken, 16_384)) throw fail('Connect Google Drive first.');
    if (text(record.accessToken, 16_384) && Number.isFinite(record.expiresAt) && record.expiresAt > Date.now() + 60_000) {
      return record.accessToken;
    }
    if (!this.refresh) {
      const promise = (async () => {
        const result = await this.request(TOKEN, { method: 'POST', body: this.tokenParams({
          grant_type: 'refresh_token', refresh_token: record.refreshToken,
        }) });
        const updated = this.tokenRecord(result, record);
        await this.saveCredentials(updated, epoch);
        this.assertActive(epoch);
        return updated.accessToken;
      })();
      this.refresh = promise;
      void promise.finally(() => { if (this.refresh === promise) this.refresh = null; }).catch(() => {});
    }
    const token = await this.refresh;
    this.assertActive(epoch);
    return token;
  }

  async disconnect({ revoke = false } = {}) {
    this.assertActive();
    this.disconnecting = true;
    this.epoch++;
    this.cancel({ force: true });
    this.refresh = null;
    for (const controller of this.controllers) controller.abort();
    // Serialize deletion after any in-flight credential write. Never re-save after revocation.
    let record;
    try {
      record = await this.serialize(async () => {
        // A broken read must not prevent removal of a locally stored credential.
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

  async listFiles({ pageSize = 10, pageToken, query, signal } = {}) {
    this.assertActive();
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw fail('Invalid cancellation signal.');
    if (signal?.aborted) throw fail('Google operation was cancelled.');
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100
      || (pageToken !== undefined && !text(pageToken, 4096))
      || (query !== undefined && (typeof query !== 'string' || query.length > 4096))) {
      throw fail('Invalid Google Drive list options.');
    }
    const epoch = this.epoch;
    // A caller may cancel its wait without aborting another caller's shared refresh.
    let onAbort;
    const cancelled = signal && new Promise((_resolve, reject) => {
      onAbort = () => reject(fail('Google operation was cancelled.'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    let token;
    try { token = await (cancelled ? Promise.race([this.getAccessToken(), cancelled]) : this.getAccessToken()); }
    finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
    this.assertActive(epoch);
    if (signal?.aborted) throw fail('Google operation was cancelled.');
    const url = new URL(FILES);
    url.search = new URLSearchParams({ pageSize: String(pageSize), fields: FIELDS, spaces: 'drive',
      ...(pageToken ? { pageToken } : {}), q: query ? `trashed = false and (${query})` : 'trashed = false' }).toString();
    const result = await this.request(url.toString(), { headers: { Authorization: `Bearer ${token}` } }, signal);
    this.assertActive(epoch);
    if (!Array.isArray(result.files) || result.files.length > pageSize
      || (result.nextPageToken !== undefined && !text(result.nextPageToken, 4096))) throw fail('Invalid Google Drive response.');
    const files = result.files.map((file) => {
      if (!file || !text(file.id, 1024) || !text(file.name, 4096) || !text(file.mimeType, 256)) throw fail('Invalid Google Drive response.');
      const output = { id: file.id, name: file.name, mimeType: file.mimeType };
      for (const key of ['size', 'modifiedTime']) {
        if (typeof file[key] === 'string' && file[key].length <= 4096) output[key] = file[key];
      }
      if (text(file.webViewLink, 4096)) {
        try {
          const link = new URL(file.webViewLink);
          if (link.protocol === 'https:' && !link.username && !link.password && !link.port
            && ['drive.google.com', 'docs.google.com'].includes(link.hostname)) output.webViewLink = link.href;
        } catch { /* Omit malformed or non-Google links from provider metadata. */ }
      }
      if (typeof file.trashed === 'boolean') output.trashed = file.trashed;
      if (Array.isArray(file.parents) && file.parents.length <= 100 && file.parents.every((id) => text(id, 1024))) output.parents = [...file.parents];
      return output;
    });
    // Keep the non-trashed contract even if a malformed filter changes grouping.
    return { files: files.filter((file) => file.trashed !== true),
      ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}) };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    this.cancel({ force: true });
    for (const controller of this.controllers) controller.abort();
  }
}
