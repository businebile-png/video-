# Audit de l'environnement — 28 novembre 2026

## Projets trouvés

| Dépôt | Contenu | Utilisé ici |
|---|---|---|
| `video-` (branche du studio `claude/serene-maxwell-pdm5wr`) | Studio de vidéos publicitaires Systeme.io : Remotion, voix « Claire », faits vérifiés, contrôleur de script, publication Zernio / Metricool / Meta, deux workflows GitHub Actions | Repris : faits vérifiés et leurs sources, règles de conformité, captures officielles de la page tarifs, méthode de vérification de la page tarifs. La machine vit dans `viral/` sur la branche `ccr-a92e76b7-88k8fk`. |
| `storedoctor-ai` | Application Next.js + Supabase (autre produit) | Non |
| `freellmapi` | Passerelle d'IA gratuites auto-hébergeable | Prévue comme fournisseur IA (`FREELLMAPI_URL`) |
| `caveman` | Greffon tiers pour agents de code | Non |

## Comptes connectés

| Compte | Outil | État au 28/11 | Carrousels |
|---|---|---|---|
| TikTok @12eure21 (z.zir) | Zernio | sain, publication et statistiques autorisées | oui (mode photo, 35 images max, 15 par 24 h) |
| YouTube @zzetu (Zzetu_off) | Zernio | sain | non : l'API ne publie pas de posts à images |
| Instagram @12eu125 | Metricool (marque z.zir) | connecté | oui (API Meta : 10 images, 50 publications / 24 h) |
| Threads @12eu125 | Metricool | connecté | oui (20 images, 500 caractères) |

25 publications réelles de nos comptes (14 TikTok, 11 YouTube, 30 derniers jours) ont été importées : 207 à
284 vues par vidéo TikTok, 11 à 53 vues par Short, très peu d'interactions. Score moyen 50/100.

## Connecteurs MCP

| Connecteur | État | Constat |
|---|---|---|
| Zernio | connecté | 2 comptes sains ; validation réelle d'un carrousel TikTok de 8 images : « aucun problème ». La clé de l'API REST refusée (401) a été remplacée le 28/11 : nouvelle clé testée, 25 statistiques synchronisées par l'API. |
| Metricool | connecté | Aucune publication programmée, aucun concurrent configuré. Formule gratuite : 20 publications par mois (quota de novembre épuisé selon le studio). |
| Firecrawl | connecté | Recherche web et données publiques (ScrapeCreators) : 60 publications TikTok de la niche collectées pour 2 crédits. Source tierce, pas l'API officielle des plateformes. |
| Perspective AI | connecté | Sans rôle pour l'instant. |
| Claude Docs | connecté | Disponible pour les rapports. |
| **Stoleez** | **introuvable** | Absent du registre des connecteurs, de npm, de PyPI et du web. Aucune connexion fictive n'a été créée : il faut l'adresse officielle du serveur MCP ou sa documentation. |

## Erreurs et limites constatées

1. **Relève gratuite du studio en panne** : les 5 dernières productions automatiques ont échoué (GitHub Models répond
   « OK » sans texte ; Pollinations refuse les consignes de plus de 16 000 caractères). Le routeur IA de la machine
   mesure la taille de la consigne avant d'appeler Pollinations et passe au modèle suivant.
2. **Clé Zernio REST invalide** : la publication et les statistiques autonomes (hors session Claude) attendent une
   nouvelle clé.
3. **Jetons Meta absents** : la publication directe Instagram / Threads du studio n'est pas encore activée
   (`data/meta-publications.json` absent).
4. **Aucune clé d'IA** dans l'environnement : la génération utilise la bibliothèque originale hors ligne ; les
   modèles (Claude, Gemini, GitHub Models, Groq, FreeLLMAPI…) se branchent par simple variable d'environnement.
5. **Veille officielle impossible sans clés** : YouTube Data API (clé gratuite), Instagram Graph API avec connexion
   Facebook (Business Discovery), API Threads (recherche par mot-clé).
6. **Faits** : 2 faits n'étaient plus lisibles sur la page tarifs avec une lecture simple ; après alignement sur la
   méthode du studio (bascule mensuel / annuel, sections repliées), les 52 faits sourcés sont confirmés en direct.

## Plan d'amélioration (par priorité)

1. ~~Créer une nouvelle clé API Zernio~~ (fait le 28/11, environnement cloud) ; l'ajouter aussi comme secret GitHub `ZERNIO_API_KEY` quand l'automatisation sera activée.
2. Valider les 30 carrousels en attente dans le tableau de bord, puis autoriser la publication automatique compte par
   compte quand le résultat convient.
3. Ajouter une clé d'IA gratuite (Google AI Studio) ou activer GitHub Models dans le workflow pour diversifier les
   textes au-delà de la bibliothèque.
4. Ajouter les jetons Instagram et Threads (procédure du studio) : publication directe et statistiques.
5. Clé YouTube Data API et concurrents dans Metricool : veille officielle quotidienne, vers des dizaines de milliers
   de publications analysées.
6. Donner l'adresse ou la documentation du MCP Stoleez.

## Audit vidéo et audio — 28 novembre 2026 (essais réels)

| Service | État | Constat |
|---|---|---|
| Voix Claire, Hugo (Chatterbox, locales) | **fonctionnent** | Installées (`bash scripts/setup-voice.sh`), environ 1 min par phrase sur 4 processeurs, chaque phrase réécoutée et refaite si besoin. |
| Voix Siwis, Hugo rapide et 10 voix étrangères (Kokoro, locales) | **fonctionnent** | Quelques secondes par vidéo ; anglais américain et britannique, espagnol, italien, portugais du Brésil, femmes et hommes. |
| ElevenLabs | **refusée (401)** | La clé enregistrée part dans l'en-tête `Authorization: Bearer` alors qu'ElevenLabs l'attend dans `xi-api-key`. Et sur le plan gratuit, ElevenLabs interdit l'usage commercial : la machine ne l'utiliserait qu'avec une offre payante. |
| Google Text-to-Speech | **refusée (400 « API key not valid »)** | Clé à remplacer, et facturation Google nécessaire ; laissée de côté à la demande de l'utilisateur (studio). |
| Pixabay (plans vidéo) | **fonctionne** | Licence vérifiée (usage commercial sans attribution) ; recherches mises en cache 24 h. |
| Coverr | **refusée (401 « Invalid API_KEY »)** | Non utilisée. |
| Pexels | absente | Clé `PEXELS_API_KEY` non configurée (facultative). |
| Veo (Google), Runway | **non configurés** | Payants, aucune clé : jamais appelés ; les scènes « IA » passent en plans sous licence et le disent. |
| Musique | **originale** | 13 ambiances composées par la machine, aucun droit tiers. Aucune piste externe enregistrée. |
| Statistiques vidéo (Zernio) | **fonctionnent** | Temps de visionnage moyen, taux de visionnage complet et abonnements gagnés importés : sur 25 vidéos du studio, 1,5 s de visionnage moyen et 0,6 % vues jusqu'au bout. |
| Vidéos concurrentes (Firecrawl / ScrapeCreators) | **fonctionne** | 6 vidéos analysées (7 crédits) : durée, sous-titres, accroche, structure, appel à l'action. Les transcriptions n'ont pas été renvoyées par ce service ; la recherche de Shorts YouTube « systeme.io » est revenue vide. |
