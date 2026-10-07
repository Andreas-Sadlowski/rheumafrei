// Meldet eine Bestellung aus dem schmerzfrei24.com-Shop (Collmex) an Klick-Tipp.
//
// Aufgerufen von der Bestellbestätigungsseite des Shops per navigator.sendBeacon
// mit JSON {bestellnummer, email, summe}.
//
// Ablauf:
//  - Kontakt in Klick-Tipp vorhanden (auch abgemeldet): Tag "EdenGold-Kunde" + Umsatzfelder
//    aktualisieren. Abgemeldete werden dabei NICHT wieder angemeldet.
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
};

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
          },
        },
        cookie,
      );
      console.log('Neuer Kontakt', bestellnummer, neu.status);
      return res.status(neu.ok ? 200 : 502).json({ ergebnis: neu.ok ? 'neu eingetragen' : 'Fehler beim Eintragen' });
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
        },
      },
      cookie,
    );
    const tag = await klicktipp('/subscriber/tag', 'POST', { email, tagids: [TAG_EDENGOLD_KUNDE] }, cookie);
    console.log('Bestehender Kontakt', bestellnummer, aenderung.status, tag.status);
    return res.status(aenderung.ok && tag.ok ? 200 : 502).json({ ergebnis: 'aktualisiert' });
  } finally {
    await klicktipp('/account/logout', 'POST', {}, cookie).catch(() => {});
  }
}
