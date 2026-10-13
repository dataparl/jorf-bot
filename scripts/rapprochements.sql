-- Rapprochement des membres de cabinets ministériels avec les collaborateurs
-- parlementaires connus : jointure exacte sur collab_cle (même normalisation
-- que cleNom du bot : NFD, sans accents, minuscules, triée). À exécuter dans
-- le SQL Editor du projet DATA après un import corpus (ou un balayage).
-- Idempotent : ne touche que les lignes non déjà rapprochées.

update cabinets_ministeriels c
set collab_id    = b.collab_id,
    collab_nom   = b.collab_nom,
    collab_prenom = b.collab_prenom
from collaborateurs b
where c.collab_cle = b.collab_cle
  and (c.collab_id is null or c.collab_id <> b.collab_id);

-- Compte de contrôle : cabinets encore non rapprochés (personnes qui n'ont
-- jamais été collaborateurs parlementaires — c'est le cas le plus courant,
-- ou homonymies à examiner).
select count(*) as cabinets_non_rapproches
from cabinets_ministeriels
where collab_id is null;
