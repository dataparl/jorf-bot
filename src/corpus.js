// Import en un coup du corpus Freemium JORF (dump global DILA, ~1,6 Go) :
// extraction des mesures nominatives des cabinets ministériels sur toute la
// période demandée, puis import par date. Idempotent (upsert).
//
// La table `ministres` n'est PAS réécrite ici : elle est déjà tenue (CSV
// validé 2012-2017 + balayage quotidien) ; on s'appuie dessus pour rattacher
// chaque membre de cabinet au bon mandat (cache chronologique du contexte,
// une seule recherche par ministre inconnu sur tout le corpus).
//
// Deux entrées possibles :
//   - l'archive tar.gz telle quelle (lecture en streaming, AUCUNE extraction
//     — utile quand le disque est plein) ;
//   - un dossier déjà extrait.
// Usage : node bin/jorf-bot.js corpus <fichier.tar.gz | dossier> <debut> [fin]

import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createGunzip } from "node:zlib";
import { join } from "node:path";
import { analyserJORF } from "./jorf.js";
import { importerMesuresBrut } from "./import.js";

// Rejet rapide avant analyse : le titre doit contenir un mot-clé nominatif
// (même filtre que analyserJORF, testé sur le XML brut, bien plus rapide).
const FILTRE_TITRE = /(nomination|cessation de fonctions|fin de fonctions|révocation|relatif à la composition|portant cessation)/i;
const PARALLELE = 16; // lecture + analyse des fichiers (mode dossier)

// ---------------------------------------------------------------------------
// 1. Lecture d'un tar.gz en streaming : aucune extraction sur le disque.
// ---------------------------------------------------------------------------
class Flux {
  constructor(chemin) {
    this.it = createReadStream(chemin).pipe(createGunzip())[Symbol.asyncIterator]();
    this.tampons = [];
    this.longueur = 0;
  }
  async lit(n) {
    while (this.longueur < n) {
      const { value, done } = await this.it.next();
      if (done) break;
      const b = Buffer.from(value);
      this.tampons.push(b);
      this.longueur += b.length;
    }
    if (this.longueur < n) return null; // fin de flux
    const premier = this.tampons[0];
    if (premier.length >= n) {
      this.tampons[0] = premier.subarray(n);
      this.longueur -= n;
      return premier.subarray(0, n);
    }
    const tout = Buffer.concat(this.tampons);
    this.tampons = [tout.subarray(n)];
    this.longueur -= n;
    return tout.subarray(0, n);
  }
}

