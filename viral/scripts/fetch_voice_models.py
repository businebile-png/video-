"""Download the free voice models at pinned revisions and check their SHA-256 (see setup-voice.sh)."""
import hashlib
import os
import sys

from huggingface_hub import hf_hub_download

KOKORO = ("onnx-community/Kokoro-82M-v1.0-ONNX", "1939ad2a8e416c0acfeecc08a694d14ef25f2231")
CHATTERBOX = ("ResembleAI/chatterbox", "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18")
SIWIS = ("Aviv-anthonnyolime/SIWIS_French_Speech_Synthesis_Database", "ef0d470f0f157682bd5d6da8ac829b67d01c52ae")
WHISPER = ("Systran/faster-whisper-small", "536b0662742c02347bc0e980a01041f333bce120")
FILES = [
    # Full precision on purpose: the fp16 export returns NaN (silence) for some sentences.
    (KOKORO, "kokoro", "onnx/model.onnx", "8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb"),
    (KOKORO, "kokoro", "voices/ff_siwis.bin", "a35f5675ad08948e326ae75fd0ea16ba5d0042e4f76b5f3d1df77d0a48c54861"),
    # Viral machine: other languages and accents (US / UK English, Spanish, Italian, Brazilian Portuguese), women and men.
    (KOKORO, "kokoro", "voices/af_heart.bin", "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b"),
    (KOKORO, "kokoro", "voices/am_michael.bin", "1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1"),
    (KOKORO, "kokoro", "voices/bf_emma.bin", "669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73"),
    (KOKORO, "kokoro", "voices/bm_george.bin", "c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc"),
    (KOKORO, "kokoro", "voices/ef_dora.bin", "f66ec66bd295acb18372e37008533a9a3228483ccd294e7538d5d9294ac9a532"),
    (KOKORO, "kokoro", "voices/em_alex.bin", "27809e9eafdcbcfff90a3016c697568676531de2a2c39cee29c96c7bd6b83e95"),
    (KOKORO, "kokoro", "voices/if_sara.bin", "409b69248798fcdc2542330c76953d230710f19b057e59cb82fdc3c4cf71265c"),
    (KOKORO, "kokoro", "voices/im_nicola.bin", "bc578e510d52a96d6940d46f12e96d7b3df00905dbea075113226d100e6e1ab0"),
    (KOKORO, "kokoro", "voices/pf_dora.bin", "3da7b5b2d91847ebf5646f57631af6ececae3c29a89cd300f06edf9aa6cfe9ee"),
    (KOKORO, "kokoro", "voices/pm_alex.bin", "0175c753f59c54e7fd5a995bedef0c5ff2fb67e0043dd3dcb2ae74ec2acbeb2a"),
    (WHISPER, "whisper/small", "model.bin", "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671"),
    (WHISPER, "whisper/small", "config.json", "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828"),
    (WHISPER, "whisper/small", "tokenizer.json", "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab"),
    (WHISPER, "whisper/small", "vocabulary.txt", "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913"),
]
# Voice « Claire » (Chatterbox Multilingual, MIT) and its reference recordings (SIWIS, CC BY 4.0).
CHATTERBOX_FILES = [
    ("ve.pt", "4b16d836bc598509860f6fa068165a8bb5e9ac84f05582dfcf278a5a372879f1"),
    ("t3_mtl23ls_v2.safetensors", "b1237586127ce98e7800a68e49938eb5092846862aabcb6e17b2fda7889a6c75"),
    ("s3gen.pt", "9b9ff07e60b20c136e2b1b3d7563a24604e8d2c4c267888d1ee929dd0151d2a3"),
    ("grapheme_mtl_merged_expanded_v1.json", "69632f47220a788a52ce2661d096453c5655e9bf25289d89a8d832c46ee07dbf"),
    ("conds.pt", "6552d70568833628ba019c6b03459e77fe71ca197d5c560cef9411bee9d87f4e"),
    ("Cangjie5_TC.json", "7073fd9de919443ae88e0bd2449917a65fe54898a4413ed1edcc4b67f28bce8c"),
]
SIWIS_FILES = [
    ("wavs/part1/neut_parl_s01_0112.wav", "c3a0afb50b2e343875fd166bd656b2d5df86b1efd2cbabdc3af90da3fde23191"),
    ("wavs/part1/neut_parl_s01_0258.wav", "413062c125b7cb516f86e4675bde1b3de7a668fc6d1060deb10ad08264300c9e"),
    ("wavs/part1/neut_parl_s01_0106.wav", "8c499d93f358e58dbba54db384fb886439103f331e15616f9dc5493ab4c568df"),
]
VOICES = ["ff_siwis", "af_heart", "am_michael", "bf_emma", "bm_george", "ef_dora", "em_alex", "if_sara", "im_nicola", "pf_dora", "pm_alex"]


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch(repo, revision, name, digest, local_dir, repo_type=None):
    dest = os.path.join(local_dir, name)
    if os.path.exists(dest) and sha256(dest) == digest:
        return dest
    print(f"  téléchargement {repo}/{name}", flush=True)
    path = hf_hub_download(repo, name, revision=revision, local_dir=local_dir, repo_type=repo_type)
    if sha256(path) != digest:
        os.remove(path)
        raise SystemExit(f"Empreinte inattendue pour {name} : fichier supprimé, rien n'est utilisé.")
    return path


def claire(root):
    """Chatterbox model files and the 8-second reference built from three SIWIS recordings."""
    for name, digest in CHATTERBOX_FILES:
        fetch(*CHATTERBOX, name, digest, os.path.join(root, "chatterbox"))
    refs = os.path.join(root, "voice-refs")
    srcs = [fetch(*SIWIS, name, digest, os.path.join(refs, "siwis-src"), repo_type="dataset") for name, digest in SIWIS_FILES]
    out = os.path.join(refs, "claire.wav")
    if not os.path.exists(out):
        import subprocess

        graph = "[0]apad=pad_dur=0.25[a];[1]apad=pad_dur=0.25[b];[a][b][2]concat=n=3:v=0:a=1,aresample=24000"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", srcs[0], "-i", srcs[1], "-i", srcs[2], "-filter_complex", graph, "-ac", "1", out], check=True)
    # Viral machine: « Hugo », a deeper timbre derived from the same recordings (pitch and formants lowered),
    # used as Chatterbox's reference for a male voice that imitates no real person.
    hugo = os.path.join(refs, "hugo.wav")
    if not os.path.exists(hugo):
        import subprocess
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", out, "-af", "rubberband=pitch=0.76:formant=shifted:pitchq=quality,highpass=f=60,aresample=24000", "-ac", "1", hugo], check=True)


def main(root, with_claire=True):
    if with_claire:
        claire(root)
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
    import numpy as np
    stale = os.path.exists(npz) and set(np.load(npz).files) != set(VOICES)
    if not os.path.exists(npz) or stale:

        styles = {v: np.fromfile(os.path.join(root, "kokoro", "voices", f"{v}.bin"), dtype=np.float32).reshape(-1, 1, 256) for v in VOICES}
        np.savez(npz, **styles)


if __name__ == "__main__":
    main(sys.argv[1], with_claire="--sans-claire" not in sys.argv)
