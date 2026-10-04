// Import des mesures nominatives du JORF dans les tables `ministres` et
// `cabinets_ministeriels` (mêmes conventions d'identifiants que le pipeline
// webapp : MIN-<NOM>-<AAAAMMJJ>, CAB-…), suivi dans `jorf_releves`.

import { cleNom, releverJour } from "./jorf.js";
import { ecrire, lire, lirePrive, maj } from "./supabase.js";

const idMinistre = (nom, date) => `MIN-${nom.toUpperCase().replace(/[^A-Z]/g, "")}-${date.replace(/-/g, "")}`;
const idCabinet = (ministreId, prenom, nom) => `CAB-${ministreId}-${cleNom(prenom, nom).replace(/ /g, "-").toUpperCase()}`;

async function chercherParlementaire(prenom, nom) {
  const or = `(and(nom.ilike.${nom},prenom.ilike.${prenom}),and(nom.ilike.${prenom},prenom.ilike.${nom}))`;
  const rows = await lire("parlementaires", new URLSearchParams({ select: "personne_id", or, limit: "1" }));
  return rows[0]?.personne_id ?? null;
}

async function chercherCollaborateur(prenom, nom) {
  const rows = await lire("collaborateurs", new URLSearchParams({
    select: "collab_id,collab_prenom,collab_nom", collab_cle: `eq.${cleNom(prenom, nom)}`, limit: "1",
  }));
  return rows[0] ?? null;
}

async function chercherMinistre(prenom, nom) {
  const or = `(and(nom.ilike.${nom},prenom.ilike.${prenom}),and(nom.ilike.${prenom},prenom.ilike.${nom}))`;
  const rows = await lire("ministres", new URLSearchParams({ select: "id", or, order: "debut.desc", limit: "1" }));
  return rows[0]?.id ?? null;
}

const gouvernementDu = (extrait) =>
  /gouvernement\s+([A-ZÉÈ][a-zéè]+(?:\s+[IV]+)?)/.exec(extrait)?.[1] ?? "";

// Un jour du JORF : relève, rapprochements, écritures.
export async function importerJour(date) {
  const mesures = await releverJour(date);
  const out = { date, nb: mesures.length, ministres: 0, cabinets: 0, erreurs: [] };
  for (const m of mesures) {
    try {
      if (m.role === "ministre") {
        const personneId = await chercherParlementaire(m.prenom, m.nom).catch(() => null);
        if (m.type === "cessation") {
          const deja = await lire("ministres", new URLSearchParams({
            select: "id", nom: `ilike.${m.nom}`, prenom: `ilike.${m.prenom}`, fin: "is.null",
          }));
          if (deja.length) await maj("ministres", { fin: m.date, synced_at: new Date().toISOString() },
            new URLSearchParams({ id: `in.(${deja.map((x) => x.id).join(",")})` }));
        } else {
          await ecrire("ministres", [{
            id: idMinistre(m.nom, m.date), personne_id: personneId, civilite: m.civilite,
            prenom: m.prenom, nom: m.nom,
            fonction: m.fonction || "ministre", portefeuille: m.portefeuille,
            gouvernement: gouvernementDu(m.extrait), rang: "",
            debut: m.date, fin: null,
            source: `JORF ${m.id_texte}`, confiance: "officiel",
          }]);
        }
        out.ministres++;
      } else {
        const ref = m.ministre ?? { prenom: "", nom: "" };
        let ministreId = ref.nom ? await chercherMinistre(ref.prenom, ref.nom).catch(() => null) : null;
        if (!ministreId && ref.nom) {
          const id = idMinistre(ref.nom, m.date);
          await ecrire("ministres", [{
            id, personne_id: null, civilite: "M.", prenom: ref.prenom, nom: ref.nom,
            fonction: "ministre", portefeuille: "", gouvernement: gouvernementDu(m.extrait), rang: "",
            debut: m.date, fin: null, source: `JORF ${m.id_texte} (rattachement de cabinet)`, confiance: "officiel",
          }]);
          ministreId = id;
        }
        if (!ministreId) { out.erreurs.push(`${m.prenom} ${m.nom} : ministre de rattachement introuvable`); continue; }
        const cle = cleNom(m.prenom, m.nom);
        const collab = await chercherCollaborateur(m.prenom, m.nom).catch(() => null);
        if (m.type === "cessation") {
          await maj("cabinets_ministeriels", { fin: m.date, synced_at: new Date().toISOString() },
            new URLSearchParams({ collab_cle: `eq.${cle}`, fin: "is.null" }));
        } else {
          const personneId = collab ? null : await chercherParlementaire(m.prenom, m.nom).catch(() => null);
          await ecrire("cabinets_ministeriels", [{
            id: idCabinet(ministreId, m.prenom, m.nom), ministre_id: ministreId,
            personne_id: personneId, collab_id: collab?.collab_id ?? null, collab_cle: cle,
            collab_nom: (collab?.collab_nom ?? m.nom).toUpperCase(), collab_prenom: collab?.collab_prenom ?? m.prenom,
            fonction: m.fonction || "membre de cabinet",
            source: `JORF ${m.id_texte}`, confiance: "officiel", date_source: m.date,
            debut: m.date, fin: null,
          }]);
        }
        out.cabinets++;
      }
    } catch (e) { out.erreurs.push(`${m.prenom} ${m.nom} : ${e.message}`); }
  }
  await ecrire("jorf_releves", [{
    date_jorf: date, nb_mesures: out.nb, nb_ministres: out.ministres, nb_cabinets: out.cabinets,
    erreurs: out.erreurs.slice(0, 5).join(" | ").slice(0, 500), synced_at: new Date().toISOString(),
  }]);
  return out;
}

