// Meldet eine Bestellung aus dem schmerzfrei24.com-Shop (Collmex) an Klick-Tipp.
//
// Aufgerufen von der Bestellbestätigungsseite des Shops per navigator.sendBeacon
// mit JSON {bestellnummer, email, summe, artikel}. artikel = "7:2;43:1" (Artikelnummer:Menge).
//
// Ablauf:
//  - Kontakt in Klick-Tipp vorhanden (auch abgemeldet): Tag "EdenGold-Kunde", je Artikel ein
//    Tag "Gekauft: …" + Umsatzfelder aktualisieren. Abgemeldete werden dabei NICHT wieder angemeldet.
//  - Kontakt nicht vorhanden: per Single-Opt-in eintragen (Bestandskunden-Ausnahme
//    § 7 Abs. 3 UWG) mit Tag und Umsatzfeldern.
//  - Gleiche Bestellnummer wie zuletzt gespeichert: nichts tun (Seite neu geladen).
//
// Benötigte Umgebungsvariablen in Vercel: KLICKTIPP_BENUTZER, KLICKTIPP_PASSWORT

const API = 'https://api.klicktipp.com';

const TAG_EDENGOLD_KUNDE = 15197611;
const OPTIN_PROZESS_SINGLE = 188069;

const FELD = {
  umsatzGesamt: 'field1002324',
  anzahlBestellungen: 'field1002325',
  letzterBestellwert: 'field1002326',
  letzteBestellungAm: 'field1002327',
  letzteBestellnummer: 'field1002328',
  letzteArtikel: 'field1002382',
};

// Collmex-Artikelnummer -> Name im Tag "Gekauft: …". Fehlende Tags werden automatisch angelegt.
const PRODUKTE = {
  2: 'Buch Dekonstruktion im Menschen',
  7: 'EdenGold N (Nieren)',
  8: 'EdenGold L (Leber)',
  9: 'EdenGold Komplettpaket',
  16: 'EdenGold Bittersalz-Kapseln',
  35: 'EdenGold Kräutersalbe',
  41: 'EdenGold Darmpflege',
  42: 'EdenGold Quellpulver',
  43: 'EdenGold Kräuterkapseln',
  44: 'EdenGold Probiotika Komplex',
  45: 'Körperbürste',
  46: 'Anleitung Darmpflege',
  75: 'Beratungsgespräch',
  78: 'Buch Die Gesetze der wahren Wunscherfüllung',
  79: 'E-Book Die Gesetze der wahren Wunscherfüllung',
};

// Das Komplettpaket enthält diese Artikel und bekommt deren Tags mit
const ENTHAELT = { 9: [7, 8, 41, 16] };

const TAG_PRAEFIX = 'Gekauft: ';

const ERLAUBTE_HERKUNFT = ['https://www.schmerzfrei24.com', 'https://schmerzfrei24.com'];

