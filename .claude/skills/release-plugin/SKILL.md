---
name: release-plugin
description: Use when releasing a new version of the Pinmo plugin from this repository (SFARL/pinmo-plugins) for Claude Code — after adding or changing a skill, the MCP server entry or a manifest, before pushing or tagging, or when asked to check that the plugin installs, or to submit or update its listing in the Claude plugin directory.
---

# Release the Pinmo plugin (Claude Code)

A release is: one version number in every place that carries it, tests and validation green, a clean install in an isolated Claude Code that shows every skill, then a push and a tag. The Claude plugin directory then picks the commit up from the tracked branch.

Scope: Claude Code. The Codex side (`.agents/plugins/marketplace.json`, `plugins/pinmo/.codex-plugin/plugin.json`, Codex install checks) has its own release flow. `npm test` requires the Codex manifest's `version` to equal the Claude one, so every release needs it bumped too:
- If the person who owns the Codex flow agreed (or asked you to release both), change only that `version` field and name the agreement in the commit message.
- Otherwise stop before step 6 and ask them; do not push with `npm test` failing, and do not weaken the test.

## Where the version lives

| File | Field |
| --- | --- |
| `plugins/pinmo/.claude-plugin/plugin.json` | `version` (Claude Code compares this to decide that an update exists) |
| `.claude-plugin/marketplace.json` | `plugins[0].version` |
| `plugins/pinmo/.codex-plugin/plugin.json` | `version` — `test/plugin.test.mjs` requires it to equal the Claude one; owned by the Codex flow |
| `README.md` | a line under `## Changelog` |

Semver: patch for wording fixes in a skill, minor for a new skill or a new capability, major when a skill or tool is removed or renamed. Never change the plugin `name` (`pinmo`): the directory listing and every install depend on it.

## Steps

1. **Start clean.** `git fetch origin && git status -sb` shows `main...origin/main` with nothing ahead or behind. Ignore stray Finder/iCloud copies such as `README 2.md` or `package 2.json`; never stage them. If other files are modified and they are not the change you are releasing, stop and ask whose they are.
2. **Tests first** when the release adds a skill or changes what a skill tells the agent to run: add assertions to `test/plugin.test.mjs` (the skill exists, names only real CLI commands or MCP tools, offers only values the server accepts), run `npm test` and see them fail. A pure wording fix needs no new test.
3. **Change the content**, then bump the version in every row of the table above (the Codex row as "Scope" says) and add the changelog line, also for a wording fix. Update the `README.md` sections the change touches: "What it adds", install notes, privacy statements. The README is the directory listing's description; keep it accurate about what leaves the user's computer.
4. **Check.**
   ```bash
   npm test
   claude plugin validate .
   claude plugin validate ./plugins/pinmo
   ```
   All three must pass. Read the validator's "Plugin directory checks" too: they do not fail the command but the directory runs them on submission (for example `ICON_MISSING`).
5. **Install in an isolated Claude Code** so the user's own plugins and settings are untouched:
   ```bash
   export CLAUDE_CONFIG_DIR="$(mktemp -d)"
   claude plugin marketplace add ./
   claude plugin install pinmo@pinmo
   claude plugin details pinmo@pinmo
   ```
   `details` must show the new version and every skill under `plugins/pinmo/skills/`, plus `MCP servers (1) pinmo`. Unset `CLAUDE_CONFIG_DIR` afterwards.
6. **Commit and push.** Stage the files by name (no `git add -A`), English imperative message, no `--no-verify`. This repository releases from `main`; push only after steps 4 and 5 passed. Pushing `main` is the release: users who refresh the marketplace get it, and a directory listing that tracks `main` picks it up.
7. **Install from GitHub** the way users do, again isolated:
   ```bash
   export CLAUDE_CONFIG_DIR="$(mktemp -d)"
   claude plugin marketplace add SFARL/pinmo-plugins
   claude plugin install pinmo@pinmo
   claude plugin details pinmo@pinmo
   ```
   Same expectations as step 5. If it fails, fix forward with the next patch version; do not rewrite `main`. Existing users get the update with `/plugin marketplace update pinmo` (or on Claude Code's own marketplace refresh).
8. **Tag** only after step 7 passed: `git tag -a v<version> -m "pinmo <version>" && git push origin v<version>`.
9. **Directory listing.** Whether the plugin is listed is recorded under "现状" in `docs/product/plugin-submission.md` of the lifemap repository (private; ask the maintainer if you cannot read it). The directory tracks a branch or tag, not a commit: each commit on the tracked ref is validated, scanned and (by default) published by a reviewer. So:
   - Already listed and tracking `main`: nothing to submit. On https://claude.ai/directory/manage the new version appears after the push; use "Check for new commits" if it does not.
   - Not listed yet: follow that file. Submitting needs a signed-in paid claude.ai account with GitHub connected, so a person does it; an agent prepares the text and stops.

## Common mistakes

| Mistake | Effect |
| --- | --- |
| Bumping `plugin.json` only | `npm test` fails on the marketplace or Codex version check; users may not see the update |
| Installing into the real `~/.claude` to test | Overwrites the user's own `pinmo` marketplace entry and settings |
| Skill text naming a CLI command, MCP tool or tag the server does not have | The agent runs something that fails; add it to the test's allow-list only after checking the lifemap source |
| Adding an icon after the first directory submission | The listing icon is taken once, on the first save or submission; later changes do not update it |
| Tracking a tag in the directory and forgetting to move it | The listing stays on the old commit |