export const demain = (date) => new Date(Date.parse(date) + 86_400_000).toISOString().slice(0, 10);

export async function joursBalayes() {
  // jorf_releves n'est pas en lecture publique : clé service_role obligatoire.
  const rows = await lirePrive("jorf_releves", new URLSearchParams({ select: "date_jorf", limit: "10000" }));
  return new Set(rows.map((x) => x.date_jorf));
}

// Balayage d'une plage de jours, en reprenant là où il s'était arrêté.
// Si tout échoue d'emblée (réseau coupé, table absente…), on s'arrête vite
// avec un message clair au lieu d'attraper des centaines d'erreurs.
export async function balayer(debut, fin, verbeux = true) {
  const vus = await joursBalayes().catch(() => new Set());
  const jours = [];
  let d = debut, restants = 0, echecsConsecutifs = 0, enErreur = 0;
  while (d <= fin) {
    if (vus.has(d)) { d = demain(d); continue; }
    const jour = await importerJour(d).catch((e) => ({ date: d, nb: 0, ministres: 0, cabinets: 0, erreurs: [e.message] }));
    jours.push(jour);
    if (verbeux) {
      const errs = jour.erreurs.length ? ` — ${jour.erreurs[0]}` : "";
      console.log(`${jour.date} : ${jour.nb} mesure(s) — ${jour.ministres} ministre(s), ${jour.cabinets} cabinet(s)${errs}`);
    }
    // Un jour n'est « balayé » que si son relevé a pu être écrit ; sinon il
    // reste à faire et sera repris au prochain passage.
    const echec = jour.erreurs.length > 0;
    enErreur += echec ? 1 : 0;
    echecsConsecutifs = echec ? echecsConsecutifs + 1 : 0;
    if (!echec) vus.add(d);
    d = demain(d);
    restants++;
    if (echecsConsecutifs >= 8 && enErreur === restants) {
      throw new Error(`Balayage interrompu : les ${restants} premiers jours échouent tous (${jour.erreurs[0] ?? "cause inconnue"}). Vérifier l'accès à la DILA et les tables Supabase (node bin/jorf-bot.js diagnostique).`);
    }
  }
  return { jours, restants, enErreur };
}

// Statut : jours balayés, prochaine étape.
export async function statut() {
  const rows = await lirePrive("jorf_releves", new URLSearchParams({ select: "date_jorf", order: "date_jorf", limit: "5000" }))
    .catch(() => []);
  const vus = new Set(rows.map((x) => x.date_jorf));
  const hier = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  let d = "2017-01-01", prochain = null, restants = 0;
  while (d <= hier) { if (!vus.has(d)) { if (!prochain) prochain = d; restants++; } d = demain(d); }
  return { scan: { jours: vus.size, premiere: rows[0]?.date_jorf ?? null, derniere: rows[rows.length - 1]?.date_jorf ?? null }, prochain, restants };
}
