import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  extensionRoot,
  readPngDimensions,
  readProjectJson,
  readProjectText,
} from './helpers.js';

const manifestPath = 'extension/manifest.json';

test('manifest uses MV3 with the expected entry points', async () => {
  const manifest = await readProjectJson(manifestPath);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.chrome_url_overrides?.newtab, 'index.html');
  assert.equal(manifest.background?.service_worker, 'background.js');
});

test('manifest keeps the minimal declared Chrome permissions', async () => {
  const manifest = await readProjectJson(manifestPath);
  assert.deepEqual(
    [...manifest.permissions].sort(),
    ['favicon', 'storage', 'tabGroups', 'tabs'].sort(),
  );
  assert.equal('host_permissions' in manifest, false);
});

test('manifest declares a toolbar action without a popup', async () => {
  const manifest = await readProjectJson(manifestPath);
  assert.equal(manifest.action?.default_title, 'Tab Atlas');
  assert.equal('default_popup' in manifest.action, false);
});

test('every manifest entry-point file exists', async () => {
  const manifest = await readProjectJson(manifestPath);
  const files = [
    manifest.chrome_url_overrides.newtab,
    manifest.background.service_worker,
    ...Object.values(manifest.action.default_icon),
    ...Object.values(manifest.icons),
  ];
  await Promise.all(files.map(file => access(path.join(extensionRoot, file))));
});

test('manifest PNG icons have their declared dimensions', async () => {
  const manifest = await readProjectJson(manifestPath);
  for (const [size, file] of Object.entries(manifest.icons)) {
    const dimensions = await readPngDimensions(`extension/${file}`);
    assert.deepEqual(dimensions, { width: Number(size), height: Number(size) });
  }
  for (const [size, file] of Object.entries(manifest.action.default_icon)) {
    const dimensions = await readPngDimensions(`extension/${file}`);
    assert.deepEqual(dimensions, { width: Number(size), height: Number(size) });
  }
});

test('extension page uses only external local scripts', async () => {
  const html = await readProjectText('extension/index.html');
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scriptTags.length, 2);
  for (const [, attributes, body] of scriptTags) {
    const source = attributes.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    assert.ok(source, 'every script tag must use src');
    assert.equal(/^https?:/i.test(source), false, 'script src must be packaged');
    assert.equal(body.trim(), '', 'script tags must not contain inline code');
  }
  assert.equal(/\son\w+\s*=/i.test(html), false, 'inline event handlers are forbidden');
});

test('top-right utilities keep Customize consolidated and expose the Bloom mode toggle', async () => {
  const html = await readProjectText('extension/index.html');
  const app = await readProjectText('extension/app.js');
  assert.match(html, /id="customizeToggle"[^>]*data-action="customize-menu"/);
  assert.match(html, /<span>Customize<\/span>/);
  assert.match(html, /id="privacyToggle"/);
  assert.match(html, /id="themeModeToggle"[^>]*data-action="toggle-theme-mode"[^>]*aria-pressed="false"/);
  const bloomMarkup = html.match(/<button class="corner-btn theme-mode-toggle"[\s\S]*?<\/button>/)?.[0] || '';
  assert.match(bloomMarkup, /class="theme-bloom-disc"/);
  assert.match(bloomMarkup, /class="theme-bloom-cutout"/);
  assert.equal((bloomMarkup.match(/class="theme-bloom-ray"/g) || []).length, 8);
  for (const removedId of ['backupToggle', 'onboardingToggle', 'shortcutsToggle', 'themeToggle']) {
    assert.equal(html.includes(`id="${removedId}"`), false, `${removedId} should be consolidated`);
  }
  assert.match(app, /function openCustomizeMenu\(x, y\)/);
  for (const menuEntry of ['Theme pair ·', 'Hide shortcuts', 'Archive cleanup ·', 'Backup & restore…', 'Restart tour']) {
    assert.equal(app.includes(menuEntry), true, `${menuEntry} should remain available from Customize`);
  }
  assert.match(app, /action === 'toggle-theme-mode'/);
});

