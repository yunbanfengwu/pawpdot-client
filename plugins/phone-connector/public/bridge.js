/* Public, metadata-only bridge SDK. Native code owns origin and instance scope. */
(() => {
  'use strict';
  const publishDirectory = value => {
    if (!window.TeamSeekNative || window.top !== window) return false;
    window.TeamSeekNative.postMessage(JSON.stringify({ type: 'directory', value }));
    return true;
  };
  const publishStatus = state => {
    if (!window.TeamSeekNative || window.top !== window || !['connecting', 'connected', 'failed'].includes(state)) return false;
    window.TeamSeekNative.postMessage(JSON.stringify({ type: 'connection', state }));
    return true;
  };
  window.TeamSeekBridge = Object.freeze({ version: 1, publishDirectory, publishStatus });
})();
