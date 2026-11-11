// A VERZIO sort a JT AppKreator szúrta be; az app-update.bat ezt emeli.
const VERZIO = '1.00';

// Hangjegyzet – minta a JT AppKreatorhoz: diktálás (beszédfelismerés) és hangfelvétel.
// A jegyzetek a telefonon maradnak (IndexedDB): szöveg, és ha van, a hangfelvétel (Blob).
//
// Hol mi működik:
// - PWA (Chrome, https-címről): a diktálás a böngésző SpeechRecognition-je, a felvétel a MediaRecorder.
// - APK: a WebView a böngésző SpeechRecognition-jét nem ismeri, ezért a diktáláshoz a JT AppKreator
//   „Beszédfelismerés” bővítménye kell (window.Capacitor.Plugins.SpeechRecognition); a felvétel a MediaRecorder,
//   ehhez a „Mikrofon” engedély. A hang fájlba mentéséhez az APK-ban a „Fájlmentés” bővítmény kell.
// - Felolvasás: mindkét helyen a szabványos speechSynthesis. Az APK-ban a WebView-ban ez nincs: a JT AppKreator
//   „Felolvasás” bővítménye (jtak-felolvas.js) pótolja a telefon saját felolvasójával, a kód ugyanaz marad.

// ===== Segédek =====
const $ = id => document.getElementById(id);
const apkban = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
// A bővítmények a window.Capacitor.Plugins alatt vannak – ha nincsenek bekapcsolva, null.
const bovitmeny = nev => (apkban && window.Capacitor.Plugins && window.Capacitor.Plugins[nev]) || null;
const Beszed = bovitmeny('SpeechRecognition');
const Filesystem = bovitmeny('Filesystem');
const BongeszoBeszed = window.SpeechRecognition || window.webkitSpeechRecognition || null;
const NYELV = 'hu-HU';
const OFFLINE_APP_LINK = 'https://play.google.com/store/apps/details?id=dev.notune.transcribe';   // Offline Voice Input
let felolvasott = null;   // a most felolvasott jegyzet azonosítója (Felolvasás)

