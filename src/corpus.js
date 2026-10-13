// Import en un coup du corpus Freemium JORF (dump global DILA, 1,6 Go) :
// parcours récursif des XML extraits, extraction des mesures nominatives avec
// les mêmes filtres que le balayage quotidien (analyserJORF), puis import par
// date via importerMesures. Idempotent : les écritures sont des upsert.
// Usage : node bin/jorf-bot.js corpus <dossier-xml-jorf> 2012-01-01 [2025-07-13]

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { analyserJORF } from "./jorf.js";
import { importerMesures } from "./import.js";

// Rejet rapide avant analyse : le titre doit contenir un mot-clé nominatif
// (même filtre que analyserJORF, testé sur le XML brut, bien plus rapide).
const FILTRE_TITRE = /(nomination|cessation de fonctions|fin de fonctions|révocation|relatif à la composition|portant cessation)/i;
const PARALLELE = 16; // fichiers lus et analysés en parallèle

async function listerXml(chemin) {
  const fichiers = [];
  const aParcourir = [chemin];
  while (aParcourir.length) {
    const dossier = aParcourir.pop();
    for (const e of await readdir(dossier, { withFileTypes: true })) {
      if (e.isDirectory()) aParcourir.push(join(dossier, e.name));
      else if (e.isFile() && /\.xml$/i.test(e.name)) fichiers.push(join(dossier, e.name));
    }
  }
  return fichiers;
}

export async function importerCorpus(chemin, debut, fin, verbeux = true) {
  const fichiers = await listerXml(chemin);
  if (!fichiers.length) throw new Error(`Aucun fichier XML trouvé sous ${chemin} — vérifier le chemin (le dossier du fonds JORF, pas la racine de l'archive).`);
  if (verbeux) console.log(`${fichiers.length} fichier(s) XML à parcourir (filtre ${debut} → ${fin})…`);
  const mesures = [];
  for (let i = 0; i < fichiers.length; i += PARALLELE) {
    const lot = await Promise.all(fichiers.slice(i, i + PARALLELE).map(async (p) => {
      const infos = await stat(p).catch(() => null);
      if (!infos || infos.size === 0 || infos.size > 60_000_000) return [];
      const xml = await readFile(p, "utf8").catch(() => "");
      if (!xml || !FILTRE_TITRE.test(xml)) return [];
      // Pas de date par défaut dans le corpus : DATE_TEXTE du texte fait foi.
      return analyserJORF(xml).filter((m) => m.date >= debut && m.date <= fin);
    }));
    mesures.push(...lot.flat());
    if (verbeux && (i / PARALLELE) % 200 === 199) {
      console.log(`  … ${Math.min(i + PARALLELE, fichiers.length)} fichiers parcourus, ${mesures.length} mesure(s)`);
    }
  }
  // Regroupement par date, puis import jour par jour (rapprochements inclus).
  const parJour = new Map();
  for (const m of mesures) {
    if (!parJour.has(m.date)) parJour.set(m.date, []);
    parJour.get(m.date).push(m);
  }
  const dates = [...parJour.keys()].sort();
  let ministres = 0, cabinets = 0, erreurs = 0;
  for (const d of dates) {
    const out = await importerMesures(d, parJour.get(d));
    ministres += out.ministres; cabinets += out.cabinets; erreurs += out.erreurs.length;
    if (verbeux) console.log(`${d} : ${out.nb} mesure(s) — ${out.ministres} ministre(s), ${out.cabinets} cabinet(s)${out.erreurs.length ? ` — ${out.erreurs[0]}` : ""}`);
  }
  return { fichiers: fichiers.length, mesures: mesures.length, jours: dates.length, ministres, cabinets, erreurs };
}
