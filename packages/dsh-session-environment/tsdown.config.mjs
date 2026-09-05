import { defineConfig } from 'tsdown'
const PACKAGE_ID = '@local/dsh-session-environment'

export default defineConfig(({ env }) => {
  const face = env?.DSH_BUILD_FACE ?? 'host'
  if (face === 'host') {
    return {
      entry: { index: 'lib/types/index.js' },
      outDir: 'lib',
      format: ['esm'],
      platform: 'node',
      target: 'es2024',
      fixedExtension: false,
      dts: false,
      clean: false,
      deps: {
        neverBundle: (specifier) => specifier.startsWith('@deepseek-ai/')
          || specifier === 'zod'
          || specifier.startsWith('node:'),
      },
    }
  }
  if (face !== 'client') {
    throw new Error(`DSH_BUILD_FACE must be host or client, received ${String(face)}`)
  }
  return {
    entry: { client: 'lib/types/client/index.js' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    sourcemap: true,
    minify: true,
    clean: false,
    deps: {
      neverBundle: (specifier) => specifier === 'react',
      alwaysBundle: (specifier) => specifier !== 'react',
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
})
