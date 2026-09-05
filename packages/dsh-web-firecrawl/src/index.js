import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { WebError } from '@deepseek-ai/dsh-web'

export const name = 'web-firecrawl'
export const inject = ['web']
export const FIRECRAWL_PROVIDER_ID = 'firecrawl'
export const FIRECRAWL_API_KEY_ENV = 'FIRECRAWL_API_KEY'
export const FIRECRAWL_CREDENTIAL_REF = credentialRef(FIRECRAWL_API_KEY_ENV)
export const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.dev/v2'
export const FIRECRAWL_DEFAULT_MAX_BODY_CHARS = 100_000

const FIRECRAWL_MAX_SEARCH_RESULTS = 100
const USER_AGENT = '@local/dsh-web-firecrawl/0.1.0'

export const Config = z.object({
  apiKey: z.string().role('secret'),
  baseURL: z.string(),
  maxBodyChars: z.number().step(1).min(1),
  search: z.boolean().default(true),
  fetch: z.boolean().default(true),
})

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalText(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function validBaseURL(value) {
  if (!URL.canParse(value)) return false
  return new URL(value).protocol === 'https:'
}

function isAbortError(error, signal) {
  return signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError')
}

function aborted(operation, signal, cause) {
  return new WebError(
    `Firecrawl ${operation} aborted`,
    'WEB_ABORTED',
    { cause: signal?.aborted === true ? signal.reason : cause },
  )
}

function abortable(operation, signal, operationName) {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(aborted(operationName, signal))
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted(operationName, signal))
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function apiErrorMessage(payload, status) {
  if (isRecord(payload)) {
    const detail = optionalText(payload.error) ?? optionalText(payload.message)
    if (detail !== undefined) return detail
  }
  return `Firecrawl API error (HTTP ${status})`
}

function mapSearchSource(value) {
  if (!isRecord(value) || typeof value.url !== 'string' || value.url.length === 0) return undefined
  const title = optionalText(value.title)
  const snippet = optionalText(value.description) ?? optionalText(value.snippet)
  const publishedAt = optionalText(value.date)
  return {
    url: value.url,
    ...(title !== undefined ? { title } : {}),
    ...(snippet !== undefined ? { snippet } : {}),
    ...(publishedAt !== undefined ? { publishedAt } : {}),
  }
}

export function mapFirecrawlSearchResponse(data, requestedLimit) {
  if (!isRecord(data)) {
    throw new WebError('Firecrawl returned an unprocessable search response', 'WEB_PROVIDER_ERROR')
  }
  const web = data.web
  if (web !== undefined && !Array.isArray(web)) {
    throw new WebError('Firecrawl returned an unprocessable search result list', 'WEB_PROVIDER_ERROR')
  }
  return {
    sources: (web ?? []).map(mapSearchSource).filter((source) => source !== undefined),
    truncated: requestedLimit !== undefined && requestedLimit > FIRECRAWL_MAX_SEARCH_RESULTS,
  }
}

export function mapFirecrawlScrapeResponse(data, requestedURL, maxBodyChars) {
  if (!isRecord(data)) {
    throw new WebError('Firecrawl returned an unprocessable scrape response', 'WEB_PROVIDER_ERROR')
  }

  const metadata = isRecord(data.metadata) ? data.metadata : {}
  const scrapeError = optionalText(metadata.error)
  if (scrapeError !== undefined) {
    throw new WebError(scrapeError, 'WEB_PROVIDER_ERROR')
  }
  const markdown = typeof data.markdown === 'string' ? data.markdown : undefined
  if (markdown === undefined) {
    throw new WebError('Firecrawl scrape response did not contain markdown', 'WEB_PROVIDER_ERROR')
  }

  const finalURL = optionalText(metadata.url) ?? optionalText(metadata.sourceURL) ?? requestedURL
  const statusCode = Number.isInteger(metadata.statusCode) ? metadata.statusCode : 200
  const bodyTruncated = markdown.length > maxBodyChars
  const documentTruncated = Number.isInteger(metadata.totalPages)
    && Number.isInteger(metadata.numPages)
    && metadata.totalPages > metadata.numPages

  return {
    url: finalURL,
    statusCode,
    body: {
      kind: 'text',
      content: markdown.slice(0, maxBodyChars),
    },
    truncated: bodyTruncated || documentTruncated,
  }
}

export class FirecrawlWebProvider {
  id = FIRECRAWL_PROVIDER_ID

  constructor(options) {
    this.options = {
      ...options,
      baseURL: options.baseURL.replace(/\/+$/u, ''),
      fetchImpl: options.fetchImpl ?? globalThis.fetch,
    }
  }

  available() {
    return ((this.options.apiKey?.length ?? 0) > 0 || this.options.resolveApiKey !== undefined)
      && validBaseURL(this.options.baseURL)
      && Number.isInteger(this.options.maxBodyChars)
      && this.options.maxBodyChars > 0
  }

  async apiKey(signal, operation) {
    if (signal?.aborted) throw aborted(operation, signal)
    if ((this.options.apiKey?.length ?? 0) > 0) return this.options.apiKey

    let resolved
    try {
      resolved = await abortable(
        this.options.resolveApiKey?.() ?? Promise.resolve(undefined),
        signal,
        operation,
      )
    } catch (error) {
      if (error instanceof WebError && error.code === 'WEB_ABORTED') throw error
      if (isAbortError(error, signal)) throw aborted(operation, signal, error)
      throw new WebError(
        `Firecrawl ${operation} credential resolution failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }

    if (typeof resolved === 'string' && resolved.length > 0) return resolved
    throw new WebError(
      `Firecrawl has no API key for "${this.options.apiKeyEnv ?? FIRECRAWL_API_KEY_ENV}"; configure it in Settings → Plugins → Plugin configuration → Firecrawl or export it in the launching environment`,
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }

  async request(path, body, signal, operation) {
    if (!validBaseURL(this.options.baseURL)) {
      throw new WebError('Firecrawl baseURL must use HTTPS', 'WEB_PROVIDER_ERROR')
    }
    const apiKey = await this.apiKey(signal, operation)
    if (signal?.aborted) throw aborted(operation, signal)

    let response
    try {
      response = await this.options.fetchImpl(`${this.options.baseURL}${path}`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json',
          'content-type': 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...(signal !== undefined ? { signal } : {}),
      })
    } catch (error) {
      if (isAbortError(error, signal)) {
        throw new WebError(`Firecrawl ${operation} aborted`, 'WEB_ABORTED', { cause: error })
      }
      throw new WebError(
        `Firecrawl ${operation} request failed: ${String(error)}`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }

    let payload
    try {
      payload = await abortable(response.json(), signal, operation)
    } catch (error) {
      if (error instanceof WebError && error.code === 'WEB_ABORTED') throw error
      if (isAbortError(error, signal)) throw aborted(operation, signal, error)
      throw new WebError(
        `Firecrawl returned an unprocessable ${operation} response body`,
        'WEB_PROVIDER_ERROR',
        { cause: error },
      )
    }
    if (signal?.aborted) throw aborted(operation, signal)

    if (!response.ok || (isRecord(payload) && payload.success === false)) {
      throw new WebError(apiErrorMessage(payload, response.status), 'WEB_PROVIDER_ERROR')
    }
    if (!isRecord(payload) || payload.success !== true || !('data' in payload)) {
      throw new WebError(`Firecrawl returned an unprocessable ${operation} response`, 'WEB_PROVIDER_ERROR')
    }
    return payload.data
  }

  async search(request, signal) {
    const requestedLimit = request.maxResults
    const limit = requestedLimit === undefined
      ? undefined
      : Math.min(requestedLimit, FIRECRAWL_MAX_SEARCH_RESULTS)
    const data = await this.request('/search', {
      query: request.query,
      sources: [{ type: 'web' }],
      ...(limit !== undefined ? { limit } : {}),
    }, signal, 'search')
    return mapFirecrawlSearchResponse(data, requestedLimit)
  }

  async fetch(request, signal) {
    const data = await this.request('/scrape', {
      url: request.url,
      formats: [{ type: 'markdown' }],
    }, signal, 'scrape')
    return mapFirecrawlScrapeResponse(data, request.url, this.options.maxBodyChars)
  }
}

export function apply(ctx, config = {}) {
  // The configurable-plugin directory only renders cards with a served namespace.
  // This card edits credentials, never settings-file secrets, so its document is empty.
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, 'web-firecrawl', z.object({}), {}, {
      setSource: () => {},
      onChange: () => {},
    })
  })
  const apiKeyEnv = FIRECRAWL_CREDENTIAL_REF
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  const provider = new FirecrawlWebProvider({
    ...(literalApiKey !== undefined ? { apiKey: literalApiKey } : {}),
    apiKeyEnv,
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
      return launchEnvironmentOf(ctx).get(apiKeyEnv)?.value
    },
    baseURL: config.baseURL ?? FIRECRAWL_DEFAULT_BASE_URL,
    maxBodyChars: config.maxBodyChars ?? FIRECRAWL_DEFAULT_MAX_BODY_CHARS,
  })

  if (config.search ?? true) ctx.web.registerSearchProvider(provider)
  if (config.fetch ?? true) ctx.web.registerFetchProvider(provider)
}
