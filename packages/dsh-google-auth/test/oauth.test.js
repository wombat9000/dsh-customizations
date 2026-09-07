import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { GoogleOAuthClient, IDENTITY_SCOPES, normalizeScopes } from '../src/oauth.js';

const A = 'https://www.googleapis.com/auth/calendar.readonly';
const B = 'https://www.googleapis.com/auth/tasks.readonly';
const required = { scopes: [A] };
const granted = [A, ...IDENTITY_SCOPES];
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const token = (extra = {}) => ({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'Bearer', expires_in: 3600, ...extra });
const fresh = () => ({ accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh', expiresAt: Date.now() + 3600_000,
  scopes: [...granted], account: { id: 'subject-one', email: 'test@example.invalid' } });
function fixture(t, options = {}) {
  let record = options.record ?? null;
  const writes = [], calls = [];
  const credentials = options.credentials ?? {
    async get() { return record; },
    async set(value, isValid) { if (isValid()) { record = value; writes.push(value); } },
    async delete() { record = null; },
  };
  const client = new GoogleOAuthClient({ clientId: 'synthetic-client', clientSecret: 'synthetic-secret', ...options, credentials,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return options.fetch ? options.fetch(url, init) : json(url.includes('userinfo')
        ? { sub: 'subject-one', email: 'test@example.invalid', email_verified: true } : token());
    } });
  t.after(() => client.dispose());
  return { client, calls, writes, record: () => record };
}
async function callback(client, options = required) {
  const started = await client.begin(options);
  const auth = new URL(started.authorizationUrl);
  const url = new URL(auth.searchParams.get('redirect_uri'));
  url.search = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'synthetic-code' });
  return { started, auth, url };
}
async function settled(client) {
  for (let i = 0; i < 200; i++) {
    if (!(await client.status()).pending) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('OAuth did not settle');
}
async function login(client, options = required) { const flow = await callback(client, options); await fetch(flow.url); await settled(client); return flow; }

test('first login requests explicit identity union, PKCE, loopback and authenticated userinfo', async (t) => {
  const { client, calls, record } = fixture(t);
  const { auth, url, started } = await login(client);
  assert.deepEqual(auth.searchParams.get('scope').split(' '), granted);
  assert.equal(auth.origin + auth.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.get('access_type'), 'offline');
  assert.equal(auth.searchParams.get('prompt'), 'consent');
  assert.equal(auth.searchParams.get('client_secret'), null);
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.protocol, 'http:');
  assert.ok(started.expiresAt > Date.now());
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(calls[0].init.redirect, 'error');
  const body = calls[0].init.body;
  assert.equal(body.get('client_secret'), 'synthetic-secret');
  assert.equal(body.get('redirect_uri'), auth.searchParams.get('redirect_uri'));
  assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'));
  assert.equal(calls[1].url, 'https://openidconnect.googleapis.com/v1/userinfo');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer synthetic-access');
  assert.deepEqual(record().scopes, granted);
  assert.deepEqual(Object.keys(record()).sort(), ['accessToken', 'account', 'expiresAt', 'refreshToken', 'scopes']);
  assert.deepEqual(await client.status(), { configured: true, connected: true, pending: false, grantedScopes: granted, account: fresh().account });
  const next = await callback(client);
  assert.notEqual(next.auth.searchParams.get('state'), auth.searchParams.get('state'));
  assert.notEqual(next.url.pathname, url.pathname);
});

test('scope options are mandatory and Google-only; invalid requests have no browser or HTTP effects', async (t) => {
  const { client, calls } = fixture(t, { record: fresh() });
  for (const options of [undefined, {}, { scopes: 'openid' }, { scopes: ['https://evil.invalid/auth/a'] },
    { scopes: ['https://www.googleapis.com/auth/a?x'] }, { scopes: ['openid email'] }, { scopes: [null] }, { scopes: Array(1) }]) {
    await assert.rejects(client.begin(options), /Invalid Google scopes/);
    await assert.rejects(client.getAccessToken(options), /Invalid Google scopes/);
  }
  assert.equal(calls.length, 0); assert.equal((await client.status()).pending, false);
  const { auth } = await callback(client, { scopes: [] });
  assert.deepEqual(new Set(auth.searchParams.get('scope').split(' ')), new Set(granted));
});

