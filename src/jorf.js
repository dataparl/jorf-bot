// Balayage du Journal officiel (JORF, edition « Lois et decrets ») :
// téléchargement des dumps quotidiens de la DILA (JORFSIMPLE), extraction des
// mesures nominatives qui concernent le gouvernement (ministres) et les
// cabinets ministériels (directeurs, chefs de cabinet, conseillers…).
// Portage 1:1 de webapp/lib/jorf.ts — zéro dépendance, Node natif.
// Source : dumps JORFSIMPLE de la DILA (Premier ministre / data.gouv.fr,
// réutilisation libre).

import { inflateRawSync } from "node:zlib";

const BASE = "https://echanges.dila.gouv.fr/OPENDATA/JORFSIMPLE";

export const lienJORF = (date) => `${BASE}/JORFSIMPLE_${date.replace(/-/g, "")}.zip`;

export const cleNom = (...parts) => {
  const txt = parts.join(" ").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[-'’`.]/g, " ").replace(/[^a-z0-9 ]/g, "");
  return txt.split(/\s+/).filter(Boolean).sort().join(" ");
};

// ---------------------------------------------------------------------------
// 1. Zip : lecture du répertoire central puis décompression (méthode 0 ou 8).
// ---------------------------------------------------------------------------
export function xmlDuZip(buf) {
  const fin = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])); // EOCD
  if (fin < 0) throw new Error("JORF : zip illisible (pas de fin de répertoire)");
  const nbEntrees = buf.readUInt16LE(fin + 10);
  const dir = buf.readUInt32LE(fin + 16);
  const out = [];
  let p = dir;
  for (let i = 0; i < nbEntrees; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const methode = buf.readUInt16LE(p + 10);
    const tailleCompressee = buf.readUInt32LE(p + 20);
    const taille = buf.readUInt32LE(p + 24);
    const nomLong = buf.readUInt16LE(p + 28);
    const extraLong = buf.readUInt16LE(p + 30);
    const commLong = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const nom = buf.toString("utf8", p + 46, p + 46 + nomLong);
    if (nom.toLowerCase().endsWith(".xml") && taille > 0 && taille < 60_000_000) {
      const nl = buf.readUInt16LE(offset + 26);
      const el = buf.readUInt16LE(offset + 28);
      const debut = offset + 30 + nl + el;
      const brut = buf.subarray(debut, debut + tailleCompressee);
      out.push(methode === 8 ? inflateRawSync(brut).toString("utf8") : brut.toString("utf8"));
    }
    p += 46 + nomLong + extraLong + commLong;
  }
  if (!out.length) throw new Error("JORF : aucun fichier XML dans le zip");
  return out;
}

// ---------------------------------------------------------------------------
// 2. XML : analyse légère (balises plates du DTD LEGIFRANCE).
// ---------------------------------------------------------------------------
const balise = (xml, champ, dans) => {
  const base = dans ?? xml;
  const m = new RegExp(`<${champ}[^>]*>([\\s\\S]*?)</${champ}>`, "i").exec(base);
  return m ? m[1].trim() : null;
};

export const sansBalises = (x) =>
  x.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, " ").trim();

function personnesDuTexte(metaSm) {
  const out = [];
  for (const m of metaSm.matchAll(/<PERSONNE\b([^>]*?)\/>|<PERSONNE\b([^>]*)>([\s\S]*?)<\/PERSONNE>/gi)) {
    const attrs = (m[1] ?? m[2] ?? "") + " " + (m[3] ?? "");
    const nom = /nom\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? sansBalises(balise(m[0], "NOM") ?? "");
    const prenom = /prenom\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? sansBalises(balise(m[0], "PRENOM") ?? "");
    const civ = /civilite\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? sansBalises(balise(m[0], "CIVILITE") ?? "");
    if (nom && prenom) out.push({ civilite: /^\s*Mme|Madame/i.test(civ) ? "Mme" : "M.", prenom: prenom.trim(), nom: nom.trim() });
  }
  return out;
}

const FONCTIONS_CABINET = [
  "directeur adjoint de cabinet", "directrice adjointe de cabinet",
  "adjoint au directeur de cabinet", "adjointe au directeur de cabinet",
  "directeur de cabinet", "directrice de cabinet",
  "chef de cabinet", "cheffe de cabinet",
  "conseiller", "conseillère",
  "conseiller technique", "conseillère technique",
  "chef adjoint de cabinet", "cheffe adjointe de cabinet",
  "chargé de mission", "chargée de mission",
];

