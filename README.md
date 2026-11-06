# Studio pub Systeme.io

Un studio de production automatisé qui fabrique chaque jour une vidéo publicitaire verticale
(TikTok et Instagram Reels) pour faire découvrir **Systeme.io** et ses **abonnements payants**
via votre lien affilié — avec de vraies séquences vidéo, une voix off naturelle, un montage
professionnel, un contrôle qualité strict et **votre validation avant toute publication**.

**Panneau de validation :** https://claude.ai/artifact/PHv2PwELy8staCztefioMr
(privé, ouvert avec votre compte claude.ai, utilisable sur téléphone)

## Ce que fait le studio, chaque jour

```mermaid
flowchart LR
  A[Idée et angle<br/>catégorie tournante] --> B[Script vérifié<br/>faits officiels]
  B --> C[Voix off française<br/>gratuite, intégrée]
  C --> D[Séquences réelles<br/>Pixabay]
  D --> E[Montage<br/>Remotion]
  E --> F[Contrôle qualité<br/>note /100 + verrous]
  F --> G[Panneau<br/>vous validez]
  G --> H[Programmation<br/>Metricool → TikTok / Instagram]
  H --> I[Statistiques<br/>vues, clics, abonnements]
  I --> A
```

1. **Choisit un sujet** parmi 14 catégories (publicité directe, formules payantes, edit court « lien en bio », tutoriels,
   tunnels de vente, automatisations, formations, erreurs de débutants…) sans jamais répéter
   une accroche ou un angle récent, en tenant compte de vos idées et de ce qui convertit le mieux.
2. **Écrit le script** pour l'oreille, orienté abonnement payant, et le fait passer par un
   contrôleur automatique : aucune promesse de revenus, aucune fausse urgence, aucun superlatif,
   et chaque prix, chiffre ou fonctionnalité doit être prouvé par un extrait de la page officielle
   de Systeme.io copiée le jour même.
3. **Enregistre la voix off** avec la voix française gratuite intégrée au studio (Kokoro, voix
   « Siwis »), **approuvée par vous à l'écoute**, puis la fait retranscrire pour détecter chaque mot
   mal prononcé. Les sous-titres sont calés au mot près.
4. **Cherche les séquences** sur Pixabay (vidéos réelles, licence commerciale), les présente sur des
   planches contact, choisit les plus justes et ne réutilise pas un plan avant 45 jours.
5. **Monte la vidéo** : coupes sur le rythme de la voix, mouvements de caméra, étalonnage, grain,
   sous-titres animés, cartes explicatives, captures réelles de Systeme.io si vous en fournissez,
   carte d'appel à l'action, mention « Publicité » visible du début à la fin, musique libre de droits
   (si vous en fournissez) et habillage sonore. Cinq directions artistiques tournent pour éviter l'effet « modèle »,
   dont « Edit nuit » (noir cinéma, gros texte central, coupes rapides) pour le format court.
6. **Note la vidéo sur 100** (grille ci-dessous) avec un relecteur indépendant et des mesures
   techniques. Moins de 85 : refaite. 85 à 89 : améliorée. 90 et plus : proposée.
7. **La dépose dans le panneau** : vous la regardez avec le son, ajustez la légende ou l'heure,
   et cliquez « Valider et programmer » — la publication part dans Metricool.
8. **Suit les résultats** : vues et visionnage depuis Metricool, clics, inscriptions et
   abonnements payants depuis votre tableau de bord affilié (saisis dans le panneau).

## La grille de qualité

| Critère | Points | Comment c'est mesuré |
|---|---:|---|
| Qualité visuelle | 20 | Relecture indépendante, plafonnée par les mesures (netteté, zones sûres, images noires ou figées) |
| Naturel de la voix | 15 | Voix approuvée par vous + mesures (prononciation retranscrite, débit, pauses) |
| Qualité du montage | 15 | Relecture, plafonnée par le rythme et la variété des plans |
| Qualité du script | 15 | Relecture, plafonnée par les avertissements du contrôleur |
| Explication de Systeme.io | 15 | Relecture |
| Potentiel de conversion | 15 | Relecture, plafonnée si l'appel à l'action est faible |
| Qualité audio | 5 | Mesures (volume EBU R128, crêtes, silences, intelligibilité) |

**Verrous** (bloquent la publication quelle que soit la note) : script non conforme, fait non
vérifié, lien affilié absent ou incorrect, mention « Publicité » absente, droits non prouvés
(séquences, musique, captures), voix non approuvée, vidéo sans voix audible, format non conforme,
problème bloquant relevé à la relecture.

## Ce qu'il vous faut — sans rien payer

| Élément | Pourquoi | Coût |
|---|---|---|
| Lien affilié Systeme.io | Toutes les ventes passent par lui | 0 € |
| Voix off intégrée (Kokoro-82M + faster-whisper) | Voix française et vérification de prononciation, calculées sur la machine de Claude ; usage commercial autorisé ; aucun compte, aucune clé, aucune limite | 0 € |
| Clé Pixabay | Séquences vidéo réelles (Pexels ne délivre plus de nouvelles clés ; une clé Pexels existante reste utilisable) | 0 € |
| Metricool (déjà connecté) | Programmation TikTok / Instagram conforme | Votre plan gratuit actuel |
| Claude (votre abonnement) | Écriture, relecture, orchestration | Déjà inclus |
| Remotion, GitHub, polices, habillage sonore | Montage, hébergement des vidéos | 0 € |

La voix s'installe toute seule (`bash scripts/setup-voice.sh`, environ 30 secondes, modèles vérifiés
par empreinte). Azure Speech (niveau gratuit, compte Microsoft requis) et ElevenLabs (plans payants
seulement pour un usage commercial) restent possibles en option dans `config/studio.json`.

Pas à pas complet : **[docs/mise-en-route.md](docs/mise-en-route.md)**.

## Ce que le studio ne fera jamais

- Publier sans votre validation (sauf si vous activez vous-même la publication automatique).
- Promettre des revenus, inventer une urgence, un témoignage, un prix ou une interface.
- Annoncer « publiée » avant que la plateforme ne l'ait confirmé.
- Contourner les règles de TikTok, d'Instagram ou de Metricool (TikTok interdit les outils
  maison de publication sur son propre compte : la publication passe par Metricool, partenaire agréé).

## Pour aller plus loin

- [Mise en route](docs/mise-en-route.md) — clés, voix, lien affilié, captures, activation
- [Production quotidienne](docs/production-quotidienne.md) — le déroulé suivi par Claude chaque jour
- [Architecture et choix d'outils](docs/architecture.md) — modules, coûts, limites
- [Conformité](docs/conformite.md) — loi influenceurs, licences, plateformes
- [Captures de Systeme.io](assets/systeme/LISEZMOI.md) et [musique sous licence](assets/music/LISEZMOI.md)

### Commandes

```bash
npm ci
```

```bash
npm run studio -- help
```

```bash
npm test
```

Les vidéos du 5 novembre présentes dans `videos/` sont les anciens essais (texte animé sur fond uni) ;
elles ne sont plus utilisées.
