# Pinmo plugins

A plugin for [Pinmo](https://pinmo.me), a private map of the places you have been, that works in **Claude Code** and **Codex**. Ask about your saved places, recap a trip, note a moment as a draft, or turn a folder of photos on your Mac or Windows PC into draft cards from a local session.

Reading is read-only: the agent can read the time, place, tags and note of your saved records. It cannot see your photos, voice notes, drafts or records others shared with you, and it cannot change them. Noting and importing only create drafts; you confirm, edit and share them on pinmo.me.

## Install in Claude Code

```
/plugin marketplace add SFARL/pinmo-plugins
/plugin install pinmo@pinmo-plugins
```

Then run `/mcp`, choose `pinmo`, and sign in. Your browser opens Pinmo; sign in there and allow Claude Code to read your records and create drafts.

If you connected before version 0.4.0, Claude Code can only read: to let it note drafts, run `/mcp`, choose `pinmo` and sign in again (or `claude mcp logout pinmo`, then `claude mcp login pinmo`), and allow drafts on the consent page.

From a shell, the same steps are `claude plugin marketplace add SFARL/pinmo-plugins` and `claude plugin install pinmo@pinmo-plugins`.

If `/mcp` later shows that `pinmo` needs authentication again (for example after you sign in to Claude Code again with `/login`), sign in once more the same way.

## Install in Codex

Needs a Codex CLI with plugin support (tested with 0.171.0; `codex --version` to check, `npm install -g @openai/codex` to update).

```
codex plugin marketplace add SFARL/pinmo-plugins
codex plugin add pinmo@pinmo
```

Start a new local Codex session after installing. Run `codex mcp login pinmo` to let Codex query your saved records. To import photos, ask Codex to import a local folder into Pinmo and follow the separate Pinmo authorization in your browser when prompted.

Import requires a local shell with access to the selected folder and to Pinmo. If the sandbox blocks access, use the session's normal approval controls or use **Batch import** on pinmo.me. Folder import is verified end to end in Codex CLI on macOS. On Windows, the PowerShell importer passed its automated tests with a stand-in server. An end-to-end Codex test on Windows is still pending.

## What it adds

- The `pinmo` MCP server (`https://pinmo.me/mcp`) with two read tools, `list_memory_filters` and `search_memories`, and `create_note_draft`, which creates a draft without photos.
- Four skills:
  - `recall` – look up places by city, tag, date or keyword.
  - `trip-review` – a day-by-day review of a trip or a range of dates.
  - `note-draft` – note a moment you describe ("we had hotpot at Haidilao last night") as a draft: some text, optionally a place name and a time.
  - `import-folder` – import a folder of JPEGs as draft cards (macOS and Windows), name the places the agent recognizes, and list the ones it is unsure of.

The agent uses the skills on its own when your request fits. In Claude Code you can also call them as `/pinmo:recall`, `/pinmo:trip-review`, `/pinmo:note-draft` and `/pinmo:import-folder`.

## Noting a draft

Ask the agent to note something ("记一下：昨晚在海底捞吃火锅"). It sends Pinmo the text and, if you mentioned them, the place name and the time. That text goes to Pinmo from the agent, so the company behind the agent has seen it too. Pinmo saves it as a draft without photos and shows it in your stream on pinmo.me, marked with the agent's name. The place name only starts the place search: you pick the exact place and confirm the draft yourself, and until then it is not a saved record. The agent cannot confirm, change, share or delete records. Each account can receive a limited number of agent drafts per day.

## Importing a photo folder

`import-folder` uses JavaScript for Automation (`osascript`) on **macOS** and Windows PowerShell on **Windows 10 / 11**. These tools ship with their respective systems. On other systems, use **Batch import** on pinmo.me.

1. The first time, your browser opens Pinmo and asks you to allow "Pinmo CLI" to import photos. The import tool shares this login with the standalone `pinmo` CLI.
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

- **0.4.0** – `note-draft` skill: note a moment as a draft record without photos through the `pinmo` server's new `create_note_draft` tool; you confirm it on pinmo.me. Connections made before 0.4.0 can only read until you sign in again. `recall` and `trip-review` send requests to add a record to it. Verified in Claude Code against Pinmo's staging site.

- **0.3.2** – Describe folder import in Codex and clarify its local execution and first-use authorization. Verified the GitHub plugin's import flow in Codex CLI on macOS against Pinmo staging.
- **0.3.1** – Fix the Windows import tool: after the first request it lost its connection to Pinmo, so login and import failed with "Could not reach". The Windows tool now passes the same automated checks as the macOS one, run on Windows with Windows PowerShell 5.1 against a stand-in Pinmo site; it has not yet been run end to end against Pinmo itself.
- **0.3.0** – `import-folder` no longer needs the `pinmo` CLI: it carries its own import tool for macOS (JavaScript for Automation) and Windows (Windows PowerShell), using only what ships with the system. Verified end to end in Claude Code on macOS against Pinmo's staging site. The Windows tool passes static checks but has not been run on Windows yet. Codex verification is done separately on the Codex side.
- **0.2.1** – The Claude Code marketplace is now named `pinmo-plugins` (install with `pinmo@pinmo-plugins`). If you added it before, remove the old one with `/plugin marketplace remove pinmo` and add it again. Codex is unchanged.
- **0.2.0** – `import-folder` skill (folder import with the `pinmo` CLI); `recall` sends add-photo requests there. Verified in Claude Code only; Codex verification of 0.2.0 is done separately on the Codex side.
- **0.1.0** – `recall` and `trip-review` over the read-only `pinmo` MCP server.
