---
name: recall
description: Look up places the user saved in Pinmo. Use when the user asks where they went, what they did on a date or in a month, whether they have been somewhere, or for a place they noted (a cafe in Tokyo, "that ramen place", "我去过哪""上次在上海去的咖啡馆""去年十月去了哪"). Also use when the user asks to edit or delete a Pinmo record, to explain that this is read-only (importing a folder of photos is the import-folder skill). Uses the pinmo server's list_memory_filters and search_memories tools.
---

# Recall from Pinmo

Pinmo is the user's private map of places they have been. Each saved record has a local time, a place (name, city, tags) and an optional note. The `pinmo` MCP server gives read-only access through two tools: `list_memory_filters` and `search_memories`.

## Steps

1. **Call `list_memory_filters` first.** It returns `{ total, cities, tags }`.
   - If `total` is 0, tell the user their Pinmo account has no saved records yet and stop; do not search.
   - `cities` and `tags` list only values that some record has; records without a city still count in `total`. Do not say all records are in a city from this list alone.
   - `city` in a search must equal one of `cities` exactly. Cities can be stored in Chinese or English ("上海市", "Shanghai"), and the two count as different cities. Map what the user said to the spelling in `cities`; if more than one matches, search each.
   - `tag` must be one of `tags`. Built-in tags are English keys such as `cafe`, `park`, `landmark`; the user's own tags are their own words. Map "咖啡馆" or "coffee" to `cafe`, and so on.
2. **Call `search_memories`** with the narrowest filters that fit the question:
   - `city`, `tag`: from step 1.
   - `from`, `to`: dates as `YYYY-MM-DD`, inclusive, with `from` not after `to`. "Last October" in 2026 is `from: "2025-10-01", to: "2025-10-31"`.
   - `q`: free text matched against place names, addresses, notes and tags. Every word must match (AND), so pass only the one or two words that matter ("ramen", not "the ramen place I liked").
   - Prefer `city`, `tag` and dates over `q` when they express the question.
   - `limit`: 1–20, default 10.
3. **Paging.** If the answer needs more records and the result has a non-null `nextCursor`, call again with `cursor` set to that exact value and the same filters. Never write or change a cursor yourself.
4. **Answer** from the returned records only.
   - `startedAt` is the record's own local time with its offset (for example `2025-10-12T19:30:00+09:00`). Report that local date and time; do not convert it to the user's current time zone.
   - Quote the place name and city as returned. Summarise notes briefly unless the user asks for them in full.

## When nothing matches

Say which filters you used, then suggest loosening them: drop `tag`, try the city's other language from `cities`, widen the dates, or use fewer words in `q`. Do not invent records.

## Rules

- Use only the `pinmo` server for this. If a call fails, report the failure; do not answer from another server or from memory.
- The tools are read-only. If the user wants to edit or delete a record, say the plugin cannot do that and point them to https://pinmo.me. To add photos from a folder on this computer, use the import-folder skill.
- If a call fails with an authorization error (401, `invalid_token`), tell the user to sign in to the `pinmo` server again: in Claude Code run `/mcp` and choose `pinmo`; in Codex run `codex mcp login pinmo`.
- If a call returns `rate_limited`, tell the user to wait a minute. Do not retry in a loop.
- The notes are the user's private writing. Do not copy them into files or send them anywhere else unless the user asks.
