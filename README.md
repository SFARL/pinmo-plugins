# Pinmo plugins

A plugin for [Pinmo](https://pinmo.me), a private map of the places you have been, that works in **Claude Code** and **Codex**. With it, the agent can answer questions such as "where did I eat in Tokyo last October?" or "recap my Kyoto trip" from the records you saved in Pinmo, and, in Claude Code, turn a folder of photos on your computer into draft cards ("organize this folder into my map and tell me which places you are unsure of").

Reading is read-only: the agent can read the time, place, tags and note of your saved records. It cannot see your photos, voice notes, drafts or records others shared with you, and it cannot change them. Importing only creates drafts; you confirm, edit and share them on pinmo.me.

## Install in Claude Code

```
/plugin marketplace add SFARL/pinmo-plugins
/plugin install pinmo@pinmo-plugins
```

Then run `/mcp`, choose `pinmo`, and sign in. Your browser opens Pinmo; sign in there and allow Claude Code to read your records.

From a shell, the same steps are `claude plugin marketplace add SFARL/pinmo-plugins` and `claude plugin install pinmo@pinmo-plugins`.

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
  - `import-folder` – import a folder of JPEGs as draft cards (macOS and Windows), name the places the agent recognizes, and list the ones it is unsure of.

The agent uses the skills on its own when your request fits. In Claude Code you can also call them as `/pinmo:recall`, `/pinmo:trip-review` and `/pinmo:import-folder`.

## Importing a photo folder

`import-folder` works on **macOS** and **Windows 10 / 11** with nothing to install. The skill carries a small import tool as text: on macOS it runs with JavaScript for Automation (`osascript`), on Windows with Windows PowerShell. Both use only what ships with the system. On other systems the skill points you to the batch import on pinmo.me.

1. The first time, your browser opens Pinmo; allow "Pinmo CLI" to import photos. (The tool shares this login with the `pinmo` command-line tool.)
2. Ask the agent to import a folder. The tool reads capture time and GPS on your computer and uploads two resized, upright copies with EXIF removed; the original files stay on your computer.
3. With `--agent-fills` (the skill's default when you ask it to name places), Pinmo does not run its own model on that import: the agent looks at the photos instead, so they are seen by the agent and the company that runs it.
4. Open the review address the agent gives you, then confirm and share the cards yourself.

Revoke this computer's import access by asking the agent to log out of Pinmo, or revoke "Pinmo CLI" under Data and account on pinmo.me.

Sign-in uses OAuth with Client ID Metadata Documents: Pinmo recognizes Claude Code and Codex by their published client documents, so there is no client to register and no API key.

## Revoke access

On https://pinmo.me, open your avatar menu → Data and account, and revoke "Claude Code" or "Codex". The next request from that agent fails until you sign in again.

Privacy notice: https://pinmo.me/privacy

## Development

The plugin lives in `plugins/pinmo/`. Claude Code reads `.claude-plugin/` (marketplace and plugin manifests); Codex reads `.agents/plugins/marketplace.json` and `plugins/pinmo/.codex-plugin/plugin.json`. Both share `plugins/pinmo/.mcp.json` and `plugins/pinmo/skills/`.

```
claude plugin validate .
claude plugin validate ./plugins/pinmo
```

This repository holds only the plugin itself (Markdown, JSON, license). The maintainers' consistency checks and release steps are kept with the Pinmo service's source.

## Changelog

- **0.3.0** – `import-folder` no longer needs the `pinmo` CLI: it carries its own import tool for macOS (JavaScript for Automation) and Windows (Windows PowerShell), using only what ships with the system. Verified end to end in Claude Code on macOS against Pinmo's staging site; the Windows tool is verified by automated checks. Codex verification is done separately on the Codex side.
- **0.2.1** – The Claude Code marketplace is now named `pinmo-plugins` (install with `pinmo@pinmo-plugins`). If you added it before, remove the old one with `/plugin marketplace remove pinmo` and add it again. Codex is unchanged.
- **0.2.0** – `import-folder` skill (folder import with the `pinmo` CLI); `recall` sends add-photo requests there. Verified in Claude Code only; Codex verification of 0.2.0 is done separately on the Codex side.
- **0.1.0** – `recall` and `trip-review` over the read-only `pinmo` MCP server.
