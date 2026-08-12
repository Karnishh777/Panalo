# Your own stickers

Drop image files in here and they show up in the app's sticker picker,
alongside the built-in vector cards.

## How to add stickers

1. **Make a folder for each category** (the folder name becomes the tab label):

   ```
   stickers/
     Friends/     → a "Friends" tab
     Fun/         → a "Fun" tab
     Anime/       → an "Anime" tab
   ```

   Files placed loose in `stickers/` (not in a folder) land in a tab called "Mine".

2. **Add images.** Supported: `.webp`, `.png`, `.gif`, `.svg`, `.jpg`.
   The file name becomes the sticker's name — `good-morning.webp` shows as
   "Good morning".

3. **Rebuild the list** so the app knows what's there:

   ```bash
   node tools/build-stickers.mjs
   ```

   That regenerates `stickers/manifest.json`. Run it every time you add or
   remove files. (Static hosting can't list a folder by itself, which is why
   the manifest exists.)

## What makes a good sticker

- **Square-ish**, around **512×512**, with a **transparent background** (PNG or
  WebP). WebP is roughly a third the size of PNG for the same quality.
- **Under ~150 KB each.** These ship with the app, so every sticker is
  downloaded by everyone — a folder of 3 MB photos will slow the app for
  people on slow connections.
- Animated `.gif` works, but keep it small.

## Important: only use art you're allowed to use

These files become part of your published app, so anyone can view them.
Use images you made, images you bought a licence for, or ones under a licence
that permits redistribution (CC0 / CC-BY with attribution). **Don't copy
sticker packs from WhatsApp, Telegram, or an artist's work without
permission** — your app is public and takedowns are a real thing.

Good free sources: **openmoji.org** (CC-BY-SA), **twemoji** (CC-BY 4.0),
**undraw.co** (free licence), or anything you draw yourself.
