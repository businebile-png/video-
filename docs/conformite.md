# Conformité

Ce document résume les règles appliquées par le studio. Il ne remplace pas un conseil juridique.

## Publicité et affiliation (France)

- **Loi n° 2023-451 du 9 juin 2023 (influenceurs)** : un contenu promotionnel rémunéré, y compris par
  commission d'affiliation, porte la mention « Publicité » ou « Collaboration commerciale », claire,
  lisible et identifiable **pendant toute la durée** de la promotion.
  → Badge « Publicité » visible de la première à la dernière image, et légende commençant par
  « Publicité · Lien affilié : si tu t'abonnes via mon lien, je touche une commission, sans surcoût pour toi. »
- **Pratiques commerciales trompeuses** : pas de promesse de gains, pas de résultat garanti, pas d'urgence
  inventée, pas de superlatif invérifiable, pas de faux témoignage, pas de prix ou de condition cachés.
  → Contrôleur automatique du script et des légendes (`src/script/lint.ts`), modifiable seulement par le code.
- **Tarifs** : affichés seulement s'ils sont prouvés par la page officielle copiée dans les 7 jours, avec la
  date de vérification à l'écran.

## Plateformes

- **TikTok** : contenu commercial déclaré (`commercialContentThirdParty`), contenu généré par IA déclaré
  (voix de synthèse réaliste : `isAigc`). La publication passe par Metricool, partenaire agréé : TikTok refuse
  les outils maison destinés à publier sur ses propres comptes.
- **Instagram** : Reels via Metricool, contenu généré par IA déclaré (`isAiGenerated`).
- **Zones de l'interface** : textes placés hors des zones couvertes par l'interface TikTok / Reels.

## Droits

- **Pexels** : usage commercial autorisé ; interdit de laisser croire qu'une personne filmée recommande le
  produit, de la montrer sous un jour dégradant, ou de revendre les vidéos telles quelles. Chaque séquence
  utilisée est enregistrée (auteur, page, date) et affichée dans le panneau.
- **Musique** : uniquement une piste avec preuve de licence (bibliothèque), sinon pas de musique.
- **Voix de synthèse** : Kokoro-82M (licence Apache-2.0, usage commercial autorisé), voix « ff_siwis »
  entraînée sur la base SIWIS (CC BY 4.0, enregistrée par une comédienne professionnelle ; crédit :
  « SIWIS French Speech Synthesis Database », Honnet et al., Idiap / Université de Genève / Université
  d'Édimbourg). Voix déclarée comme générée par IA sur TikTok et Instagram. Aucune imitation de la voix
  d'une personne réelle. En option : Azure Speech (usage commercial autorisé) ; le plan gratuit
  d'ElevenLabs n'autorise pas l'usage commercial.
- **Polices** : licence SIL Open Font (Inter, Inter Tight, Manrope, Fraunces, Instrument Serif, Space Grotesk).
- **Habillage sonore** : synthétisé par le studio.
- **Remotion** : licence gratuite pour un particulier ou une entreprise de 3 personnes au plus.
- **Captures de Systeme.io** : faites par vous, sans données personnelles visibles (case à confirmer).

## Données

Le dépôt `businebile-png/video-` est **public** (Metricool doit pouvoir télécharger les vidéos) : n'y mettez
ni clé, ni chiffre d'affaires, ni donnée personnelle. Les statistiques et réglages vivent dans le panneau
(privé, sur votre compte claude.ai). Les clés API sont stockées dans l'environnement Claude Code, jamais dans le code.
