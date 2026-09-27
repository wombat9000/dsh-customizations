import { presetRegressions } from '../../dsh-product-mode/test/preset-regressions.js'

presetRegressions({
  id: 'project-steward',
  name: 'Project Steward',
  skill: 'project-steward',
  marker: '## Inspect before proposing changes',
  resource: 'templates/v1/AGENTS.md.template',
})
