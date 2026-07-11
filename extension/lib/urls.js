/** Return true for URLs that should never be treated as restorable web tabs. */
export function isInternalBrowserUrl(url) {
  const value = url || '';
  return (
    !value ||
    value.startsWith('chrome://') ||
    value.startsWith('chrome-extension://') ||
    value.startsWith('about:') ||
    value.startsWith('edge://') ||
    value.startsWith('brave://')
  );
}
