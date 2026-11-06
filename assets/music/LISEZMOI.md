# Musique sous licence

Le studio n'utilise une musique que si sa licence est prouvée. Trois possibilités :

1. **Génération Eleven Music** (par défaut si la bibliothèque est vide) : morceau instrumental composé pour
   chaque vidéo, couvert par la licence commerciale de votre abonnement ElevenLabs payant
   (conditions : https://elevenlabs.io/music-terms).
2. **Vos pistes** achetées ou abonnées (Epidemic Sound, Artlist, Uppbeat…) avec une licence couvrant
   TikTok et Instagram :

```bash
npm run studio -- music:add ~/Musique/piste.mp3 --id piste-calme-01 --title "Titre" --source "Epidemic Sound" --license "Abonnement Personal (réseaux sociaux)" --proof "Facture 2026-11, certificat de licence" --moods minimal,warm --energy 2
```

3. **Aucune musique** : voix et habillage sonore seulement (`"mode": "none"` dans `config/studio.json`).

Ambiances reconnues (`--moods`) : cinematic, ambient, warm, minimal, corporate-light, uplifting, pop,
lofi, acoustic, electronic, upbeat, driving.
