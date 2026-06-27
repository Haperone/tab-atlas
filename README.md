# Tab Atlas

**Keep tabs on your tabs.**

Tab Atlas replaces your Chrome new‑tab page with a calm dashboard of everything you have open — grouped by domain, searchable, themeable, organised into folders, and restorable as saved workspaces. No server, no account, no external requests. Everything lives on your machine.

---

## Features

**See & manage open tabs**
- Open tabs **grouped by domain**, with homepages (Gmail, X, YouTube, GitHub, LinkedIn…) pulled into their own card
- **Click any tab to jump to it** across windows — no new tab opened
- **Multi‑select open tabs** — `Ctrl/⌘`‑click to pick tabs, `Shift`‑click for a range, or drag across chips; then close, save, or file them into a folder in bulk
- **Focus Sweep** — review selected tabs (or all open tabs) one by one with keyboard actions to keep, save, close or jump
- **Native Chrome tab groups dock** — see open tab groups next to your folders, collapse/expand them, rename, recolour, or save a live group into a folder
- **Duplicate detection** flags repeated pages, with one‑click cleanup
- **Close with style** — swoosh sound + confetti burst
- **Pinned‑tab protection** — “Close all” asks before touching pinned tabs (with Undo)
- **Local favicons** via Chrome’s built‑in cache — works offline, for intranet sites, and sends nothing to any third party

**Save & organise**
- **Save for later** — stash tabs into an inbox before closing them, with archive support for dismissed items
- **Bulk actions for saved tabs** — `Ctrl/⌘`, `Shift`, or drag-select saved items, then right-click the selection to open, move, or remove them together
- **Folders** — create, rename, recolour, collapse, reorder and delete folders
- **Folder ↔ tab group conversion** — open a saved folder as a named Chrome tab group, or save an open Chrome tab group back into a folder
- **Workspace states** — save the current browser workspace, rename/delete saved states, and restore windows, tabs, pinned tabs and tab groups later
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
- **Speed dial** — an editable grid of site shortcuts under the header (open in the current tab, or a new tab with `Ctrl/⌘`); show or hide the whole strip with the grid button in the top‑right corner

**Private by design**
- **100% local** — saved tabs, folders and workspace states in `chrome.storage.local`; theme and speed dial settings in `localStorage`
- **No server, no Node.js, no npm, no external API calls** — just load the extension

---

## Install (Load unpacked)

```bash
git clone https://github.com/Haperone/tab-atlas.git
```

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top‑right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder inside the cloned repo
5. Open a new tab — you’ll see Tab Atlas

> It runs as long as the folder stays on disk and Developer mode is on. Moving/renaming the folder changes the extension ID and resets local data.

To update: `git pull`, then hit **Reload** on the extension card in `chrome://extensions`.

---

## Tech stack

| What | How |
|------|-----|
| Extension | Chrome Manifest V3 |
| Permissions | `tabs`, `storage`, `favicon`, `tabGroups` |
| Storage | `chrome.storage.local` (saved tabs, folders, workspaces) · `localStorage` (theme, shortcuts) |
| Favicons | Chrome `_favicon` (local, offline‑friendly) |
| Theming | CSS custom properties via `[data-theme]` |
| Sound | Web Audio API (synthesized, no files) |
| Animations | CSS transitions + JS confetti |

---

## License & credits

MIT — see [`LICENSE`](LICENSE).

Tab Atlas is based on the original **[Tab Out](https://github.com/zarazhangrui/tab-out)** by **Zara Zhang** (MIT). This is a personal fork with folders, search, themes, drag‑and‑drop, undo, privacy mode, workspace states, native tab group workflows and more.
