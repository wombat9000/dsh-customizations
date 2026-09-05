import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FIRECRAWL_DEFAULT_BASE_URL,
  apply,
  FirecrawlWebProvider,
  mapFirecrawlScrapeResponse,
} from '../src/index.js'

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function provider(fetchImpl, overrides = {}) {
  return new FirecrawlWebProvider({
    apiKey: 'fc-test-key',
    baseURL: FIRECRAWL_DEFAULT_BASE_URL,
    maxBodyChars: 100_000,
    fetchImpl,
    ...overrides,
  })
}

test('apply serves a credential-only plugin namespace when settings becomes available', () => {
  let install
  const providers = []
  const ctx = {
    inject(dependencies, callback) {
      assert.deepEqual(dependencies, ['settings'])
      assert.equal(install, undefined)
      install = callback
    },
    web: {
      registerSearchProvider(value) { providers.push(value) },
      registerFetchProvider(value) { providers.push(value) },
    },
  }
  apply(ctx, { apiKey: 'fc-private-key' })
  assert.equal(providers.length, 2)
  assert.equal(providers[0], providers[1])
  assert.ok(providers[0] instanceof FirecrawlWebProvider)
  let registrations = 0
  install({ settings: {
    installSection(owner, namespace, schema, initial, hooks) {
      registrations++
      assert.equal(owner, ctx)
      assert.equal(namespace, 'web-firecrawl')
      assert.equal(schema.type, 'object')
      assert.deepEqual(schema.dict, {})
      assert.deepEqual(schema({}), {})
      assert.deepEqual(initial, {})
      assert.equal(typeof hooks.setSource, 'function')
      assert.equal(typeof hooks.onChange, 'function')
    },
  } })
  assert.equal(registrations, 1)
})

test('reports availability from local configuration only', () => {
  assert.equal(provider(async () => jsonResponse({})).available(), true)
  assert.equal(provider(async () => jsonResponse({}), { apiKey: '' }).available(), false)
  assert.equal(provider(async () => jsonResponse({}), {
    apiKey: '',
    resolveApiKey: async () => undefined,
  }).available(), true)
  assert.equal(provider(async () => jsonResponse({}), { baseURL: 'not a url' }).available(), false)
  assert.equal(provider(async () => jsonResponse({}), { baseURL: 'http://firecrawl.example.com/v2' }).available(), false)
  assert.equal(provider(async () => jsonResponse({}), { maxBodyChars: 0 }).available(), false)
})

test('never sends credentials to an HTTP base URL', async () => {
  let called = false
  const firecrawl = provider(async () => {
    called = true
    return jsonResponse({})
  }, { baseURL: 'http://firecrawl.example.com/v2' })

  await assert.rejects(
    firecrawl.search({ query: 'test', maxResults: 1 }),
    (error) => error.code === 'WEB_PROVIDER_ERROR'
      && error.message === 'Firecrawl baseURL must use HTTPS',
  )
  assert.equal(called, false)
})

test('search calls Firecrawl v2 and maps web results', async () => {
  let call
  const firecrawl = provider(async (url, init) => {
    call = { url, init }
    return jsonResponse({
      success: true,
      data: {
        web: [
          {
            url: 'https://example.com/article',
            title: 'Example article',
            description: 'A useful result.',
          },
          { url: 'https://example.org/no-metadata' },
          { title: 'Missing URL' },
        ],
      },
    })
  })

  const result = await firecrawl.search({ query: 'example query', maxResults: 8 })

  assert.equal(call.url, 'https://api.firecrawl.dev/v2/search')
  assert.equal(call.init.method, 'POST')
  assert.equal(call.init.redirect, 'error')
  assert.equal(call.init.headers.authorization, 'Bearer fc-test-key')
  assert.deepEqual(JSON.parse(call.init.body), {
    query: 'example query',
    sources: [{ type: 'web' }],
    limit: 8,
  })
  assert.deepEqual(result, {
    sources: [
      {
        url: 'https://example.com/article',
        title: 'Example article',
        snippet: 'A useful result.',
      },
      { url: 'https://example.org/no-metadata' },
    ],
    truncated: false,
  })
})

test('search clamps Firecrawl limit while reporting provider truncation', async () => {
  let body
  const firecrawl = provider(async (_url, init) => {
    body = JSON.parse(init.body)
    return jsonResponse({ success: true, data: { web: [] } })
  })

  const result = await firecrawl.search({ query: 'many results', maxResults: 500 })

  assert.equal(body.limit, 100)
  assert.equal(result.truncated, true)
})