function allapot(szoveg, hiba) {
  $('allapot').textContent = szoveg || '';
  $('allapot').classList.toggle('hiba', !!hiba);
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function hibaSzoveg(e) {
  return e && e.message ? e.message : String(e);
}
function idoSzoveg(ms) {
  const d = new Date(ms);
  const k = n => String(n).padStart(2, '0');
  return d.getFullYear() + '.' + k(d.getMonth() + 1) + '.' + k(d.getDate()) + ' ' + k(d.getHours()) + ':' + k(d.getMinutes());
}
function percMasodperc(mp) {
  mp = Math.round(mp);
  return Math.floor(mp / 60) + ':' + String(mp % 60).padStart(2, '0');
}
// Két szövegrész összefűzése egy szóközzel.
function osszefuz(a, b) {
  a = a || '';
  b = (b || '').trim();
  if (!b) return a;
  if (!a.trim()) return b;
  return a.replace(/\s+$/, '') + ' ' + b;
}

// ===== Tárolás (IndexedDB) =====
let db = null;
function dbNyit() {
  return new Promise((kesz, hiba) => {
    const r = indexedDB.open('hangjegyzet', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('jegyzetek', { keyPath: 'id', autoIncrement: true });
    r.onsuccess = () => kesz(r.result);
    r.onerror = () => hiba(r.error);
  });
}
function tar(mod) {
  return db.transaction('jegyzetek', mod).objectStore('jegyzetek');
}
function keres(r) {
  return new Promise((kesz, hiba) => { r.onsuccess = () => kesz(r.result); r.onerror = () => hiba(r.error); });
}
const jegyzetekOlvas = () => keres(tar('readonly').getAll());
const jegyzetIr = j => keres(tar('readwrite').add(j));
const jegyzetTorol = id => keres(tar('readwrite').delete(id));

// ===== Diktálás =====
let diktal = false;     // be van-e kapcsolva (a gombbal)
let alap = '';          // a szöveg a mostani felismerési menet előtt
let resz = '';          // a mostani menet szövege (még változhat)
let uresMenet = 0;      // egymás utáni menetek szöveg nélkül (hosszú csendnél leáll)
let bongeszoRec = null;
let apkFigyelok = false;
let beszedHelyben = false;
let apkMod = '';            // a mostani menet módja: 'elo' (élő, a háttérben) vagy 'felugro' (a felismerő saját ablaka)
let lezart = false;         // a szövegmezőben lévő jegyzet le van zárva (Diktálás vége): az újabb diktálás új jegyzet  // tud-e a telefon internet nélkül, magyarul felismerni (Android 13-tól, nyelvcsomaggal)
let ujraIdozito = null;

function szovegIr() {
  $('szoveg').value = osszefuz(alap, resz);
}
// A menet vége: a felismert rész véglegesen a szövegbe kerül.
function menetVege() {
  if (resz.trim()) uresMenet = 0; else uresMenet++;
  alap = osszefuz(alap, resz);
  resz = '';
  szovegIr();
  if (diktal && uresMenet >= 6) {
    diktalLeallit();
    allapot('Hosszabb csend volt, a diktálás megállt. Folytatáshoz nyomd meg újra.');
  }
}

async function diktalIndit() {
  // A „Diktálás vége” lezárja a jegyzetet: az újabb diktálás új jegyzetet kezd (az előzőt, ha még nincs mentve, elmenti).
  if (lezart && $('szoveg').value.trim()) {
    if (!(await szovegMent())) return;
    allapot('Az előző jegyzetet elmentettem; új jegyzet.');
  }
  lezart = false;
  alap = $('szoveg').value;
  resz = '';
  uresMenet = 0;
  diktal = true;
  gombokFrissit();
  try {
    if (Beszed) await apkDiktalIndit();
    else if (BongeszoBeszed) bongeszoDiktalIndit();
    else throw new Error('Itt nem lehet diktálni.');
  } catch (e) {
    diktal = false;
    gombokFrissit();
    allapot(hibaSzoveg(e), true);
  }
}

async function diktalLeallit() {
  diktal = false;
  clearTimeout(ujraIdozito);
  gombokFrissit();
  try {
    if (Beszed) await Beszed.stop();
    else if (bongeszoRec) bongeszoRec.stop();
  } catch (e) { /* már állt */ }
  menetVegeHaKell();
  lezart = !!$('szoveg').value.trim();
  allapot(lezart ? 'A jegyzet kész. Mentés: „Jegyzet mentése”; az újabb Diktálás új jegyzetet kezd.' : 'A diktálás leállt.');
}
// Leállításkor a még függő rész se vesszen el.
function menetVegeHaKell() {
  if (resz.trim()) { alap = osszefuz(alap, resz); resz = ''; szovegIr(); }
}

// --- APK: a Beszédfelismerés bővítmény (az Android saját felismerője) ---
async function apkDiktalIndit() {
  let jog = await Beszed.checkPermissions();
  if (jog.speechRecognition !== 'granted') jog = await Beszed.requestPermissions();
  if (jog.speechRecognition !== 'granted') throw new Error('Nincs engedély a mikrofonhoz. (Telefon beállításai → Alkalmazások → Hangjegyzet → Engedélyek)');
  const v = await Beszed.available();
  if (!v.available) throw new Error('A telefonon nincs beszédfelismerő (a Google app kell hozzá).');
  if (!apkFigyelok) {
    apkFigyelok = true;
    // Élő szöveg: a menet eddigi szövege (a végén a végleges is ugyanígy jön).
    Beszed.addListener('partialResults', e => {
      const t = (e && e.matches && e.matches[0]) || '';
      if (t) { resz = t; szovegIr(); }
    });
    // Egy szünet után az Android lezárja a menetet: a szöveg véglegesítése, és ha még diktálunk, új menet.
    Beszed.addListener('listeningState', e => {
      if (apkMod === 'felugro') return;   // a felugró ablak eredményét az apkFelugro() kezeli
      if (!e || e.state !== 'stopped') return;
      menetVege();
      if (diktal) {
        clearTimeout(ujraIdozito);
        ujraIdozito = setTimeout(() => { if (diktal) apkMenet(); }, 900);   // ha a „kész” jelzés nem jönne
      }
    });
    Beszed.addListener('readyForNextSession', () => {
      if (!diktal || apkMod === 'felugro') return;
      clearTimeout(ujraIdozito);
      ujraIdozito = setTimeout(() => { if (diktal) apkMenet(); }, 100);
    });
    // Komoly hibánál (hálózat, engedély, nyelv) leáll; a „nem értettem”, a csend és a „foglalt” nem hiba.
    // A kód szöveg (a bővítmény adja): NETWORK, AUDIO, … ; az Android 12-es és 13-as kódja (nyelv) UNKNOWN_12 / UNKNOWN_13.
    Beszed.addListener('error', e => {
      const kod = String((e && e.code) || '');
      const okok = {
        NETWORK: 'nincs internet', NETWORK_TIMEOUT: 'lassú vagy nincs internet', SERVER: 'a felismerő szerver hibája',
        SERVER_DISCONNECTED: 'a felismerő szerver hibája', AUDIO: 'a mikrofon nem elérhető', INSUFFICIENT_PERMISSIONS: 'nincs engedély a mikrofonhoz',
        UNKNOWN_12: 'a magyar nyelv nem támogatott', UNKNOWN_13: 'a magyar nyelvcsomag nincs letöltve',
        MODEL_DOWNLOAD_SCHEDULED: 'a magyar nyelvcsomag letöltése elindult – ha kész, próbáld újra'
      };
      if (!okok[kod]) return;
      diktal = false;
      clearTimeout(ujraIdozito);
      gombokFrissit();
      let szoveg = 'A diktálás leállt: ' + okok[kod] + '.';
      if (/^NETWORK/.test(kod)) szoveg += ' Próbáld az „Internet nélkül” beállítással.';
      // Ezt egy másik (pl. offline) felismerő is adhatja, ha a háttérből hívva nem látja az appot – a felugró ablak megkerüli.
      if (kod === 'INSUFFICIENT_PERMISSIONS') szoveg += ' Ha az engedély megvan, kapcsold be az „Internet nélkül” jelölőt (felugró ablakkal megy).';
      allapot(szoveg, true);
    });
  }
  await apkMenet();
}
async function apkMenet() {
  // Internet nélkül (bekapcsolva, vagy ha nincs internet):
  // - ha a telefon eszközön futó felismerője tud magyarul: azzal, élőben;
  // - különben a beállított hangbevitel (pl. Offline Voice Input) saját felugró ablakával.
  const offline = $('helybenJelolo').checked || !navigator.onLine;
  if (offline && !beszedHelyben) return apkFelugro();
  apkMod = 'elo';
  try {
    const helyben = beszedHelyben && offline;
    await Beszed.start({ language: NYELV, partialResults: true, popup: false, maxResults: 1, useOnDeviceRecognition: helyben });
    allapot('Hallgatlak… beszélj.' + (helyben ? ' (internet nélkül)' : '') + ' (Leállítás: a gomb újra)');
  } catch (e) {
    // Ha a felismerő még foglalt, kicsit később újra.
    if (diktal && /busy|foglalt/i.test(hibaSzoveg(e))) {
      ujraIdozito = setTimeout(() => { if (diktal) apkMenet(); }, 600);
      return;
    }
    diktal = false;
    gombokFrissit();
    allapot('A diktálás nem indult: ' + hibaSzoveg(e), true);
  }
}

// Felugró ablak: a felismerő a saját ablakában hallgat (a saját mikrofonengedélyével), a végén
// egyben adja vissza a szöveget. Élő szöveg nincs; leállítás: koppintás az ablakra.
// Minden Diktálás-nyomás egy ablak.
async function apkFelugro() {
  apkMod = 'felugro';
  allapot('');   // a teendő a szövegdobozon látszik
  // Amíg a felugró ablak hallgat, a szövegdoboz jelzi, hogy a szöveg a végén érkezik.
  $('szoveg').classList.add('var');
  $('felugroJelzes').hidden = false;
  let szoveg = '';
  let hiba = '';
  try {
    const v = await Beszed.start({ language: NYELV, popup: true, partialResults: false, maxResults: 1 });
    szoveg = (v && v.matches && v.matches[0]) || '';
  } catch (e) {
    // A bővítmény „0”-t ad, ha az ablakot bezárták (X) – az nem hiba.
    const h = hibaSzoveg(e);
    if (h !== '0' && !/stopped/i.test(h)) hiba = h;
    // Nincs olyan app, ami a felugró ablakot adná.
    if (/no activity|activitynotfound/i.test(h)) hiba = 'nincs internet nélküli felismerő a telefonon. Lásd lent: Offline Voice Input.';
  }
  $('szoveg').classList.remove('var');
  $('felugroJelzes').hidden = true;
  alap = osszefuz(alap, szoveg);
  resz = '';
  szovegIr();
  diktal = false;
  // Mint a „Diktálás vége”: a jegyzet lezárul, az újabb Diktálás új jegyzetet kezd (az előzőt elmenti).
  lezart = !!$('szoveg').value.trim();
  gombokFrissit();
  if (hiba) allapot('A diktálás nem sikerült: ' + hiba, true);
  else if (szoveg) allapot('A jegyzet kész. Mentés: „Jegyzet mentése”; az újabb Diktálás új jegyzetet kezd.');
  else allapot('Nem jött szöveg.');
}

// --- PWA: a böngésző SpeechRecognition-je (Chrome) ---
function bongeszoDiktalIndit() {
  const rec = new BongeszoBeszed();
  bongeszoRec = rec;
  rec.lang = NYELV;
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = e => {
    let szoveg = '';
    for (let i = 0; i < e.results.length; i++) szoveg += e.results[i][0].transcript;
    resz = szoveg.trim();
    szovegIr();
  };
  rec.onerror = e => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    diktal = false;
    gombokFrissit();
    const okok = { 'not-allowed': 'nincs engedély a mikrofonhoz', 'service-not-allowed': 'a böngésző nem engedi', network: 'nincs internet', 'audio-capture': 'nincs mikrofon' };
    allapot('A diktálás leállt: ' + (okok[e.error] || e.error) + '.', true);
  };
  rec.onend = () => {
    menetVege();
    if (diktal && bongeszoRec === rec) {
      try { rec.start(); } catch (err) { diktal = false; gombokFrissit(); }
    }
  };
  rec.start();
  allapot('Hallgatlak… beszélj. (Leállítás: a gomb újra)');
}

// ===== Hangfelvétel =====
let felvevo = null;
let felvetelStream = null;
let felvetelKezdet = 0;
let felvetelOra = null;
let ujHang = null;          // { blob, tipus, hossz } – az elkészült, még nem mentett felvétel
let elonezetUrl = null;

function felvetelTipus() {
  const jeloltek = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
  return jeloltek.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

async function felvetelIndit() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    allapot('Hangfelvétel csak https-címről (PWA) vagy az APK-ban lehetséges.', true);
    return;
  }
  try {
    felvetelStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    allapot('A mikrofon nem érhető el: ' + (e.name === 'NotAllowedError' ? 'nincs engedély.' : hibaSzoveg(e)), true);
    return;
  }
  const tipus = felvetelTipus();
  felvevo = new MediaRecorder(felvetelStream, tipus ? { mimeType: tipus } : undefined);
  const darabok = [];
  felvevo.ondataavailable = e => { if (e.data && e.data.size) darabok.push(e.data); };
  felvevo.onstop = () => {
    const hossz = (Date.now() - felvetelKezdet) / 1000;
    felvetelStream.getTracks().forEach(t => t.stop());
    felvetelStream = null;
    const t = felvevo.mimeType || tipus || 'audio/webm';
    felvevo = null;
    ujHang = { blob: new Blob(darabok, { type: t }), tipus: t, hossz };
    elonezetMutat();
    gombokFrissit();
    allapot('Felvétel kész (' + percMasodperc(hossz) + '). A „Jegyzet mentése” a jegyzethez menti.');
  };
  felvetelKezdet = Date.now();
  felvevo.start(1000);
  felvetelOra = setInterval(() => allapot('⏺ Felvétel… ' + percMasodperc((Date.now() - felvetelKezdet) / 1000) + ' (Leállítás: a gomb újra)'), 500);
  gombokFrissit();
}

