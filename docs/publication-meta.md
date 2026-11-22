# Publication Instagram et Threads par les API de Meta (gratuit)

Depuis le 22/11/2026 (demande de l'utilisateur : « automatiquement, mais gratuitement »), Instagram (Reels) et Threads
peuvent être publiés **directement** avec les API officielles de Meta, sans passer par Metricool (quota gratuit de
20 publications par mois, épuisé en novembre) ni par Zernio (carte demandée au-delà de 2 comptes). TikTok et YouTube
restent sur Zernio (2 comptes gratuits, publications illimitées).

## Fonctionnement

- `src/publish/meta.ts` lit `queue/*.json` (les vidéos prêtes) et publie, au créneau de la vidéo (10:00 ou 20:00), le Reel
  Instagram puis le post Threads, avec la légende déjà préparée (`posts[instagram]`, `posts[threads]`, mention
  « Publicité · Systeme.io » en tête, déclaration « contenu IA » cochée côté Instagram et Threads).
- `.github/workflows/publier-meta.yml` le lance par GitHub Actions (gratuit, indépendant du quota de Claude) à 9:20 et 9:50
  (puis 19:20 et 19:50) heure de Paris : GitHub retarde ses tâches planifiées de 10 à 60 minutes, donc le job part tôt, attend
  jusqu'à 70 minutes l'heure exacte du créneau (10:00 ou 20:00) et publie pile ; reprise à 12:15 et 22:15 en cas d'échec.
  Les départs suivants d'un même créneau trouvent tout publié et s'arrêtent (groupe de concurrence). **Ce fichier doit rester sur la
  branche par défaut du dépôt** (`claude/kind-euler-t08y5a`) : GitHub n'exécute les planifications que depuis elle.
- Meta télécharge elle-même la vidéo à une adresse publique (le téléversement direct exige « Facebook Login for Business »,
  hors de cette formule gratuite). GitHub brut sert les MP4 en `application/octet-stream`, que Meta peut refuser, et jsDelivr
  ne sert pas les fichiers de plus de 20 Mo. Le publieur teste donc, avant d'appeler Meta, trois adresses épinglées sur le
  commit récupéré (jsDelivr, githack, GitHub brut), ne garde que celles qui répondent avec un vrai type vidéo (`video/mp4`)
  et passe à la suivante si Meta refuse la première. Le mode « verifier » affiche ces tests pour la prochaine vidéo.
- Contrôles refaits à la publication : vidéo « publishable », légende commençant par « Publicité », créneau atteint et
  dépassé de moins de 5 h, 3 essais au plus par réseau. Une vidéo n'est jamais publiée deux fois (`data/meta-publications.json`).
- Résultat de chaque publication (identifiant, adresse du post) : `data/meta-publications.json`, commité par le workflow.
  La tâche de publication de 13:35 s'en sert pour passer les fiches du panneau à « publiée » (la plateforme a confirmé).

## Mise en route (une fois, environ 20 minutes)

1. https://developers.facebook.com/apps → **Créer une app** → cas d'usage **Autre** → type **Business** → nom et e-mail.
2. Produit **Instagram** → **Configurer** → « API setup with Instagram login » → ajouter le compte Instagram (professionnel,
   public) → **Generate token** → copier le jeton (valable 60 jours).
3. Pour Threads : app avec le cas d'usage **Accéder à l'API Threads** ; **Rôles de l'app → Ajouter des personnes → Testeur
   Threads** ; accepter l'invitation dans Threads (Paramètres → Compte → Autorisations du site web → Invitations) ; générer
   le jeton utilisateur dans les réglages du cas d'usage (permissions `threads_basic` et `threads_content_publish`).
4. Dépôt GitHub → Settings → Secrets and variables → Actions → **New repository secret** : `INSTAGRAM_ACCESS_TOKEN` et
   `THREADS_ACCESS_TOKEN`. Ne jamais coller un jeton dans une conversation ni dans le dépôt.
5. Onglet Actions → « Publication Instagram et Threads (API Meta) » → Run workflow → mode `verifier` : le journal affiche
   `✓ instagram : @compte` et `✓ threads : @compte`, teste les adresses de la prochaine vidéo, puis fait un **essai réel
   auprès de Meta** : un conteneur (jamais publié, invisible, expiré de lui-même) par type d'adresse, pour savoir si Meta
   accepte la vidéo telle que GitHub la sert. Rien n'est publié, aucun commentaire n'est posté.
6. Une fois les jetons contrôlés, mettre `"actif": true` dans `data/meta-publications.json` : dès lors Instagram et Threads
   ne sont plus programmés sur Metricool ni Zernio (les publications Metricool déjà créées pour ces réseaux passent en
   brouillon, sinon doublon). **C'est aussi un verrou** : tant que `"actif"` n'est pas à `true`, le workflow ne publie rien
   (il l'écrit dans son journal), même si les jetons sont déjà en place. Ordre à respecter : jetons → « verifier » →
   posts Metricool en brouillon → `"actif": true`.

## Limite connue : vidéos de plus de 20 Mo

Mesuré depuis GitHub Actions le 22/11/2026 (mode « verifier ») : pour une vidéo de 17,9 Mo, jsDelivr répond `video/mp4` ;
pour une de 30,8 Mo, jsDelivr et Statically refusent (403, plafond de 20 Mo), githack et GitHub brut répondent
`application/octet-stream`. Ce que Meta fait d'un `octet-stream` n'est pas encore connu : l'essai réel de « verifier »
(conteneurs jamais publiés) le dira dès que les jetons sont en place. Les vidéos de la série durent 22 à 28 s et font
environ 15 à 19 Mo, donc la plupart passent par jsDelivr. Si Meta refuse l'`octet-stream` et qu'une vidéo dépasse 20 Mo :
ne pas activer la publication pour elle (« skipped » dans `data/meta-publications.json`), puis soit la réencoder à moins de
19 Mo avant `media:push`, soit servir les MP4 par GitHub Pages (réglage à faire par l'utilisateur).

## Entretien

- Les jetons durent **60 jours** : en générer de nouveaux (étapes 2 et 3) et remplacer les secrets avant l'échéance
  (jetons créés le 22/11/2026 → à renouveler avant le 20/01/2027).
- Heure d'été (à partir du 28/03/2027) : décaler les `cron` du workflow d'une heure en arrière (8:50 → 7:50 UTC, etc.).
- Laisser une vidéo de côté pour un réseau : ajouter dans `data/meta-publications.json`
  `"<runId>": {"instagram": {"status": "skipped", "at": "<iso>", "reason": "…"}}`.
- Essai à blanc local : `npm run studio -- meta:publish publier --simuler --maintenant 2026-11-23T20:05:00+01:00`.
- Limites de Meta : 100 publications par 24 h sur Instagram, 250 sur Threads (loin de notre usage).
- Pas de label « partenariat rémunéré » par cette API : la mention « Publicité » reste dans la vidéo et en tête de légende.
