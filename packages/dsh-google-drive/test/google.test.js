import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { GoogleDriveClient, DRIVE_SCOPE } from '../src/google.js';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const tokenResponse = () => ({ access_token: 'access-private', refresh_token: 'refresh-private', token_type: 'Bearer', expires_in: 3600, scope: DRIVE_SCOPE });
function fixture(t, options = {}) {
  let record = options.record ?? null;
  const writes = [];
  const credentials = options.credentials ?? {
    async get() { return record; },
    async set(value, isValid = () => true) {
      if (!isValid()) return;
      record = value; writes.push(value);
    },
    async delete() { record = null; },
  };
  const calls = [];
  const client = new GoogleDriveClient({ clientId: 'desktop-client', clientSecret: 'client-private', ...options, credentials,
    fetch: async (url, init) => { calls.push({ url, init }); return (options.fetch ?? (() => json(tokenResponse())))(url, init); } });
  t.after(() => client.dispose());
  return { client, calls, writes, record: () => record };
}
async function callback(client) {
  const started = await client.begin();
  const auth = new URL(started.authorizationUrl);
  const url = new URL(auth.searchParams.get('redirect_uri'));
  url.search = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'code-private' });
  return { started, auth, url };
}
async function settled(client) {
  for (let i = 0; i < 200; i++) {
    if (!(await client.status()).pending) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('OAuth flow did not settle');
}
const fresh = () => ({ accessToken: 'access-private', refreshToken: 'refresh-private', expiresAt: Date.now() + 3600_000 });

test('Desktop OAuth uses loopback, random state, PKCE and offline metadata scope', async (t) => {
  const { client, calls, record } = fixture(t);
  const { auth, url, started } = await callback(client);
  assert.equal(auth.origin + auth.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(auth.searchParams.get('scope'), DRIVE_SCOPE);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.get('access_type'), 'offline');
  assert.equal(auth.searchParams.get('prompt'), 'consent');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.protocol, 'http:');
  assert.equal(auth.searchParams.get('client_secret'), null);
  assert.ok(started.expiresAt > Date.now());
  assert.equal((await fetch(url)).status, 200);
  await settled(client);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(calls[0].init.redirect, 'error');
  const body = calls[0].init.body;
  assert.equal(body.get('client_secret'), 'client-private');
  assert.equal(body.get('code'), 'code-private');
  assert.equal(body.get('redirect_uri'), auth.searchParams.get('redirect_uri'));
  assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'));
  assert.equal(record().refreshToken, 'refresh-private');
  assert.deepEqual(Object.keys(record()).sort(), ['accessToken', 'expiresAt', 'refreshToken']);
  assert.deepEqual(await client.status(), { configured: true, connected: true, pending: false });
  const next = await callback(client);
  assert.notEqual(next.auth.searchParams.get('state'), auth.searchParams.get('state'));
  assert.notEqual(next.auth.searchParams.get('redirect_uri'), auth.searchParams.get('redirect_uri'));
});

test('callback validates exact method, path, bounded query, duplicate and Unicode state', async (t) => {
  const { client, calls } = fixture(t);
  const { url } = await callback(client);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  const bad = new URL(url);
  bad.pathname += '/wrong';
  assert.equal((await fetch(bad)).status, 404);
  bad.pathname = url.pathname;
  bad.searchParams.set('state', 'wrong');
  assert.equal((await fetch(bad)).status, 400);
  bad.searchParams.set('state', 'é'.repeat(43));
  assert.equal((await fetch(bad)).status, 400);
  bad.search = url.search;
  bad.searchParams.append('state', 'duplicate');
  assert.equal((await fetch(bad)).status, 400);
  bad.search = url.search;
  bad.searchParams.append('code', 'duplicate');
  assert.equal((await fetch(bad)).status, 400);
  bad.search = url.search;
  bad.searchParams.set('code', 'x'.repeat(4097));
  assert.equal((await fetch(bad)).status, 400);
  const rawStatus = (path, host = url.host) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: url.hostname, port: url.port, path, headers: { Host: host } }, (res) => {
      res.resume(); resolve(res.statusCode);
    });
    req.on('error', reject); req.end();
  });
  assert.equal(await rawStatus(`/extra/..${url.pathname}${url.search}`), 404);
  assert.equal(await rawStatus(`${url.pathname}${url.search}`, 'attacker.invalid'), 404);
  assert.equal(calls.length, 0);
  assert.equal((await client.status()).pending, true);
  assert.equal((await fetch(url)).status, 200);
  await settled(client);
});

