/** Parse free text plus domain: and url: search operators. */
export function parseSearch(query) {
  const parsed = { domain: [], url: [], text: [] };
  for (const part of (query || '').split(/\s+/).filter(Boolean)) {
    if (part.startsWith('domain:')) parsed.domain.push(part.slice(7));
    else if (part.startsWith('url:')) parsed.url.push(part.slice(4));
    else parsed.text.push(part);
  }
  return parsed;
}

/** Return true when a URL/title record satisfies every parsed term. */
export function recordMatches(url, title, parsed) {
  const normalizedUrl = (url || '').toLowerCase();
  const normalizedTitle = (title || '').toLowerCase();
  let domain = '';
  try { domain = new URL(normalizedUrl).hostname.toLowerCase(); } catch {}
  for (const value of parsed.domain) if (!domain.includes(value)) return false;
  for (const value of parsed.url) if (!normalizedUrl.includes(value)) return false;
  for (const value of parsed.text) {
    if (!(normalizedTitle.includes(value) || normalizedUrl.includes(value) || domain.includes(value))) return false;
  }
  return true;
}