function felvetelLeallit() {
  clearInterval(felvetelOra);
  if (felvevo && felvevo.state !== 'inactive') felvevo.stop();
}

function elonezetMutat() {
  if (elonezetUrl) URL.revokeObjectURL(elonezetUrl);
  elonezetUrl = ujHang ? URL.createObjectURL(ujHang.blob) : null;
  const lj = $('hangLejatszo');
  // Üres src helyett az attribútum törlése: az src="" az oldal címét próbálná betölteni („nem töltődött be” hiba).
  if (elonezetUrl) lj.src = elonezetUrl;
  else { lj.removeAttribute('src'); lj.load(); }
  $('hangElonezet').hidden = !ujHang;
}

// ===== Gombok állapota =====
function gombokFrissit() {
  const felvesz = !!felvevo;
  const dg = $('diktalGomb');
  const fg = $('felvetelGomb');
  dg.classList.toggle('fut', diktal);
  dg.textContent = diktal ? '⏹ Diktálás vége' : '🗣 Diktálás';
  dg.disabled = felvesz || (!Beszed && !BongeszoBeszed);
  fg.classList.toggle('fut', felvesz);
  fg.textContent = felvesz ? '⏹ Felvétel vége' : (ujHang ? '⏺ Új felvétel' : '⏺ Hangfelvétel');
  fg.disabled = diktal;
  $('mentGomb').disabled = diktal || felvesz;
  // A mentés gomb a jegyzet fajtája szerint: kész felvétel van → a felvételt menti, különben a szöveget.
  $('mentGomb').textContent = ujHang ? '💾 A felvétel mentése' : '💾 Jegyzet mentése';
}

