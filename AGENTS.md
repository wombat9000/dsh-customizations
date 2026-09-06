# Repository guidance

- Follow the repository rules in `README.md`. Keep secrets and DSH runtime state out of Git.
- If a task concerns setup, dependencies, validation, or a fresh checkout/worktree, read `.agents/skills/repository-setup/SKILL.md` first.
- If `.agents/skills/` contains other skills, inspect their names and descriptions and load only those relevant to the task. Without a skill tool, read the relevant `SKILL.md` directly.
- Preserve existing package conventions. Keep shared services in host bundles and per-session contributions in agent presets.
- Do not install or upgrade dependencies, edit CI, apply profiles, commit, or deploy without explicit approval.
