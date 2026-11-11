// JT AppKreator – Teljes kijelző. Csak az APK-ban fut; böngészőben (PWA-ként) nem csinál semmit.
// Az app a felső és az alsó rendszersáv mögé is rajzol (a MainActivity beállítása és a viewport-fit=cover miatt).
// Ez a fájl:
// - a tartalmat a sávokon belül tartja (az oldal felül és alul annyi helyet hagy, amekkora a sáv),
// - a sávok helyét kiszínezi: felül a témaszín (<meta name="theme-color">), alul (és fekvő helyzetben oldalt)
//   az oldal háttere,
// - a sávok ikonjait (óra, akku, vissza gomb) a háttérhez igazítja: sötét alapon világos, világos alapon sötét.
// Ha az app futás közben színt vált (sötét mód, másik theme-color), magától követi.
// Kézzel is állítható: jtakSavok.szinek('#1f6f5c', '#ffffff') – felső és alsó szín; jtakSavok.szinek() – vissza
// az automatikusra; jtakSavok.frissit() – újraszámolás.
// A JT AppKreator teszi a projektbe, ha a Teljes kijelző be van kapcsolva (APK-kártya: Bővítmények…).
(function () {
  'use strict';
  var C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return;

  var st = document.createElement('style');
  st.textContent =
    'html{padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}' +
    '.jtak-sav{position:fixed;z-index:2147483647;pointer-events:none}' +
    '.jtak-sav-fel{top:0;left:0;right:0;height:env(safe-area-inset-top,0px)}' +
    '.jtak-sav-le{bottom:0;left:0;right:0;height:env(safe-area-inset-bottom,0px)}' +
    '.jtak-sav-bal{top:0;bottom:0;left:0;width:env(safe-area-inset-left,0px)}' +
    '.jtak-sav-jobb{top:0;bottom:0;right:0;width:env(safe-area-inset-right,0px)}';
  (document.head || document.documentElement).appendChild(st);

  var kezi = null, savok = null, utolso = '';

  function temaSzin() {
    var m = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < m.length; i++) {
      var media = m[i].getAttribute('media');
      var c = m[i].getAttribute('content');
      if (c && (!media || window.matchMedia(media).matches)) return c;
    }
    return null;
  }
  function hatter(el) {
    if (!el) return null;
    var c = getComputedStyle(el).backgroundColor;
    if (!c || c === 'transparent' || /^rgba\(.*,\s*0\)$/.test(c)) return null;
    return c;
  }
  function oldalSzin() { return hatter(document.body) || hatter(document.documentElement) || '#ffffff'; }
  function sotet(c) {
    var p = document.createElement('i');
    p.style.color = c;
    document.documentElement.appendChild(p);
    var x = (getComputedStyle(p).color.match(/[\d.]+/g) || [255, 255, 255]).map(Number);
    p.remove();
    return 0.299 * x[0] + 0.587 * x[1] + 0.114 * x[2] < 150;
  }
  function sav(osztaly) {
    var d = document.createElement('div');
    d.className = 'jtak-sav ' + osztaly;
    d.setAttribute('aria-hidden', 'true');
    document.body.appendChild(d);
    return d;
  }

  function frissit() {
    try {
      if (!document.body) return;
      if (!savok || !savok[0].isConnected) savok = [sav('jtak-sav-fel'), sav('jtak-sav-le'), sav('jtak-sav-bal'), sav('jtak-sav-jobb')];
      var fel = (kezi && kezi[0]) || temaSzin() || oldalSzin();
      var le = (kezi && kezi[1]) || oldalSzin();
      savok[0].style.background = fel;
      for (var i = 1; i < 4; i++) savok[i].style.background = le;
      var SB = C.Plugins && C.Plugins.SystemBars;
      var k = fel + '|' + le;
      if (SB && k !== utolso) {
        utolso = k;
        SB.setStyle({ style: sotet(fel) ? 'DARK' : 'LIGHT', bar: 'StatusBar' }).catch(function () {});
        SB.setStyle({ style: sotet(le) ? 'DARK' : 'LIGHT', bar: 'NavigationBar' }).catch(function () {});
      }
    } catch (e) { /* a színezés hibája ne zavarja az appot */ }
  }

  function indul() {
    frissit();
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', frissit);
    var mo = new MutationObserver(frissit);
    mo.observe(document.head, { subtree: true, childList: true, attributes: true, attributeFilter: ['content', 'media'] });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    mo.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    window.addEventListener('load', frissit);
    setTimeout(frissit, 500);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { utolso = ''; frissit(); }
    });
  }

  window.jtakSavok = {
    frissit: frissit,
    szinek: function (fel, le) { kezi = (fel || le) ? [fel || null, le || null] : null; frissit(); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', indul);
  else indul();
})();