// ===== Jegyzetek =====
// A diktált (írt) jegyzet és a hangfelvétel külön jegyzet: a gomb, ha van kész felvétel, azt menti, különben a szöveget.
async function jegyzetMent() {
  if (ujHang) return felvetelMent();
  if (!$('szoveg').value.trim()) { allapot('Üres jegyzet: írj, diktálj, vagy vegyél fel hangot.', true); return; }
  if (await szovegMent()) allapot('✓ A jegyzet elmentve.');
}
async function szovegMent() {
  try {
    await jegyzetIr({ ido: Date.now(), szoveg: $('szoveg').value.trim() });
  } catch (e) {
    allapot('Nem sikerült menteni: ' + hibaSzoveg(e), true);
    return false;
  }
  $('szoveg').value = '';
  lezart = false;
  listaRajzol();
  return true;
}
async function felvetelMent() {
  try {
    await jegyzetIr({ ido: Date.now(), szoveg: '', hang: ujHang.blob, hangTipus: ujHang.tipus, hossz: ujHang.hossz });
  } catch (e) {
    allapot('Nem sikerült menteni: ' + hibaSzoveg(e), true);
    return;
  }
  ujHang = null;
  elonezetMutat();
  gombokFrissit();
  allapot('✓ A felvétel elmentve.');
  listaRajzol();
}