test('incremental consent explicitly unions old grants and preserves offline token for same account', async (t) => {
  const { client, record } = fixture(t, { record: fresh(), fetch: (url) => json(url.includes('userinfo')
    ? { sub: 'subject-one' } : token({ refresh_token: undefined })) });
  const { auth } = await login(client, { scopes: [B] });
  assert.deepEqual(new Set(auth.searchParams.get('scope').split(' ')), new Set([...granted, B]));
  assert.deepEqual(new Set(record().scopes), new Set([...granted, B]));
  assert.equal(record().refreshToken, 'synthetic-refresh');
});

test('explicit denied required or identity scopes never count as approved and preserve old grant', async (t) => {
  for (const scope of [A, `${B} openid`, 'openid email', '']) {
    const old = fresh();
    const { client, record } = fixture(t, { record: old, fetch: () => json(token({ scope })) });
    await login(client, { scopes: [B] });
    assert.equal(record(), old);
    assert.match((await client.status()).error, /required scopes/);
  }
});

test('explicit consent grants do not invent previous scopes omitted by Google', async (t) => {
  const { client, record } = fixture(t, { record: fresh(), fetch: (url) => json(url.includes('userinfo')
    ? { sub: 'subject-one' } : token({ scope: `${B} openid email` })) });
  await login(client, { scopes: [B] });
  assert.deepEqual(record().scopes, [B, ...IDENTITY_SCOPES]);
  await assert.rejects(client.getAccessToken(required), /scopes are missing/);
});

test('email/profile aliases normalize across requests, consent, stored grants and refresh', async (t) => {
  const email = 'https://www.googleapis.com/auth/userinfo.email';
  const profile = 'https://www.googleapis.com/auth/userinfo.profile';
  assert.deepEqual(normalizeScopes(['email', email, 'profile', profile, 'openid']), [email, profile, 'openid']);
  assert.throws(() => normalizeScopes(['bad scope']), /Invalid Google scopes/);
  for (const scope of ['openid email profile', `openid ${email} ${profile}`]) {
    const { client, record } = fixture(t, { fetch: (url) => json(url.includes('userinfo') ? { sub: 'subject-one' } : token({ scope })) });
    const { auth } = await login(client, { scopes: ['profile', 'email'] });
    assert.deepEqual(auth.searchParams.get('scope').split(' '), [profile, email, 'openid']);
    assert.deepEqual(record().scopes, ['openid', email, profile]);
    assert.equal(await client.getAccessToken({ scopes: ['email', 'profile'] }), 'synthetic-access');
    assert.deepEqual((await client.status()).grantedScopes, ['openid', email, profile]);
  }
  for (const scope of [undefined, `openid ${email} ${profile}`, 'openid email profile']) {
    const { client, record } = fixture(t, { record: { ...fresh(), expiresAt: 0, scopes: ['openid', 'email', 'profile'] },
      fetch: () => json(token({ scope })) });
    assert.deepEqual((await client.status()).grantedScopes, ['openid', email, profile]);
    assert.equal(await client.getAccessToken({ scopes: [email, profile] }), 'synthetic-access');
    assert.deepEqual(record().scopes, ['openid', email, profile]);
  }
});

test('delayed credential reads cannot reuse refresh tokens rotated by another caller', async (t) => {
  let record = { ...fresh(), expiresAt: 0 };
  let reads = 0;
  const entered = deferred(), release = deferred();
  const { client, calls } = fixture(t, { credentials: {
    async get() { const snapshot = record; if (++reads === 1) { entered.resolve(); await release.promise; } return snapshot; },
    async set(value, isValid) { if (isValid()) record = value; }, async delete() { record = null; },
  }, fetch: () => json(token({ refresh_token: 'rotated-refresh' })) });
  const first = client.getAccessToken(required); await entered.promise;
  const second = client.getAccessToken(required);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0); release.resolve();
  assert.deepEqual(await Promise.all([first, second]), ['synthetic-access', 'synthetic-access']);
  assert.equal(calls.length, 1); assert.equal(record.refreshToken, 'rotated-refresh');
});

