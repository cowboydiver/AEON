# Vendored skills — Matt Pocock's `skills`

These are the [Matt Pocock skills](https://github.com/mattpocock/skills)
("Skills for Real Engineers"), vendored into this repo so every contributor and
every Claude Code session gets the same engineering + productivity workflow
skills. Claude Code discovers each `<skill>/SKILL.md` under `.claude/skills/`
automatically.

## Provenance

| | |
|---|---|
| Source | https://github.com/mattpocock/skills |
| Version | **v1.1.0** |
| Commit | `d574778f94cf620fcc8ce741584093bc650a61d3` |
| Vendored | 2026-07-08 |
| License | MIT — see [`LICENSE`](./LICENSE) |

## What's included

The 21 skills that ship in the upstream plugin (`.claude-plugin/plugin.json`),
copied verbatim with their reference files, flattened one directory per skill:

- **Engineering:** `ask-matt`, `codebase-design`, `code-review`,
  `diagnosing-bugs`, `domain-modeling`, `grill-with-docs`, `implement`,
  `improve-codebase-architecture`, `prototype`, `research`,
  `setup-matt-pocock-skills`, `tdd`, `to-spec`, `to-tickets`, `triage`,
  `wayfinder`
- **Productivity:** `grill-me`, `grilling`, `handoff`, `teach`,
  `writing-great-skills`

Upstream's `deprecated/`, `in-progress/`, `personal/`, and `misc/` skills, and
the unshipped `engineering/resolving-merge-conflicts`, are intentionally **not**
vendored — they are not part of the released plugin.

## v1.1.0 highlights (from the upstream changelog)

- `ask-matt` router updated to map the full skill set (adds `tdd`,
  `diagnosing-bugs`, `domain-modeling`, `codebase-design`, `grilling`).
- `review` promoted to `engineering/code-review`, with an always-on Fowler
  "Bad Smells in Code" baseline on its Standards axis.
- `grilling` gains a confirmation gate and a facts-vs-decisions split.
- New `research` skill (background agent, primary sources → cited Markdown).
- Planning reshaped: `to-prd` → `to-spec`; `to-plan` + `to-issues` → `to-tickets`.
- `prototype` and `wayfinder` graduated; `wayfinder` = renamed `decision-mapping`.
- `tdd` reshaped to reference-only (red → green); `triage` now handles external PRs.

Full notes: https://github.com/mattpocock/skills/blob/main/CHANGELOG.md

## Updating

These are a vendored snapshot, not a git submodule. To move to a newer release:

1. `git clone --branch <tag> https://github.com/mattpocock/skills.git`
2. Re-copy the directories listed in that release's `.claude-plugin/plugin.json`
   into `.claude/skills/` (one dir per skill).
3. Update the version, commit, and date in the table above.
4. Read the changelog and note anything project-affecting in the commit message.