function urit() {
  $('szoveg').value = '';
  lezart = false;
  ujHang = null;
  elonezetMutat();
  gombokFrissit();
}

let listaUrlek = [];
async function listaRajzol() {
  // A régi lejátszók címeit csak az új lista után, kis késéssel szabadítjuk fel (különben „nem töltődött be” hiba).
  const regiUrlek = listaUrlek;
  setTimeout(() => regiUrlek.forEach(u => URL.revokeObjectURL(u)), 2000);
  listaUrlek = [];
  const lista = (await jegyzetekOlvas()).sort((a, b) => b.ido - a.ido);
  $('db').textContent = lista.length ? '(' + lista.length + ')' : '';
  if (!lista.length) { $('lista').innerHTML = '<p class="halvany">Még nincs jegyzet.</p>'; return; }
  $('lista').innerHTML = lista.map(j => {
    let hang = '';
    if (j.hang) {
      const u = URL.createObjectURL(j.hang);
      listaUrlek.push(u);
      hang = '<audio controls preload="metadata" src="' + u + '"></audio>';
    }
    return '<div class="jegyzet" data-id="' + j.id + '">'
      + '<div class="ido">' + idoSzoveg(j.ido) + (j.hang ? ' · 🎧 ' + percMasodperc(j.hossz || 0) : '') + '</div>'
      + (j.szoveg ? '<div class="tartalom">' + esc(j.szoveg) + '</div>' : '')
      + hang
      + '<div class="muveletek">'
      + (j.szoveg ? '<button type="button" data-m="felolvas">' + (felolvasott === j.id ? '⏹ Leállítás' : '🔊 Felolvasás') + '</button>' : '')
      + (j.szoveg ? '<button type="button" data-m="masol">Szöveg másolása</button>' : '')
      + (j.szoveg ? '<button type="button" data-m="szovegment">Mentés fájlba</button>' : '')
      + (j.hang ? '<button type="button" data-m="hangment">Hang mentése fájlba</button>' : '')
      + '<button type="button" data-m="torol">Törlés</button>'
      + '</div><div class="jegyzet-uzenet" aria-live="polite"></div></div>';
  }).join('');
}

