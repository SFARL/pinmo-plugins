---
name: import-folder
description: Turn a folder of photos on this computer into draft Pinmo cards with the pinmo CLI, name the places you recognize, and tell the user which ones you are unsure of. Use when the user asks to import, upload or organize a photo folder into Pinmo or onto their map ("import ~/Pictures/tokyo into Pinmo", "把这个文件夹整理成地图，拿不准的地点告诉我", "把这些照片放进 Pinmo"). Not for questions about places already saved; use recall for those.
---

# Import a photo folder into Pinmo

The `pinmo` command-line tool imports a folder of photos into the user's Pinmo account as **draft** cards. Photos are prepared on this computer: the CLI reads the capture time and GPS, then uploads two resized copies with all EXIF removed. The original files never leave the computer. You can then look at each draft's photos yourself and suggest a place name. The user confirms, edits and shares the cards on the Pinmo website; the CLI cannot confirm, publish, share or delete anything.

This skill does not use the `pinmo` MCP server. It runs the CLI through the shell.

## 0. Find the CLI

Run `pinmo --help`. If that command is not found, and the environment variable `PINMO_CLI` is set, use `node "$PINMO_CLI"` in place of `pinmo` everywhere below (it points to the built `pinmo.mjs`). The help text ends with the same five steps as this skill.

If neither works, stop. Tell the user that the Pinmo CLI is not installed on this computer and that it is not publicly distributed yet, and suggest the website's own batch import on https://pinmo.me instead. Do not try to upload the photos another way, and do not write your own uploader.

The CLI needs Node 22 or later. Every command takes `--origin <url>`; leave it out (the default is `https://pinmo.me`) unless the user names another Pinmo site.

## 1. Check the folder and tell the user what will happen

- Only `.jpg` / `.jpeg` files directly in the folder are imported (no subfolders). Other files, including HEIC, are skipped and counted; the user can export HEIC as JPEG first. At most 200 JPEGs per import; for more, ask the user to split the folder.
- Decide whether to pass `--agent-fills`:
  - **With `--agent-fills`** (the usual case when the user wants you to name the places): Pinmo does not run its own model on this import, and you look at the photos instead. Say this means the photos are seen by you, the assistant, and the company that runs you.
  - **Without it**: Pinmo fills places and tags with its own model as it does for imports from the website. Skip steps 4 and 5 below.

## 2. Log in (once per computer)

Run `pinmo login`. It prints an address and opens the browser. The user signs in to Pinmo there and clicks **Allow** on the page that asks to let Pinmo CLI import photos. The command waits up to five minutes and prints `Logged in to <site>.` On a machine without a browser (for example over SSH), run `pinmo login --no-browser` and give the user the printed address.

Skip this step if a later command works without it. If any command prints `Run pinmo login again`, run this step again and then retry that command.

## 3. Import

Run `pinmo import "<folder>" --agent-fills` (or without the flag, as decided in step 1). On success it prints:

```
Import: <import-id>
Uploaded: <n>
Skipped: <n> not JPEG (export HEIC as JPEG first), <n> already saved, <n> failed
Cards: <n> (<n> need a place, <n> need a time)
Review and confirm: https://pinmo.me/imports/<import-id>
```

Keep the import ID. Photos that are already in one of the user's records count as "already saved" and are not uploaded again; running the same command again only uploads what is still missing.

If it stops instead:

| Message | What to do |
| --- | --- |
| `An import is still open on the web…` | Ask the user to finish or leave the open import on the website, then run the command again. |
| `More than 200 JPEGs…` | Ask the user to split the folder. |
| `No JPEG in that folder…` | Check the path; HEIC needs exporting as JPEG first. |
| `Run pinmo login again` | Do step 2, then run the command again. |
| `The import could not be opened (quota_exceeded)` or another code | Report the code to the user. Do not loop. |

## 4. Look at each draft

Run `pinmo drafts <import-id> "<folder>"`. Each draft is one line `<draft-id>  needs a place | needs a time | ready`, followed by the paths of its photos in the folder. Open the photos listed under each draft that needs a place, and only those.

## 5. Suggest places you recognize

For a draft whose place you can name with confidence (a readable shop sign, a menu with the name, a well-known landmark), run:

```
pinmo suggest <draft-id> --place "<place name>" [--tag <tag>]...
```

- Use the name as written on the sign, 1 to 100 characters. Pinmo looks for a place with that name within 5 km of the photos' GPS.
- Up to three `--tag` values, each a built-in key such as `restaurant`, `cafe`, `bar`, `bakery`, `dessert`, `noodles`, `pizza`, `park`, `beach`, `viewpoint`, `museum`, `gallery`, `landmark`, `temple`, `hotel`, `mall`, `market`, `bookstore`, `train_station`. Other words are rejected; leave tags out if unsure.
- The answer is one of:
  - `Prefilled the place for <id>…`: Pinmo found the place; it shows on the draft for the user to confirm.
  - `Kept "<name>" as a hint…`: no nearby place had that name; the user sees your name as a hint and picks the place.
  - `<id> already has a place…`: nothing changed.
- Skip a draft when you are guessing: no readable name, only GPS, a blurry or generic street. Never invent a place. Skipped drafts are the ones the user needs to hear about.

## 6. Report to the user

Run `pinmo status <import-id>` for the final counts. Then tell the user, briefly:

- how many photos were uploaded and how many cards were made;
- which places you filled in, and which drafts you could not name, described by their file names and times so the user can find them;
- that the cards are drafts until they confirm them, with the review address from the output.

Do not say the records are saved or shared: the user does that on the website.

## Rules

- Never print, read aloud or copy the CLI's credentials file (`~/.config/pinmo/credentials.json`). The CLI never prints tokens; neither should you.
- Do not move, rename, edit or delete the user's photos.
- Exit codes: `0` done, `1` failed (the reason is on stderr), `2` usage error. On `1`, report the reason; do not retry more than once.
- The CLI already waits and retries when Pinmo says it is busy. If it still fails, tell the user to try again later.
- To remove this computer's access, run `pinmo logout`, or revoke "Pinmo CLI" on https://pinmo.me under the avatar menu → Data and account.