test('OAuth denial never reflects provider error details', async (t) => {
  const { client, calls } = fixture(t);
  const { url } = await callback(client);
  url.searchParams.set('error', 'secret-provider-detail');
  const res = await fetch(url);
  assert.equal(res.status, 400);
  assert.doesNotMatch(await res.text(), /secret-provider-detail/);
  const status = await client.status();
  assert.equal(status.pending, false);
  assert.doesNotMatch(JSON.stringify(status), /private|secret-provider-detail|http/);
  assert.equal(calls.length, 0);
});

test('cancel, timeout and disposal close loopback listeners', async (t) => {
  for (const mode of ['cancel', 'timeout', 'dispose']) {
    const { client } = fixture(t, { timeoutMs: mode === 'timeout' ? 30 : 300_000 });
    const { url } = await callback(client);
    if (mode === 'timeout') await settled(client);
    else client[mode]();
    await assert.rejects(fetch(url));
    if (mode === 'dispose') await assert.rejects(client.begin(), /cancelled/);
    else assert.equal((await client.status()).pending, false);
  }
});

test('refresh calls share a request and preserve the offline token', async (t) => {
  const gate = deferred();
  const { client, calls, record } = fixture(t, { record: { ...fresh(), expiresAt: 0 }, fetch: async () => {
    await gate.promise;
    return json({ access_token: 'refreshed-private', token_type: 'bearer', expires_in: 3600 });
  } });
  const requests = Array.from({ length: 12 }, () => client.getAccessToken());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.body.get('grant_type'), 'refresh_token');
  gate.resolve();
  assert.deepEqual(await Promise.all(requests), Array(12).fill('refreshed-private'));
  assert.equal(record().refreshToken, 'refresh-private');
  assert.equal(await client.getAccessToken(), 'refreshed-private');
  assert.equal(calls.length, 1);
});

test('disconnect invalidates a late refresh even when transport ignores abort', async (t) => {
  const gate = deferred();
  const { client, record, writes } = fixture(t, { record: { ...fresh(), expiresAt: 0 }, fetch: async () => {
    await gate.promise;
    return json(tokenResponse());
  } });
  const pending = client.getAccessToken();
  const rejected = assert.rejects(pending, /Google/);
  await new Promise((resolve) => setImmediate(resolve));
  await client.disconnect();
  gate.resolve();
  await rejected;
  assert.equal(record(), null);
  assert.equal(writes.length, 0);
  await assert.rejects(client.getAccessToken(), /Connect Google Drive/);
});

test('disconnect deletes after an in-flight store write and blocks new operations', async (t) => {
  let record = { ...fresh(), expiresAt: 0 };
  const writing = deferred();
  const finish = deferred();
  const { client } = fixture(t, { credentials: {
    async get() { return record; },
    async set(value) { writing.resolve(); await finish.promise; record = value; },
    async delete() { record = null; },
  } });
  const pending = client.getAccessToken();
  const rejected = assert.rejects(pending, /cancelled/);
  await writing.promise;
  const disconnect = client.disconnect();
  await assert.rejects(client.getAccessToken(), /cancelled/);
  await assert.rejects(client.begin(), /cancelled/);
  finish.resolve();
  await Promise.all([disconnect, rejected]);
  assert.equal(record, null);
});

test('disconnect defaults to local deletion; explicit revocation uses fixed endpoint', async (t) => {
  const local = fixture(t, { record: fresh() });
  await local.client.disconnect();
  assert.equal(local.record(), null);
  assert.equal(local.calls.length, 0);
  const remote = fixture(t, { record: fresh(), fetch: () => new Response(null, { status: 200 }) });
  await remote.client.disconnect({ revoke: true });
  assert.equal(remote.record(), null);
  assert.equal(remote.calls[0].url, 'https://oauth2.googleapis.com/revoke');
  assert.equal(remote.calls[0].init.body.get('token'), 'refresh-private');
});

