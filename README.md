# Tab Out

**Keep tabs on your tabs.**

Tab Out replaces your Chrome new‑tab page with a calm dashboard of everything you have open — grouped by domain, searchable, themeable, and organised into folders. No server, no account, no external requests. Everything lives on your machine.

---

## Features

**See & manage open tabs**
- Open tabs **grouped by domain**, with homepages (Gmail, X, YouTube, GitHub, LinkedIn…) pulled into their own card
- **Click any tab to jump to it** across windows — no new tab opened
- **Duplicate detection** flags repeated pages, with one‑click cleanup
- **Close with style** — swoosh sound + confetti burst
- **Pinned‑tab protection** — “Close all” asks before touching pinned tabs (with Undo)
- **Local favicons** via Chrome’s built‑in cache — works offline, for intranet sites, and sends nothing to any third party

**Save & organise**
- **Save for later** — stash tabs into an inbox before closing them
- **Folders** — create, rename, recolour, collapse, reorder and delete folders
- **Drag & drop** — drop open tabs or saved tabs into folders / the inbox; reorder folders by a grip handle
- **Right‑click menus** for moving, opening and removing items

**Find & focus**
- **One search bar** over open tabs, the inbox and folders — press `/` to focus it
- Search **operators**: `domain:github`, `url:docs`, plus free text
- **Undo** for destructive actions (closing tabs, removing saved items, deleting folders)
- **Privacy mode** — a full‑screen clock hides the dashboard for screen‑sharing (toggle with `Esc`)
- **Auto‑refresh** — the dashboard stays in sync as tabs open/close/navigate

**Make it yours**
- **11 themes** (9 dark + 2 light) — Default, Graphite, Solarized, Dracula, Tokyo Night, Gruvbox, Catppuccin Mocha, Monokai, Obsidian, Paper, Catppuccin Latte — picked from the top‑right palette and remembered across sessions

**Private by design**
- **100% local** — saved tabs/folders in `chrome.storage.local`, theme in `localStorage`
- **No server, no Node.js, no npm, no external API calls** — just load the extension

---

## Install (Load unpacked)

```bash
git clone https://github.com/Haperone/tab-out.git
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top‑right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder inside the cloned repo
5. Open a new tab — you’ll see Tab Out

> It runs as long as the folder stays on disk and Developer mode is on. Moving/renaming the folder changes the extension ID and resets local data.

To update: `git pull`, then hit **Reload** on the extension card in `chrome://extensions`.

---

## Tech stack

| What | How |
|------|-----|
| Extension | Chrome Manifest V3 |
| Permissions | `tabs`, `activeTab`, `storage`, `favicon` |
| Storage | `chrome.storage.local` (data) · `localStorage` (theme) |
| Favicons | Chrome `_favicon` (local, offline‑friendly) |
| Theming | CSS custom properties via `[data-theme]` |
| Sound | Web Audio API (synthesized, no files) |
| Animations | CSS transitions + JS confetti |

---

## License & credits

MIT — see [`LICENSE`](LICENSE).

Tab Out is based on the original **[Tab Out](https://github.com/zarazhangrui/tab-out)** by **Zara Zhang** (MIT). This is a personal fork with folders, search, themes, drag‑and‑drop, undo, privacy mode and more.
