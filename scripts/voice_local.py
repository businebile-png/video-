"""Free local voice for the studio: no account, no key, nothing to pay.

tts    Kokoro-82M (Apache-2.0) through kokoro-onnx; French voice ff_siwis.
stt    faster-whisper (MIT) with word timings: caption timing and pronunciation check.
voices List the voices in the voices file.

Usage: python -I scripts/voice_local.py tts|stt|voices <job.json>
Prints one JSON object on the last line of stdout.
"""
import json
import re
import subprocess
import sys

# espeak marks English words with "(en)...(fr)": spoken as letters they become noise
# ("tes e-mails" heard as "fleuette"). Drop the flags, keep the English phonemes.
LANG_FLAG = re.compile(r"\([a-z]{2,3}(?:-[a-z0-9]+)?\)")
# The model swallows a word-final "gn" ("en ligne" heard as "en lit"): release it with a light schwa.
FINAL_GN = re.compile(r"ɲ(?=$|[\s,.;:!?…»\"')])")
# The brand, spoken fast, melts into "iro": lengthen the two letters ("Système I… O…"), heard right at every speed.
BRAND = re.compile(r"(sist[ˈˌ]?ɛm)\s+[ˈˌ]?i\s+[ˈˌ]?o(?=$|[\s,.;:!?…»\"')])")


# Phrases Whisper is known to invent over silence or music in French: never part of a script
# (scripts use « tu »), so they are dropped instead of counting as pronunciation errors.
HALLUCINATION = re.compile(r"sous-titr|amara\.org|merci d'avoir regard|abonnez-vous|n'oubliez pas de vous abonner", re.I)


def fix_phonemes(phonemes):
    return BRAND.sub(r"\1 ˈiː ˈoː", FINAL_GN.sub("ɲə", LANG_FLAG.sub("", phonemes)))


def tts(job):
    import numpy as np
    import soundfile as sf
    from kokoro_onnx import Kokoro

    kokoro = Kokoro(job["model"], job["voices"])
    lang = job.get("lang", "fr-fr")
    sample_rate = 24000
    gap = np.zeros(int(sample_rate * job.get("sceneBreakMs", 300) / 1000), dtype=np.float32)
    chunks, switched, phonemes_out = [], [], []
    for i, part in enumerate(job["parts"]):
        raw = kokoro.tokenizer.phonemize(part, lang)
        if LANG_FLAG.search(raw):
            switched.append(part)
        phonemes = fix_phonemes(raw)
        phonemes_out.append(phonemes)
        speed = float(job.get("speed", 1.0))
        audio, sample_rate = kokoro.create(phonemes, voice=job.get("voice", "ff_siwis"), speed=speed, lang=lang, is_phonemes=True)
        # A numeric failure comes out as NaN, which the silence trimming turns into nothing:
        # never let a sentence vanish silently.
        expected = len(kokoro.tokenizer.tokenize(phonemes, limit=None)) * 0.055 / speed
        if not np.isfinite(audio).all() or len(audio) / sample_rate < 0.35 * expected:
            raise SystemExit(f"Synthèse incomplète pour : {part!r} ({len(audio) / sample_rate:.2f} s au lieu d'environ {expected:.1f} s)")
        chunks.append(audio.astype(np.float32))
        if i < len(job["parts"]) - 1:
            chunks.append(gap)
    audio = np.concatenate(chunks) if chunks else np.zeros(1, dtype=np.float32)
    peak = float(np.max(np.abs(audio))) or 1.0
    sf.write(job["out"], (audio / peak * 0.89).astype(np.float32), sample_rate, subtype="PCM_16")
    return {
        "out": job["out"],
        "sampleRate": sample_rate,
        "seconds": round(len(audio) / sample_rate, 3),
        "languageSwitches": switched,
        "phonemes": phonemes_out,
    }


def load_16k(path):
    """Decode any audio file to 16 kHz mono float32 with ffmpeg (avoids PyAV version issues)."""
    import numpy as np

    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
        check=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def stt(job):
    from faster_whisper import WhisperModel

    model = WhisperModel(job["model"], device="cpu", compute_type="int8")
    segments, _info = model.transcribe(
        load_16k(job["audio"]),
        language=job.get("language", "fr"),
        word_timestamps=True,
        beam_size=5,
        condition_on_previous_text=False,
        vad_filter=False,
        hallucination_silence_threshold=1.5,
    )
    words, texts = [], []
    for seg in segments:
        if HALLUCINATION.search(seg.text):
            continue
        texts.append(seg.text.strip())
        for w in seg.words or []:
            words.append({"text": w.word.strip(), "start": round(float(w.start), 3), "end": round(float(w.end), 3)})
    return {"text": " ".join(texts).strip(), "words": words}


def voices(job):
    import numpy as np

    with np.load(job["voices"]) as data:
        return {"voices": sorted(data.files)}


if __name__ == "__main__":
    command, job_file = sys.argv[1], sys.argv[2]
    with open(job_file, encoding="utf-8") as f:
        job = json.load(f)
    handler = {"tts": tts, "stt": stt, "voices": voices}[command]
    result = handler(job)
    sys.stdout.write("\n" + json.dumps(result, ensure_ascii=False) + "\n")
