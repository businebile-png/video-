#!/usr/bin/env bash
# Installe la voix gratuite du studio : Kokoro-82M (Apache-2.0) pour parler, faster-whisper (MIT)
# pour caler les sous-titres et vérifier la prononciation. Aucun compte, aucune clé.
# Idempotent : ne refait que ce qui manque. Usage : bash scripts/setup-voice.sh
set -euo pipefail
cd "$(dirname "$0")/.."
# Les scripts d'installation des sessions tournent avec un PATH réduit : uv est souvent dans ~/.local/bin.
export PATH="$HOME/.local/bin:/root/.local/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  python3 -m pip install --quiet --user uv >/dev/null 2>&1 || python3 -m pip install --quiet --break-system-packages --user uv >/dev/null 2>&1 || true
fi
# Une voix qui ne s'installe pas ne doit pas empêcher la session de démarrer : elle sera réinstallée par la
# production (npm run studio -- doctor), qui verra l'erreur. GitHub Actions exige au contraire une réussite.
if [ "${STUDIO_STRICT_SETUP:-}" != "1" ] && [ -z "${STUDIO_SETUP_INNER:-}" ]; then
  if STUDIO_SETUP_INNER=1 bash "$0" "$@"; then exit 0; fi
  echo "ATTENTION : installation de la voix incomplète (relancer : bash scripts/setup-voice.sh)." >&2
  exit 0
fi
VENV=.venv-voice
PKGS=(kokoro-onnx==0.6.1 faster-whisper==1.2.1 soundfile==0.14.0 "numpy>=2,<3")
if ! "$VENV/bin/python" -I -c "import kokoro_onnx, faster_whisper, soundfile" >/dev/null 2>&1; then
  echo "Voix : installation de l'environnement Python…"
  if command -v uv >/dev/null 2>&1; then
    uv venv --quiet --allow-existing --python python3 "$VENV"
    uv pip install --quiet --python "$VENV/bin/python" "${PKGS[@]}"
  else
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install --quiet "${PKGS[@]}"
  fi
fi
# Voix « Claire » : Chatterbox Multilingual sur PyTorch processeur (Python 3.11, environnement séparé).
CB=.venv-chatterbox
if ! "$CB/bin/python" -I -c "import chatterbox.mtl_tts, faster_whisper, perth; assert perth.PerthImplicitWatermarker" >/dev/null 2>&1; then
  echo "Voix Claire : installation de l'environnement (PyTorch processeur, Chatterbox)…"
  if command -v uv >/dev/null 2>&1; then
    uv venv --quiet --allow-existing --python 3.11 "$CB"
    uv pip install --quiet --python "$CB/bin/python" --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match \
      "torch==2.6.0" "torchaudio==2.6.0" "chatterbox-tts==0.1.7" "setuptools<81" "faster-whisper==1.2.1"
  else
    python3.11 -m venv "$CB"
    "$CB/bin/pip" install --quiet --extra-index-url https://download.pytorch.org/whl/cpu \
      "torch==2.6.0" "torchaudio==2.6.0" "chatterbox-tts==0.1.7" "setuptools<81" "faster-whisper==1.2.1"
  fi
fi
echo "Voix : vérification des modèles…"
HF_HUB_DISABLE_XET=1 HF_HUB_DISABLE_TELEMETRY=1 "$VENV/bin/python" -I scripts/fetch_voice_models.py "$PWD/models"
echo "Voix gratuites prêtes (Claire et Siwis)."
