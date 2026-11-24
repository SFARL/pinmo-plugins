---
name: import-folder
description: Help the user turn a folder of photos into draft Pinmo cards with the batch import on pinmo.me. Use when the user asks to import, upload or organize a photo folder into Pinmo or onto their map ("import ~/Pictures/tokyo into Pinmo", "把这个文件夹整理成地图", "把这些照片放进 Pinmo"). Not for questions about places already saved; use recall for those.
---

# Import a photo folder into Pinmo

Photos go into Pinmo through the **Batch import** on the Pinmo website. This plugin does not upload photos itself, and its `pinmo` tools are read-only, so guide the user through the website instead.

## What to tell the user

1. Open https://pinmo.me and sign in.
2. On the upload page, choose **Batch import** next to the message box, then select the photos from the folder. Pinmo reads each photo's capture time and GPS in the browser and uploads resized copies; the original files stay on the computer.
3. Keep the page open while it uploads. Pinmo groups the photos into draft cards and suggests places where it can (unless the user turned auto-organize off).
4. Review the drafts: pick a place for the ones that need one, fix times, then confirm. Nothing is saved or shared until the user confirms it.

Helpful details:
- JPEG photos work in any browser. HEIC photos open only in Safari; in other browsers, export them as JPEG first.
- One import holds up to 200 photos; for more, import the rest next time.
- Photos already in one of the user's records are skipped.

## Rules

- Do not try to upload the photos another way, and do not write your own uploader or script.
- Do not say the photos are imported or saved: the user does that on the website.
- After the user has confirmed the cards, the recall skill can answer questions about them.
