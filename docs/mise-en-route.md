# Mise en route

Comptez une demi-heure. Chaque étape débloque une partie du studio ; le panneau indique en haut
ce qui manque encore.

## 1. Rendre le code disponible aux productions automatiques

Le studio est sur la branche `claude/serene-maxwell-pdm5wr` du dépôt `businebile-png/video-`.
Les productions automatiques partent de la branche par défaut du dépôt : fusionnez cette branche
(ou demandez à Claude d'ouvrir la demande de fusion).

## 2. Clé ElevenLabs (voix off naturelle)

1. Prenez un abonnement payant ElevenLabs (licence commerciale incluse ; **Creator** conseillé pour
   une vidéo par jour avec essais et musique générée).
2. Dans *Developers → API Keys*, créez une clé.
3. Enregistrez-la dans l'environnement cloud de Claude Code (menu de l'environnement → Modifier →
   *Network secrets*) pour l'hôte `api.elevenlabs.io`, en-tête `xi-api-key`, sans préfixe.
   Claude peut aussi vous ouvrir le formulaire sécurisé : ne collez jamais une clé dans la conversation.

## 3. Clé Pexels (séquences vidéo)

1. Créez un compte sur pexels.com puis une clé sur https://www.pexels.com/api/ (gratuit).
2. Enregistrez-la pour l'hôte `api.pexels.com`, en-tête `Authorization`, **sans préfixe** (Pexels
   refuse « Bearer »). Si le formulaire impose un préfixe, ajoutez plutôt une variable
   d'environnement `PEXELS_API_KEY`.

## 4. Accès réseau de l'environnement

L'environnement des productions doit autoriser : `api.pexels.com`, `videos.pexels.com`,
`images.pexels.com`, `player.vimeo.com`, `api.elevenlabs.io`, `systeme.io`, `help.systeme.io`,
`raw.githubusercontent.com` (et les registres de paquets, autorisés par défaut).

## 5. Lien affilié

Dans le panneau → **Réglages** : collez votre lien (tableau de bord affilié Systeme.io).
Il doit être de la forme `https://systeme.io/?sa=sa…`, **sans « www »** (Systeme.io précise que
« www » casse le suivi). Mettez le même lien dans la bio TikTok et Instagram, puis cliquez
« Le lien de ma bio TikTok/Instagram est bien celui-ci ».

> TikTok : le lien cliquable en bio demande un compte **Business** (ou 1 000 abonnés pour un compte personnel).

## 6. Choisir la voix

1. Dans ElevenLabs → *Voice Library*, filtrez sur le français et ajoutez 2 ou 3 voix **françaises
   natives** à « My Voices » (usage réseaux sociaux ou conversation : elles sonnent moins « lu »).
2. Lancez une production depuis le panneau : sans voix approuvée, elle prépare des essais audio.
3. Panneau → **Réglages → Voix off** : écoutez avec le son et approuvez la plus naturelle.

## 7. Instagram (facultatif)

Connectez votre compte Instagram professionnel ou créateur dans Metricool, puis activez Instagram
dans les Réglages du panneau.

## 8. Captures réelles de Systeme.io (fortement conseillé)

Les démonstrations à l'écran n'utilisent que de vraies captures de votre compte : voir
[assets/systeme/LISEZMOI.md](../assets/systeme/LISEZMOI.md). Sans elles, les vidéos expliquent
avec des séquences et des cartes, mais ne montrent pas l'interface.

## 9. Musique

Par défaut, une musique instrumentale est générée par ElevenLabs (licence de votre abonnement payant).
Vous pouvez aussi fournir vos propres pistes sous licence : [assets/music/LISEZMOI.md](../assets/music/LISEZMOI.md).

## 10. Activer la production quotidienne

Panneau → **Réglages → Production quotidienne** : « Activer ». Chaque matin, la vidéo du jour
arrive dans « À valider ». Vous pouvez aussi « Lancer une production maintenant ».

## Vérifier où vous en êtes

```bash
npm run studio -- doctor
```
