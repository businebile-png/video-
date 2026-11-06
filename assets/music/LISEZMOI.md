# Musique sous licence

Le studio n'utilise une musique que si sa licence est prouvée. Trois possibilités :

1. **Pistes gratuites** libres de droits pour un usage commercial, par exemple Pixabay Music
   (https://pixabay.com/fr/music/ — licence Pixabay) : téléchargez-les puis enregistrez-les avec la preuve
   (lien de la page, date). Évitez les pistes signalées comme protégées par Content ID.
2. **Vos pistes** sous licence (achat ou abonnement) couvrant TikTok et Instagram :

```bash
npm run studio -- music:add ~/Musique/piste.mp3 --id piste-calme-01 --title "Titre" --source "Epidemic Sound" --license "Abonnement Personal (réseaux sociaux)" --proof "Facture 2026-11, certificat de licence" --moods minimal,warm --energy 2
```

3. **Aucune musique** (par défaut si la bibliothèque est vide) : voix et habillage sonore seulement.

Ambiances reconnues (`--moods`) : cinematic, ambient, warm, minimal, corporate-light, uplifting, pop,
lofi, acoustic, electronic, upbeat, driving.
