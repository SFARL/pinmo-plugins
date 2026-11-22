# Pinmo plugins

Claude Code plugin for [Pinmo](https://pinmo.me), a private map of the places you have been. With it, Claude can answer questions such as "where did I eat in Tokyo last October?" or "recap my Kyoto trip" from the records you saved in Pinmo.

The plugin is read-only. Claude can read the time, place, tags and note of your saved records. It cannot see your photos, voice notes, drafts or records others shared with you, and it cannot change anything.

## Install

In Claude Code:

```
/plugin marketplace add SFARL/pinmo-plugins
/plugin install pinmo@pinmo
```

Then run `/mcp`, choose `pinmo`, and sign in. Your browser opens Pinmo; sign in there and allow Claude Code to read your records.

If `/mcp` later shows that `pinmo` needs authentication again (for example after you sign in to Claude Code again with `/login`), sign in once more the same way.

## What it adds

- The `pinmo` MCP server (`https://pinmo.me/mcp`) with two tools: `list_memory_filters` and `search_memories`.
- Two skills:
  - `/pinmo:recall` – look up places by city, tag, date or keyword.
  - `/pinmo:trip-review` – a day-by-day review of a trip or a range of dates.

Claude uses the skills on its own when your question fits; you can also call them by name.

## Revoke access

On https://pinmo.me, open your avatar menu → Data and account, and revoke "Claude Code". The next request from Claude Code fails until you sign in again.

Privacy notice: https://pinmo.me/privacy

## Development

```
npm test
claude plugin validate .
claude plugin validate ./plugins/pinmo
```
