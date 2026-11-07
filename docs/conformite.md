# Conformité

Ce document résume les règles appliquées par le studio. Il ne remplace pas un conseil juridique.

## Publicité et affiliation (France)

- **Loi n° 2023-451 du 9 juin 2023 (influenceurs)** : un contenu promotionnel rémunéré, y compris par
  commission d'affiliation, porte la mention « Publicité » ou « Collaboration commerciale », claire,
  lisible et identifiable **pendant toute la durée** de la promotion.
  → Badge « Publicité » visible de la première à la dernière image, et légende commençant par
  « Publicité · Lien affilié : si tu t'abonnes via mon lien, je touche une commission. Le prix reste celui affiché sur systeme.io. » (aucune source officielle ne parle de « surcoût » : on renvoie au prix public affiché,
  vérifié par le studio)
- **Pratiques commerciales trompeuses** : pas de promesse de gains, pas de résultat garanti, pas d'urgence
  inventée, pas de superlatif invérifiable, pas de faux témoignage, pas de prix ou de condition cachés.
  → Contrôleur automatique du script et des légendes (`src/script/lint.ts`), modifiable seulement par le code.
  Les chiffres dits en lettres (« cinq mille contacts ») sont vérifiés comme les chiffres écrits.
- **Promesse de revenus implicite** : le format « voiture de luxe + secret de ma réussite en bio » (courant
  sur TikTok) suggère que le produit enrichit. Le contrôleur refuse les recherches d'images de richesse
  (voitures de luxe, argent, montres, jets, villas…) et les formules du type « le secret de ma réussite ».
  Le format court « edit » est repris pour son rythme et son montage seulement.
- **Tarifs** : affichés seulement s'ils sont prouvés par la page officielle copiée dans les 7 jours, avec la
  date de vérification à l'écran.

## Plateformes

- **TikTok** : contenu commercial déclaré (`commercialContentThirdParty`), contenu généré par IA déclaré
  (voix de synthèse réaliste : `isAigc`). La publication passe par Metricool, partenaire agréé : TikTok refuse
  les outils maison destinés à publier sur ses propres comptes.
- **Instagram** : Reels via Metricool, contenu généré par IA déclaré (`isAiGenerated`).
- **Zones de l'interface** : textes placés hors des zones couvertes par l'interface TikTok / Reels.

## Droits

- **Pixabay** (par défaut) : licence de contenu Pixabay, usage commercial autorisé sans attribution ; interdit de
  revendre ou redistribuer les vidéos telles quelles, de laisser croire qu'une personne filmée recommande le
  produit ou de la montrer sous un jour dégradant. Recherches mises en cache 24 h, pas de téléchargement de masse.
- **Pexels** (si une clé existe) : mêmes règles. Chaque séquence utilisée est enregistrée (source, auteur,
  page, date) et affichée dans le panneau.
- **Musique** : uniquement une piste avec preuve de licence (bibliothèque), sinon pas de musique.
- **Voix de synthèse** : « Claire », produite par Chatterbox Multilingual (Resemble AI, licence MIT, usage
  commercial autorisé). Son timbre vient de trois phrases de la base SIWIS (CC BY 4.0 : usage commercial et
  adaptation autorisés avec crédit ; enregistrée pour la synthèse vocale par une comédienne professionnelle
  anonyme ; crédit : « SIWIS French Speech Synthesis Database », Honnet et al., Idiap / Université de Genève
  / Université d'Édimbourg). L'audio porte le tatouage inaudible Perth de Resemble AI, qui le signale comme
  généré par IA. Voix de secours : Kokoro-82M (Apache-2.0), voix « ff_siwis » entraînée sur la même base.
  Voix déclarée comme générée par IA sur TikTok et Instagram. Aucune imitation d'une personnalité ni d'une
  personne identifiable. En option : Azure Speech (usage commercial autorisé) ; le plan gratuit
  d'ElevenLabs n'autorise pas l'usage commercial.
- **Polices** : licence SIL Open Font (Inter, Inter Tight, Manrope, Fraunces, Instrument Serif, Space Grotesk).
- **Habillage sonore** : synthétisé par le studio.
- **Remotion** : licence gratuite pour un particulier ou une entreprise de 3 personnes au plus.
- **Captures de Systeme.io** : faites par vous, sans données personnelles visibles (case à confirmer).

## Données

Le dépôt `businebile-png/video-` est **public** (Metricool doit pouvoir télécharger les vidéos) : n'y mettez
ni clé, ni chiffre d'affaires, ni donnée personnelle. Les statistiques et réglages vivent dans le panneau
(privé, sur votre compte claude.ai). Les clés API sont stockées dans l'environnement Claude Code, jamais dans le code.