// Fájl mentése: APK-ban a Fájlmentés bővítménnyel a Dokumentumok mappába, böngészőben letöltéssel.
function blobBase64(blob) {
  return new Promise((kesz, hiba) => {
    const r = new FileReader();
    r.onload = () => kesz(String(r.result).split(',')[1]);
    r.onerror = () => hiba(r.error);
    r.readAsDataURL(blob);
  });
}
// A mappák a telefon Dokumentumok mappáján belül.
const MAPPA_HANG = 'Hangjegyzet';                // hangfelvételek
const MAPPA_SZOVEG = 'Hangjegyzet-Jegyzetek';    // diktált vagy írt jegyzetek (.txt)

const fajlIdo = j => idoSzoveg(j.ido).replace(/[ .:]/g, '-');

async function fajlbaMent(mappa, nev, blob) {
  if (Filesystem) {
    await Filesystem.writeFile({ path: mappa + '/' + nev, data: await blobBase64(blob), directory: 'DOCUMENTS', recursive: true });
    return 'Elmentve: Dokumentumok/' + mappa + '/' + nev;
  }
  if (apkban) throw new Error('Az APK-ban a fájlmentéshez a „Fájlmentés” bővítmény kell (JT AppKreator → Bővítmények…).');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nev;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'Letöltve: ' + nev;
}

function hangMent(j) {
  const kit = /mp4/.test(j.hangTipus) ? 'm4a' : /ogg/.test(j.hangTipus) ? 'ogg' : 'webm';
  return fajlbaMent(MAPPA_HANG, 'hangjegyzet-' + fajlIdo(j) + '.' + kit, j.hang);
}

// Szöveges jegyzet .txt-be (UTF-8, Windows-os sorvégekkel, hogy a Jegyzettömb is jól mutassa).
function szovegFajlMent(j) {
  const tartalom = '\ufeff' + (idoSzoveg(j.ido) + '\n\n' + j.szoveg + '\n').replace(/\r?\n/g, '\r\n');
  return fajlbaMent(MAPPA_SZOVEG, 'jegyzet-' + fajlIdo(j) + '.txt', new Blob([tartalom], { type: 'text/plain;charset=utf-8' }));
}

