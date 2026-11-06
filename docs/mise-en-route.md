# Mise en route

Comptez un quart d'heure. Chaque étape débloque une partie du studio ; le panneau (onglet
**Démarrage**) indique ce qui manque encore.

## 1. Rendre le code disponible aux productions automatiques

Le studio est sur la branche `claude/serene-maxwell-pdm5wr` du dépôt `businebile-png/video-`.
La production programmée récupère d'elle-même cette branche si la branche par défaut ne contient pas
encore le studio : la fusion est facultative (elle évite seulement ce détour).

## 2. Voix off : rien à faire

La voix du studio est « Claire » : Chatterbox Multilingual (Resemble AI, licence MIT), avec un timbre
tiré de trois phrases de la base SIWIS (CC BY 4.0), et faster-whisper (licence MIT) pour réécouter
chaque phrase, caler les sous-titres et vérifier la prononciation. Elle tourne sur la machine de Claude :
aucun compte, aucune clé, aucune limite. Chaque production l'installe si besoin
(`bash scripts/setup-voice.sh`, quelques minutes la première fois ; les modèles sont vérifiés par
empreinte SHA-256). La voix « Siwis » (Kokoro-82M, Apache-2.0) reste installée en secours.

Claire a été choisie à l'écoute le 6 novembre 2026, parmi six voix. Pour la réécouter ou l'écarter :
panneau → **Réglages → Voix off**.

> Option : Azure Speech (niveau gratuit F0, compte Microsoft avec carte pour vérifier l'identité) donne
> d'autres voix. Il suffit alors de passer `voice.provider` et `voice.sttProvider` à `azure` dans
> `config/studio.json` et d'enregistrer la clé par le formulaire sécurisé (hôtes
> `francecentral.tts.speech.microsoft.com` et `francecentral.api.cognitive.microsoft.com`, en-tête
> `Ocp-Apim-Subscription-Key`, sans préfixe).

## 3. Clé Pixabay (séquences vidéo)

Pexels a suspendu la création de nouvelles clés : le studio utilise Pixabay (vraies vidéos, usage commercial
autorisé sans citer l'auteur, gratuit).

1. Créez un compte sur pixabay.com (connexion Google possible).
2. Ouvrez https://pixabay.com/api/docs/ : votre clé s'affiche dans la section « Parameters », ligne `key`.
3. Environnement « Studio vidéo businebile » → Modifier → **Environment variables** → ajoutez
   `PIXABAY_API_KEY=` suivi de la clé, puis enregistrez. Pixabay ne lit la clé que dans l'adresse de la
   requête : elle ne peut pas passer par « Network secrets ». La variable est lue au démarrage de chaque session.

Une clé Pexels déjà obtenue reste utilisable : `footage.provider` à `pexels` dans `config/studio.json`, clé
dans « Network secrets » (hôte `api.pexels.com`, en-tête `Authorization`, sans préfixe).

## 4. Accès réseau de l'environnement

L'environnement « Studio vidéo businebile » autorise déjà : `pixabay.com`, `cdn.pixabay.com`, `api.pexels.com`,
`videos.pexels.com`, `images.pexels.com`, `player.vimeo.com`, `systeme.io`, `help.systeme.io`, `raw.githubusercontent.com`,
les hôtes de Hugging Face (téléchargement des modèles de voix), `download.pytorch.org` et
`download-r2.pytorch.org` (moteur de la voix Claire) et les registres de paquets.

## 5. Lien affilié

Dans le panneau → **Réglages** : collez votre lien (tableau de bord affilié Systeme.io).
Il doit être de la forme `https://systeme.io/?sa=sa…`, **sans « www »** (Systeme.io précise que
« www » casse le suivi). Mettez le même lien dans la bio TikTok et Instagram, puis cliquez
« Le lien de ma bio TikTok/Instagram est bien celui-ci ».

> TikTok : le lien cliquable en bio demande un compte **Business** (ou 1 000 abonnés pour un compte personnel).

## 6. Voix approuvée

Déjà fait : la voix « Claire » est approuvée (et « Siwis » en secours). Si vous l'écartez dans
**Réglages → Voix off**, la production suivante passe à la voix de secours approuvée, ou s'arrête et
dépose de nouveaux essais à écouter s'il n'en reste aucune.

## 7. Instagram (facultatif)

Connectez votre compte Instagram professionnel ou créateur dans Metricool, puis activez Instagram
dans les Réglages du panneau.

## 8. Captures réelles de Systeme.io (fortement conseillé)

Les démonstrations à l'écran n'utilisent que de vraies captures de votre compte : voir
[assets/systeme/LISEZMOI.md](../assets/systeme/LISEZMOI.md). Sans elles, les vidéos expliquent
avec des séquences et des cartes, mais ne montrent pas l'interface.

## 9. Musique

Par défaut, pas de musique (voix et habillage sonore). Pour en ajouter gratuitement, téléchargez des
pistes libres de droits (par exemple sur Pixabay Music, licence utilisable commercialement) et
enregistrez-les : [assets/music/LISEZMOI.md](../assets/music/LISEZMOI.md).

## 10. Activer la production quotidienne

Panneau → **Réglages → Production quotidienne** : « Activer ». Chaque matin, la vidéo du jour
arrive dans « À valider ». Vous pouvez aussi « Lancer une production maintenant ».

## Vérifier où vous en êtes

```bash
npm run studio -- doctor
```