const nomApostrophe = (prenom, nom) => {
  const echappe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[\s]+/g, "\\s+");
  return new RegExp(`${echappe(nom)}\\s*[,«]?\\s*${echappe(prenom)}|${echappe(prenom)}\\s+${echappe(nom)}`, "i");
};

export function analyserJORF(xml, dateDefaut) {
  const out = [];
  const blocs = xml.match(/<TEXTE\b[\s\S]*?<\/TEXTE>/gi) ?? [xml];
  for (const bloc of blocs) {
    const titre = sansBalises(balise(bloc, "TITRE") ?? "");
    if (!/(nomination|cessation de fonctions|fin de fonctions|révocation|relatif à la composition|portant cessation)/i.test(titre)) continue;
    const nature = balise(bloc, "NATURE") ?? "Décret";
    if (!/^(décret|arrêté)$/i.test(nature)) continue;
    const dateBrute = balise(bloc, "DATE_TEXTE") ?? (dateDefaut ? dateDefaut.replace(/-/g, "") : "");
    const date = dateBrute ? `${dateBrute.slice(0, 4)}-${dateBrute.slice(4, 6)}-${dateBrute.slice(6, 8)}` : dateDefaut ?? "";
    const id = balise(bloc, "ID_TEXTE") ?? `${date}-${out.length}`;
    const sm = balise(bloc, "SM") ?? "";
    const contenu = sansBalises(balise(bloc, "CONTENU") ?? "");
    const texte = `${titre}. ${contenu}`;
    const type = /(cessation de fonctions|fin de fonctions|révocation|cessation)/i.test(titre) ? "cessation" : "nomination";
    const personnes = personnesDuTexte(sm);
    for (const p of personnes) {
      const autour = (() => {
        const m = nomApostrophe(p.prenom, p.nom).exec(texte);
        if (!m) return texte.slice(0, 400);
        return texte.slice(Math.max(0, m.index - 260), Math.min(texte.length, m.index + 420));
      })();
      const rMinistre = /(ministre d[e']\s?[ÉEa-zéèêàâ\s,'-]{3,80}|ministre chargé[e]? de[^,.;]{3,80}|Premier ministre|secrétaire d[ée]?tat [àa][^,.;]{3,60})/i.exec(autour);
      const rCabinet = FONCTIONS_CABINET.map((f) => new RegExp(f, "i").exec(autour)).find(Boolean);
      const role = rCabinet && !/ministre\s/i.test(autour.slice(0, 40)) ? "cabinet" : rMinistre ? "ministre" : rCabinet ? "cabinet" : "ministre";
      const ministre = (() => {
        if (role !== "cabinet") return null;
        const m = /(?:auprès|chez|cabinet)\s+d[e']?\s*(?:M\.|Mme|Madame|Monsieur)\s+([A-ZÉÈ][\p{L}'’-]+)\s+([A-ZÉÈ][\p{L}'’-]+(?:\s+[A-ZÉÈ][\p{L}'’-]+)?)/u.exec(autour);
        if (m) {
          const nom = m[1] === m[1].toUpperCase() ? m[1] : m[2];
          const prenom = m[1] === m[1].toUpperCase() ? m[2] : m[1];
          return { prenom, nom };
        }
        return null;
      })();
      out.push({
        id_texte: id, date, nature, titre, type, role,
        civilite: p.civilite, prenom: p.prenom, nom: p.nom,
        fonction: (rCabinet?.[0] ?? rMinistre?.[0] ?? "").trim(),
        portefeuille: role === "ministre" ? (rMinistre?.[0] ?? "").replace(/^ministre\s*/i, "").trim() : "",
        ministre,
        extrait: autour.replace(/\s+/g, " ").slice(0, 400),
      });
    }
    if (!personnes.length) {
      for (const m of texte.matchAll(/(?:M\.|Mme)\s+([A-ZÉÈ][\p{L}'’-]+)\s+([A-ZÉÈ][\p{L}'’-]+(?:\s+[A-ZÉÈ][\p{L}'’-]+){0,2})/gu)) {
        const autour = texte.slice(Math.max(0, m.index - 100), m.index + 320);
        if (!/(cabinet|ministre|secrétaire d[ée]?tat)/i.test(autour)) continue;
        out.push({
          id_texte: id, date, nature, titre,
          type: /(cessation|révocation|fin de fonctions)/i.test(titre) ? "cessation" : "nomination",
          role: /cabinet|conseiller/i.test(autour) && !/ministre\s/i.test(autour.slice(0, 40)) ? "cabinet" : "ministre",
          civilite: m[0].startsWith("Mme") ? "Mme" : "M.",
          prenom: m[1], nom: m[2],
          fonction: FONCTIONS_CABINET.map((f) => new RegExp(f, "i").exec(autour)).find(Boolean)?.[0] ?? (/ministre/i.test(autour) ? "ministre" : ""),
          portefeuille: (/(ministre d[e']?\s?[a-zéèêàâ\s,'-]{3,80})/i.exec(autour)?.[0] ?? "").replace(/^ministre\s*/i, "").trim(),
          ministre: null,
          extrait: autour,
        });
      }
    }
  }
  const vus = new Set();
  return out.filter((m) => {
    const k = `${m.id_texte}|${cleNom(m.prenom, m.nom)}|${m.type}|${m.role}`;
    if (vus.has(k)) return false;
    vus.add(k);
    return true;
  });
}

const UA = "DataParl (https://www.dataparl.fr), jorf-bot";

// Fenêtre disponible sur JORFSIMPLE (index du dossier) : la DILA ne conserve
// qu'une fenêtre glissante de quelques mois de zips quotidiens. Savoir jusqu'où
// on peut remonter évite de « balayer » des jours qui n'existent plus.
export async function fenetreJorfsimple() {
  const r = await fetch(`${BASE}/`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25_000) });
  if (!r.ok) throw new Error(`index JORFSIMPLE : HTTP ${r.status}`);
  const texte = await r.text();
  const dates = [...texte.matchAll(/JORFSIMPLE_(\d{8})\.zip/gi)].map((m) => m[1]).sort();
  if (!dates.length) throw new Error("index JORFSIMPLE illisible (aucun zip listé)");
  return { premier: dates[0], dernier: dates[dates.length - 1], nb: dates.length };
}

