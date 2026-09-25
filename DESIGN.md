# Panalo design system

How the interface is put together, and where to change it. For what the app
can't do, see `LIMITATIONS.md`.

## Files

| File | What's in it |
| --- | --- |
| `css/tokens.css` | Every colour, radius, shadow, duration and font. Light and dark themes. Density, bubble shape, text size and reduced-motion switches. |
| `css/base.css` | Reset, type, buttons, fields, switches, chips, avatars, toasts, alert banners, connection pill, ambient layers. |
| `css/public.css` | Boot splash, landing page, sign-in / sign-up. |
| `css/shell.css` | App layout: rail / bottom tab bar, chat list, Home, wallpapers, chat-info drawer, focus mode, breakpoints. |
| `css/chat.css` | Chat header, messages, media, reactions, menus, composer, emoji and sticker panels. |
| `css/overlays.css` | Dialogs (bottom sheets on phones), Settings, confirmations, tour, calls, image viewer. |

No build step: the files load in that order from `index.html`.

## Rules

- **Components ask for roles, never colours.** `--surface`, `--text-2`,
  `--primary-soft`, `--border`… A hard-coded colour in a component is a bug:
  it will be wrong in one of the two themes.
- **Accent = three variables.** `--primary`, `--primary-strong`,
  `--on-primary`. Every other accent shade (`--primary-soft`, `--primary-text`,
  `--grad`, `--bubble-out`…) is derived with `color-mix` in `tokens.css`, on
  `:root`, `.chat-main` and `.accent-scope` — because a custom property's
  `var()` resolves where it is declared, a per-chat accent set on `.chat-main`
  needs the derived shades re-declared there too.
- **Accents meet WCAG AA with white text.** `tests/appearance.test.mjs` checks
  every preset in `src/config.js`. Accent-coloured *text* uses
  `--primary-text`, which is darkened in light mode and lightened in dark mode.
- **Accent ids are a contract.** `conversations.theme` stores them; never
  rename or remove one (`default`, `sunset`, `ocean`, `forest`, `rose`,
  `slate` exist in real chats). Adding one is safe — older clients fall back
  to the app accent.
- **Motion clarifies, never decorates.** Durations are `--dur-1..3`; the OS
  reduced-motion setting or Settings → Reduce motion zero them app-wide.

## Appearance settings

Stored per device in `localStorage["panalo.settings"]`.

- `src/appearance-core.js` — pure rules: defaults, validation, migration of old
  keys (`ogSkin` → dark + Grape, `animatedBg:false` → effect none), theme
  resolution, and the attributes put on `<html>`. Unit-tested.
- `src/appearance.js` — applies them: attributes, the accent, `theme-color`,
  and following the OS when the theme is Auto.
- `src/boot.js` — a tiny classic script in `<head>` that applies the saved
  theme and accent **before first paint** (no flash of the wrong theme), and
  shows a splash instead of the landing page when a session is stored. It is
  an external file because the CSP forbids inline scripts.
- `src/fonts.js` — personalisation fonts load only when chosen or previewed;
  only Inter and Bricolage Grotesque load up front.

| Setting | Attribute on `<html>` |
| --- | --- |
| Theme: Auto / Light / Dark | `data-theme="light\|dark"` |
| Bubbles: Bubbly / Soft / Crisp | `data-bubbles` (absent = Bubbly) |
| Text size: Small / Default / Large | `data-text` (absent = Default) |
| Compact list | `data-density="compact"` |
| Reduce motion | `data-motion="reduce"` |

## Public pages and routing

`#login` and `#signup` show the auth screen; anything else shows the landing
page. `src/public.js` owns what is on screen; `src/auth.js` still owns every
Supabase auth call and hands over with `enterApp()` / `leaveApp()` /
`showPublic()`. Works on any static host (Cloudflare Pages today, the custom
domain later) with no server routing.

## Accessibility

`src/a11y.js` watches for dialogs opening and closing and, for the top one:
moves focus in, traps Tab, restores focus on close, and maps Escape to the
button named by the dialog's `data-dismiss`. Dialogs marked `data-persistent`
are never closed by Escape, and a hidden dismiss button is never pressed —
that is what keeps the app-lock PIN prompt a lock. With no dialog open,
Escape closes the innermost menu, panel, drawer or reply, in that order.

## Checking your work

```sh
for t in tests/*.mjs; do node "$t"; done   # unit + migration tests
node tools/qa/smoke.mjs                     # browser smoke test (see tools/qa/README.md)
```
