/* =========================================================================
   Cookie-Banner  (rein optisch – KEINE echte Consent-Steuerung)
   - erscheint nur beim ERSTEN Besuch
   - merkt sich die Auswahl (localStorage + Cookie) → kommt danach nicht mehr
   ========================================================================= */
(function () {
  var KEY = 'rf_cookie_choice';

  // Bereits entschieden? → nichts tun
  try { if (localStorage.getItem(KEY)) return; } catch (e) {}
  if (document.cookie.indexOf(KEY + '=') > -1) return;

  var css = '\
  .rfcb{position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:16px;display:flex;justify-content:center;\
    transform:translateY(140%);transition:transform .4s cubic-bezier(.22,1,.36,1);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}\
  .rfcb.show{transform:translateY(0)}\
  .rfcb-card{width:100%;max-width:920px;background:#fff;border:1px solid #E5E7EB;border-radius:16px;\
    box-shadow:0 20px 60px rgba(11,31,28,.22);padding:22px 24px}\
  .rfcb-row{display:flex;flex-direction:column;gap:18px;align-items:flex-start}\
  @media(min-width:820px){.rfcb-row{flex-direction:row;align-items:center;justify-content:space-between}}\
  .rfcb-title{font-weight:800;color:#0B1F1C;font-size:1.02rem;margin:0 0 4px}\
  .rfcb-text{margin:0;color:#4B5563;font-size:.92rem;line-height:1.5;max-width:560px}\
  .rfcb-text a{color:#115E59}\
  .rfcb-btns{display:flex;flex-wrap:wrap;gap:10px;flex:0 0 auto}\
  .rfcb-btn{appearance:none;border:0;cursor:pointer;border-radius:10px;font-weight:700;font-size:.92rem;padding:12px 18px;white-space:nowrap;transition:transform .12s,background .15s,border-color .15s}\
  .rfcb-btn:active{transform:translateY(1px)}\
  .rfcb-accept{background:#F97316;color:#fff;box-shadow:0 8px 20px rgba(249,115,22,.32)}\
  .rfcb-accept:hover{background:#EA580C}\
  .rfcb-reject{background:#fff;color:#1F2937;border:1.5px solid #E5E7EB}\
  .rfcb-reject:hover{background:#F6FAF9;border-color:#cbd5e1}\
  .rfcb-settings-btn{background:transparent;color:#4B5563;text-decoration:underline;padding:12px 8px}\
  .rfcb-settings{display:none;margin-top:16px;border-top:1px solid #E5E7EB;padding-top:16px}\
  .rfcb-settings.open{display:block}\
  .rfcb-opt{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid #F1F5F4}\
  .rfcb-opt:last-of-type{border-bottom:0}\
  .rfcb-opt .lbl{font-size:.9rem;color:#1F2937}\
  .rfcb-opt .lbl small{display:block;color:#6B7280;font-weight:400;font-size:.8rem}\
  .rfcb-sw{position:relative;width:42px;height:24px;flex:0 0 42px;border-radius:999px;background:#CBD5E1;transition:background .15s;cursor:pointer}\
  .rfcb-sw::after{content:"";position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .15s;box-shadow:0 1px 3px rgba(0,0,0,.3)}\
  .rfcb-sw.on{background:#0F766E}.rfcb-sw.on::after{transform:translateX(18px)}\
  .rfcb-sw.locked{background:#0F766E;opacity:.55;cursor:not-allowed}.rfcb-sw.locked::after{transform:translateX(18px)}\
  .rfcb-save{margin-top:14px}';

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  var el = document.createElement('div');
  el.className = 'rfcb';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Cookie-Einstellungen');
  el.innerHTML =
    '<div class="rfcb-card">' +
      '<div class="rfcb-row">' +
        '<div>' +
          '<p class="rfcb-title">🍪 Wir verwenden Cookies</p>' +
          '<p class="rfcb-text">Wir nutzen Cookies, um dir das beste Erlebnis zu bieten, unsere Inhalte zu verbessern und Reichweite zu messen. Mehr dazu in unserer <a href="/datenschutz/">Datenschutzerklärung</a>.</p>' +
        '</div>' +
        '<div class="rfcb-btns">' +
          '<button class="rfcb-btn rfcb-settings-btn" data-act="settings">Einstellungen</button>' +
          '<button class="rfcb-btn rfcb-reject" data-act="reject">Ablehnen</button>' +
          '<button class="rfcb-btn rfcb-accept" data-act="accept">Alle akzeptieren</button>' +
        '</div>' +
      '</div>' +
      '<div class="rfcb-settings">' +
        '<div class="rfcb-opt"><span class="lbl">Notwendig<small>Für den Betrieb der Seite erforderlich.</small></span><span class="rfcb-sw locked" aria-hidden="true"></span></div>' +
        '<div class="rfcb-opt"><span class="lbl">Statistik<small>Hilft uns zu verstehen, wie die Seite genutzt wird.</small></span><span class="rfcb-sw on" data-toggle></span></div>' +
        '<div class="rfcb-opt"><span class="lbl">Marketing<small>Für personalisierte Werbung.</small></span><span class="rfcb-sw" data-toggle></span></div>' +
        '<button class="rfcb-btn rfcb-accept rfcb-save" data-act="save">Auswahl speichern</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(el);

  // einblenden
  requestAnimationFrame(function () { el.classList.add('show'); });

  function choose(value) {
    try { localStorage.setItem(KEY, value); } catch (e) {}
    document.cookie = KEY + '=' + value + ';path=/;max-age=31536000;SameSite=Lax';
    el.classList.remove('show');
    setTimeout(function () { el.remove(); }, 400);
  }

  el.querySelector('[data-act="accept"]').addEventListener('click', function () { choose('accept'); });
  el.querySelector('[data-act="reject"]').addEventListener('click', function () { choose('reject'); });
  el.querySelector('[data-act="save"]').addEventListener('click', function () { choose('custom'); });

  el.querySelector('[data-act="settings"]').addEventListener('click', function () {
    el.querySelector('.rfcb-settings').classList.toggle('open');
  });

  // optische Toggles (ohne echte Funktion)
  el.querySelectorAll('[data-toggle]').forEach(function (sw) {
    sw.addEventListener('click', function () { sw.classList.toggle('on'); });
  });
})();
