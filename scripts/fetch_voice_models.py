"""Download the free voice models at pinned revisions and check their SHA-256 (see setup-voice.sh)."""
import hashlib
import os
import sys

from huggingface_hub import hf_hub_download

KOKORO = ("onnx-community/Kokoro-82M-v1.0-ONNX", "1939ad2a8e416c0acfeecc08a694d14ef25f2231")
WHISPER = ("Systran/faster-whisper-small", "536b0662742c02347bc0e980a01041f333bce120")
FILES = [
    # Full precision on purpose: the fp16 export returns NaN (silence) for some sentences.
    (KOKORO, "kokoro", "onnx/model.onnx", "8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb"),
    (KOKORO, "kokoro", "voices/ff_siwis.bin", "a35f5675ad08948e326ae75fd0ea16ba5d0042e4f76b5f3d1df77d0a48c54861"),
    (WHISPER, "whisper/small", "model.bin", "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671"),
    (WHISPER, "whisper/small", "config.json", "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828"),
    (WHISPER, "whisper/small", "tokenizer.json", "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab"),
    (WHISPER, "whisper/small", "vocabulary.txt", "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913"),
]
VOICES = ["ff_siwis"]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main(root):
    for (repo, revision), sub, name, digest in FILES:
        dest = os.path.join(root, sub, name)
        if os.path.exists(dest) and sha256(dest) == digest:
            continue
        print(f"  téléchargement {repo}/{name}", flush=True)
        path = hf_hub_download(repo, name, revision=revision, local_dir=os.path.join(root, sub))
        if sha256(path) != digest:
            os.remove(path)
            raise SystemExit(f"Empreinte inattendue pour {name} : fichier supprimé, rien n'est utilisé.")
    npz = os.path.join(root, "kokoro", "voices.npz")
    if not os.path.exists(npz):
        import numpy as np

        styles = {v: np.fromfile(os.path.join(root, "kokoro", "voices", f"{v}.bin"), dtype=np.float32).reshape(-1, 1, 256) for v in VOICES}
        np.savez(npz, **styles)


if __name__ == "__main__":
    main(sys.argv[1])
