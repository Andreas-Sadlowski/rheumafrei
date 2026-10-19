// Teilt Buchkaeufer der Startplan-Seite A oder B zu und markiert sie in Klick-Tipp.
//
// Aufgerufen von schmerzfrei24.com (Weiche /start/ und die Startplan-Seiten) per POST mit
// JSON {email, bestellnummer, variante?}. Der Body wird als text/plain gesendet (kein Preflight).
//
// Ablauf:
//  - Kontakt hat schon "Startplan A" oder "Startplan B": diese Variante zurueckgeben (bleibt gleich).
//  - Sonst: wurde "variante" mitgeschickt (A/B), diese nehmen. Ohne "variante" die Seite waehlen,
//    die weniger Kontakte hat (strikt ausgleichend: A, B, A, B ...), bei Gleichstand A.
//  - Kontakt in Klick-Tipp vorhanden: Tag setzen. Kontakt NICHT vorhanden: NICHTS anlegen,
//    nur die Variante zurueckgeben (die Seite versucht das Tag spaeter nochmal).
//  - Es werden keine personenbezogenen Daten zurueckgegeben.
//
// Benoetigte Umgebungsvariablen in Vercel: KLICKTIPP_BENUTZER, KLICKTIPP_PASSWORT (wie edengold-bestellung)

const API = 'https://api.klicktipp.com';
const TAG_A = 'Startplan A';
const TAG_B = 'Startplan B';
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

// Liefert die Tag-IDs zu den Namen und legt fehlende Tags an
async function tagIds(namen, cookie) {
  const liste = await klicktipp('/tag', 'GET', null, cookie);
  const vorhanden = new Map();
  for (const [id, name] of Object.entries(liste.ok && typeof liste.inhalt === 'object' ? liste.inhalt : {})) {
    vorhanden.set(String(name), Number(id));
  }
  const ergebnis = {};
  for (const name of namen) {
    let id = vorhanden.get(name);
    if (!id) {
      const neu = await klicktipp('/tag', 'POST', { name }, cookie);
      id = Number(Array.isArray(neu.inhalt) ? neu.inhalt[0] : neu.inhalt);
      if (!neu.ok || !id) {
        console.error('Tag anlegen fehlgeschlagen', name, neu.status, neu.inhalt);
        id = null;
      }
    }
    ergebnis[name] = id;
  }
  return ergebnis;
}

// Kontakt-IDs, die ein Tag tragen. Antwortform kann Liste oder Objekt sein.
async function kontakteMitTag(tagid, cookie) {
  if (!tagid) return null;
  const r = await klicktipp('/subscriber/tagged', 'POST', { tagid }, cookie);
  if (!r.ok || r.inhalt === null || r.inhalt === undefined) return null;
  const roh = Array.isArray(r.inhalt) ? r.inhalt : typeof r.inhalt === 'object' ? Object.keys(r.inhalt) : [];
  return roh.map((x) => String(x));
}

export default async function handler(req, res) {
  const herkunft = req.headers.origin;
  if (ERLAUBTE_HERKUNFT.includes(herkunft)) {
    res.setHeader('Access-Control-Allow-Origin', herkunft);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
  const gewuenscht = String(daten?.variante || '').trim().toUpperCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return res.status(400).json({ fehler: 'Ungültige E-Mail' });
  }
  if (bestellnummer && !/^[A-Za-z0-9-]{1,30}$/.test(bestellnummer)) {
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
    const ids = await tagIds([TAG_A, TAG_B], cookie);
    const suche = await klicktipp('/subscriber/search', 'POST', { email }, cookie);
    const kontaktId = suche.ok ? String(Array.isArray(suche.inhalt) ? suche.inhalt[0] : suche.inhalt || '') : '';

    const listeA = await kontakteMitTag(ids[TAG_A], cookie);
    const listeB = await kontakteMitTag(ids[TAG_B], cookie);

    // 1) Schon zugeteilt: gleiche Variante wie beim ersten Mal
    let variante = '';
    if (kontaktId && listeA && listeA.includes(kontaktId)) variante = 'A';
    else if (kontaktId && listeB && listeB.includes(kontaktId)) variante = 'B';

    const schonGetaggt = variante !== '';

    // 2) Neu: gewuenschte Variante oder die mit weniger Kontakten
    if (!variante) {
      if (gewuenscht === 'A' || gewuenscht === 'B') {
        variante = gewuenscht;
      } else if (listeA && listeB) {
        variante = listeB.length < listeA.length ? 'B' : 'A';
      } else {
        variante = Math.random() < 0.5 ? 'A' : 'B';
      }
    }

    // 3) Tag setzen, wenn der Kontakt existiert und noch keines hat
    let getaggt = schonGetaggt;
    if (!schonGetaggt && kontaktId) {
      const tagid = ids[variante === 'A' ? TAG_A : TAG_B];
      if (tagid) {
        const t = await klicktipp('/subscriber/tag', 'POST', { email, tagids: [tagid] }, cookie);
        getaggt = t.ok;
      }
    }

    console.log('Startplan-Zuteilung', bestellnummer || '-', variante, 'getaggt', getaggt, 'gefunden', Boolean(kontaktId), 'A/B', listeA ? listeA.length : '?', listeB ? listeB.length : '?');
    // Zaehlstaende (nur Zahlen, keine Personendaten) zur Kontrolle der Verteilung
    return res.status(200).json({
      variante,
      getaggt,
      gefunden: Boolean(kontaktId),
      anzahlA: listeA ? listeA.length : null,
      anzahlB: listeB ? listeB.length : null,
    });
  } finally {
    await klicktipp('/account/logout', 'POST', {}, cookie).catch(() => {});
  }
}
