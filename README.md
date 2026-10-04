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

node bin/jorf-bot.js diagnostique      # index DILA, zip de la veille, accès Supabase
node bin/jorf-bot.js statut            # où en est le balayage ?
node bin/jorf-bot.js jour 2026-10-03   # un jour précis
node bin/jorf-bot.js veille            # hier + avant-hier
node bin/jorf-bot.js balayer 2024-01-01 2024-06-30
node bin/jorf-bot.js rattraper         # reprise depuis la fenêtre la plus ancienne
```

## Exécution : en local, pas depuis un datacenter

La DILA (`echanges.dila.gouv.fr`) **refuse les connexions venant des IP de
datacenters** : les dumps ne sont téléchargeables que depuis une IP
résidentielle (tests concluants depuis GitHub Actions et Vercel : connexion
réinitialisée). Le bot se lance donc **depuis une machine locale** :

```bash
node bin/jorf-bot.js diagnostique   # vérifie l'index DILA et l'accès Supabase
node bin/jorf-bot.js veille         # puis le balayage quotidien
```

`jorf-history.yml` (GitHub Actions) reste disponible pour le diagnostic et le
lancement manuel, mais ne peut pas télécharger les zips : la DILA coupe la
connexion depuis les runners. La fenêtre JORFSIMPLE ne conserve qu'environ dix
mois de zips quotidiens ; l'historique antérieur passe par les archives (les
ministres 2017-2026 sont déjà en base).

## Sources

Dumps JORFSIMPLE de la DILA (Premier ministre / data.gouv.fr, réutilisation
libre) : https://echanges.dila.gouv.fr/OPENDATA/JORFSIMPLE

## Licence

Code sous licence MIT (voir `LICENSE`). Les données extraites du Journal
officiel relèvent de la réutilisation libre ; la base DataParl' est publiée
sous ODbL.
