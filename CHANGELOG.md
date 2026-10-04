# Changelog

Tous les changements notables de ce projet sont documentés ici. Le format
suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et la
versionnement [SemVer](https://semver.org/lang/fr/).

## [Non publié]

### Ajouté

- Commande `diagnostique` : index DILA, zip de la veille, lecture publique
  Supabase, sonde d'écriture dans `jorf_releves`.
- Workflow `jorf-history.yml` : diagnostic systématique, balayage manuel borné
  (`date_debut`), journal publié sur la branche `logs`.
- `fenetreJorfsimple()` : lecture de l'index DILA pour connaître le premier et
  le dernier zip disponibles (~10 mois de fenêtre glissante).

### Modifié

- `releverJour` : 3 essais avec pauses croissantes, User-Agent constant.
- `balayer` : un jour n'est marqué « balayé » que s'il a été traité sans
  erreur ; compteur `enErreur` ; arrêt anticipé après 8 échecs consécutifs.
- `supprimer(table, params)` dans le client Supabase.

### Supprimé

- Cron Vercel `/api/cron/jorf` de la webapp : la DILA refuse les connexions
  depuis les IP Vercel ; le balayage passe en exécution locale.
