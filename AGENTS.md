# Repository guidance

- Follow the repository rules in `README.md`. Keep secrets and DSH runtime state out of Git.
- Before implementing or refactoring code, read [the engineering guide](docs/engineering.md).
- Before adding or reorganizing tests, read [test ownership and real-shell journeys](docs/testing.md) and load the test-audit skill. Prefer focused integration journeys over repeated shell setup; preserve each contract at its primary test boundary.
- For substantial implementations, refactors, or architecture reviews, load the [deep-module design skill](.agents/skills/deep-module-design/SKILL.md). Small fixes within established boundaries do not require it.
- If a task concerns setup, dependencies, validation, or a fresh checkout/worktree, read `.agents/skills/repository-setup/SKILL.md` first.
- For repository-owned DSH client UI work, read `.agents/skills/dsh-client-ui-development/SKILL.md` and choose its smallest sufficient path; routine presentation changes do not require fresh contract discovery.
- If `.agents/skills/` contains other skills, inspect their names and descriptions and load only those relevant to the task. Without a skill tool, read the relevant `SKILL.md` directly.
- Preserve existing package conventions. Keep shared services in host bundles and per-session contributions in agent presets.
- Do not install or upgrade dependencies, edit CI, apply profiles, commit, or deploy without explicit approval.
