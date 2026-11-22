---
name: trip-review
description: Write a day-by-day review of a trip or a stretch of dates from the places the user saved in Pinmo. Use when the user asks to recap, review or summarise a trip, a holiday or a period ("回顾一下十月的东京之旅""帮我整理上周去了哪些地方""trip recap", "what did I do in Kyoto last spring"). Uses the pinmo server's list_memory_filters and search_memories tools. Read-only.
---

# Trip review from Pinmo

Pinmo is the user's private map of places they have been. Each saved record has a local time, a place (name, city, tags) and an optional note. The `pinmo` MCP server gives read-only access through two tools: `list_memory_filters` and `search_memories`.

## Steps

1. **Pin down the dates.** Get a start and end date from the user's words (`YYYY-MM-DD`, inclusive). If they named only a place ("my Kyoto trip"), search that city without dates first, look at the record times, and confirm the date range with the user before building the review.
2. **Call `list_memory_filters`.** If `total` is 0, say the account has no saved records and stop; do not search. Map the city the user named to the exact spelling in `cities`; cities can be stored in Chinese or English, and the two count as different cities. For a trip across several cities, leave `city` out and rely on the dates.
3. **Fetch every record in the range** with `search_memories`: `from`, `to`, `city` if it applies, and `limit: 20`. While `nextCursor` is not null, call again with `cursor` set to that exact value and the same filters. Never write or change a cursor yourself.
   - After 5 pages (100 records), stop and ask the user whether to continue or narrow the range. This keeps within the server's rate limit.
4. **Build the review.**
   - Results arrive newest first; present them oldest first.
   - Group by the local date in each record's `startedAt` (it carries the record's own offset; do not convert to the user's current time zone).
   - For each day: the places in order with their local time, city and tags, and the gist of any note.
   - End with a short summary: number of days and places, cities visited, and places the user returned to more than once.

## When nothing matches

Say which dates and city you searched, then suggest a wider range, the city's other language from `cities`, or no city at all. Do not invent records.

## Rules

- Use only the `pinmo` server for this. If a call fails, report the failure; do not answer from another server or from memory.
- The tools are read-only. If the user wants to add, edit or delete a record, say the plugin cannot do that and point them to https://pinmo.me.
- If a call fails with an authorization error (401, `invalid_token`), tell the user to run `/mcp`, choose `pinmo`, and sign in again.
- If a call returns `rate_limited`, tell the user to wait a minute. Do not retry in a loop.
- The notes are the user's private writing. Do not copy them into files or send them anywhere else unless the user asks.
