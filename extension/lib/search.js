/** Parse case-insensitive operators, quoted phrases and excluded terms. */
export function parseSearch(query) {
  const parsed = { domain: [], url: [], text: [] };
  const terms = String(query || '').match(/(?:[^\s"]|"[^"]*"|"[^"]*$)+/g) || [];
  for (let part of terms) {
    part = part.toLowerCase();
    const exclude = part.startsWith('-') && part.length > 1;
    if (exclude) part = part.slice(1);
    const operator = /^(domain|url):/.exec(part);
    const field = operator ? operator[1] : 'text';
    const value = (operator ? part.slice(operator[0].length) : part).replace(/"/g, '');
    if (!value) continue;
    if (exclude) (parsed.exclude ||= []).push({ field, value });
    else parsed[field].push(value);
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
  for (const { field, value } of parsed.exclude || []) {
    const haystack = field === 'domain' ? domain : field === 'url' ? normalizedUrl : `${normalizedTitle} ${normalizedUrl}`;
    if (haystack.includes(value)) return false;
  }
  return true;
}