// Felolvasás: a szabványos speechSynthesis (böngészőben a Chrome-é, az APK-ban a Felolvasás bővítményé).
// Ugyanaz a gomb indítja és állítja le; egyszerre egy jegyzet szól.
function felolvas(j, gomb, uzen) {
  const S = window.speechSynthesis;
  if (!S || typeof window.SpeechSynthesisUtterance !== 'function') {
    throw new Error(apkban ? 'Az APK-ban a felolvasáshoz a „Felolvasás” bővítmény kell (JT AppKreator → Bővítmények…).' : 'Ez a böngésző nem tud felolvasni.');
  }
  if (felolvasott === j.id) { S.cancel(); return; }
  S.cancel();
  const u = new SpeechSynthesisUtterance(j.szoveg);
  u.lang = NYELV;
  const vege = () => {
    if (felolvasott === j.id) felolvasott = null;
    const b = document.querySelector('.jegyzet[data-id="' + j.id + '"] button[data-m="felolvas"]');
    if (b) b.textContent = '🔊 Felolvasás';
  };
  u.onstart = () => { felolvasott = j.id; gomb.textContent = '⏹ Leállítás'; uzen(''); };
  u.onend = vege;
  u.onerror = e => {
    vege();
    if (e.error !== 'interrupted' && e.error !== 'canceled') uzen('A felolvasás nem sikerült: ' + (e.message || e.error || 'ismeretlen hiba'), true);
  };
  felolvasott = j.id;
  gomb.textContent = '⏹ Leállítás';
  S.speak(u);
}

async function listaKattintas(e) {
  const b = e.target.closest('button[data-m]');
  if (!b) return;
  const elem = b.closest('.jegyzet');
  const id = Number(elem.dataset.id);
  const j = (await jegyzetekOlvas()).find(x => x.id === id);
  if (!j) return;
  // Az eredmény a jegyzet alatt látszik (a felső állapotsor a lista mellől nem látszana).
  const uzen = (szoveg, hiba) => {
    const u = elem.querySelector('.jegyzet-uzenet');
    u.textContent = szoveg;
    u.classList.toggle('hiba', !!hiba);
  };
  try {
    if (b.dataset.m === 'felolvas') {
      felolvas(j, b, uzen);
    } else if (b.dataset.m === 'masol') {
      await navigator.clipboard.writeText(j.szoveg);
      uzen('✓ A szöveg a vágólapon.');
    } else if (b.dataset.m === 'hangment' || b.dataset.m === 'szovegment') {
      b.disabled = true;
      uzen('Mentés…');
      try { uzen('✓ ' + await (b.dataset.m === 'hangment' ? hangMent(j) : szovegFajlMent(j))); } finally { b.disabled = false; }
    } else if (b.dataset.m === 'torol') {
      if (!confirm('Törlöd ezt a jegyzetet?')) return;
      if (felolvasott === id && window.speechSynthesis) window.speechSynthesis.cancel();
      await jegyzetTorol(id);
      listaRajzol();
      allapot('Törölve.');
    }
  } catch (err) {
    uzen(hibaSzoveg(err), true);
  }
}

// ===== Indítás =====
// Az alsó doboz utolsó sora: csak akkor szól, ha valami hiányzik.
function kornyezetKiir() {
  const hianyok = [];
  if (apkban) {
    if (!Beszed) hianyok.push('A diktáláshoz a JT AppKreatorban kapcsold be a „Beszédfelismerés” bővítményt.');
    if (!Filesystem) hianyok.push('A fájlba mentéshez a „Fájlmentés” bővítmény kell.');
    if (!window.speechSynthesis) hianyok.push('A felolvasáshoz a „Felolvasás” bővítmény kell.');
  } else {
    if (!BongeszoBeszed) hianyok.push('Ebben a böngészőben nem lehet diktálni – Chrome-ban megy.');
    if (!window.speechSynthesis) hianyok.push('Ez a böngésző nem tud felolvasni.');
  }
  $('kornyezet').textContent = hianyok.join(' ');
  $('kornyezet').hidden = !hianyok.length;
}