test('queued token consumers retain admission epoch and missing scopes do not poison later callers', async (t) => {
  const ready = fixture(t, { record: { ...fresh(), expiresAt: 0 } });
  const missing = assert.rejects(ready.client.getAccessToken({ scopes: [B] }), /scopes are missing/);
  const valid = ready.client.getAccessToken(required);
  await missing; assert.equal(await valid, 'synthetic-access'); assert.equal(ready.calls.length, 1);
  const entered = deferred(), release = deferred();
  const { client, calls } = fixture(t, { credentials: {
    async get() { entered.resolve(); await release.promise; return fresh(); }, async set() {}, async delete() {},
  } });
  const first = assert.rejects(client.getAccessToken(required), /cancelled/);
  await entered.promise;
  const second = assert.rejects(client.getAccessToken(required), /cancelled/);
  client.dispose(); release.resolve(); await Promise.all([first, second]); assert.equal(calls.length, 0);
});

test('userinfo binds accounts, ignores JWT claims and includes only verified email', async (t) => {
  for (const identity of [{ sub: 'different' }, {}, { sub: '' }]) {
    const old = fresh();
    const { client, record } = fixture(t, { record: old, fetch: (url) => json(url.includes('userinfo') ? identity
      : token({ id_token: 'untrusted.jwt.synthetic' })) });
    await login(client);
    assert.equal(record(), old);
    assert.match((await client.status()).error, identity.sub ? /Disconnect first/ : /sign-in failed/);
  }
  for (const email_verified of [false, 'true', undefined]) {
    const { client, record } = fixture(t, { fetch: (url) => json(url.includes('userinfo')
      ? { sub: 'subject-one', email: 'unverified@example.invalid', email_verified } : token()) });
    await login(client);
    assert.deepEqual(record().account, { id: 'subject-one' });
  }
});

test('missing stored scopes reject before refresh without silent OAuth', async (t) => {
  const { client, calls } = fixture(t, { record: { ...fresh(), expiresAt: 0 } });
  await assert.rejects(client.getAccessToken({ scopes: [B] }), /scopes are missing/);
  assert.equal(calls.length, 0); assert.equal((await client.status()).pending, false);
});

test('shared refresh preserves omitted scopes/account and validates narrowed grants per caller', async (t) => {
  for (const narrowed of [false, true]) {
    const gate = deferred();
    const { client, calls, record } = fixture(t, { record: { ...fresh(), scopes: [...granted, B], expiresAt: 0 }, fetch: async () => {
      await gate.promise; return json(token({ refresh_token: undefined, ...(narrowed ? { scope: `${B} openid email` } : {}) }));
    } });
    const a = client.getAccessToken(required);
    const check = narrowed ? assert.rejects(a, /scopes are missing/) : a;
    const b = client.getAccessToken({ scopes: [B] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1); gate.resolve();
    await check; assert.equal(await b, 'synthetic-access');
    assert.deepEqual(record().account, fresh().account);
    assert.equal(record().refreshToken, 'synthetic-refresh');
    assert.equal(record().scopes.includes(A), !narrowed);
  }
});

test('callback rejects method/path/host/state/code ambiguity without consuming flow', async (t) => {
  const { client, calls } = fixture(t);
  const { url } = await callback(client);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  for (const mutate of [(u) => { u.pathname += '/wrong'; }, (u) => u.searchParams.set('state', 'é'.repeat(43)),
    (u) => u.searchParams.append('state', 'duplicate'), (u) => u.searchParams.append('code', 'duplicate'),
    (u) => u.searchParams.set('code', 'x'.repeat(4097))]) {
    const bad = new URL(url); mutate(bad); assert.ok((await fetch(bad)).status >= 400);
  }
  const raw = (path, host) => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: url.hostname, port: url.port, path, headers: { Host: host } }, (res) => {
      res.resume(); resolve(res.statusCode);
    }); req.on('error', reject); req.end();
  });
  assert.equal(await raw(`${url.pathname}${url.search}`, 'attacker.invalid'), 404);
  assert.equal(await raw(`/extra/..${url.pathname}${url.search}`, url.host), 404);
  assert.equal(calls.length, 0); assert.equal((await client.status()).pending, true);
  await fetch(url); await settled(client);
});

