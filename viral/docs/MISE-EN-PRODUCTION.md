# Mise en production

## 1. Secrets (jamais dans le dépôt)

| Variable | Pour | Où la créer |
|---|---|---|
| `ZERNIO_API_KEY` | Publier sur TikTok, lire les statistiques | Zernio → Settings → API keys |
| `INSTAGRAM_ACCESS_TOKEN`, `THREADS_ACCESS_TOKEN` | Publier sur Instagram et Threads, lire leurs statistiques | Même procédure que le studio (`docs/publication-meta.md` sur sa branche) |
| `ANTHROPIC_API_KEY` ou `GOOGLE_AI_API_KEY` ou `GROQ_API_KEY` ou `FREELLMAPI_URL` + `FREELLMAPI_KEY` | Rédaction par IA (sinon bibliothèque hors ligne) | Console du fournisseur |
| `GITHUB_MODELS_TOKEN` | IA gratuite de GitHub (dans le workflow : `${{ github.token }}` avec `permissions: models: read`) | Automatique dans GitHub Actions |
| `YOUTUBE_API_KEY`, `META_GRAPH_TOKEN` + `IG_BUSINESS_ID` | Veille officielle | Google Cloud, Meta for Developers |
| `VIRAL_MEDIA_BASE_URL` | Adresse publique des images (Meta en a besoin) | ex. `https://raw.githubusercontent.com/<compte>/<dépôt>/<branche>/viral/media` |
| `DASHBOARD_TOKEN` | Protéger les actions du tableau de bord s'il est exposé | libre |

Budgets : `config/ai.json` (2 $ par jour au total par défaut, 0 $ pour les fournisseurs gratuits), quotas d'appels
par fournisseur, disjoncteur après 3 échecs en 10 minutes, journal de chaque appel (jetons, coût, durée, erreur).

## 2. Automatisation

Le fichier `deploy/viral-machine.yml` est prêt pour GitHub Actions : chaque jour, collecte, analyse, génération,
rendu, contrôle, programmation, publication de ce qui est dû (comptes autorisés uniquement), statistiques et
apprentissage. GitHub n'exécute les tâches planifiées que depuis la **branche par défaut** du dépôt : le copier dans
`.github/workflows/` de cette branche demande ton accord (règle du studio). La base de données est conservée entre
deux passages par le cache d'Actions.

Sans workflow, la même boucle tourne dans une session Claude programmée qui a les connecteurs Zernio et Metricool :
`npm run viral -- pipeline --per-account 3`, puis `publish:plan` donne les appels `posts_create` prêts à envoyer par
le connecteur Zernio, et `publish:record` enregistre le résultat.

## 3. Mise en route conseillée

1. `npm run viral -- facts:verify` (les prix sont valables 7 jours).
2. Tableau de bord → Publications : valider ou refuser les carrousels en attente.
3. `npm run viral -- schedule:auto` (calendrier, au plus 2 par jour sur TikTok, 1 sur Instagram et Threads, à 90 min
   au moins des vidéos de 10:00 et 20:00).
4. Quand la qualité convient, Comptes → « Autoriser la publication auto » pour le compte.
5. Chaque semaine : importer les statistiques (Analytics) pour nourrir l'apprentissage.

## 4. Limites actuelles

- **Veille à grande échelle** : 60 publications concurrentes analysées aujourd'hui. Les 50 000 visées demandent les
  clés de veille officielles (YouTube : environ 5 000 vidéos par jour gratuitement ; Instagram Business Discovery :
  quelques milliers de publications par heure) ou des crédits Firecrawl (environ 2 crédits par page de 30 TikTok).
  TikTok n'a pas d'API officielle de veille pour ce cas : seule la source tierce Firecrawl existe.
- **IA** : sans clé, la rédaction repose sur la bibliothèque originale (15 sujets, 8 structures, des centaines de
  combinaisons sans doublon). Les autres langues et les sujets libres demandent une IA.
- **Images** : uniquement typographie, formes et captures officielles de Systeme.io. Pas de générateur d'images IA :
  aucune licence commerciale vérifiée pour ces images (règle du studio). Pixabay est branchable (clé présente).
- **Publication** : Zernio attend une nouvelle clé ; Meta attend les jetons ; Metricool n'a pas d'API publique (ses
  publications passent par une session Claude avec le connecteur, dans la limite de 20 par mois).
- **YouTube** : pas de carrousel possible par API.
- **Stoleez** : non intégré tant que son adresse officielle n'est pas connue.
- **Base de données** : SQLite (des millions de lignes sans difficulté sur une machine) ; le schéma est en SQL
  standard pour passer à PostgreSQL si plusieurs machines doivent écrire en même temps.
