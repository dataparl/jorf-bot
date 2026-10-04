// Client PostgREST minimal pour Supabase DATA (zéro dépendance) :
//  - lecture avec la clé publique (RLS « lecture publique ») ;
//  - écriture avec la clé service_role (tables ministres,
//    cabinets_ministeriels, jorf_releves).

const URL = process.env.DATA_SUPABASE_URL ?? "https://yuhqajaznizwmenmyzms.supabase.co";
const CLE_PUBLIQUE = process.env.DATA_SUPABASE_KEY ?? "";
const CLE_SERVICE = process.env.DATA_SUPABASE_SERVICE_ROLE_KEY ?? "";

export function verifierEnv() {
  const manquantes = ["DATA_SUPABASE_KEY", "DATA_SUPABASE_SERVICE_ROLE_KEY"]
    .filter((n) => !process.env[n]);
  if (manquantes.length) throw new Error(`Variables d'environnement manquantes : ${manquantes.join(", ")}`);
}

async function appel(chemin, options, cle) {
  const r = await fetch(`${URL}/rest/v1/${chemin}`, {
    ...options,
    headers: {
      apikey: cle,
      Authorization: `Bearer ${cle}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`Supabase ${chemin} : HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.headers.get("content-type")?.includes("json") ? r.json() : null;
}

// Lecture publique : select=…&filtre=eq.… (URLSearchParams).
export const lire = (table, params) =>
  appel(`${table}?${params.toString()}`, { method: "GET" }, CLE_PUBLIQUE);

// Écriture service_role : upsert (on conflict = clé primaire).
export const ecrire = (table, lignes) =>
  appel(table, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(lignes),
  }, CLE_SERVICE);

export const maj = (table, valeurs, params) =>
  appel(`${table}?${params.toString()}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(valeurs),
  }, CLE_SERVICE);

// Lecture avec la clé service_role (tables internes non publiques, ex. jorf_releves).
export const lirePrive = (table, params) =>
  appel(`${table}?${params.toString()}`, { method: "GET" }, CLE_SERVICE);

// Suppression service_role (sondes du diagnostique).
export const supprimer = (table, params) =>
  appel(`${table}?${params.toString()}`, { method: "DELETE" }, CLE_SERVICE);