test('denial is sanitized and listener closes', async (t) => {
  const { client, calls } = fixture(t);
  const { url } = await callback(client); url.searchParams.set('error', 'private-provider-detail');
  const response = await fetch(url);
  assert.equal(response.status, 400); assert.doesNotMatch(await response.text(), /private-provider/);
  assert.equal((await client.status()).pending, false); assert.equal(calls.length, 0);
  await assert.rejects(fetch(url));
});

test('cancel, timeout and disposal close listeners and prevent late exchange writes', async (t) => {
  for (const action of ['cancel', 'timeout', 'dispose']) {
    const gate = deferred(), entered = deferred();
    const { client, writes } = fixture(t, { timeoutMs: action === 'timeout' ? 30 : 300_000,
      fetch: async () => { entered.resolve(); await gate.promise; return json(token()); } });
    const { url } = await callback(client); await fetch(url); await entered.promise;
    if (action === 'timeout') await settled(client); else client[action]();
    gate.resolve(); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(writes.length, 0); await assert.rejects(fetch(url));
  }
  const { client } = fixture(t); const pending = client.begin(required); client.dispose();
  await assert.rejects(pending, /could not start/);
});

test('locked credential writes respect cancellation, disconnect and disposal predicates', async (t) => {
  for (const action of ['cancel', 'disconnect', 'dispose']) {
    let record = null;
    const waiting = deferred(), release = deferred(), finished = deferred();
    const { client } = fixture(t, { credentials: {
      async get() { return record; },
      async set(value, isValid) { waiting.resolve(); await release.promise; assert.equal(isValid(), false); if (isValid()) record = value; finished.resolve(); },
      async delete() { record = null; },
    } });
    const { url } = await callback(client); await fetch(url); await waiting.promise;
    const stopped = client[action](); release.resolve(); await finished.promise; await stopped;
    assert.equal(record, null);
  }
});

test('cancel refuses after commit and timeout cannot interrupt completion', async (t) => {
  let record = null;
  const committing = deferred(), flush = deferred();
  const { client } = fixture(t, { timeoutMs: 50, credentials: {
    async get() { return record; },
    async set(value, isValid) { assert.equal(isValid(), true); committing.resolve(); await flush.promise; record = value; },
    async delete() { record = null; },
  } });
  const { url } = await callback(client); await fetch(url); await committing.promise;
  assert.equal(client.cancel(), false);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal((await client.status()).pending, true); assert.equal((await client.status()).error, undefined);
  flush.resolve(); await settled(client); assert.equal((await client.status()).connected, true);
  await client.disconnect(); assert.equal(record, null);
});

test('disconnect invalidates refresh, serializes deletion and blocks operations during a write', async (t) => {
  let record = { ...fresh(), expiresAt: 0 };
  const writing = deferred(), finish = deferred();
  const { client } = fixture(t, { credentials: {
    async get() { return record; }, async set(value) { writing.resolve(); await finish.promise; record = value; },
    async delete() { record = null; },
  } });
  const pending = client.getAccessToken(required); const rejected = assert.rejects(pending, /cancelled/);
  await writing.promise; const disconnect = client.disconnect();
  await assert.rejects(client.begin(required), /cancelled/); await assert.rejects(client.getAccessToken(required), /cancelled/);
  finish.resolve(); await Promise.all([disconnect, rejected]); assert.equal(record, null);
});

test('reconnect aborts old refresh; token consumers cannot bypass pending consent', async (t) => {
  const gate = deferred();
  const { client, writes } = fixture(t, { record: { ...fresh(), expiresAt: 0 }, fetch: async () => { await gate.promise; return json(token()); } });
  const refresh = client.getAccessToken(required); const rejected = assert.rejects(refresh, /Google/);
  await new Promise((resolve) => setImmediate(resolve)); await client.begin(required);
  await assert.rejects(client.getAccessToken(required), /Finish or cancel/); gate.resolve(); await rejected;
  assert.equal(writes.length, 0);
});