test('revocation errors stay sanitized and never restore removed credentials', async (t) => {
  const { client, record } = fixture(t, { record: fresh(), fetch: () => { throw new Error('https://private/?token=secret'); } });
  await assert.rejects(client.disconnect({ revoke: true }), (error) => {
    assert.match(error.message, /Local Google credentials were removed/);
    assert.doesNotMatch(error.message, /https|secret|private/);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(record(), null);
});

test('cancelled OAuth exchange cannot persist credentials', async (t) => {
  const gate = deferred();
  const entered = deferred();
  const { client, writes } = fixture(t, { fetch: async () => { entered.resolve(); await gate.promise; return json(tokenResponse()); } });
  const { url } = await callback(client);
  await fetch(url);
  await entered.promise;
  client.cancel();
  gate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 0);
  assert.equal((await client.status()).pending, false);
});

test('credential commit predicate rejects OAuth writes queued behind a store lock after cancel or dispose', async (t) => {
  for (const action of ['cancel', 'dispose', 'disconnect']) {
    let record = null;
    const waitingForLock = deferred();
    const releaseLock = deferred();
    const writeFinished = deferred();
    const { client } = fixture(t, { credentials: {
      async get() { return record; },
      async set(value, isValid) {
        waitingForLock.resolve();
        await releaseLock.promise;
        assert.equal(typeof isValid, 'function');
        assert.equal(isValid(), false);
        if (isValid()) record = value;
        writeFinished.resolve();
      },
      async delete() { record = null; },
    } });
    const { url } = await callback(client);
    assert.equal((await fetch(url)).status, 200);
    await waitingForLock.promise;
    const stopped = client[action]();
    releaseLock.resolve();
    await writeFinished.promise;
    await stopped;
    assert.equal(record, null, `${action} prevents the queued write from committing`);
  }
});

test('cancel refuses after credential commit begins and timeout preserves pending completion', async (t) => {
  let record = null;
  const committing = deferred();
  const flushDisk = deferred();
  const { client } = fixture(t, { timeoutMs: 30, credentials: {
    async get() { return record; },
    async set(value, isValid) {
      assert.equal(isValid(), true);
      committing.resolve();
      await flushDisk.promise;
      record = value;
    },
    async delete() { record = null; },
  } });
  const { url } = await callback(client);
  await fetch(url);
  await committing.promise;
  assert.equal(client.cancel(), false);
  assert.equal((await client.status()).pending, true);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal((await client.status()).pending, true);
  assert.equal((await client.status()).error, undefined);
  flushDisk.resolve();
  await settled(client);
  assert.equal((await client.status()).connected, true);
  assert.equal(client.cancel(), true);
  await client.disconnect();
  assert.equal(record, null);
});

test('Drive list fixes URL and fields, encodes filters, and returns only bounded metadata', async (t) => {
  const { client, calls } = fixture(t, { record: fresh(), fetch: () => json({
    nextPageToken: 'next', files: [{ id: 'id1', name: 'Notes', mimeType: 'text/plain', size: '12',
      modifiedTime: '2026-01-01T00:00:00Z', parents: ['parent'], trashed: false, arbitrary: 'not returned' }],
    injected: 'not returned',
  }) });
  const result = await client.listFiles({ pageSize: 1, pageToken: 'a&key=b', query: "name contains 'Notes'" });
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, 'https://www.googleapis.com/drive/v3/files');
  assert.equal(url.searchParams.get('pageToken'), 'a&key=b');
  assert.equal(url.searchParams.get('q'), "trashed = false and (name contains 'Notes')");
  assert.equal(url.searchParams.get('fields'), 'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,parents,trashed)');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer access-private');
  assert.equal(result.files[0].name, 'Notes');
  assert.equal(result.files[0].arbitrary, undefined);
  assert.equal(result.injected, undefined);
  assert.equal(result.nextPageToken, 'next');
  for (const options of [{ pageSize: 0 }, { pageSize: 101 }, { pageSize: 1.5 }, { query: 'x'.repeat(4097) }, { pageToken: 'x'.repeat(4097) }]) {
    await assert.rejects(client.listFiles(options), /Invalid/);
  }
  assert.equal(calls.length, 1);
  await assert.rejects(client.request('https://attacker.invalid/token'), /Invalid Google endpoint/);
});

test('Drive defaults to ten non-trashed files and omits unsafe links and trashed results', async (t) => {
  const links = ['https://drive.google.com/file/d/id/view', 'https://docs.google.com/document/d/id/edit',
    'javascript:alert(1)', 'http://drive.google.com/file', 'https://drive.google.com.attacker.invalid/file',
    'https://attacker.invalid/', 'https://user:password@drive.google.com/file', 'https://drive.google.com:8443/file', 'not a URL'];
  const { client, calls } = fixture(t, { record: fresh(), fetch: () => json({ files: [
    ...links.map((webViewLink, i) => ({ id: String(i), name: 'File', mimeType: 'text/plain', webViewLink, trashed: false })),
    { id: 'trash', name: 'Trash', mimeType: 'text/plain', trashed: true },
  ] }) });
  const result = await client.listFiles();
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('pageSize'), '10');
  assert.equal(url.searchParams.get('q'), 'trashed = false');
  assert.equal(result.files.length, 9);
  assert.equal(result.files[0].webViewLink, links[0]);
  assert.equal(result.files[1].webViewLink, links[1]);
  assert.ok(result.files.slice(2).every((file) => !Object.hasOwn(file, 'webViewLink')));
  await client.listFiles({ query: '' });
  assert.equal(new URL(calls[1].url).searchParams.get('q'), 'trashed = false');
});