test('Bloom owns theme-specific tokens in all themes and accessible motion fallbacks', async () => {
  const css = await readProjectText('extension/style.css');
  const themeIds = [
    'default', 'graphite', 'solarized', 'tokyonight', 'mocha', 'monokai',
    'obsidian', 'paper', 'latte', 'papersoft', 'lattesoft',
  ];
  const tokens = [
    'bloom-moon', 'bloom-sun', 'bloom-surface', 'bloom-cutout',
    'bloom-border', 'bloom-shadow', 'bloom-radius',
  ];
  for (const id of themeIds) {
    const block = css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] || '';
    for (const token of tokens) {
      assert.match(block, new RegExp(`--${token}:`), `${id} needs an explicit --${token}`);
    }
  }
  for (const id of ['papersoft', 'lattesoft']) {
    const block = css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] || '';
    assert.match(block, /--bloom-radius:\s*14px/, `${id} Bloom should use the standard rounded-square control shape`);
  }
  assert.match(css, /html\[data-theme-mode="light"\] \.theme-bloom-cutout[\s\S]*?opacity:\s*0/);
  assert.match(css, /html\[data-theme-mode="light"\] \.theme-bloom-ray[\s\S]*?scale:\s*1/);
  assert.match(css, /html\[data-theme="papersoft"\].*html\[data-theme="lattesoft"\][\s\S]*?\.theme-mode-toggle:active[\s\S]*?box-shadow:\s*inset 3px 3px 7px var\(--neu-dark\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.theme-bloom-ray[\s\S]*?transition-duration:\s*0\.01ms !important/);
  assert.match(css, /@media \(forced-colors: active\)[\s\S]*?\.theme-mode-toggle[\s\S]*?forced-color-adjust:\s*none/);
});

test('Bloom celestial states keep non-text contrast in every theme', async () => {
  const css = await readProjectText('extension/style.css');
  const themeIds = [
    'default', 'graphite', 'solarized', 'tokyonight', 'mocha', 'monokai',
    'obsidian', 'paper', 'latte', 'papersoft', 'lattesoft',
  ];
  const luminance = hex => {
    const channels = [1, 3, 5]
      .map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (first, second) => {
    const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };

  for (const id of themeIds) {
    const block = css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] || '';
    const token = name => block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i'))?.[1];
    for (const state of ['bloom-moon', 'bloom-sun']) {
      assert.ok(contrast(token(state), token('bloom-surface')) >= 3, `${id} ${state} needs 3:1 against its control surface`);
    }
  }
});

test('theme text roles meet WCAG AA on page and card surfaces', async () => {
  const css = await readProjectText('extension/style.css');
  const themeIds = [
    'default', 'graphite', 'solarized', 'tokyonight', 'mocha', 'monokai',
    'obsidian', 'paper', 'latte', 'papersoft', 'lattesoft',
  ];
  const roles = ['muted', 'accent-primary', 'accent-success', 'accent-info', 'accent-danger'];
  const luminance = hex => {
    const channels = [1, 3, 5]
      .map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (foreground, background) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };

  for (const id of themeIds) {
    const block = css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] || '';
    const tokens = {};
    for (const match of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) tokens[match[1]] = match[2];
    for (const role of roles) {
      for (const surface of ['bg', 'card-bg']) {
        assert.ok(
          contrast(tokens[role], tokens[surface]) >= 4.5,
          `${id} ${role} must meet AA on ${surface}`,
        );
      }
    }
  }
});

