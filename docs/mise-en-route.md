# Mise en route

Comptez une demi-heure. Chaque étape débloque une partie du studio ; le panneau indique en haut
ce qui manque encore.

## 1. Rendre le code disponible aux productions automatiques

Le studio est sur la branche `claude/serene-maxwell-pdm5wr` du dépôt `businebile-png/video-`.
Les productions automatiques partent de la branche par défaut du dépôt : fusionnez cette branche
(ou demandez à Claude d'ouvrir la demande de fusion).

## 2. Clé Azure Speech gratuite (voix off naturelle)

1. Créez un compte Azure gratuit (https://azure.microsoft.com/fr-fr/free/). Microsoft demande une carte
   pour vérifier votre identité ; le niveau **F0** utilisé ici est gratuit et ne facture rien.
2. Dans le portail Azure : *Créer une ressource* → **Speech** (Services Speech) → région **France Central**,
   niveau tarifaire **Free F0**.
3. Dans la ressource : *Clés et point de terminaison* → copiez la **Clé 1**.
4. Donnez-la à Claude par le formulaire sécurisé (jamais dans la conversation), pour les deux hôtes
   `francecentral.tts.speech.microsoft.com` (voix) et `francecentral.api.cognitive.microsoft.com`
   (vérification de prononciation), en-tête `Ocp-Apim-Subscription-Key`, sans préfixe.

Limites gratuites : 500 000 caractères de voix et 5 heures de transcription par mois, largement
suffisant pour une vidéo par jour.

## 3. Clé Pexels (séquences vidéo)

1. Créez un compte sur pexels.com puis une clé sur https://www.pexels.com/api/ (gratuit).
2. Enregistrez-la pour l'hôte `api.pexels.com`, en-tête `Authorization`, **sans préfixe** (Pexels
   refuse « Bearer »). Si le formulaire impose un préfixe, ajoutez plutôt une variable
   d'environnement `PEXELS_API_KEY`.

## 4. Accès réseau de l'environnement

L'environnement « Studio vidéo businebile » autorise déjà : `api.pexels.com`, `videos.pexels.com`,
`images.pexels.com`, `player.vimeo.com`, `systeme.io`, `help.systeme.io`, `raw.githubusercontent.com`
(et les registres de paquets). Les hôtes Azure sont ajoutés automatiquement quand vous enregistrez la clé.

## 5. Lien affilié

Dans le panneau → **Réglages** : collez votre lien (tableau de bord affilié Systeme.io).
Il doit être de la forme `https://systeme.io/?sa=sa…`, **sans « www »** (Systeme.io précise que
« www » casse le suivi). Mettez le même lien dans la bio TikTok et Instagram, puis cliquez
« Le lien de ma bio TikTok/Instagram est bien celui-ci ».

> TikTok : le lien cliquable en bio demande un compte **Business** (ou 1 000 abonnés pour un compte personnel).

## 6. Choisir la voix

1. Lancez une production depuis le panneau : sans voix approuvée, elle prépare des essais audio des
   voix françaises les plus naturelles (Vivienne et Rémy « multilingues », Denise, Henri).
2. Panneau → **Réglages → Voix off** : écoutez avec le son et approuvez celle qui vous plaît.

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