test('fetch maps scraped markdown and final target metadata', async () => {
  let call
  const firecrawl = provider(async (url, init) => {
    call = { url, init }
    return jsonResponse({
      success: true,
      data: {
        markdown: '# Final page\n\nContent',
        metadata: {
          url: 'https://example.com/final',
          sourceURL: 'https://example.com/start',
          statusCode: 200,
        },
      },
    })
  })

  const result = await firecrawl.fetch({ url: 'https://example.com/start' })

  assert.equal(call.url, 'https://api.firecrawl.dev/v2/scrape')
  assert.deepEqual(JSON.parse(call.init.body), {
    url: 'https://example.com/start',
    formats: [{ type: 'markdown' }],
  })
  assert.deepEqual(result, {
    url: 'https://example.com/final',
    statusCode: 200,
    body: { kind: 'text', content: '# Final page\n\nContent' },
    truncated: false,
  })
})

test('fetch caps large bodies and detects partial PDF extraction', () => {
  const result = mapFirecrawlScrapeResponse({
    markdown: 'abcdefghij',
    metadata: {
      sourceURL: 'https://example.com/document.pdf',
      statusCode: 200,
      numPages: 2,
      totalPages: 5,
    },
  }, 'https://example.com/document.pdf', 6)

  assert.equal(result.body.content, 'abcdef')
  assert.equal(result.truncated, true)
})

test('rejects scrape metadata errors instead of returning them as page content', () => {
  assert.throws(
    () => mapFirecrawlScrapeResponse({
      metadata: {
        sourceURL: 'https://example.com/blocked',
        statusCode: 200,
        error: 'Unable to scrape this page',
      },
    }, 'https://example.com/blocked', 100_000),
    (error) => error.code === 'WEB_PROVIDER_ERROR'
      && error.message === 'Unable to scrape this page',
  )
})

test('resolves the credential for every operation without caching it', async () => {
  let currentKey = 'fc-first-key'
  const authorizations = []
  const firecrawl = provider(async (_url, init) => {
    authorizations.push(init.headers.authorization)
    return jsonResponse({ success: true, data: { web: [] } })
  }, {
    apiKey: '',
    apiKeyEnv: 'FIRECRAWL_API_KEY',
    resolveApiKey: async () => currentKey,
  })

  await firecrawl.search({ query: 'first', maxResults: 1 })
  currentKey = 'fc-rotated-key'
  await firecrawl.search({ query: 'second', maxResults: 1 })

  assert.deepEqual(authorizations, ['Bearer fc-first-key', 'Bearer fc-rotated-key'])
})

test('reports a missing dynamic credential without making a request', async () => {
  let called = false
  const firecrawl = provider(async () => {
    called = true
    return jsonResponse({})
  }, {
    apiKey: '',
    apiKeyEnv: 'FIRECRAWL_API_KEY',
    resolveApiKey: async () => undefined,
  })

  await assert.rejects(
    firecrawl.search({ query: 'test', maxResults: 1 }),
    (error) => error.code === 'WEB_PROVIDER_CREDENTIAL_MISSING'
      && error.message.includes('Settings → Plugins → Plugin configuration → Firecrawl'),
  )
  assert.equal(called, false)
})

test('surfaces Firecrawl API messages as provider errors', async () => {
  const firecrawl = provider(async () => jsonResponse({
    success: false,
    error: 'Insufficient credits',
  }, 402))

  await assert.rejects(
    firecrawl.search({ query: 'test', maxResults: 1 }),
    (error) => error.code === 'WEB_PROVIDER_ERROR' && error.message === 'Insufficient credits',
  )
})

test('cancels credential resolution without waiting for it to settle', async () => {
  const firecrawl = provider(async () => jsonResponse({}), {
    apiKey: '',
    resolveApiKey: () => new Promise(() => {}),
  })
  const controller = new AbortController()
  const search = firecrawl.search({ query: 'test', maxResults: 1 }, controller.signal)
  controller.abort(new Error('cancel credential read'))

  await assert.rejects(search, (error) => error.code === 'WEB_ABORTED')
})

test('cancels an uncooperative response body read', async () => {
  const firecrawl = provider(async () => ({
    ok: true,
    status: 200,
    json: () => new Promise(() => {}),
  }))
  const controller = new AbortController()
  const search = firecrawl.search({ query: 'test', maxResults: 1 }, controller.signal)
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort(new Error('cancel body read'))

  await assert.rejects(search, (error) => error.code === 'WEB_ABORTED')
})

test('maps cancellation to WEB_ABORTED without making a request', async () => {
  let called = false
  const firecrawl = provider(async () => {
    called = true
    return jsonResponse({})
  })
  const controller = new AbortController()
  controller.abort(new Error('test cancellation'))

  await assert.rejects(
    firecrawl.fetch({ url: 'https://example.com' }, controller.signal),
    (error) => error.code === 'WEB_ABORTED',
  )
  assert.equal(called, false)
})

test('rejects malformed successful envelopes', async () => {
  const firecrawl = provider(async () => jsonResponse({ success: true }))

  await assert.rejects(
    firecrawl.search({ query: 'test', maxResults: 1 }),
    (error) => error.code === 'WEB_PROVIDER_ERROR'
      && error.message.includes('unprocessable search response'),
  )
})