// Parcourt l'archive et rend chaque XML du fonds JORF (nom + contenu).
// Format tar : en-têtes de 512 octets, données alignées sur 512. Gère USTAR
// (préfixe), GNU longname ('L'), et ignore pax/longlink.
async function* xmlDuTar(chemin) {
  const flux = new Flux(chemin);
  let nomLong = null; // GNU longname : nom du fichier suivant
  while (true) {
    const head = await flux.lit(512);
    if (!head || head.every((b) => b === 0)) return; // fin (blocs zéros)
    let nom = head.toString("utf8", 0, 100).replace(/\0[\s\S]*$/, "");
    const prefixe = head.toString("utf8", 345, 500).replace(/\0[\s\S]*$/, "");
    if (prefixe) nom = `${prefixe}/${nom}`;
    const type = String.fromCharCode(head[156] || 0x30);
    let taille = 0;
    if (head[124] & 0x80) { // base-256 (tailles énormes, rare)
      let v = 0n;
      for (let i = 125; i < 136; i++) v = (v << 8n) | BigInt(head[i]);
      taille = Number(v);
    } else {
      const t = head.toString("utf8", 124, 136).replace(/\0[\s\S]*$/, "").trim();
      if (t) taille = parseInt(t, 8) || 0;
    }
    const contenu = taille > 0 ? await flux.lit(taille) : null;
    const pad = (512 - (taille % 512)) % 512;
    if (pad > 0) await flux.lit(pad); // alignement, ignoré
    if (contenu === null || contenu.length < taille) return; // archive tronquée
    if (type === "L") { nomLong = contenu.toString("utf8").replace(/\0[\s\S]*$/, ""); continue; }
    if (type === "K" || type === "x" || type === "g") continue; // longlink, pax : ignorés
    if (nomLong) { nom = nomLong; nomLong = null; }
    if (type !== "0") continue; // répertoires, liens… : ignorés
    if (!/(^|\/)jorf\//i.test(nom)) continue; // uniquement le fonds JORF
    // Le dump Freemium nomme ses fichiers SANS extension .xml (ex. …/jo/article_9) :
    // on n'exige pas d'extension, la validité XML est vérifiée à l'analyse.
    yield { nom, xml: contenu.toString("utf8") };
  }
}

// ---------------------------------------------------------------------------
// 2. Mode dossier : liste récursive des XML.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 3. Collecte puis import par date. L'ordre chronologique est obligatoire :
//    le cache des mandats ministériels du contexte se construit au fil de
//    l'eau (nomination → mandat courant ; cessation → retrait du cache).
// ---------------------------------------------------------------------------
export async function importerCorpus(chemin, debut, fin, verbeux = true) {
  const mesures = [];
  if (/\.(tar\.gz|tgz)$/i.test(chemin)) {
    if (verbeux) console.log(`Lecture en streaming de ${chemin} (aucune extraction)…`);
    let lus = 0, vus = 0;
    for await (const { nom, xml } of xmlDuTar(chemin)) {
      vus++;
      if (verbeux && vus <= 3) console.log(`  entrée #${vus} : ${nom}`);
      lus += 1;
      if (FILTRE_TITRE.test(xml)) {
        for (const m of analyserJORF(xml)) if (m.date >= debut && m.date <= fin) mesures.push(m);
      }
      if (verbeux && lus % 5000 === 0) console.log(`  … ${lus} fichier(s) JORF lu(s), ${mesures.length} mesure(s)`);
    }
    if (!lus) throw new Error(`Aucun XML trouvé dans l'archive ${chemin} — vérifier que c'est bien le dump Freemium JORF.`);
  } else {
    const fichiers = await listerXml(chemin);
    if (!fichiers.length) throw new Error(`Aucun fichier XML trouvé sous ${chemin} — vérifier le chemin (le dossier du fonds JORF, pas la racine de l'archive).`);
    if (verbeux) console.log(`${fichiers.length} fichier(s) XML à parcourir (filtre ${debut} → ${fin})…`);
    for (let i = 0; i < fichiers.length; i += PARALLELE) {
      const lot = await Promise.all(fichiers.slice(i, i + PARALLELE).map(async (p) => {
        const infos = await stat(p).catch(() => null);
        if (!infos || infos.size === 0 || infos.size > 60_000_000) return [];
        const xml = await readFile(p, "utf8").catch(() => "");
        if (!xml || !FILTRE_TITRE.test(xml)) return [];
        return analyserJORF(xml).filter((m) => m.date >= debut && m.date <= fin);
      }));
      mesures.push(...lot.flat());
      if (verbeux && (i / PARALLELE) % 200 === 199) console.log(`  … ${Math.min(i + PARALLELE, fichiers.length)} fichiers parcourus, ${mesures.length} mesure(s)`);
    }
  }
  // Regroupement par date ; les mesures ministres passent avant les cabinets
  // (le cache du mandat doit être à jour avant de rattacher un cabinet).
  const parJour = new Map();
  for (const m of mesures) {
    if (!parJour.has(m.date)) parJour.set(m.date, []);
    parJour.get(m.date).push(m);
  }
  const ctx = { ministres: new Map() }; // cleNom(ministre) → id du mandat courant
  let cabinets = 0, erreurs = 0;
  for (const d of [...parJour.keys()].sort()) {
    const duJour = parJour.get(d)
      .sort((a, b) => (a.role === "ministre" ? -1 : 0) - (b.role === "ministre" ? -1 : 0));
    const out = await importerMesuresBrut(d, duJour, ctx);
    cabinets += out.cabinets;
    erreurs += out.erreurs.length;
    if (verbeux) console.log(`${d} : ${out.nb} mesure(s) — ${out.cabinets} cabinet(s)${out.erreurs.length ? ` — ${out.erreurs[0]}` : ""}`);
  }
  return { jours: parJour.size, mesures: mesures.length, cabinets, erreurs };
}