test('theme status decoration is driven entirely by semantic tokens', async () => {
  const css = await readProjectText('extension/style.css');
  const themeIds = [
    'default', 'graphite', 'solarized', 'tokyonight', 'mocha', 'monokai',
    'obsidian', 'paper', 'latte', 'papersoft', 'lattesoft',
  ];
  for (const id of themeIds) {
    const block = css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] || '';
    for (const token of ['status-active-rgb', 'status-cooling-rgb', 'status-abandoned-rgb']) {
      assert.match(block, new RegExp(`--${token}:\\s*\\d+,\\s*\\d+,\\s*\\d+`), `${id} needs ${token}`);
    }
  }
  const activeCard = css.match(/\.mission-card\.has-active-bar\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(activeCard, /rgba\(var\(--status-active-rgb\)/);
  assert.doesNotMatch(activeCard, /rgba\(108,\s*161,\s*128/);
});

test('Sweep stays visually secondary across regular and soft themes', async () => {
  const css = await readProjectText('extension/style.css');
  const html = await readProjectText('extension/index.html');
  const renderers = await readProjectText('extension/lib/renderers.js');
  const rule = css.match(/\.action-btn\.sweep-action\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /background:\s*rgba\(var\(--accent-rgb\), 0\.05\)/);
  assert.match(rule, /color:\s*var\(--accent-primary\)/);
  assert.doesNotMatch(rule, /background:\s*var\(--accent-primary\)/);
  assert.doesNotMatch(css, /\.action-btn\.primary-action/);
  assert.doesNotMatch(html, /section-mini-btn primary-action/);
  assert.match(renderers, /class="action-btn sweep-action"/);
});

test('archive and global search share the same themed focus treatment', async () => {
  const css = await readProjectText('extension/style.css');
  const sharedRule = css.match(/\.global-search:focus,\s*\.archive-search:focus\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(sharedRule, /border-color:\s*rgba\(var\(--accent-rgb\), 0\.55\)/);
  assert.match(sharedRule, /0 0 0 3px rgba\(var\(--accent-rgb\), 0\.12\)/);
  const focusVisibleGroup = css.match(/\.archive-launch:focus-visible,[\s\S]*?\{([^}]*)\}/)?.[0] || '';
  assert.doesNotMatch(focusVisibleGroup, /archive-search:focus-visible/);
});

test('archive access sits beside global search and stays raised in soft themes', async () => {
  const html = await readProjectText('extension/index.html');
  const css = await readProjectText('extension/style.css');
  const searchRowStart = html.indexOf('<div class="global-search-row">');
  const searchRowEnd = html.indexOf('</div>', searchRowStart);
  const archiveLaunch = html.indexOf('id="archiveLaunch"');
  const archiveRule = [...css.matchAll(/\.archive-launch\s*\{([^}]*)\}/g)]
    .map(match => match[1])
    .find(rule => rule.includes('--archive-label:')) || '';
  assert.ok(searchRowStart >= 0 && archiveLaunch > searchRowStart && archiveLaunch < searchRowEnd);
  assert.match(archiveRule, /color:\s*var\(--archive-label\)/);
  assert.match(archiveRule, /background:\s*rgba\(var\(--neutral-rgb\), 0\.07\)/);
  assert.doesNotMatch(archiveRule, /accent-rgb/);
  assert.match(css, /html\[data-theme="papersoft"\].*html\[data-theme="lattesoft"\][\s\S]*?\.archive-launch[\s\S]*?box-shadow:\s*-3px -3px 6px var\(--neu-light\), 3px 3px 6px var\(--neu-dark\)/);
  assert.match(css, /\.archive-launch[\s\S]*?:active\s*\{[\s\S]*?box-shadow:\s*inset 2px 2px 5px var\(--neu-dark\), inset -2px -2px 5px var\(--neu-light\)/);
  assert.match(css, /\.archive-count\s*\{[\s\S]*?box-shadow:\s*inset 1px 1px 2px var\(--neu-dark\), inset -1px -1px 2px var\(--neu-light\)/);
});

test('dashboard columns use accessible inner scroll viewports with boundary chaining', async () => {
  const html = await readProjectText('extension/index.html');
  const css = await readProjectText('extension/style.css');
  const app = await readProjectText('extension/app.js');

  const viewports = [
    ['openTabsScroll', 'openTabsSectionTitle', 'openTabsMissions'],
    ['deferredScroll', 'deferredColumnTitle', 'deferredList'],
    ['foldersScroll', 'foldersColumnTitle', 'foldersList'],
  ];
  for (const [viewportId, labelId, contentId] of viewports) {
    const start = html.indexOf(`id="${viewportId}"`);
    const content = html.indexOf(`id="${contentId}"`);
    assert.ok(start >= 0 && content > start, `${contentId} must live inside ${viewportId}`);
    const openingTag = html.slice(html.lastIndexOf('<div', start), html.indexOf('>', start) + 1);
    assert.match(openingTag, /class="column-scroll column-scroll-[^"]+"/);
    assert.match(openingTag, /role="region"/);
    assert.match(openingTag, new RegExp(`aria-labelledby="${labelId}"`));
    assert.match(openingTag, /tabindex="0"/);
  }
  assert.ok(html.indexOf('id="newFolderInputRow"') < html.indexOf('id="foldersScroll"'));

  const shellRule = css.match(/\.dashboard-columns \.active-section,\s*\.deferred-column,\s*\.folders-column\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(shellRule, /display:\s*flex/);
  assert.match(shellRule, /overflow:\s*visible/);
  assert.doesNotMatch(shellRule, /overflow-y:\s*auto|overscroll-behavior/);

  const viewportRule = css.match(/\.column-scroll\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(viewportRule, /width:\s*calc\(100% \+ 16px\)/);
  assert.match(viewportRule, /margin:\s*-8px -8px 0/);
  assert.match(viewportRule, /padding:\s*8px 8px 10px/);
  assert.match(viewportRule, /overflow-y:\s*auto/);
  assert.match(viewportRule, /overscroll-behavior-y:\s*auto/);
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selectors, declarations] = match;
    if (!/(?:\.active-section|\.deferred-column|\.folders-column)(?:\W|$)/.test(selectors)) continue;
    assert.doesNotMatch(declarations, /overflow-y:\s*auto/, `${selectors.trim()} must leave scrolling to .column-scroll`);
    assert.doesNotMatch(declarations, /overscroll-behavior(?:-y)?:\s*contain/, `${selectors.trim()} must preserve scroll chaining`);
  }

  const railMediaStart = css.indexOf('@media (max-width: 1239px) and (min-width: 960px)');
  const mobileMediaStart = css.indexOf('@media (max-width: 959px)', railMediaStart);
  const railMedia = css.slice(railMediaStart, mobileMediaStart);
  assert.match(railMedia, /\.dashboard-side-rail\s*\{[\s\S]*?overflow:\s*visible/);
  assert.doesNotMatch(railMedia, /\.dashboard-side-rail\s*\{[^}]*overflow:\s*hidden/);

  const mobileViewportMediaStart = css.indexOf('@media (max-width: 959px) {\n  .dashboard-side-rail');
  const mobileViewportMedia = css.slice(mobileViewportMediaStart, css.indexOf('\n}', mobileViewportMediaStart) + 2);
  assert.match(mobileViewportMedia, /width:\s*100%/);
  assert.match(mobileViewportMedia, /margin:\s*0/);
  assert.match(mobileViewportMedia, /padding:\s*0/);
  assert.match(mobileViewportMedia, /overflow:\s*visible/);
  assert.equal((css.match(/@media \(max-width: 959px\) \{/g) || []).length, 1);
  assert.doesNotMatch(app, /(?:openTabsSection|column)\.style\.display = 'block'/);
});

test('desktop column scrolling magnetically anchors the dashboard without trapping boundaries', async () => {
  const css = await readProjectText('extension/style.css');
  const app = await readProjectText('extension/app.js');
  const controller = await readProjectText('extension/lib/column-scroll-controller.js');

  const dashboardRule = css.match(/\.dashboard-columns\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(dashboardRule, /--dashboard-sticky-offset:\s*32px/);
  assert.match(css, /position:\s*sticky;\s*top:\s*var\(--dashboard-sticky-offset\)/);
  assert.match(app, /createColumnScrollController\(\{/);
  assert.match(app, /root:\s*document\.getElementById\('dashboardColumns'\)/);
  assert.match(app, /minWidth:\s*960/);
  assert.doesNotMatch(app, /const columnScrollController\s*=/);
  assert.match(app, /window\.addEventListener\('scroll', \(event\) => \{[\s\S]*?event\.target !== document[\s\S]*?requestAnimationFrame/);
  assert.match(controller, /addEventListener\('wheel', handleWheel, \{ passive: false \}\)/);
  assert.match(controller, /DEFAULT_ANCHOR_DURATION\s*=\s*90/);
  assert.match(controller, /DEFAULT_SCROLL_DURATION\s*=\s*80/);
  assert.match(controller, /DEFAULT_IMMEDIATE_RATIO\s*=\s*0\.4/);
  assert.match(controller, /DEFAULT_SMOOTH_THRESHOLD\s*=\s*24/);
  assert.match(controller, /const owner = activeViewport\(\)[\s\S]*?owner === viewport[\s\S]*?event\.preventDefault\(\)[\s\S]*?startAnchor\(viewport\)[\s\S]*?applyWheelDelta\(viewport, delta, event\)/);
  assert.match(controller, /if \(!canScrollInDirection\(viewport, delta\)\) return/);
  assert.match(controller, /consumeScrollDelta\(viewport, delta\)/);
  assert.doesNotMatch(controller, /window\.scrollTo\(0, window\.scrollY \+ remainder\)/);
  assert.doesNotMatch(css, /\.column-scroll\s*\{[^}]*scroll-behavior:\s*smooth/);
  assert.match(controller, /addEventListener\('wheel', handleExternalWheel, \{ capture: true, passive: true \}\)/);
  assert.doesNotMatch(controller, /localStorage|chrome\.storage/);
});

test('every theme defines a distinct checkbox hover and soft themes expose it', async () => {
  const css = await readProjectText('extension/style.css');
  const themeIds = [
    'default', 'graphite', 'solarized', 'tokyonight', 'mocha', 'monokai',
    'obsidian', 'paper', 'latte', 'papersoft', 'lattesoft',
  ];
  const colors = themeIds.map(id => {
    const block = css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] || '';
    const color = block.match(/--checkbox-hover:\s*(#[0-9a-f]{6})/i)?.[1];
    assert.ok(color, `${id} must define --checkbox-hover`);
    return color.toLowerCase();
  });
  assert.equal(new Set(colors).size, themeIds.length);
  assert.match(css, /\.deferred-checkbox:hover:not\(:checked\)\s*\{[\s\S]*?var\(--checkbox-hover\)/);
  assert.match(css, /html\[data-theme="papersoft"\].*html\[data-theme="lattesoft"\][\s\S]*?\.deferred-checkbox:hover:not\(:checked\)[\s\S]*?0 0 0 2px color-mix\(in srgb, var\(--checkbox-hover\) 34%, transparent\)/);
});

test('soft themes own save and close hover treatments for tab actions', async () => {
  const css = await readProjectText('extension/style.css');
  const softTokens = ['papersoft', 'lattesoft'].map(id => {
    const block = css.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1] || '';
    return {
      save: block.match(/--soft-save-hover:\s*(#[0-9a-f]{6})/i)?.[1],
      close: block.match(/--soft-close-hover:\s*(#[0-9a-f]{6})/i)?.[1],
    };
  });
  assert.ok(softTokens.every(tokens => tokens.save && tokens.close));
  assert.notDeepEqual(softTokens[0], softTokens[1]);
  const saveHover = css.match(/\.chip-save:hover\s*\{([^}]*)\}/)?.[1] || '';
  const closeHover = css.match(/\.chip-close:hover, \.deferred-dismiss:hover\s*\)\s*\{([^}]*)\}/)?.[1] || '';
  assert.match(saveHover, /color:\s*var\(--soft-save-hover\)/);
  assert.match(saveHover, /background:\s*transparent/);
  assert.match(saveHover, /box-shadow:\s*none/);
  assert.doesNotMatch(saveHover, /inset/);
  assert.match(closeHover, /color:\s*var\(--soft-close-hover\)/);
  assert.match(closeHover, /background:\s*transparent/);
  assert.match(closeHover, /box-shadow:\s*none/);
  assert.doesNotMatch(closeHover, /inset/);
  assert.match(css, /html\[data-theme="papersoft"\].*html\[data-theme="lattesoft"\][\s\S]*?\.page-chip\.clickable:hover\s*\{[\s\S]*?linear-gradient\([\s\S]*?var\(--accent-primary\)/);
  assert.match(css, /\.page-chip\.clickable:has\(\.chip-action:hover\)\s*\{\s*background:\s*transparent/);
});

test('soft themes preserve regular dashboard geometry during theme switches', async () => {
  const css = await readProjectText('extension/style.css');
  const start = css.indexOf('NEUMORPHIC (SOFT UI) LIGHT THEMES');
  const end = css.indexOf('* { margin: 0; padding: 0; box-sizing: border-box; }', start);
  const softSection = css.slice(start, end);
  const missionsRule = css.match(/\.missions\s*\{([^}]*)\}/)?.[1] || '';
  const folderRule = css.match(/\/\* A folder card \*\/[\s\S]*?\.folder\s*\{([^}]*)\}/)?.[1] || '';
  const softCardRule = softSection.match(/:is\(\.mission-card, \.folder\)\s*\{([^}]*)\}/)?.[1] || '';

  assert.match(missionsRule, /gap:\s*12px/);
  assert.match(folderRule, /margin-bottom:\s*10px/);
  assert.match(softCardRule, /border-color:\s*transparent/);
  assert.doesNotMatch(softSection, /border:\s*none/);
  assert.doesNotMatch(softSection, /\.missions\s*\{[^}]*gap:/);
  assert.doesNotMatch(softSection, /\.folder\s*\{[^}]*margin-bottom:/);
  assert.doesNotMatch(softSection, /padding-(?:left|right|top|bottom):/);
});

test('saved-link close buttons match the first-column close control', async () => {
  const css = await readProjectText('extension/style.css');
  const firstColumnIcon = css.match(/\.chip-action svg\s*\{([^}]*)\}/)?.[1] || '';
  const savedLinkIcon = css.match(/\.deferred-dismiss svg\s*\{([^}]*)\}/)?.[1] || '';
  const savedLinkButton = css.match(/\.deferred-dismiss\s*\{([^}]*)\}/)?.[1] || '';

  for (const iconRule of [firstColumnIcon, savedLinkIcon]) {
    assert.match(iconRule, /width:\s*15px/);
    assert.match(iconRule, /height:\s*15px/);
  }
  assert.match(savedLinkButton, /display:\s*inline-flex/);
  assert.match(savedLinkButton, /padding:\s*4px/);
  assert.match(savedLinkButton, /opacity:\s*0\.62/);
});

test('extension JavaScript avoids dynamic execution and promise chains', async () => {
  const libraryFiles = (await readdir(path.join(extensionRoot, 'lib')))
    .filter(file => file.endsWith('.js'))
    .map(file => `extension/lib/${file}`);
  const sources = await Promise.all([
    'extension/app.js',
    'extension/background.js',
    'extension/theme-init.js',
    ...libraryFiles,
  ].map(readProjectText));
  const source = sources.join('\n');
  assert.equal(/\beval\s*\(/.test(source), false);
  assert.equal(/\bnew\s+Function\s*\(/.test(source), false);
  assert.equal(/\.then\s*\(/.test(source), false);
});

test('storage keys remain stable for saved data', async () => {
  const repositorySource = await readProjectText('extension/lib/storage-repository.js');
  const appSource = await readProjectText('extension/app.js');
  assert.match(repositorySource, /deferred:\s*['"]deferred['"]/);
  assert.match(repositorySource, /folders:\s*['"]folders['"]/);
  assert.match(repositorySource, /workspaceSnapshots:\s*['"]workspaceSnapshots['"]/);
  assert.match(appSource, /createStorageRepository\(chrome\.storage\.local\)/);
});

test('backup contract remains schema version 1', async () => {
  const source = await readProjectText('extension/lib/backup-data.js');
  assert.match(source, /BACKUP_APP_NAME\s*=\s*['"]Tab Atlas['"]/);
  assert.match(source, /BACKUP_SCHEMA_VERSION\s*=\s*1\b/);
  assert.match(source, /workspaceSnapshots:\s*cloneStorageArray/);
});

test('theme initialization remains a packaged pre-paint script', async () => {
  const html = await readProjectText('extension/index.html');
  const init = await readProjectText('extension/theme-init.js');
  const themeIndex = html.indexOf('<script src="theme-init.js"></script>');
  const stylesheetIndex = html.indexOf('<link rel="stylesheet" href="style.css">');
  const appIndex = html.search(/<script\b[^>]*\bsrc="app\.js"[^>]*><\/script>/);
  assert.ok(themeIndex >= 0 && themeIndex < stylesheetIndex);
  assert.ok(appIndex > stylesheetIndex);
  assert.match(init, /dataset\.themeMode = lightThemes\.has\(theme\) \? 'light' : 'dark'/);
});
