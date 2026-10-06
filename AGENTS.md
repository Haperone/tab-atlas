# AGENTS.md -- Tab Atlas: Setup & Onboarding Guide for Coding Agents

## Project design preference

- Keep the interface minimalist in all future changes. The dashboard should prioritize tab content and leave secondary controls hidden until requested.
- Put filters, sorting and view settings behind the small edge arrow beside Open tabs. Keep this panel collapsed by default, retain a subtle active-state indicator, and avoid adding permanent toolbars or redundant status rows.
- Preserve the user's chosen themes and existing interaction patterns; motion should be restrained, interruptible and respect reduced-motion preferences.
- Every theme must remain internally consistent: reuse its semantic colors, surface materials, radius and shadow direction. Glass stays translucent, Soft stays tactile, and the solid Apple themes stay opaque. Never apply one universal visual treatment across these families.
- Project-local interface skills from jakubkrehel/skills live in `.agents/skills/better-*`; use them for relevant UI work while honoring these project preferences.

## Mobile PWA and optional synchronization

- The approved requirements are in `docs/mobile-sync-spec.md`. The local skill catalog, pinned sources and application boundaries are in `docs/mobile-sync-skills.md`.
- For mobile interface work, combine `mobile-native` with the existing `better-*` skills and the project's theme rules. For PWA behavior, consult `pwa-development`; for browser verification, consult the relevant `playwright-best-practices` references.
- Supabase and Cloudflare remain provider candidates. Their skills do not authorize provisioning, authentication, deployment, paid plans, framework changes, package installation or Git actions. Follow the user's current scope and existing project patterns.
- PWA snippets are references, not the synchronization design: preserve durable outbox/ack behavior, owner-scoped storage, optional E2EE sync and local Time machine. Do not cache private API/auth responses through generic recipes or delete unrelated caches. Activate updates without discarding pending changes.
- Verify evolving installation, Share Target, background execution and storage capabilities against current platform documentation. Never disable zoom; distinguish browser emulation from Android/iOS hardware verification.
- Load only the skills and reference files relevant to the current task. Generic security guidance does not replace design and review of the E2EE protocol, key recovery, or concurrent synchronization.

You're installing **Tab Atlas** for the user. Your job is not just to set it up -- it's to get them excited about using it.

---

## Step 0 -- Introduce the product

Before doing anything technical, tell the user what they're about to get:

> **Tab Atlas** replaces your new tab page with a clean dashboard of everything you have open, grouped by domain.
>
> Here's what makes it great:
> - **See all your open tabs at a glance** grouped by domain on a grid
> - **Homepages group** pulls Gmail, X, LinkedIn, YouTube, GitHub homepages into one card for easy cleanup
> - **Close tabs with style** satisfying swoosh sound + confetti burst
> - **Duplicate detection** flags when you have the same page open twice
> - **Click any tab title to jump to it** even across different Chrome windows
> - **Save for later** bookmark individual tabs to a checklist before closing them
> - **100% local** no server, no accounts, no data sent anywhere
>
> It's just a Chrome extension. Setup takes about 1 minute.

---

## Step 1 -- Clone the repo

```bash
git clone https://github.com/Haperone/tab-atlas.git
cd tab-atlas
```

---

## Step 2 -- Install the Chrome extension

This is the one step that requires manual action from the user. Make it as easy as possible.

**First**, print the full path to the `extension/` folder:
```bash
echo "Extension folder: $(cd extension && pwd)"
```

**Then**, copy the `extension/` folder path to their clipboard:
- macOS: `cd extension && pwd | pbcopy && echo "Path copied to clipboard"`
- Linux: `cd extension && pwd | xclip -selection clipboard 2>/dev/null || echo "Path: $(pwd)"`
- Windows: `cd extension && echo %CD% | clip`

**Then**, open the extensions page:
```bash
open "chrome://extensions"
```

**Then**, walk the user through it step by step:

> I've copied the extension folder path to your clipboard. Now:
>
> 1. You should see Chrome's extensions page. In the **top-right corner**, toggle on **Developer mode** (it's a switch).
> 2. Once Developer mode is on, you'll see a button called **"Load unpacked"** appear in the top-left. Click it.
> 3. A file picker will open. **Press Cmd+Shift+G** (Mac) or **Ctrl+L** (Windows/Linux) to open the "Go to folder" bar, then **paste** the path I copied (Cmd+V / Ctrl+V) and press Enter.
> 4. Click **"Select"** or **"Open"** and the extension will install.
>
> You should see "Tab Atlas" appear in your extensions list.

**Also**, open the file browser directly to the extension folder as a fallback:
- macOS: `open extension/`
- Linux: `xdg-open extension/`
- Windows: `explorer extension\\`

---

## Step 3 -- Show them around

Once the extension is loaded:

> You're all set! Open a **new tab** and you'll see Tab Atlas.
>
> Here's how it works:
> 1. **Your open tabs are grouped by domain** in a grid layout.
> 2. **Homepages** (Gmail inbox, X home, YouTube, etc.) are in their own group at the top.
> 3. **Click any tab title** to jump directly to that tab.
> 4. **Click the X** next to any tab to close just that one (with swoosh + confetti).
> 5. **Click "Close all N tabs"** on a group to close the whole thing.
> 6. **Duplicate tabs** are flagged with an amber "(2x)" badge. Click "Close duplicates" to keep one copy.
> 7. **Save a tab for later** by clicking the bookmark icon before closing it. Saved tabs appear in the sidebar.
>
> That's it! No server to run, no config files. Everything works right away.

---

## Key Facts

- Tab Atlas is a pure Chrome extension. No server, no Node.js, no npm.
- Saved tabs are stored in `chrome.storage.local` (persists across sessions).
- 100% local. No data is sent to any external service.
- To update: `cd tab-atlas && git pull`, then reload the extension in `chrome://extensions`.
