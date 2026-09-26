import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Some supported Node builds disable native type stripping. Transpile only this
// package's source modules using the already-pinned compiler, not its built bundle.
// Strict checking runs separately in typecheck.test.mjs; this hook only executes TS.
const packageUrl = new URL('../../', import.meta.url).href
let registered = false
export function registerTypeScript() {
  if (registered) return
  registerHooks({
    resolve(specifier, context, nextResolve) {
      // Backend source uses Node-compatible .js specifiers for emitted modules.
      // Redirect only intra-backend source imports during source-level tests.
      const sourceUrl = new URL('src/', packageUrl).href
      if (
        context.parentURL?.startsWith(sourceUrl) &&
        specifier.startsWith('./') &&
        specifier.endsWith('.js')
      ) {
        return nextResolve(new URL(specifier.slice(0, -3) + '.ts', context.parentURL).href, context)
      }
      return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      if (!url.startsWith(packageUrl) || !/\.tsx?$/u.test(url)) return nextLoad(url, context)
      const fileName = fileURLToPath(url)
      const source = ts.transpileModule(readFileSync(fileName, 'utf8'), {
        fileName,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.React,
          verbatimModuleSyntax: true,
          sourceMap: false,
        },
      }).outputText
      return { format: 'module', source, shortCircuit: true }
    },
  })
  registered = true
}
