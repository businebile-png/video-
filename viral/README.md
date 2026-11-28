# Viral Content Machine

Machine de production de carrousels (slideshows) pour faire découvrir **Systeme.io** avec le lien affilié du compte,
sur plusieurs comptes à la fois : elle étudie la niche, comprend ce qui rend une publication virale, génère des
carrousels originaux, les contrôle, les programme en respectant les limites de chaque compte, puis apprend des
statistiques réelles.

```
ANALYSER → COMPRENDRE → GÉNÉRER → CONTRÔLER → PUBLIER → MESURER → OPTIMISER
```

Tableau de bord (copie en lecture seule, privée) : https://claude.ai/artifact/WX1m3a9TPo7qvSub7mjfX9

## Ce que fait chaque partie

| Partie | Rôle | Où |
|---|---|---|
| Veille concurrentielle | Importe des publications publiques (API officielles, exports Firecrawl / Metricool / Zernio, CSV), repère les comptes et les sujets | `src/intel/` |
| Détecteur de mécanismes viraux | Lit l'accroche, la structure, l'appel à l'action, les émotions, le nombre de slides, l'heure ; note chaque publication sur 100 sans se fier aux seules vues ; compare, repère les formats partagés et les tendances | `src/intel/features.ts`, `scoring.ts`, `patterns.ts`, `trends.ts` |
| Générateur | 10 à 500 idées ou carrousels par demande : IA (7 rôles, plusieurs fournisseurs) ou bibliothèque originale hors ligne ; jamais de texte copié | `src/generate/`, `data/library/` |
| Visuels | 10 modèles (minimaliste, storytelling, éducatif, luxe, business, motivation, curiosité, liste, avant/après, anecdotes), identité par compte, formats 9:16 / 4:5 / 1:1, mention « Publicité » sur chaque slide, JPEG prêts à publier, ZIP et PDF | `src/render/` |
| Contrôle qualité | Orthographe, grammaire, cohérence, faits vérifiés, lisibilité, contraste, dimensions, doublons (nos carrousels et ceux des concurrents), règles des plateformes, promesses interdites ; validation humaine réglable par compte | `src/qc/`, `src/review.ts` |
| Publication | Calendrier, plafonds par compte, créneaux vidéo réservés, file d'attente, Zernio / Meta / paquet manuel, reprises seulement sur erreur passagère, jamais de contournement d'une limite | `src/publish/` |
| Boucle d'apprentissage | Statistiques de nos publications → score → apprentissage par dimension (échantillonnage de Thompson) → choix des prochains sujets, accroches, modèles, nombres de slides, horaires | `src/analytics/` |
| Tableau de bord | 11 pages : Dashboard, Comptes, Analyse concurrentielle, Base de publications, Générateur, Templates, Calendrier, Publications, Analytics, Paramètres, Intégrations MCP | `src/dashboard/` |

## Démarrer

Node 22 ou plus récent. Le rendu utilise Chromium via Playwright (déjà présent dans les sessions cloud).

```bash
cd viral
npm ci
npm run viral -- init                      # base de données + comptes
npm run viral -- import var/imports/…      # publications à analyser (JSON, JSON lines, CSV)
npm run viral -- generate --account tiktok-12eure21 --quantity 10
npm run viral -- dashboard                 # http://127.0.0.1:8787
npm test                                   # 32 tests
```

`npm run viral -- help` liste toutes les commandes. Les comptes, limites, identités visuelles et modèles d'IA se
règlent dans `config/` (ou dans le tableau de bord pour la validation humaine et la publication automatique).

## Règles qui ne bougent pas

- « Publicité » visible sur chaque slide et en tête de légende (loi n° 2023-451).
- Aucun prix, chiffre, pourcentage ou fonction de Systeme.io sans fait vérifié et récent (`data/facts/`, relus par
  `facts:verify` sur les pages officielles).
- Aucune promesse de revenus, de résultat garanti, d'argent facile, aucune image de richesse, aucun faux témoignage,
  aucune fausse urgence, aucune marque concurrente.
- Inspirés des mécanismes des concurrents, jamais de leurs textes : le contrôle qualité refuse tout passage trop
  proche d'une publication collectée.
- Pas de publication en masse identique sur plusieurs comptes : chaque compte a son identité, et le même carrousel
  ne peut pas partir sur deux comptes à moins de 24 h.
- Les limites des plateformes et de chaque compte sont des plafonds, jamais contournés : une publication refusée
  pour limite est reportée, une publication impossible devient un paquet à poster à la main.

Pour aller plus loin : [audit et plan](docs/AUDIT.md) · [mise en production et limites](docs/MISE-EN-PRODUCTION.md).
