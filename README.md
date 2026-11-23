# Pinmo plugins

A plugin for [Pinmo](https://pinmo.me), a private map of the places you have been, that works in **Claude Code** and **Codex**. With it, the agent can answer questions such as "where did I eat in Tokyo last October?" or "recap my Kyoto trip" from the records you saved in Pinmo, and, in Claude Code, turn a folder of photos on your computer into draft cards ("organize this folder into my map and tell me which places you are unsure of").

Reading is read-only: the agent can read the time, place, tags and note of your saved records. It cannot see your photos, voice notes, drafts or records others shared with you, and it cannot change them. Importing only creates drafts; you confirm, edit and share them on pinmo.me.

## Install in Claude Code

```
/plugin marketplace add SFARL/pinmo-plugins
/plugin install pinmo@pinmo
```

Then run `/mcp`, choose `pinmo`, and sign in. Your browser opens Pinmo; sign in there and allow Claude Code to read your records.

From a shell, the same steps are `claude plugin marketplace add SFARL/pinmo-plugins` and `claude plugin install pinmo@pinmo`.

If `/mcp` later shows that `pinmo` needs authentication again (for example after you sign in to Claude Code again with `/login`), sign in once more the same way.

## Install in Codex

Needs a Codex CLI with plugin support (tested with 0.171.0; `codex --version` to check, `npm install -g @openai/codex` to update).

```
codex plugin marketplace add SFARL/pinmo-plugins
codex plugin add pinmo@pinmo
codex mcp login pinmo
```

The last command opens Pinmo in your browser; sign in there and allow Codex to read your records. In the Codex app, add the marketplace the same way and install Pinmo from the Plugins directory, then start a new chat.

## What it adds

- The `pinmo` MCP server (`https://pinmo.me/mcp`) with two tools: `list_memory_filters` and `search_memories`.
- Three skills:
  - `recall` – look up places by city, tag, date or keyword.
  - `trip-review` – a day-by-day review of a trip or a range of dates.
  - `import-folder` – import a folder of JPEGs as draft cards with the `pinmo` CLI, name the places the agent recognizes, and list the ones it is unsure of.

The agent uses the skills on its own when your request fits. In Claude Code you can also call them as `/pinmo:recall`, `/pinmo:trip-review` and `/pinmo:import-folder`.

## Importing a photo folder

`import-folder` runs the `pinmo` command-line tool, which is **not publicly distributed yet**; without it the skill stops and points you to the batch import on pinmo.me. When the CLI is installed (`pinmo` on your `PATH`, or `PINMO_CLI` set to the built `pinmo.mjs`; Node 22 or later):

1. `pinmo login` once: your browser opens Pinmo; allow "Pinmo CLI" to import photos.
2. Ask the agent to import a folder. The CLI reads capture time and GPS on your computer and uploads two resized copies with EXIF removed; the original files stay on your computer.
3. With `--agent-fills` (the skill's default when you ask it to name places), Pinmo does not run its own model on that import: the agent looks at the photos instead, so they are seen by the agent and the company that runs it.
4. Open the review address the agent gives you, then confirm and share the cards yourself.

Revoke the CLI with `pinmo logout`, or revoke "Pinmo CLI" under Data and account on pinmo.me.

Sign-in uses OAuth with Client ID Metadata Documents: Pinmo recognizes Claude Code and Codex by their published client documents, so there is no client to register and no API key.

## Revoke access

On https://pinmo.me, open your avatar menu → Data and account, and revoke "Claude Code" or "Codex". The next request from that agent fails until you sign in again.

Privacy notice: https://pinmo.me/privacy

## Development

The plugin lives in `plugins/pinmo/`. Claude Code reads `.claude-plugin/` (marketplace and plugin manifests); Codex reads `.agents/plugins/marketplace.json` and `plugins/pinmo/.codex-plugin/plugin.json`. Both share `plugins/pinmo/.mcp.json` and `plugins/pinmo/skills/`.

```
npm test
claude plugin validate .
claude plugin validate ./plugins/pinmo
```

Releases follow [`.claude/skills/release-plugin/SKILL.md`](.claude/skills/release-plugin/SKILL.md).

## Changelog

- **0.2.0** – `import-folder` skill (folder import with the `pinmo` CLI); `recall` sends add-photo requests there. Verified in Claude Code only; Codex verification of 0.2.0 is done separately on the Codex side.
- **0.1.0** – `recall` and `trip-review` over the read-only `pinmo` MCP server.
