# Chrome Web Store Listing — Tab Atlas

> Last Updated: 2026-07-13

## Store Listing

**Extension Name:** Tab Atlas

**Short Description:** A calm new-tab dashboard that groups open tabs by domain and helps you search, save, organize, and restore them.

**Detailed Description**

Tab Atlas replaces Chrome's new-tab page with a clear dashboard of your open tabs, grouped by domain.

See tabs across windows, search by title or URL, spot duplicates, close clutter, save pages for later, restore links from a searchable archive, organize saved pages into folders, and capture whole workspaces for later restoration. Independent columns stay aligned while you scroll and release naturally when you reach an edge. Focus Sweep helps you review many tabs as one deliberate batch. Themes, privacy mode, and editable shortcuts let the dashboard fit your workflow.

Install the extension, open a new tab, and use the dashboard to jump to, save, group, or close tabs. The toolbar icon returns you to an existing Tab Atlas page or opens one when needed.

All tab information, saved pages, folders, workspaces, themes, and shortcuts stay on your device. Tab Atlas has no account, analytics, advertising, server, or automatic third-party requests.

Support and source: https://github.com/Haperone/tab-atlas

**Category:** Productivity

**Single Purpose:** Organize and manage the user's open Chrome tabs from the new-tab page.

**Primary Language:** English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------:|--------|----------|
| Store Icon | 128×128 PNG | ✅ Ready | `extension/icons/icon128.png` |
| Screenshot 1 | 1280×800 or 640×400 | ⬜ Not created | Dashboard overview |
| Screenshot 2 | 1280×800 or 640×400 | ⬜ Not created | Saved tabs and folders |
| Screenshot 3 | 1280×800 or 640×400 | ⬜ Not created | Focus Sweep and workspace drawer |
| Small Promo Tile | 440×280 | ⬜ Not created | |

### Screenshot Notes

Use real extension UI with representative, non-sensitive example tabs. Show domain grouping and search first, saved tabs/folders second, and Focus Sweep or workspace restoration third. Refresh screenshots after any material UI change.

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
   cropped to size. Pick the theme that reads best (Paper light tends to photograph cleanly).
4. Capture, in order:
   - **Screenshot 1 — Dashboard overview:** domain cards grid + the search row (type into `/` search to show filtering).
   - **Screenshot 2 — Saved tabs & folders:** the right-hand Saved-for-later column and Folders column with a few items.
   - **Screenshot 3 — Focus Sweep / workspaces:** trigger Sweep (or open the workspace drawer) to show batch triage.
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

**Host permissions:** None.

## Privacy & Data Use

**Does the extension collect user data?** No. It processes current tab information locally to provide its features, but does not transmit or make that information available to the developer or any third party.

The extension may store URLs, page titles, folder names, workspace layouts, and user preferences locally when the user uses save, folder, workspace, theme, or shortcut features. `chrome.storage.local` and `localStorage` remain on the user's device. There is no analytics, telemetry, advertising, account, cookie, remote API, or automatic external resource request.

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
Last updated: July 13, 2026

Tab Atlas does not collect, transmit, sell, or share personal data or browsing information. It processes open-tab information locally to provide tab organization features. URLs, titles, saved tabs, folders, workspace snapshots, themes, and shortcuts are stored only on the user's device when relevant features are used.

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
| 1.0.0 | 2026-07-12 | Initial store draft with the saved-links archive, one-click restoration, Undo, and aligned independent column scrolling. | Draft |

## Review Notes

- Manifest V3; packaged JavaScript only; no remotely hosted code.
- New-tab override: `index.html`.
- Background service worker: `background.js` as an ES module.
- No content scripts, host permissions, external network services, analytics, telemetry, or ads.
- The two GitHub links in the dashboard are user-clicked credits and are not requested automatically.
- The extension package itself has no build step or runtime dependencies.

### Submission Blockers

- [x] **Privacy-policy URL** — page written at [`docs/privacy-policy.html`](docs/privacy-policy.html);
      URL wired above. Remaining action: flip on GitHub Pages (Settings → Pages → `main` / `/docs`)
      and confirm the URL loads.
- [x] **Version** — `1.0.0`. No git tags / prior uploads exist, so nothing higher is published. Keep
      this greater than any version already uploaded before each future submission.
- [x] **Publisher name and contact email** — filled in "Developer Info" (Publisher: Haperone,
      Contact: nsvyatogo26@gmail.com). Remaining action: enter them in the Developer Dashboard and
      **verify the email** there (verification can only happen in your account, not in the repo).
- [ ] **At least one 1280×800 or 640×400 screenshot** — a seeded demo harness that renders the real
      dashboard UI is at [`tools/screenshot-harness.html`](tools/screenshot-harness.html); open it and
      capture. See "Screenshot capture procedure" below.
