---
name: note-draft
description: Save something the user wants to remember in Pinmo as a draft record without photos. Use when the user asks to note, log or remember a moment, a meal, a visit or a place ("记一下", "帮我记下来", "add this to Pinmo", "note that we had dinner at …"). The draft is not saved until the user confirms it on pinmo.me. Uses the pinmo server's create_note_draft tool. To import a folder of photos, use the import-folder skill instead.
---

# Note a draft in Pinmo

Pinmo is the user's private map of places they have been. The `pinmo` MCP server's `create_note_draft` tool creates a **draft** record without photos in the user's account. A draft is not a saved record: it is not saved until the user picks the exact place and confirms it on Pinmo. The tool cannot confirm, change, share or delete anything, and drafts never show up in `search_memories`.

## Steps

1. **Decide what to send.** Only send what the user said; do not invent details.
   - `text` (required, 1–2000 characters): what happened, in the user's words and language. Keep their wording; a short clean-up is fine.
   - `placeName` (optional, up to 100 characters): the place's name if the user named one ("Seesaw Coffee", "海底捞"). It is only a hint that starts the user's place search; Pinmo does not pick the place from it. Leave it out if no place was named. Do not put an address or coordinates here.
   - `time` (optional): when it happened, as ISO 8601 with the user's UTC offset, for example `2026-11-20T19:30:00+08:00` (or `Z` for UTC). Resolve words like "yesterday evening" against today's date in the user's time zone. If the user's time zone is unknown and the time matters, ask, or leave `time` out. Leave it out when the user gave no time: Pinmo then uses the moment it receives the draft. Never send a time in the future.
2. **Call `create_note_draft` once** per moment the user described. For several separate moments, make one call each. Do not call it again to "fix" a draft: the user edits drafts on Pinmo.
3. **Tell the user** the draft was created but is not saved yet, and give them the `reviewUrl` from the result to choose the place and confirm it. Repeat what you sent (text, place hint, time) so they can check it.

## When it fails

The tool answers an error as `{"error": "<code>"}`:

- `write_not_granted`: this connection can only read. Pinmo was connected before drafts were possible, or the user did not allow drafts. Ask the user to reconnect Pinmo and allow it to create drafts: in Claude Code run `/mcp`, choose `pinmo` and sign in again (or `claude mcp logout pinmo` then `claude mcp login pinmo`); in Codex run `codex mcp login pinmo`. Do not retry before that.
- `invalid_time`: the time is in the future or its offset is impossible. Check the date and offset and try once more, or leave `time` out.
- `quota`: the user has created today's maximum number of drafts. Tell them to try again tomorrow or to add it on pinmo.me.
- `rate_limited`: too many requests; wait a minute. Do not retry in a loop.
- An authorization error (401, `invalid_token`): sign in to the `pinmo` server again as above.

## Rules

- Use only the `pinmo` server for this. If a call fails, report the failure; do not save the note anywhere else or claim it was saved.
- Only create a draft when the user asked you to note something. Do not turn other conversation into drafts on your own.
- The text is the user's private writing. Do not copy it into files or send it anywhere else.
- To look up what the user already saved, use the recall skill. To import a folder of photos, use the import-folder skill.
