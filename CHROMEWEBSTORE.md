# Chrome Web Store Listing — Tab Atlas

> Last Updated: 2026-09-30

## Store Listing

**Extension Name:** Tab Atlas

**Short Description:** A calm new-tab dashboard that groups open tabs by domain and helps you search, save, organize, and restore them.

**Detailed Description**

Tab Atlas replaces Chrome's new-tab page with a clear dashboard of your open tabs, grouped by domain.

See tabs across windows, search by title or URL, spot duplicates, close clutter, save pages for later, restore links from a searchable archive, organize saved pages into folders, and capture whole workspaces for later restoration. Lock any folder from its menu to protect its saved links from accidental removal, archiving or being moved out, while still allowing new links to be added. Select several open or saved tabs with modifier clicks, then drag the selected group into a folder or handle it with bulk actions. Independent columns stay aligned while you scroll and release naturally when you reach an edge. Focus Sweep presents tabs as a calm card deck: swipe left to close, up to save, or right to keep, then review the batch before applying it. Choose from 16 local themes, including animated, minimalist dark, soft-grey, warm cream and three polished Apple-inspired material styles, then save one light and one dark favourite as a quick-switch pair. Privacy mode and editable shortcuts let the dashboard fit your workflow.

Install the extension, open a new tab, and use the dashboard to jump to, save, group, or close tabs. On a website, click the toolbar icon to save the current page directly into a folder, search folders, or create one. You can also right-click a page and choose Save page to Tab Atlas. Your tab stays open, repeated saves reuse the existing page, and Undo remains available when you reopen the popup. The popup follows your chosen theme and includes a shortcut to the dashboard.

All tab information, saved pages, folders, workspaces, themes, and shortcuts stay on your device during normal use. Tab Atlas has no account, analytics, advertising, server-side tab storage, or automatic third-party requests. Folder sharing is initiated explicitly by the user and creates an encrypted bearer link.

Support and source: https://github.com/Haperone/tab-atlas

**Category:** Productivity

**Single Purpose:** Organize and manage the user's open Chrome tabs from the new-tab page.

**Primary Language:** English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------:|--------|----------|
| Store Icon | 128×128 PNG | ✅ Ready | `extension/icons/icon128.png` |
| Screenshot 1 | 1280×800 or 640×400 | ✅ Existing in listing | Managed in Developer Dashboard |
| Screenshot 2 | 1280×800 or 640×400 | ✅ Existing in listing | Managed in Developer Dashboard |
| Screenshot 3 | 1280×800 or 640×400 | ✅ Existing in listing | Managed in Developer Dashboard |
| Small Promo Tile | 440×280 | Optional for this update | Managed in Developer Dashboard |

### Screenshot Notes

Use real extension UI with representative, non-sensitive example tabs. Show domain grouping and search first, saved tabs/folders second, and the Focus Sweep card deck or workspace restoration third. Screenshot 3 must be refreshed for the card-deck redesign. Add or refresh a screenshot showing the themed quick-save popup and the page context menu before publishing the quick-save update.

### Screenshot capture procedure

**Option A — seeded demo harness (fastest, no live tabs needed).** `tools/screenshot-harness.html`
renders the *real* dashboard (`extension/app.js` + `extension/style.css`) against a mocked `chrome.*`
API with representative example data, so you don't have to load the extension or arrange tabs:

1. From the repo root run `node tools/serve.mjs` (serves at `http://localhost:8232`).
2. Open `http://localhost:8232/tools/screenshot-harness.html` in Chrome.
3. Force a **1280×800** viewport (DevTools device toolbar → Responsive → set 1280×800) and screenshot.
4. To vary the shots, tweak the `SEED_TABS` / `SEED_STORE` data at the top of the harness, or open the
   Sweep / workspace UI before capturing. Save PNGs into `extension/store-assets/`.

**Option B — the real loaded extension (most authentic).** Capture once, in Chrome:

1. Load the unpacked extension: `chrome://extensions` → Developer mode → **Load unpacked** → select the `extension/` folder.
2. Open ~12–15 representative, non-sensitive tabs across several domains (e.g. GitHub, YouTube,
   a couple of docs sites, Gmail/X homepages) so domain grouping and the Homepages card are populated.
   Save 3–4 pages for later and create a folder or two so the side rail is non-empty.
3. Set the browser window to a clean size and use a **1280×800** capture region (or 640×400).
   Chrome DevTools device toolbar can force an exact 1280×800 viewport; or use any OS screenshot tool
   cropped to size. Pearl Glass photographs cleanly; Aurora Glass is the stronger visual showcase.
