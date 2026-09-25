import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// Use the installed, pinned compiler; this hook neither installs tools
// nor replaces the separate strict type check. Only GitHub TS source is loaded.
const sourceUrls = ['../client/', '../shared/'].map((path) => new URL(path, import.meta.url).href)
let registered = false
export function registerTypeScript() {
  if (registered) return
  registerHooks({
    load(url, context, nextLoad) {
      if (!sourceUrls.some((prefix) => url.startsWith(prefix)) || !/\.tsx?$/u.test(url))
        return nextLoad(url, context)
      const fileName = fileURLToPath(url)
      const source = ts.transpileModule(readFileSync(fileName, 'utf8'), {
        fileName,
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
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
