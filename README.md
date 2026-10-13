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

## Exécution depuis la maison (conteneur Docker sur la box Home Assistant)

Même pattern que le runner europarl (`collabs/pe_waf.py`) : un conteneur Docker
sur la box Home Assistant — toujours allumée, IP résidentielle acceptée par la
DILA — qui gère son propre cron. Pas besoin de Playwright : l'image Node
suffit, et la lecture DILA est du HTTP simple.

```bash
# 1. Conteneur persistant avec le dépôt monté et les secrets en env
docker run -d --name jorf --restart unless-stopped \
  -v /opt/jorf-bot:/app -w /app \
  -e DATA_SUPABASE_URL=https://yuhqajaznizwmenmyzms.supabase.co \
  -e DATA_SUPABASE_KEY=<clé publishable> \
  -e DATA_SUPABASE_SERVICE_ROLE_KEY=<clé service_role> \
  node:20-alpine sleep infinity

# 2. Backfill initial (fenêtre JORFSIMPLE ≈ 10 mois) — dans le conteneur :
docker exec jorf node bin/jorf-bot.js balayer 2025-12-15 2026-10-12

# 3. Cron quotidien (07:20 UTC = après publication du dump de la veille,
#    avant le Daily de 06:30 UTC le lendemain) :
docker exec jorf node bin/jorf-bot.js veille
```

Le cron peut être assuré par un `crontab` dans le conteneur, par le planificateur
de la box, ou par une automatisation Home Assistant appelant le `docker exec`.
Limite connue : JORFSIMPLE ne conserve qu'environ dix mois de dumps ; pour les
jours antérieurs (début du gouvernement courant), passer par Légifrance.

## Historique complet en un coup : dump Freemium global (2012 → …)

Les zips quotidiens JORFSIMPLE ne couvrent qu'une fenêtre glissante (~10 mois).
Pour l'historique, la DILA met à disposition un dump global du fonds JORF :
`Freemium_jorf_global_<AAAAMMJJ>-140000.tar.gz` (~1,6 Go) dans
https://echanges.dila.gouv.fr/OPENDATA/JORF/ — le fonds complet en XML,
structure « SARDE » : dossiers par base (`jorf/`, `legi/`, …), fichiers XML nommés
par identifiant de texte. Téléchargeable uniquement depuis une IP résidentielle.

```bash
# 1. Télécharger (Mac, IP maison) puis extraire (≈ 10 Go) :
curl -O https://echanges.dila.gouv.fr/OPENDATA/JORF/Freemium_jorf_global_XXXX-140000.tar.gz
tar -xzf Freemium_jorf_global_XXXX-140000.tar.gz
find . -type d -iname jorf   # repérer le dossier du fonds JORF

# 2. Import 2012 → date du dump (idempotent, upsert) :
node bin/jorf-bot.js corpus <dossier-jorf> 2012-01-01 <date-du-dump>

# 3. Compléter jusqu'à aujourd'hui avec la fenêtre JORFSIMPLE :
node bin/jorf-bot.js balayer <lendemain-du-dump> $(date -d hier +%F)
```

La commande `corpus` parcourt les XML (rejet rapide sur le titre, puis mêmes
filtres que le balayage quotidien), regroupe les mesures par date et les importe
avec les rapprochements habituels (parlementaires, collaborateurs, ministre de
rattachement). Si un trou subsiste entre la date du dump et le début de la
fenêtre JORFSIMPLE (rafaîchissement du Freemium irrégulier), le combler via
Légifrance. Ensuite, la mise à jour quotidienne = `veille` (Mac ou conteneur
Home Assistant).

## Sources


Dumps JORFSIMPLE de la DILA (Premier ministre / data.gouv.fr, réutilisation
libre) : https://echanges.dila.gouv.fr/OPENDATA/JORFSIMPLE

## Licence

Code sous licence MIT (voir `LICENSE`). Les données extraites du Journal
officiel relèvent de la réutilisation libre ; la base DataParl' est publiée
sous ODbL.
