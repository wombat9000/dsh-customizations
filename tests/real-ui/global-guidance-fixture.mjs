// Disposable-host observation only: assemble the actual public prompt registry
// and return this bundle's section, never unrelated prompt text or credentials.
// No agent loop, model request, capture, cleanup, or production endpoint is added.
export function registerGlobalGuidanceFixture(ctx) {
  ctx.inject(['webServer', 'systemPrompt'], (scope) =>
    scope.effect(() =>
      scope.webServer.register({
        kind: 'exact',
        path: '/api/test/global-guidance',
        handler: async (req, res) => {
          if (
            req.method !== 'POST' ||
            req.headers.origin !== `http://${req.headers.host}` ||
            req.headers['x-dsh-test'] !== '1'
          ) {
            res.writeHead(403)
            res.end()
            return
          }
          const assembly = await scope.systemPrompt.assemble()
          res.writeHead(200, {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          })
          res.end(
            JSON.stringify({
              sections: assembly.sections.filter(
                (s) => s.name === 'global-guidance:visual-evidence',
              ),
            }),
          )
        },
      }),
    ),
  )
}
