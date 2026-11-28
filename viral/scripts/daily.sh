#!/usr/bin/env bash
# Tâche quotidienne de la Viral Content Machine, lancée chaque matin par une session Claude planifiée.
# Tout se fait ici, pour que la session n'ait qu'une commande à lancer (moins de jetons) :
# installation, voix, vidéo du jour, contrôle, programmation chez Zernio, statistiques, sauvegarde de l'état.
# Dernière ligne : RESULTAT=OK (la session peut s'archiver) ou RESULTAT=ECHEC (elle reste ouverte pour l'utilisateur).
set -uo pipefail
cd "$(dirname "$0")/.."
export ZERNIO_API_KEY="${ZERNIO_API_KEY:-proxy-injected}"
OUT="${TMPDIR:-/tmp}/viral-daily"
mkdir -p "$OUT"
say() { echo "$*"; }
ok=1
npm ci --no-audit --no-fund --silent > "$OUT/npm.log" 2>&1 || { say "Échec : installation des dépendances (npm ci)."; echo "RESULTAT=ECHEC"; exit 1; }
bash scripts/setup-voice.sh > "$OUT/voix.log" 2>&1 || say "Voix : installation incomplète (la voix Siwis prend le relais)."
mkdir -p var && cp state/seed.db var/viral.db
npm run -s viral -- facts:verify > "$OUT/faits.json" 2>&1 || say "Faits : relecture de systeme.io impossible aujourd'hui (les faits déjà vérifiés restent valables 7 jours)."
npm run -s viral -- publish:sync-remote > "$OUT/sync.json" 2>&1 || { say "Échec : Zernio injoignable."; ok=0; }
npm run -s viral -- publish:guard-facts > "$OUT/garde.json" 2>&1 && grep -q '"video"' "$OUT/garde.json" && say "Faits changés sur systeme.io : vidéo(s) retirée(s) avant publication."
if [ "$ok" = 1 ]; then
  npm run -s viral -- factory:daily --per-account 1 > "$OUT/jour.json" 2> "$OUT/jour.log" || { say "Échec : production du jour (voir $OUT/jour.log)."; ok=0; }
fi
npm run -s viral -- analytics:sync > "$OUT/stats.json" 2>&1 || true
npm run -s viral -- learn > /dev/null 2>&1 || true
npm run -s viral -- state:export > /dev/null 2>&1
git add state/seed.db data/facts > /dev/null 2>&1
if ! git diff --cached --quiet; then
  git commit -q -m "Viral : tâche quotidienne du $(date +%d/%m/%Y)" && git push -q origin HEAD:ccr-a92e76b7-88k8fk || say "État du jour non sauvegardé sur GitHub (sans gravité : Zernio garde le calendrier)."
fi
if [ -s "$OUT/jour.json" ]; then
  node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const fmt = (iso) => new Date(iso).toLocaleString("fr-FR", {timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short"});
    const made = r.comptes.filter((c) => c.lot).map((c) => `${c.compte} : ${c.faites} faite(s), ${c.echouees} échec(s)`).join(" ; ") || "aucun compte en publication automatique";
    const slots = r.creneaux.map((c) => `${fmt(c.creneau)} (${c.statut}${c.zernio ? ", Zernio " + c.zernio : ""}${c.erreur ? ", " + c.erreur : ""})`).join(" ; ") || "aucun nouveau créneau";
    console.log(`Vidéos du jour : ${made}.`);
    console.log(`Programmées : ${slots}.`);
    const skipped = r.comptes.filter((c) => c.ignore).map((c) => `${c.compte} (${c.ignore})`).join(" ; ");
    console.log(`Zernio : ${r.publication.confiees} confiée(s), ${r.publication.echecs} échec(s)${skipped ? ". Ignorés : " + skipped : ""}.`);
    if (r.comptes.some((c) => c.echouees > 0) || r.publication.echecs > 0) process.exit(3);
  ' "$OUT/jour.json" || ok=0
fi
[ "$ok" = 1 ] && echo "RESULTAT=OK" || echo "RESULTAT=ECHEC"
