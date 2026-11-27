/* 網店結帳穩定性修正（2026-11-27，預覽版先行；老闆批准後併入正式 index.html）
 * ① 舊款 iPhone（iOS 15.4 以前）及部分內置瀏覽器不支援 <dialog>：補上 showModal／close，令購物車及商品詳情可以打開。
 * ② 提交訂單（尤其 FPS 截圖）網絡較慢時：等候上限由 45 秒延長至 120 秒；8 秒後按鈕提示「正在上載，請勿關閉此頁」。
 * ③ 網絡中斷或逾時：顯示具體原因（原本只顯示「系統暫時未能提交訂單」）。 */
(function () {
  'use strict';
  // ① <dialog> 後備
  try {
    var D = window.HTMLDialogElement && HTMLDialogElement.prototype;
    var need = !D || typeof D.showModal !== 'function';
    if (need) {
      var css = document.createElement('style');
      css.textContent = 'dialog{position:fixed;inset:0;margin:auto;max-height:100%;overflow:auto;z-index:1000;display:none;background:#fff}dialog[open]{display:block}.dlg-bd{position:fixed;inset:0;background:rgba(19,33,61,.45);z-index:999}';
      document.head.appendChild(css);
      var patch = function (d) {
        if (d.__dlgPatched) return; d.__dlgPatched = true;
        var bd = null;
        d.showModal = d.show = function () {
          if (d.hasAttribute('open')) return; d.setAttribute('open', '');
          bd = document.createElement('div'); bd.className = 'dlg-bd';
          bd.addEventListener('click', function () { d.close(); });
          d.parentNode.insertBefore(bd, d); document.documentElement.style.overflow = 'hidden';
        };
        d.close = function () {
          if (!d.hasAttribute('open')) return; d.removeAttribute('open');
          if (bd && bd.parentNode) bd.parentNode.removeChild(bd); bd = null;
          document.documentElement.style.overflow = '';
          try { d.dispatchEvent(new Event('close')); } catch (e) { var ev = document.createEvent('Event'); ev.initEvent('close', false, false); d.dispatchEvent(ev); }
        };
        try { Object.defineProperty(d, 'open', { configurable: true, get: function () { return d.hasAttribute('open'); } }); } catch (e) {}
      };
      var all = function () { [].forEach.call(document.querySelectorAll('dialog'), patch); };
      all(); document.addEventListener('DOMContentLoaded', all);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { [].forEach.call(document.querySelectorAll('dialog[open]'), function (d) { d.close(); }); } });
    }
  } catch (e) {}

  // ②③ 提交訂單
  var API_RE = /script\.google\.com\/macros\/s\/[^/]+\/exec/;
  var of = window.fetch;
  if (typeof of === 'function') {
    window.fetch = function (url, opt) {
      var isOrder = API_RE.test(String(url)) && opt && String(opt.method || '').toUpperCase() === 'POST' && /"action":"shopOrder"/.test(String(opt.body || ''));
      if (!isOrder) return of.apply(this, arguments);
      var o = {}; for (var k in opt) if (k !== 'signal') o[k] = opt[k];
      var ctl = window.AbortController ? new AbortController() : null; if (ctl) o.signal = ctl.signal;
      var btn = document.querySelector('#vPay [type=submit]');
      var hint = setTimeout(function () { if (btn && btn.disabled) btn.textContent = '提交中（正在上載，請勿關閉此頁）…'; }, 8000);
      var tm = setTimeout(function () { if (ctl) ctl.abort(); }, 120000);
      var self = this;
      return of.call(self, url, o).then(function (r) { clearTimeout(tm); clearTimeout(hint); return r; }, function (err) {
        clearTimeout(tm); clearTimeout(hint);
        var msg = (err && err.name === 'AbortError') ? '網絡回應逾時，請確認網絡穩定後再試' : '網絡連線中斷，請檢查網絡後再試';
        return new Response(JSON.stringify({ ok: false, err: msg }), { headers: { 'Content-Type': 'application/json' } });
      });
    };
  }
})();