// Az alsó dobozban: hogyan lehet internet nélkül is diktálni (csak az APK-ban).
function offlineSugoKiir() {
  const p = $('offlineSugo');
  if (!Beszed) return;
  p.hidden = false;
  if (beszedHelyben) {
    p.innerHTML = '<b>Internet nélkül is:</b> a telefonod net nélkül is ért magyarul, így térerő nélkül is diktálhatsz.';
  } else {
    p.innerHTML = '<b>Internet nélkül is:</b> térerő nélkül is diktálhatsz, ha telepíted az ingyenes <b>Offline Voice Input</b> appot.<br>'
      + 'Ilyenkor a szöveg nem élőben, hanem a diktálás végén, egyben kerül a jegyzetbe. '
      + 'A diktálást egy koppintással fejezed be.<br>'
      + 'Első alkalommal a telefon megkérdezheti, melyik appal folytassa: válaszd az Offline Voice Inputot.<br>'
      + '<a class="play-link" href="' + OFFLINE_APP_LINK + '">Offline Voice Input a Play Áruházban</a>';
  }
}

async function indul() {
  $('verzio').textContent = typeof VERZIO !== 'undefined' ? 'v' + VERZIO : '';
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  // Tud-e a telefon internet nélkül, magyarul? (Android 13-tól, ha a nyelvcsomag megvan vagy letölthető.)
  if (Beszed && Beszed.isOnDeviceRecognitionAvailable) {
    try {
      const valasz = await Promise.race([
        Beszed.isOnDeviceRecognitionAvailable({ language: NYELV }),
        new Promise(kesz => setTimeout(() => kesz({ available: false }), 3000))   // ha nem válaszolna
      ]);
      beszedHelyben = !!(valasz && valasz.available);
    } catch (e) { beszedHelyben = false; }
  }
  // APK-ban mindig látszik: eszközön futó magyar felismerő nélkül a felugró ablakos (pl. Offline Voice Input) módot kapcsolja.
  $('helybenSor').hidden = !Beszed;
  try { $('helybenJelolo').checked = localStorage.getItem('hangjegyzet-helyben') === '1'; } catch (e) { /* nem baj */ }
  $('helybenJelolo').addEventListener('change', () => {
    try { localStorage.setItem('hangjegyzet-helyben', $('helybenJelolo').checked ? '1' : '0'); } catch (e) { /* nem baj */ }
  });
  offlineSugoKiir();
  kornyezetKiir();
  gombokFrissit();
  $('diktalGomb').addEventListener('click', () => { if (diktal) diktalLeallit(); else diktalIndit(); });
  $('felvetelGomb').addEventListener('click', () => { if (felvevo) felvetelLeallit(); else felvetelIndit(); });
  $('hangElvet').addEventListener('click', () => { ujHang = null; elonezetMutat(); gombokFrissit(); allapot('A felvételt elvetettem.'); });
  $('mentGomb').addEventListener('click', jegyzetMent);
  $('uritGomb').addEventListener('click', () => { if (diktal) diktalLeallit(); urit(); allapot(''); });
  $('lista').addEventListener('click', listaKattintas);
  // Ha az app a háttérbe kerül, a diktálás és a felvétel leáll (a telefon úgyis elvenné a mikrofont).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    // A felugró beszédablak is „háttérbe” teszi az appot – azt nem szabad leállítani.
    if (diktal && apkMod !== 'felugro') diktalLeallit();
    if (felvevo) felvetelLeallit();
  });
  try {
    db = await dbNyit();
    await listaRajzol();
  } catch (e) {
    allapot('A tároló nem nyílt meg: ' + hibaSzoveg(e), true);
  }
}

indul();

// Service worker regisztrálása (offline működés).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