// Télécharge le JORF d'un jour et rend ses mesures nominatives. La DILA coupe
// parfois les connexions : trois essais avec pauses croissantes.
export async function releverJour(date) {
  let r = null;
  let derniereErreur = null;
  for (let essai = 0; essai < 3; essai += 1) {
    try {
      r = await fetch(lienJORF(date), { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25_000) });
      break;
    } catch (e) {
      derniereErreur = e;
      r = null;
      await new Promise((ok) => setTimeout(ok, 2000 * (essai + 1)));
    }
  }
  if (!r) throw new Error(`JORF ${date} : inaccessible (${derniereErreur?.message ?? "réseau"})`);
  if (r.status === 404) return []; // pas de publication ce jour-là (ou hors fenêtre)
  if (!r.ok) throw new Error(`JORF ${date} : HTTP ${r.status}`);
  const brut = Buffer.from(await r.arrayBuffer());
  if (brut.length > 80_000_000) throw new Error(`JORF ${date} : zip trop volumineux`);
  return xmlDuZip(brut).flatMap((x) => analyserJORF(x, date));
}

// ---------------------------------------------------------------------------
// 3. XML du dump Freemium global (famille article/) : format spécifique.
//    Le texte parent vit dans CONTEXTE/TEXTE (attributs cid, date_publi,
//    nature + TITRE_TXT), le contenu de l'article dans BLOC_TEXTUEL.
//    Produit exactement les mêmes mesures qu'analyserJORF.
// ---------------------------------------------------------------------------
export function analyserArticleFreemium(xml) {
  const out = [];
  const ctx = /<CONTEXTE>[\s\S]*?<TEXTE\b([^>]*)>([\s\S]*?)<\/TEXTE>/i.exec(xml);
  if (!ctx) return out;
  const attrs = ctx[1];
  const cid = / cid="([^"]+)"/i.exec(attrs)?.[1] ?? "";
  const date = / date_publi="([^"]+)"/i.exec(attrs)?.[1] ?? "";
  const natureBrute = / nature="([^"]+)"/i.exec(attrs)?.[1] ?? "";
  const nature = { DECRET: "Décret", ARRETE: "Arrêté" }[natureBrute.toUpperCase()] ?? natureBrute;
  const titre = sansBalises(/<TITRE_TXT\b[^>]*>([\s\S]*?)<\/TITRE_TXT>/i.exec(ctx[2])?.[1] ?? "");
  if (!/(nomination|cessation de fonctions|fin de fonctions|révocation|relatif à la composition|portant cessation)/i.test(titre)) return out;
  if (!/^(décret|arrêté)$/i.test(nature)) return out;
  if (!date) return out;
  const id = cid || `${date}-0`;
  const sm = /<SM\b[^>]*>([\s\S]*?)<\/SM>/i.exec(xml)?.[1] ?? "";
  const bloc = /<BLOC_TEXTUEL\b[^>]*>([\s\S]*?)<\/BLOC_TEXTUEL>/i.exec(xml);
  const contenu = sansBalises(bloc?.[1] ?? "");
  const texte = `${titre}. ${contenu}`;
  const type = /(cessation de fonctions|fin de fonctions|révocation|cessation)/i.test(titre) ? "cessation" : "nomination";
  const personnes = personnesDuTexte(sm);
  for (const p of personnes) {
    const autour = (() => {
      const m = nomApostrophe(p.prenom, p.nom).exec(texte);
      if (!m) return texte.slice(0, 400);
      return texte.slice(Math.max(0, m.index - 260), Math.min(texte.length, m.index + 420));
    })();
    const rMinistre = /(ministre d[e']\s?[ÉEa-zéèêàâ\s,'-]{3,80}|ministre chargé[e]? de[^,.;]{3,80}|Premier ministre|secrétaire d[ée]?tat [àa][^,.;]{3,60})/i.exec(autour);
    const rCabinet = FONCTIONS_CABINET.map((f) => new RegExp(f, "i").exec(autour)).find(Boolean);
    const role = rCabinet && !/ministre\s/i.test(autour.slice(0, 40)) ? "cabinet" : rMinistre ? "ministre" : rCabinet ? "cabinet" : "ministre";
    const ministre = (() => {
      if (role !== "cabinet") return null;
      const m = /(?:auprès|chez|cabinet)\s+d[e']?\s*(?:M\.|Mme|Madame|Monsieur)\s+([A-ZÉÈ][\p{L}'’-]+)\s+([A-ZÉÈ][\p{L}'’-]+(?:\s+[A-ZÉÈ][\p{L}'’-]+)?)/u.exec(autour);
      if (m) {
        const nom = m[1] === m[1].toUpperCase() ? m[1] : m[2];
        const prenom = m[1] === m[1].toUpperCase() ? m[2] : m[1];
        return { prenom, nom };
      }
      return null;
    })();
    out.push({
      id_texte: id, date, nature, titre, type, role,
      civilite: p.civilite, prenom: p.prenom, nom: p.nom,
      fonction: (rCabinet?.[0] ?? rMinistre?.[0] ?? "").trim(),
      portefeuille: (rMinistre?.[0] ?? "").replace(/^ministre\s*/i, "").trim(),
      ministre,
      extrait: autour.replace(/\s+/g, " ").slice(0, 400),
    });
  }
  if (!personnes.length) {
    for (const m of texte.matchAll(/(?:M\.|Mme)\s+([A-ZÉÈ][\p{L}'’-]+)\s+([A-ZÉÈ][\p{L}'’-]+(?:\s+[A-ZÉÈ][\p{L}'’-]+){0,2})/gu)) {
      const autour = texte.slice(Math.max(0, m.index - 100), m.index + 320);
      if (!/(cabinet|ministre|secrétaire d[ée]?tat)/i.test(autour)) continue;
      out.push({
        id_texte: id, date, nature, titre,
        type: /(cessation|révocation|fin de fonctions)/i.test(titre) ? "cessation" : "nomination",
        role: /cabinet|conseiller/i.test(autour) && !/ministre\s/i.test(autour.slice(0, 40)) ? "cabinet" : "ministre",
        civilite: m[0].startsWith("Mme") ? "Mme" : "M.",
        prenom: m[1], nom: m[2],
        fonction: FONCTIONS_CABINET.map((f) => new RegExp(f, "i").exec(autour)).find(Boolean)?.[0] ?? (/ministre/i.test(autour) ? "ministre" : ""),
        portefeuille: (/(Premier ministre|ministre d[e']?\s?[^,.;]{3,80})/i.exec(autour)?.[0] ?? "").replace(/^ministre\s*/i, "").trim(),
        ministre: null,
        extrait: autour,
      });
    }
  }
  const vus = new Set();
  return out.filter((m) => {
    const k = `${m.id_texte}|${cleNom(m.prenom, m.nom)}|${m.type}|${m.role}`;
    if (vus.has(k)) return false;
    vus.add(k);
    return true;
  });
}
