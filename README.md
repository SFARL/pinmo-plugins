# Pinmo plugins

A plugin for [Pinmo](https://pinmo.me), a private map of the places you have been, that works in **Claude Code** and **Codex**. With it, the agent can answer questions such as "where did I eat in Tokyo last October?" or "recap my Kyoto trip" from the records you saved in Pinmo.

The plugin is read-only. The agent can read the time, place, tags and note of your saved records. It cannot see your photos, voice notes, drafts or records others shared with you, and it cannot change anything.

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
- Two skills:
  - `recall` – look up places by city, tag, date or keyword.
  - `trip-review` – a day-by-day review of a trip or a range of dates.

The agent uses the skills on its own when your question fits. In Claude Code you can also call them as `/pinmo:recall` and `/pinmo:trip-review`.

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