function formular(daten, prefix = '') {
  const teile = [];
  for (const [schluessel, wert] of Object.entries(daten)) {
    const name = prefix ? `${prefix}[${schluessel}]` : schluessel;
    if (wert !== null && typeof wert === 'object') {
      teile.push(formular(wert, name));
    } else if (wert !== undefined) {
      teile.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(wert))}`);
    }
  }
  return teile.filter(Boolean).join('&');
}

async function klicktipp(pfad, methode, daten, cookie) {
  const antwort = await fetch(`${API}${pfad}.json`, {
    method: methode,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: methode === 'GET' ? undefined : formular(daten || {}),
  });
  const text = await antwort.text();
  let inhalt;
  try {
    inhalt = JSON.parse(text);
  } catch {
    inhalt = text;
  }
  return { ok: antwort.ok, status: antwort.status, inhalt };
}

function zahl(wert) {
  if (wert === undefined || wert === null || wert === '') return 0;
  let s = String(wert).trim();
  // "1.234,56" (deutsch) -> "1234.56"; "1234.56" bleibt
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

// Liest ein Klick-Tipp-Dezimalfeld als Cent. Je nach Antwort kommt der Wert
// als Cent-Ganzzahl ("4837") oder als Betrag ("48.37" / "48,37").
function centAusFeld(wert) {
  if (wert === undefined || wert === null || wert === '') return 0;
  const s = String(wert).trim();
  if (/[.,]/.test(s)) return Math.round(zahl(s) * 100);
  return Math.round(zahl(s));
}

// "7:2;43:1" -> [{nr:'7', menge:2}, {nr:'43', menge:1}]; ungültige Einträge werden ignoriert
function artikelListe(wert) {
  return String(wert || '')
    .split(';')
    .slice(0, 30)
    .map((teil) => /^\s*([0-9]{1,10}):([0-9.,]{1,10})\s*$/.exec(teil))
    .filter(Boolean)
    .map((m) => ({ nr: m[1], menge: Math.max(1, Math.round(zahl(m[2]))) }));
}

function tagNamenFuer(artikel) {
  const namen = new Set();
  for (const { nr } of artikel) {
    for (const n of [nr, ...(ENTHAELT[nr] || [])]) {
      // Unbekannte Nummern bekommen keinen eigenen Tag (Endpunkt ist öffentlich erreichbar)
      namen.add(TAG_PRAEFIX + (PRODUKTE[n] || 'sonstiger Artikel'));
    }
  }
  return [...namen];
}

// Liefert die Tag-IDs zu den Namen und legt fehlende Tags an
async function tagIds(namen, cookie) {
  if (!namen.length) return [];
  const liste = await klicktipp('/tag', 'GET', null, cookie);
  const vorhanden = new Map();
  for (const [id, name] of Object.entries(liste.ok && typeof liste.inhalt === 'object' ? liste.inhalt : {})) {
    vorhanden.set(String(name), Number(id));
  }
  const ids = [];
  for (const name of namen) {
    let id = vorhanden.get(name);
    if (!id) {
      const neu = await klicktipp('/tag', 'POST', { name }, cookie);
      id = Number(Array.isArray(neu.inhalt) ? neu.inhalt[0] : neu.inhalt);
      if (!neu.ok || !id) {
        console.error('Tag anlegen fehlgeschlagen', name, neu.status, neu.inhalt);
        continue;
      }
    }
    ids.push(id);
  }
  return ids;
}

function artikelText(artikel) {
  return artikel
    .map(({ nr, menge }) => `${menge}x ${PRODUKTE[nr] || `Artikel ${nr}`}`)
    .join(', ')
    .slice(0, 250);
}

export default async function handler(req, res) {
  const herkunft = req.headers.origin;
  if (ERLAUBTE_HERKUNFT.includes(herkunft)) {
    res.setHeader('Access-Control-Allow-Origin', herkunft);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ fehler: 'Nur POST' });

  let daten = req.body;
  if (typeof daten === 'string') {
    try {
      daten = JSON.parse(daten);
    } catch {
      return res.status(400).json({ fehler: 'Ungültiges JSON' });
    }
  }
  const email = String(daten?.email || '').trim().toLowerCase();
  const bestellnummer = String(daten?.bestellnummer || '').trim();
  // Klick-Tipp speichert Dezimalzahl-Felder in Cent (48,37 € = 4837)
  const summeCent = Math.round(zahl(daten?.summe) * 100);
  const artikel = artikelListe(daten?.artikel);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return res.status(400).json({ fehler: 'Ungültige E-Mail' });
  }
  if (!/^[A-Za-z0-9-]{1,30}$/.test(bestellnummer)) {
    return res.status(400).json({ fehler: 'Ungültige Bestellnummer' });
  }

  const benutzer = process.env.KLICKTIPP_BENUTZER;
  const passwort = process.env.KLICKTIPP_PASSWORT;
  if (!benutzer || !passwort) {
    return res.status(500).json({ fehler: 'Klick-Tipp-Zugang fehlt' });
  }

  const anmeldung = await klicktipp('/account/login', 'POST', { username: benutzer, password: passwort });
  if (!anmeldung.ok || !anmeldung.inhalt?.sessid) {
    console.error('Klick-Tipp-Login fehlgeschlagen', anmeldung.status, anmeldung.inhalt);
    return res.status(502).json({ fehler: 'Klick-Tipp-Login fehlgeschlagen' });
  }
  const cookie = `${anmeldung.inhalt.session_name}=${anmeldung.inhalt.sessid}`;

  try {
    const heute = Math.floor(Date.now() / 1000);
    const artikelFelder = artikel.length ? { [FELD.letzteArtikel]: artikelText(artikel) } : {};
    const produktTags = await tagIds(tagNamenFuer(artikel), cookie);
    const suche = await klicktipp('/subscriber/search', 'POST', { email }, cookie);
    const kontaktId = suche.ok ? (Array.isArray(suche.inhalt) ? suche.inhalt[0] : suche.inhalt) : null;

    if (!kontaktId) {
      const neu = await klicktipp(
        '/subscriber',
        'POST',
        {
          email,
          listid: OPTIN_PROZESS_SINGLE,
          tagid: TAG_EDENGOLD_KUNDE,
          fields: {
            [FELD.umsatzGesamt]: summeCent,
            [FELD.anzahlBestellungen]: 1,
            [FELD.letzterBestellwert]: summeCent,
            [FELD.letzteBestellungAm]: heute,
            [FELD.letzteBestellnummer]: bestellnummer,
            ...artikelFelder,
          },
        },
        cookie,
      );
      const tag = produktTags.length
        ? await klicktipp('/subscriber/tag', 'POST', { email, tagids: produktTags }, cookie)
        : { ok: true };
      console.log('Neuer Kontakt', bestellnummer, neu.status, tag.status, artikel.length);
      return res.status(neu.ok && tag.ok ? 200 : 502).json({ ergebnis: neu.ok ? 'neu eingetragen' : 'Fehler beim Eintragen' });
    }

    const kontakt = await klicktipp(`/subscriber/${kontaktId}`, 'GET', null, cookie);
    const felder = kontakt.inhalt || {};
    if (String(felder[FELD.letzteBestellnummer] || '') === bestellnummer) {
      return res.status(200).json({ ergebnis: 'bereits erfasst' });
    }

    const umsatzNeu = centAusFeld(felder[FELD.umsatzGesamt]) + summeCent;
    const anzahlNeu = Math.round(zahl(felder[FELD.anzahlBestellungen])) + 1;

    const aenderung = await klicktipp(
      `/subscriber/${kontaktId}`,
      'PUT',
      {
        fields: {
          [FELD.umsatzGesamt]: umsatzNeu,
          [FELD.anzahlBestellungen]: anzahlNeu,
          [FELD.letzterBestellwert]: summeCent,
          [FELD.letzteBestellungAm]: heute,
          [FELD.letzteBestellnummer]: bestellnummer,
          ...artikelFelder,
        },
      },
      cookie,
    );
    const tag = await klicktipp('/subscriber/tag', 'POST', { email, tagids: [TAG_EDENGOLD_KUNDE, ...produktTags] }, cookie);
    console.log('Bestehender Kontakt', bestellnummer, aenderung.status, tag.status, artikel.length);
    return res.status(aenderung.ok && tag.ok ? 200 : 502).json({ ergebnis: 'aktualisiert' });
  } finally {
    await klicktipp('/account/logout', 'POST', {}, cookie).catch(() => {});
  }
}
