/** Public share deployment values. Keep both packaged copies byte-identical. */
export const SHARE_PUBLIC_CONFIG = Object.freeze({
  shareOrigin: 'https://tabatlas.app',
  sharePath: '/share',
  extensionId: 'bnclgfhbebombghodiibgmllbaeonadm',
  chromeWebStoreUrl: 'https://chromewebstore.google.com/detail/tab-atlas/bnclgfhbebombghodiibgmllbaeonadm',
});

export const SHARE_BASE_URL = `${SHARE_PUBLIC_CONFIG.shareOrigin}${SHARE_PUBLIC_CONFIG.sharePath}`;
