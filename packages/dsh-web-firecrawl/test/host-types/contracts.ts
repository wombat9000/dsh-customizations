import type { WebSearchProvider, WebFetchProvider } from '@deepseek-ai/dsh-web'
import { FirecrawlWebProvider } from '../../src/index.js'
import type { FirecrawlConfig } from '../../src/index.js'

const provider = new FirecrawlWebProvider({
  baseURL: 'https://api.firecrawl.dev/v2',
  maxBodyChars: 100_000,
  resolveApiKey: async () => undefined,
})
const search: WebSearchProvider = provider
const fetch: WebFetchProvider = provider
void search
void fetch

// @ts-expect-error The public search contract requires a string query.
void provider.search({ query: 123 })
// @ts-expect-error The public fetch contract requires a string URL.
void provider.fetch({ url: null })
// @ts-expect-error Exact optional config distinguishes absence from explicit undefined.
const config: FirecrawlConfig = { apiKey: undefined }
void config
