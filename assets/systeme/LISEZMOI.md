# Captures réelles de Systeme.io

Les démonstrations à l'écran n'utilisent **que** des captures de votre propre compte Systeme.io.
Le studio n'invente jamais d'interface : sans capture, il n'y a pas de scène de démonstration.

## Quoi enregistrer (10 à 30 secondes chacune, écran d'ordinateur)

| Identifiant conseillé | Fonction (`--feature`) | Ce qu'on doit voir |
|---|---|---|
| `tunnel-editeur` | `funnels` | L'éditeur de tunnel : étapes, ajout d'une page |
| `page-capture` | `landing-pages` | Une page de capture en cours d'édition |
| `email-campagne` | `email-marketing` | La création d'un e-mail ou d'une campagne |
| `automatisation-regle` | `automations` | Une règle « quand… alors… » ou un workflow |
| `formation-modules` | `courses` | Les modules et leçons d'une formation |
| `contacts-liste` | `contacts` | La liste des contacts avec leurs étiquettes (données floutées) |
| `bon-de-commande` | `payments` | Un bon de commande / une page de paiement |
| `tarifs-page` | `pricing` | La page tarifs officielle (systeme.io/fr/pricing) |

Conseils : fenêtre de navigateur propre, zoom 110 à 125 %, gestes lents, pas de données personnelles
(noms, e-mails, chiffres d'affaires) — floutez-les ou utilisez un compte de démonstration.

## Ajouter une capture

```bash
npm run studio -- captures:add ~/Desktop/tunnel.mp4 --id tunnel-editeur --feature funnels --title "Éditeur de tunnel" --desc "Ajout d'une page de capture dans un tunnel" --checked
```

Puis indiquer les zones à mettre en valeur (coordonnées relatives de 0 à 1, origine en haut à gauche) :

```bash
npm run studio -- captures:region tunnel-editeur --id bouton-ajouter --x 0.62 --y 0.18 --w 0.2 --h 0.08 --label "Ajouter une étape"
```

`--checked` confirme qu'aucune donnée personnelle n'est visible : sans lui, la capture n'est pas utilisée.
