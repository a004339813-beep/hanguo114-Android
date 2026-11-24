package com.jobinfinity.app

/**
 * 在网页脚本运行前注入（只对自家域名生效）。
 * 1. navigator.share → 调原生分享面板（Android WebView 原本不支持 Web Share）
 * 2. 让网页认为自己运行在「已安装 App」模式：display-mode: standalone 为 true，
 *    这样首页的「添加到主屏幕 / 安装 PWA」引导不会在 App 里出现。
 * 注意：Kotlin 原始字符串里不要出现美元符号。
 */
object InjectedScripts {

    val BOOTSTRAP: String = """
(function () {
  if (window.__jobInfinityNativeReady) return;
  window.__jobInfinityNativeReady = true;
  var bridge = window.JobInfinityNative;

  // ---- 1. 原生分享 ----
  if (bridge && typeof bridge.share === 'function') {
    var nativeShare = function (data) {
      data = data || {};
      try {
        bridge.share(String(data.title || ''), String(data.text || ''), String(data.url || ''));
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e);
      }
    };
    var canShare = function (data) { return !!data && !data.files; };
    try {
      Object.defineProperty(Navigator.prototype, 'share', { value: nativeShare, configurable: true, writable: true });
      Object.defineProperty(Navigator.prototype, 'canShare', { value: canShare, configurable: true, writable: true });
    } catch (e) {
      try { navigator.share = nativeShare; navigator.canShare = canShare; } catch (e2) {}
    }
  }

  // ---- 2. 标记为已安装的独立 App ----
  try {
    var originalMatchMedia = window.matchMedia;
    if (typeof originalMatchMedia === 'function') {
      var noop = function () {};
      window.matchMedia = function (query) {
        if (/display-mode\s*:\s*standalone/i.test(String(query))) {
          return {
            matches: true,
            media: String(query),
            onchange: null,
            addListener: noop,
            removeListener: noop,
            addEventListener: noop,
            removeEventListener: noop,
            dispatchEvent: function () { return false; }
          };
        }
        return originalMatchMedia.call(window, query);
      };
    }
  } catch (e) {}

  var markStandalone = function () {
    try { document.documentElement.classList.add('standalone-mode', 'native-app'); } catch (e) {}
  };
  if (document.documentElement) markStandalone();
  else document.addEventListener('DOMContentLoaded', markStandalone);
})();
""".trimIndent()
}
