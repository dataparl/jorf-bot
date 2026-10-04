#!/usr/bin/env node
// jorf-bot — CLI : statut | jour <date> | veille | rattraper | balayer <debut> [fin]
// Exemples :
//   node bin/jorf-bot.js statut
//   node bin/jorf-bot.js jour 2026-10-03
//   node bin/jorf-bot.js veille              (hier + avant-hier, comme le cron)
//   node bin/jorf-bot.js rattraper           (2017-01-01 → hier)
//   node bin/jorf-bot.js balayer 2024-01-01 2024-06-30

import { balayer, importerJour, statut } from "../src/import.js";
import { verifierEnv } from "../src/supabase.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const aujourdhui = (offset = 0) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

const [commande, ...args] = process.argv.slice(2);

async function main() {
  verifierEnv();
  switch (commande) {
    case "statut": {
      const s = await statut();
      console.log(`Jours balayés : ${s.scan.jours}${s.scan.premiere ? ` (de ${s.scan.premiere} à ${s.scan.derniere})` : ""}`);
      console.log(s.prochain ? `Prochaine étape : ${s.prochain} (${s.restants} jours restants)` : "Historique complet.");
      break;
    }
    case "jour": {
      if (!ISO.test(args[0] ?? "")) { console.error("Usage : jorf-bot jour YYYY-MM-DD"); process.exit(1); }
      console.log(JSON.stringify(await importerJour(args[0]), null, 2));
      break;
    }
    case "veille": {
      for (const d of [aujourdhui(2), aujourdhui(1)]) {
        const j = await importerJour(d).catch((e) => ({ date: d, erreurs: [e.message] }));
        console.log(`${j.date} : ${j.nb ?? 0} mesure(s) — ${j.ministres ?? 0} ministre(s), ${j.cabinets ?? 0} cabinet(s)${j.erreurs?.length ? ` — ${j.erreurs[0]}` : ""}`);
      }
      break;
    }
    case "rattraper": {
      const s = await statut();
      const debut = s.prochain ?? "2017-01-01";
      console.log(`Rattrapage depuis ${debut}…`);
      const r = await balayer(debut, aujourdhui(1));
      console.log(`${r.jours.length} jour(s) traité(s).`);
      break;
    }
    case "balayer": {
      if (!ISO.test(args[0] ?? "")) { console.error("Usage : jorf-bot balayer YYYY-MM-DD [YYYY-MM-DD]"); process.exit(1); }
      const r = await balayer(args[0], ISO.test(args[1] ?? "") ? args[1] : aujourdhui(1));
      console.log(`${r.jours.length} jour(s) traité(s).`);
      break;
    }
    default:
      console.error("Commandes : statut | jour <date> | veille | rattraper | balayer <debut> [fin]");
      process.exit(1);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
