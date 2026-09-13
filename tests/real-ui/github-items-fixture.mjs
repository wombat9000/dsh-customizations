import { githubSessionSeed } from './github-grants-fixture.mjs'
import { projectItemsBlock } from './project-items-fixture.js'
export const githubItemsWorkspace = 'github-items-workspace'
export const githubItemsPrompt = 'Review the synthetic historical project items.'
export function githubItemsSeed(cwd) {
  const fixture = githubSessionSeed(cwd)
  fixture.id = 'visual-test-github-items'
  const events = fixture.options.seed
  events[1].data.content[0].text = githubItemsPrompt
  const call = events[2].data.message.content[0]
  call.name = 'github_list_project_items'; call.arguments = JSON.stringify({ owner: 'fixture-org', projectNumber: 7 })
  events[3].data.name = call.name; events[3].data.arguments = call.arguments
  events[4].data.message.content[0].content = projectItemsBlock().content
  return fixture
}