4. Capture, in order:
   - **Screenshot 1 — Dashboard overview:** domain cards grid + the search row (type into `/` search to show filtering).
   - **Screenshot 2 — Saved tabs & folders:** the right-hand Saved-for-later column and Folders column with a few items.
   - **Screenshot 3 — Focus Sweep / workspaces:** trigger Sweep to show the swipeable three-card deck and review controls (or open the workspace drawer).
5. Save as PNG, drop into `extension/store-assets/` (or attach directly in the dashboard), and flip the
   table rows above to ✅.

Optional promo tile (440×280): a cropped dashboard hero with the "Tab Atlas" name overlaid.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `tabs` | permissions | Shows the user's open tabs in the new-tab dashboard and lets the user focus, close, pin, group, save, and restore selected tabs and windows. |
| `storage` | permissions | Stores saved tabs, folders, workspace snapshots, and related extension state locally on the user's device. |
| `favicon` | permissions | Displays site icons from Chrome's local favicon cache without contacting the sites or a third-party icon service. |
| `tabGroups` | permissions | Shows existing Chrome tab groups and lets the user rename, recolor, collapse, save, and recreate groups. |
| `contextMenus` | permissions | Adds a user-invoked Save page to Tab Atlas submenu on websites, with destinations matching the user's locally saved folders. It saves the selected page title and URL locally. |
| `activeTab` | permissions | Grants temporary access when the user invokes the toolbar popup or page context menu, only to show save-result feedback on that tab. No persistent access to websites is requested. |
| `scripting` | permissions | Injects a packaged, temporary save-result notification after the user confirms a popup save or invokes the page context menu. It does not extract website content, alter the site's application, or make network requests. |
| `offscreen` | permissions | Plays brief locally packaged sounds after a successful save or Undo, even when the toolbar popup closes. Respects the user's Sound setting and makes no network requests. |

**Host permissions:** None.

Choose a folder in the popup and confirm to save and close it. Successful saves
from either entry point show a small green confirmation rising from the bottom
center, accompanied by a short sound when Sound is enabled. The notification uses
the selected theme and respects reduced motion. Undo also has a brief sound,
including in Focus Sweep, and the popup has a single surface. Restricted pages retain toolbar
feedback and the persisted save result. The native toolbar popup keeps its
360px width rather than shrinking with its initial viewport.

## Privacy & Data Use

**Does the extension collect user data?** No. It processes current tab information locally and does not transmit it to the developer or any third party. If a user explicitly creates and sends a folder-share link, that user has chosen to share its encrypted URL with the recipient.

The extension may store URLs, page titles, folder names, workspace layouts, and user preferences locally when the user uses save, folder, workspace, theme, or shortcut features. The latest quick-save result and one Undo record are stored locally so recovery survives closing the popup. `chrome.storage.local` and `localStorage` remain on the user's device. Folder shares carry a compressed encrypted copy in the user-copied URL fragment; Tab Atlas does not upload or retain that copy. There is no analytics, telemetry, advertising, account, cookie, remote API, or automatic external resource request.

### Data Use Certification

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

### Retention and User Control

Locally saved data remains until the user removes it, clears extension data, or uninstalls the extension. Saved items and archive entries can be deleted in the UI. Backup export and import are initiated explicitly by the user and use local files.

## Privacy Policy

**Privacy Policy URL:** https://haperone.github.io/tab-atlas/privacy-policy.html

> Published from [`docs/privacy-policy.html`](docs/privacy-policy.html). Enable GitHub Pages
> once (repo **Settings → Pages → Source: Deploy from a branch → `main` / `/docs`**) and this
> URL goes live. The page is self-contained and makes no external requests. The copy below is
> the source of truth for that page — keep them in sync.

### Publishable Privacy Policy Copy

**Privacy Policy for Tab Atlas**
Last updated: August 15, 2026

Tab Atlas does not collect, transmit, sell, or share personal data or browsing information. It processes open-tab information locally to provide tab organization features. URLs, titles, saved tabs, folders, workspace snapshots, themes, and shortcuts are stored only on the user's device when relevant features are used.

Folder sharing is an explicit user action. The link contains an encrypted copy of this folder. Anyone who has the complete link can decrypt, view, and import it. Encryption prevents casual reading and detects changes; it does not restrict recipients and does not provide revocation, expiry, or server-side access control. The extension does not upload or store shared-folder data on a server.

Tab Atlas does not use analytics, advertising, cookies, accounts, remote APIs, or third-party services. Users can remove saved data in the extension, clear the extension's local storage, or uninstall the extension. Backup files are exported and imported only at the user's explicit request.

Questions about privacy can be submitted through the project's public issue tracker: https://github.com/Haperone/tab-atlas/issues

