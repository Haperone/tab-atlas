# tools/

Local helpers for **publishing** Tab Atlas. Nothing here ships with the extension —
the store ZIP is built only from `extension/`.

## `serve.mjs`

A dependency-free static file server for the repo root.

```bash
node tools/serve.mjs [port]   # default port 8232
```

Then open, for example:
- `http://localhost:8232/tools/screenshot-harness.html` — screenshot harness (below)
- `http://localhost:8232/docs/privacy-policy.html` — preview the published privacy page

## `screenshot-harness.html`

Renders the **real** dashboard — the actual `extension/app.js` and `extension/style.css` —
inside a plain web page by mocking the `chrome.*` APIs the dashboard reads
(`chrome.tabs`, `chrome.storage`, `chrome.windows`, `chrome.tabGroups`) and feeding it
representative seed data. Favicons (normally from Chrome's local `_favicon` cache, which
isn't available outside the extension) are painted as on-brand letter tiles.

**Why:** Chrome Web Store requires at least one 1280×800 (or 640×400) screenshot, and
authentic ones would otherwise need the unpacked extension loaded plus ~15 real tabs
arranged by hand. This harness makes a clean, deterministic capture a one-file affair.

**Capture:**
1. `node tools/serve.mjs`
2. Open `http://localhost:8232/tools/screenshot-harness.html`
3. Force a **1280×800** viewport (DevTools device toolbar → Responsive → 1280×800)
4. Screenshot. To vary shots, edit the `SEED_TABS` / `SEED_STORE` arrays near the top of
   the harness, or open the Sweep / workspace UI before capturing.

Choose a theme deterministically with `?theme=<id>`, for example:

- `http://localhost:8232/tools/screenshot-harness.html?theme=auroraglass`
- `http://localhost:8232/tools/screenshot-harness.html?theme=smokeglass`
- `http://localhost:8232/tools/screenshot-harness.html?theme=pearlglass`
- `http://localhost:8232/tools/screenshot-harness.html?theme=paperglass`

Save PNGs into `extension/store-assets/` and attach them in the Web Store dashboard.

> The harness loads `extension/index.html` via `fetch`, so it only works over `http://`
> (the `serve.mjs` server), not from a `file://` path.
