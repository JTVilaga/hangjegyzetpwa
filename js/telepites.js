// Telepítés gomb – a JT AppKreator készítette.
// Chrome / Edge (Android, Windows, macOS, Linux): gomb, ha a böngésző felajánlja a telepítést.
// iPhone / iPad és Safari: ott nincs ilyen ajánlat, ezért egyszer egy bezárható tippet mutat.
(function () {
  var prompt = null;
  var telepitett = function () {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  };
  var alap = 'position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);'
    + 'z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:calc(100vw - 32px);font:600 15px system-ui,sans-serif;';
  var gomb = document.createElement('button');
  gomb.type = 'button';
  gomb.textContent = '📲 Hangjegyzetpwa telepítése';
  gomb.setAttribute('aria-label', 'Az app telepítése erre az eszközre');
  gomb.style.cssText = alap + 'display:none;padding:12px 20px;border:0;border-radius:999px;background:#0b4a8f;color:#fff;font-size:16px;cursor:pointer;';
  var uzenet = function (szoveg) {
    var d = document.createElement('div');
    d.textContent = szoveg;
    d.style.cssText = alap + 'padding:12px 18px;border-radius:10px;background:#1f8a4c;color:#fff;text-align:center;';
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 5000);
  };
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    prompt = e;
    if (!telepitett()) gomb.style.display = 'block';
  });
  gomb.addEventListener('click', function () {
    if (!prompt) return;
    gomb.style.display = 'none';
    prompt.prompt();
    prompt.userChoice.then(function () { prompt = null; });
  });
  window.addEventListener('appinstalled', function () {
    gomb.style.display = 'none';
    uzenet('Telepítve! Mostantól a kezdőképernyőről is indíthatod.');
  });

  // Tipp iPhone-on, iPaden és Safariban (ott a böngésző nem ajánlja fel magától a telepítést).
  var ua = navigator.userAgent;
  var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var macSafari = !ios && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
  var tippKulcs = 'telepites-tipp-' + location.pathname;
  var tipp = function () {
    if (prompt || telepitett() || !(ios || macSafari)) return;
    try { if (localStorage.getItem(tippKulcs)) return; } catch (e) { /* nincs tároló: azért mutatjuk */ }
    var d = document.createElement('div');
    d.setAttribute('role', 'note');
    d.style.cssText = alap + 'width:min(440px, calc(100vw - 32px));box-sizing:border-box;padding:12px 40px 12px 16px;border-radius:10px;background:#0b4a8f;color:#fff;font-weight:500;line-height:1.4;text-align:left;';
    d.textContent = ios
      ? 'Telepítés: koppints a Megosztás gombra (négyzet felfelé mutató nyíllal), majd: Hozzáadás a főképernyőhöz.'
      : 'Telepítés: a Safari Fájl menüjében: Hozzáadás a Dockhoz.';
    var x = document.createElement('button');
    x.type = 'button';
    x.textContent = '✕';
    x.setAttribute('aria-label', 'Bezárás');
    x.style.cssText = 'position:absolute;top:6px;right:6px;border:0;background:transparent;color:#fff;font-size:18px;cursor:pointer;padding:4px 8px;';
    x.addEventListener('click', function () {
      d.remove();
      try { localStorage.setItem(tippKulcs, '1'); } catch (e) {}
    });
    d.appendChild(x);
    document.body.appendChild(d);
  };

  var be = function () {
    document.body.appendChild(gomb);
    setTimeout(tipp, 2500);
  };
  if (document.body) be(); else document.addEventListener('DOMContentLoaded', be);
})();
