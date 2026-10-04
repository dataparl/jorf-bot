# jorf-bot — le Journal officiel, chaque matin, dans Supabase

Bot DataParl' : il télécharge les dumps quotidiens du JORF « Lois et décrets »
(édition simple, DILA), en extrait les **mesures nominatives** — nominations et
cessations de fonctions des **ministres** et des membres des **cabinets
ministériels** — et alimente la base Supabase **DATA** (`dataparl`) :

- `ministres` — membres du gouvernement, datés (debut/fin, null = en fonction) ;
- `cabinets_ministeriels` — directeurs, chefs de cabinet, conseillers…,
  rapprochés avec les collaborateurs parlementaires connus (`collab_id`) et le
  référentiel des parlementaires (`personne_id`) ;
- `jorf_releves` — un relevé par jour balayé (reprise du balayage possible).

C'est le même pipeline que la page https://admin.dataparl.fr/jorf (application
web `dataparl/webapp`) : les deux partagent les conventions d'identifiants
(`MIN-<NOM>-<AAAAMMJJ>`, `CAB-…`) et écrivent dans les mêmes tables par
upsert — jamais de doublons, quel que soit l'outil qui balaye le jour.

- Lecture : clé publique (publishable) — les tables sont en RLS « lecture
  publique ».
- Écriture : clé `service_role` (variable d'environnement, jamais commitée).

## Utilisation

```bash
export DATA_SUPABASE_URL=…            # https://yuhqajnizwmenmyzms.supabase.co
export DATA_SUPABASE_KEY=…            # clé publishable
export DATA_SUPABASE_SERVICE_ROLE_KEY=…

node bin/jorf-bot.js statut                 # où en est le balayage ?
node bin/jorf-bot.js jour 2026-10-03        # un jour précis
node bin/jorf-bot.js veille                 # hier + avant-hier (comme le cron)
node bin/jorf-bot.js rattraper              # 2017-01-01 → hier, en reprenant
node bin/jorf-bot.js balayer 2024-01-01 2024-06-30
```

## Automatique (GitHub Actions)

`.github/workflows/jorf.yml` lance chaque matin (06h30 UTC, avant le cron
webapp de 07h15) `jorf-bot veille` avec les secrets du dépôt :
`DATA_SUPABASE_URL`, `DATA_SUPABASE_KEY`, `DATA_SUPABASE_SERVICE_ROLE_KEY`.

## Sources

Dumps JORFSIMPLE de la DILA (Premier ministre / data.gouv.fr, réutilisation
libre) : https://echanges.dila.gouv.fr/OPENDATA/JORFSIMPLE