test('Drive tool cancellation aborts requests and can stop waiting for shared refresh', async (t) => {
  const entered = deferred();
  const { client } = fixture(t, { record: fresh(), fetch: (_url, { signal }) => new Promise((_resolve, reject) => {
    entered.resolve(); signal.addEventListener('abort', () => reject(new Error('secret')), { once: true });
  }) });
  const controller = new AbortController();
  const request = client.listFiles({ signal: controller.signal });
  const rejected = assert.rejects(request, /Google request failed/);
  await entered.promise;
  controller.abort();
  await rejected;
  const gate = deferred();
  const other = fixture(t, { record: { ...fresh(), expiresAt: 0 }, fetch: async () => { await gate.promise; return json(tokenResponse()); } });
  const abort = new AbortController();
  const listing = other.client.listFiles({ signal: abort.signal });
  const cancelled = assert.rejects(listing, /cancelled/);
  const token = other.client.getAccessToken();
  abort.abort();
  await cancelled;
  gate.resolve();
  assert.equal(await token, 'access-private');
});

test('transport bounds response size and timeout, and sanitizes provider errors', async (t) => {
  for (const fetchImpl of [
    () => json({ error: 'client-private code-private access-private' }, 400),
    () => new Response('x'.repeat(1_048_577)),
    () => new Response('invalid JSON private'),
    () => { throw new Error('client-private code-private access-private'); },
    (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('private')), { once: true })),
  ]) {
    const { client } = fixture(t, { record: { ...fresh(), expiresAt: 0 }, requestTimeoutMs: 20, fetch: fetchImpl });
    await assert.rejects(client.getAccessToken(), (error) => {
      assert.equal(error.message, 'Google request failed. Try again or reconnect.');
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('reconnect invalidates old refresh and blocks token consumers until completion', async (t) => {
  const gate = deferred();
  const { client, writes } = fixture(t, { record: { ...fresh(), expiresAt: 0 }, fetch: async () => {
    await gate.promise; return json(tokenResponse());
  } });
  const refresh = client.getAccessToken();
  const rejected = assert.rejects(refresh, /Google/);
  await new Promise((resolve) => setImmediate(resolve));
  await client.begin();
  await assert.rejects(client.getAccessToken(), /Finish or cancel/);
  gate.resolve();
  await rejected;
  assert.equal(writes.length, 0);
});

test('OAuth exchange times out without saving and begin handles early disposal', async (t) => {
  const gate = deferred();
  const { client, writes } = fixture(t, { timeoutMs: 30, fetch: async () => { await gate.promise; return json(tokenResponse()); } });
  const { url } = await callback(client);
  await fetch(url);
  await settled(client);
  assert.match((await client.status()).error, /timed out/);
  gate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 0);
  const other = fixture(t);
  const begin = other.client.begin();
  other.client.dispose();
  await assert.rejects(begin, /could not start/);
});

test('optional Desktop client secret and missing offline grant are handled', async (t) => {
  const { client, calls } = fixture(t, { clientSecret: undefined });
  const { url } = await callback(client);
  await fetch(url);
  await settled(client);
  assert.equal(calls[0].init.body.has('client_secret'), false);
  const missing = fixture(t, { fetch: () => json({ access_token: 'private', token_type: 'Bearer', expires_in: 3600 }) });
  const second = await callback(missing.client);
  await fetch(second.url);
  await settled(missing.client);
  assert.equal(missing.record(), null);
  assert.equal((await missing.client.status()).error, 'Google sign-in failed. Try connecting again.');
});

test('invalid token replies and credential adapter failures do not expose secrets', async (t) => {
  for (const response of [{ ...tokenResponse(), scope: 'unrelated' }, { ...tokenResponse(), expires_in: -1 },
    { ...tokenResponse(), token_type: {} }, { ...tokenResponse(), access_token: '' }]) {
    const { client } = fixture(t, { record: { ...fresh(), expiresAt: 0 }, fetch: () => json(response) });
    await assert.rejects(client.getAccessToken(), /invalid token response/);
  }
  const { client } = fixture(t, { credentials: {
    async get() { throw new Error('client-private'); }, async set() { throw new Error('secret'); }, async delete() {},
  } });
  await assert.rejects(client.status(), { message: 'Google credentials could not be read.' });
  await client.disconnect();
});