## Distribution

**Visibility:** Public
**Regions:** All regions

## Developer Info

> These two fields are entered (and the email **verified**) in the Chrome Web Store
> Developer Dashboard — **Account settings** for the publisher identity, and the item's
> listing for the shown contact. The values below are the repo's source of truth; copy
> them into the dashboard. Change the email if you prefer a different public contact.

**Publisher Name:** Haperone
**Contact Email:** nsvyatogo26@gmail.com
**Support URL:** https://github.com/Haperone/tab-atlas/issues
**Homepage URL:** https://github.com/Haperone/tab-atlas

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.2.0 | 2026-09-30 | Added a themed toolbar popup with explicit destination confirmation and a Save page to Tab Atlas page context menu. Saves keep the page open and show a compact green bottom-center receipt with a paused-on-hover countdown, matching Undo arrow and local save/Undo sounds. Added contextMenus, activeTab, scripting and offscreen permissions. Improved drag scrolling, keyboard organization, loading/error recovery, full share/import previews, partial-operation handling and retryable Undo that restores tab windows, positions and native groups. Polished all 16 themes while retaining their distinct materials and minimalist controls. | Package prepared locally; not uploaded |
| 1.1.0 | 2026-08-15 | Added three distinct Apple-inspired material themes: Space Black, Pacific Blue and Orchid Bloom; retired Silver Studio and safely migrated saved Apple-theme choices to supported replacements. Added folder locks that protect saved and archived links from destructive actions and moves out, while allowing new links in, plus accessible clear buttons for search, naming and shortcut fields. Added explicit encrypted folder sharing with local preview, recipient confirmation and no server-side storage, including a clearer status when tracking parameters are removed, local unpacked-build detection during development and a reliable Chrome Web Store install link. | Ready to upload |
| 1.0.1 | 2026-07-18 | Added Aurora Glass, Smoke Glass, Pearl Glass and warm Paper Glass; retired the regular Paper and Catppuccin Latte themes, leaving 13 themes. Redesigned Focus Sweep as an animated three-card deck with swipe, keyboard and button controls, a safe review summary, folder-aware saving and an optional Instant mode. Glass search fields now use the same restrained focus ring as the regular themes. The guided tour also uses separate animated steps for modifier-click selection and dragging a selected group from Saved for later into a folder, including a grab cursor and group ghost. | Ready to upload |
| 1.0.0 | 2026-07-12 | Initial store draft with the saved-links archive, one-click restoration, Undo, and aligned independent column scrolling. | Draft |

## Release Package

Built from the current `extension/` sources for version 1.2.0. Previous release ZIPs are retained. The package is prepared locally; uploading and publishing remain manual actions in the publisher's account.

- **Upload file:** `release/tab-atlas-1.2.0-chrome-web-store.zip`
- **Package size:** 224,970 bytes
- **Runtime files:** 53
- **SHA-256:** `c177bf39bd2b2c4dd4e52b5496e7bd28ee854857a1666de452f9c371b0169b12`
- **Package verification:** `release/tab-atlas-1.2.0-package-report.json` records size, SHA-256, every file hash and dependency checks.
- **Validated:** `manifest.json` is at the ZIP root; package contains no tests, repository metadata,
  development dependencies, source maps, store assets, or store documentation.

## Review Notes

- Manifest V3; packaged JavaScript only; no remotely hosted code.
- New-tab override: `index.html`.
- Background service worker: `background.js` as an ES module.
- No automatic content scripts or persistent host permissions, external network services, analytics, telemetry, or ads. A packaged notification is injected only after the user saves from the context menu or confirms a popup save and removes itself afterward.
- External messaging is limited to `https://tab-atlas.pages.dev/*` and accepts only the folder-share ping and explicit import handoff envelopes.
- The two GitHub links in the dashboard are user-clicked credits and are not requested automatically.
- The extension package itself has no build step or runtime dependencies.

### Submission Blockers

- [x] **Privacy-policy URL** — page written at [`docs/privacy-policy.html`](docs/privacy-policy.html);
      the public URL returned HTTP 200 and was verified on 2026-08-15.
- [x] **Version** — `1.2.0`, greater than the previous local release 1.1.0. Keep this greater than any version already uploaded before each future
      submission.
- [x] **Publisher name and contact email** — filled in "Developer Info" (Publisher: Haperone,
      Contact: nsvyatogo26@gmail.com). Remaining action: enter them in the Developer Dashboard and
      **verify the email** there (verification can only happen in your account, not in the repo).
- [x] **Store listing assets** — the existing screenshots and listing will be retained for this update,
      as confirmed by the publisher on 2026-08-15. The demo harness remains available for future refreshes.