test('transport fixes endpoints, bounds size and time including abort-ignoring fetch and bodies', async (t) => {
  for (const fetchImpl of [() => json({ secret: 'private' }, 400), () => new Response('x'.repeat(1_048_577)),
    () => new Response('private invalid JSON'), () => { throw new Error('private URL token'); },
    () => new Promise(() => {}), () => new Response(new ReadableStream({ start() {} }))]) {
    const { client } = fixture(t, { record: { ...fresh(), expiresAt: 0 }, requestTimeoutMs: 20, fetch: fetchImpl });
    await assert.rejects(client.getAccessToken(required), { message: 'Google request failed. Try again or reconnect.' });
  }
  const { client, calls } = fixture(t);
  for (const url of ['https://attacker.invalid/token', 'https://oauth2.googleapis.com/token?x=1',
    'https://openidconnect.googleapis.com/v1/userinfo#fragment', 'http://oauth2.googleapis.com/token']) {
    await assert.rejects(client.request(url), /Invalid Google endpoint/);
  }
  assert.equal(calls.length, 0);
});

test('disconnect is local by default; explicit revoke cannot leak errors or restore credentials', async (t) => {
  const local = fixture(t, { record: fresh() }); await local.client.disconnect();
  assert.equal(local.record(), null); assert.equal(local.calls.length, 0);
  const remote = fixture(t, { record: fresh(), fetch: () => new Response(null) }); await remote.client.disconnect({ revoke: true });
  assert.equal(remote.calls[0].url, 'https://oauth2.googleapis.com/revoke');
  assert.equal(remote.calls[0].init.body.get('token'), 'synthetic-refresh');
  const broken = fixture(t, { record: fresh(), fetch: () => { throw new Error('private-secret'); } });
  await assert.rejects(broken.client.disconnect({ revoke: true }), /Local Google credentials were removed/);
  assert.equal(broken.record(), null);
});

test('userinfo failure and cancellation preserve previous account without committing', async (t) => {
  for (const cancel of [false, true]) {
    const old = fresh(), entered = deferred(), gate = deferred();
    const { client, record, writes } = fixture(t, { record: old, fetch: async (url) => {
      if (!url.includes('userinfo')) return json(token());
      entered.resolve();
      if (cancel) await gate.promise;
      return cancel ? json({ sub: 'subject-one' }) : json({ private: 'secret' }, 401);
    } });
    const { url } = await callback(client); await fetch(url); await entered.promise;
    if (cancel) { assert.equal(client.cancel(), true); gate.resolve(); }
    await settled(client); await new Promise((resolve) => setImmediate(resolve));
    assert.equal(record(), old); assert.equal(writes.length, 0);
  }
});

test('fresh token and disconnected reads never initiate OAuth or HTTP', async (t) => {
  const ready = fixture(t, { record: fresh() });
  assert.equal(await ready.client.getAccessToken(required), 'synthetic-access'); assert.equal(ready.calls.length, 0);
  const empty = fixture(t);
  await assert.rejects(empty.client.getAccessToken(required), /Connect Google first/);
  assert.deepEqual(await empty.client.status(), { configured: true, connected: false, pending: false, grantedScopes: [] });
  assert.equal(empty.calls.length, 0);
});

test('disconnect rejects late abort-ignoring refresh without restoring storage', async (t) => {
  const gate = deferred(), entered = deferred();
  const { client, record, writes } = fixture(t, { record: { ...fresh(), expiresAt: 0 }, fetch: async () => {
    entered.resolve(); await gate.promise; return json(token());
  } });
  const rejected = assert.rejects(client.getAccessToken(required), /Google/);
  await entered.promise; await client.disconnect(); gate.resolve(); await rejected;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(record(), null); assert.equal(writes.length, 0);
});

test('invalid tokens, missing offline access and adapter errors stay sanitized', async (t) => {
  for (const response of [token({ scope: 'unrelated' }), token({ expires_in: -1 }), token({ token_type: {} }), token({ access_token: '' })]) {
    const { client } = fixture(t, { record: { ...fresh(), expiresAt: 0 }, fetch: () => json(response) });
    await assert.rejects(client.getAccessToken(required), /invalid token response/);
  }
  const missing = fixture(t, { fetch: () => json(token({ refresh_token: undefined })) });
  await login(missing.client); assert.equal(missing.record(), null); assert.match((await missing.client.status()).error, /sign-in failed/);
  const optional = fixture(t, { clientSecret: undefined }); await login(optional.client);
  assert.equal(optional.calls[0].init.body.has('client_secret'), false);
  const broken = fixture(t, { credentials: { async get() { throw new Error('private'); }, async set() {}, async delete() {} } });
  await assert.rejects(broken.client.status(), { message: 'Google credentials could not be read.' }); await broken.client.disconnect();
});
