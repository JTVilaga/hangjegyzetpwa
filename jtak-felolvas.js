// JT AppKreator – Felolvasás. Csak az APK-ban fut (böngészőben, PWA-ként nem csinál semmit).
// Az Android-app belső böngészőjében nincs speechSynthesis; ez a fájl a telefon saját felolvasójával pótolja
// (Capacitor TextToSpeech bővítmény), így a szabványos webes kód változtatás nélkül szól:
//   const u = new SpeechSynthesisUtterance('Szia!'); u.lang = 'hu-HU'; u.onend = () => …; speechSynthesis.speak(u);
//   speechSynthesis.cancel();  speechSynthesis.speaking;  speechSynthesis.getVoices()
// Amit tud: lang, rate, pitch, volume, voice; start, end, error, boundary (szavanként) események; sorban állás.
// A pause() és a resume() az Androidon nem működik (nem csinál semmit).
// Ha a telefonon nincs magyar hang: Beállítások → Kisegítő lehetőségek → Szövegfelolvasás (a Google beszédszolgáltatása).
// A JT AppKreator teszi a projektbe, ha a Felolvasás be van kapcsolva (APK-kártya: Bővítmények…).
(function () {
  'use strict';
  var C = window.Capacitor;
  if (!C || typeof C.isNativePlatform !== 'function' || !C.isNativePlatform()) return;
  if (typeof C.isPluginAvailable === 'function' && !C.isPluginAvailable('TextToSpeech')) {
    console.warn('Felolvasás: a TextToSpeech bővítmény nincs az APK-ban (futtasd az app-bovitmeny.bat-ot, majd az app-update-et).');
    return;
  }
  var T = C.Plugins && C.Plugins.TextToSpeech;
  if (!T) return;

  function esemeny(u, tipus, tobb) {
    var e = { type: tipus, utterance: u, target: u, charIndex: 0, charLength: 0, elapsedTime: 0, name: '' };
    if (tobb) for (var k in tobb) e[k] = tobb[k];
    try { if (typeof u['on' + tipus] === 'function') u['on' + tipus](e); } catch (h) { console.error(h); }
    (u._figyelok[tipus] || []).slice().forEach(function (f) { try { f.call(u, e); } catch (h) { console.error(h); } });
  }

  function Mondat(szoveg) {
    this.text = szoveg == null ? '' : String(szoveg);
    this.lang = ''; this.rate = 1; this.pitch = 1; this.volume = 1; this.voice = null;
    this.onstart = null; this.onend = null; this.onerror = null; this.onboundary = null;
    this.onpause = null; this.onresume = null; this.onmark = null;
    this._figyelok = {};
  }
  Mondat.prototype.addEventListener = function (t, f) { (this._figyelok[t] = this._figyelok[t] || []).push(f); };
  Mondat.prototype.removeEventListener = function (t, f) { var l = this._figyelok[t] || []; var i = l.indexOf(f); if (i >= 0) l.splice(i, 1); };

  var sor = [], most = null, hangok = [], hangFigyelok = [];
  function nyelv(u) {
    return u.lang || (u.voice && u.voice.lang) || document.documentElement.lang || navigator.language || 'hu-HU';
  }
  function kovetkezo() {
    var u = sor.shift();
    S.pending = sor.length > 0;
    if (!u) { most = null; S.speaking = false; return; }
    most = u; S.speaking = true;
    esemeny(u, 'start');
    var opt = { text: u.text, lang: nyelv(u), rate: Number(u.rate) || 1, pitch: Number(u.pitch) || 1, volume: u.volume == null ? 1 : Number(u.volume), queueStrategy: 0 };
    if (u.voice && typeof u.voice._index === 'number') opt.voice = u.voice._index;
    var probak = 0;
    (function mond() {
      T.speak(opt).then(function () {
        if (most !== u) return;
        esemeny(u, 'end', { charIndex: u.text.length });
        kovetkezo();
      }, function (h) {
        if (most !== u) return;
        var uz = String((h && h.message) || h || '');
        // Közvetlenül az indulás után a telefon felolvasója még töltődhet: kicsit később újra.
        if (/initiali[sz]ed|not available/i.test(uz) && probak++ < 5) { setTimeout(mond, 600); return; }
        var nincsHang = /language/i.test(uz);
        console.warn('Felolvasás: ' + uz);
        esemeny(u, 'error', { error: nincsHang ? 'language-unavailable' : 'synthesis-failed',
          message: nincsHang ? 'A telefonon nincs hang ehhez a nyelvhez (' + opt.lang + '). Beállítások → Kisegítő lehetőségek → Szövegfelolvasás.' : uz });
        kovetkezo();
      });
    })();
  }
  var S = {
    speaking: false, pending: false, paused: false, onvoiceschanged: null,
    speak: function (u) {
      if (!(u instanceof Mondat)) throw new TypeError('speechSynthesis.speak: SpeechSynthesisUtterance kell');
      sor.push(u);
      S.pending = true;
      if (!most) kovetkezo();
    },
    cancel: function () {
      var varo = sor; sor = [];
      var u = most; most = null;
      S.speaking = false; S.pending = false;
      T.stop().catch(function () {});
      if (u) esemeny(u, 'end', { charIndex: 0 });
      varo.forEach(function (x) { esemeny(x, 'error', { error: 'canceled' }); });
    },
    pause: function () {}, resume: function () {},
    getVoices: function () { return hangok.slice(); },
    addEventListener: function (t, f) { if (t === 'voiceschanged') hangFigyelok.push(f); },
    removeEventListener: function (t, f) { var i = hangFigyelok.indexOf(f); if (i >= 0) hangFigyelok.splice(i, 1); }
  };

  // Szavanként jelez (pl. a felolvasott szó kiemeléséhez).
  if (typeof T.addListener === 'function') {
    try {
      T.addListener('onRangeStart', function (i) {
        if (most) esemeny(most, 'boundary', { name: 'word', charIndex: i.start, charLength: Math.max(0, i.end - i.start) });
      });
    } catch (h) { /* régebbi bővítmény */ }
  }
  // A telefon hangjai (név, nyelv); a voice-ként átadott hang sorszáma a bővítménynek.
  var hangProba = 0;
  function hangokBetolt() {
    T.getSupportedVoices().then(function (r) {
      hangok = ((r && r.voices) || []).map(function (v, i) {
        return { name: v.name, lang: v.lang, default: !!v.default, localService: v.localService !== false, voiceURI: v.voiceURI || v.name, _index: i };
      });
      var e = { type: 'voiceschanged' };
      if (typeof S.onvoiceschanged === 'function') S.onvoiceschanged(e);
      hangFigyelok.forEach(function (f) { f(e); });
    }).catch(function () { if (hangProba++ < 5) setTimeout(hangokBetolt, 800); });   // a felolvasó még töltődik
  }
  hangokBetolt();

  try {
    Object.defineProperty(window, 'speechSynthesis', { value: S, configurable: true, writable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Mondat, configurable: true, writable: true });
  } catch (h) {
    window.speechSynthesis = S;
    window.SpeechSynthesisUtterance = Mondat;
  }
  // Kilépéskor (a háttérbe kerüléskor) ne beszéljen tovább.
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && S.speaking) S.cancel(); });
  window.jtakFelolvas = { telepites: function () { return T.openInstall(); } };
})();
