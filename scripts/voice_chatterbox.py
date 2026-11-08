"""Voix « Claire » : Chatterbox Multilingual (Resemble AI, licence MIT), français, sur le processeur.

Le timbre vient d'un court enregistrement de référence (base SIWIS, CC BY 4.0, comédienne professionnelle
enregistrée pour la synthèse vocale). Chaque phrase est générée séparément puis réécoutée par faster-whisper :
une prise qui ne colle pas au texte (mot avalé, phrase répétée, improvisation en fin de phrase) est refaite.
Les fichiers produits portent le tatouage inaudible Perth de Resemble AI (contenu généré par IA).

Usage : python -I scripts/voice_chatterbox.py tts <job.json>   (une ligne JSON en fin de sortie standard)
"""
import json
import re
import sys
import time
import unicodedata

SENTENCE_END = re.compile(r"(?<=[.?!…])\s+")
MIN_WORDS = 5  # the model garbles very short sentences: they are merged with the next one
# Ways the transcriber writes the brand: never counted as errors here (the full check runs afterwards).
BRAND_WORDS = {"systeme", "system", "systemio", "systemi", "systemie", "systamio", "io", "i", "o", "ou", "au", "iot", "aie", "neo"}


UNITS = ["zero", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize"]
TENS = {20: "vingt", 30: "trente", 40: "quarante", 50: "cinquante", 60: "soixante"}


def below_100(n):
    if n <= 16:
        return UNITS[n]
    if n < 20:
        return "dix " + UNITS[n - 10]
    if n < 70:
        t, u = n // 10 * 10, n % 10
        return TENS[t] + ("" if u == 0 else " et un" if u == 1 else " " + UNITS[u])
    if n < 80:
        return "soixante " + ("et onze" if n == 71 else below_100(n - 60))
    return "quatre vingt" + ("s" if n == 80 else " " + below_100(n - 80))


def below_1000(n):
    h, r = divmod(n, 100)
    head = "" if h == 0 else "cent" if h == 1 else UNITS[h] + " cent" + ("s" if r == 0 else "")
    tail = below_100(r) if r or not head else ""
    return f"{head} {tail}".strip()


def french_number(n):
    """How a number is said in French (the text sent to the voice spells numbers out, the transcriber writes digits)."""
    if n == 0:
        return "zero"
    th, r = divmod(n, 1000)
    head = "" if th == 0 else "mille" if th == 1 else below_1000(th) + " mille"
    return f"{head} {below_1000(r) if r else ''}".strip()


def words(text):
    text = unicodedata.normalize("NFD", text.lower())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    # « 2 000 » / « 2000 » heard for « deux mille »: digits become the words that were said.
    text = re.sub(r"(?<=\d)[\s\u202f\u00a0.,](?=\d{3}\b)", "", text)
    text = re.sub(r"\d{1,6}", lambda m: " " + french_number(int(m.group())) + " ", text)
    return [w for w in re.sub(r"[^a-z0-9]+", " ", text).split() if w not in BRAND_WORDS]


def sound(word):
    """Rough French sound of a word: silent endings, doubled letters and nasal spellings do not count
    (« sans » / « cent », « illimités » / « illimitées », « tunnel » / « tunel », « mails » / « mail »)."""
    w = word
    if len(w) > 2:
        w = re.sub(r"[sxtdzp]+$", "", w)
    if len(w) > 3:
        w = re.sub(r"e+$", "", w)
    w = re.sub(r"c(?=[eiy])", "s", w)
    w = re.sub(r"(.)\1+", r"\1", w)
    return re.sub(r"[ae][nm](?![aeiouynm])", "an", w)


def distance(ref, hyp):
    ref, hyp = [sound(w) for w in ref], [sound(w) for w in hyp]
    row = list(range(len(hyp) + 1))
    for i in range(1, len(ref) + 1):
        prev, row[0] = row[0], i
        for j in range(1, len(hyp) + 1):
            cur = min(row[j] + 1, row[j - 1] + 1, prev + (ref[i - 1] != hyp[j - 1]))
            prev, row[j] = row[j], cur
    return row[len(hyp)]


def take_error(sentence, heard):
    """Share of words missing or wrong, plus a penalty when the take runs on past the text."""
    ref, hyp = words(sentence), words(heard)
    error = distance(ref, hyp) / max(1, len(ref))
    if len(hyp) > len(ref) + 1:
        error += 0.5
    return error


def split_sentences(part):
    """Sentences of a scene, short ones merged with their neighbour (never split on « : »)."""
    out = []
    for sentence in [s.strip() for s in SENTENCE_END.split(part.strip()) if s.strip()]:
        if out and len(out[-1].split()) < MIN_WORDS:
            out[-1] = f"{out[-1]} {sentence}"
        else:
            out.append(sentence)
    if len(out) > 1 and len(out[-1].split()) < MIN_WORDS:
        last = out.pop()
        out[-1] = f"{out[-1]} {last}"
    return out


def tts(job):
    import numpy as np
    import torch
    import torchaudio
    import librosa
    import soundfile as sf
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    from faster_whisper import WhisperModel

    torch.set_num_threads(int(job.get("threads", 4)))
    model = ChatterboxMultilingualTTS.from_local(job["modelDir"], "cpu")
    asr = WhisperModel(job["whisperModel"], device="cpu", compute_type="int8")
    sr = model.sr
    max_takes = int(job.get("maxTakes", 4))
    accept = float(job.get("accept", 0.12))
    seed_base = int(job.get("seed", 1))
    sentence_gap = np.zeros(int(sr * job.get("sentenceBreakMs", 160) / 1000), dtype=np.float32)
    scene_gap = np.zeros(int(sr * job.get("sceneBreakMs", 300) / 1000), dtype=np.float32)
    chunks, report = [], []
    t0 = time.time()
    for p, part in enumerate(job["parts"]):
        sentences = split_sentences(part)
        for s, sentence in enumerate(sentences):
            best = None
            for attempt in range(max_takes):
                torch.manual_seed(seed_base * 10007 + p * 101 + s * 13 + attempt)
                wav = model.generate(
                    sentence,
                    language_id="fr",
                    audio_prompt_path=job["reference"],
                    exaggeration=float(job.get("exaggeration", 0.5)),
                    cfg_weight=float(job.get("cfg", 0.5)),
                    temperature=float(job.get("temperature", 0.7)),
                )
                audio = wav[0].numpy().astype(np.float32)
                if not np.isfinite(audio).all() or len(audio) < sr * 0.2:
                    continue
                audio, _ = librosa.effects.trim(audio, top_db=38)
                a16 = torchaudio.functional.resample(torch.from_numpy(audio).unsqueeze(0), sr, 16000)[0].numpy()
                segments = list(asr.transcribe(a16, language="fr", beam_size=5, condition_on_previous_text=False, word_timestamps=True)[0])
                heard = " ".join(seg.text.strip() for seg in segments)
                spoken = [w for seg in segments for w in (seg.words or [])]
                if spoken:
                    # Keep only the speech: the model leaves breaths and noise around a sentence.
                    # Generous tail: Whisper often ends a word before its final consonant (« compte » heard « con »).
                    start = max(0, int((spoken[0].start - 0.08) * sr))
                    end = min(len(audio), int((spoken[-1].end + 0.28) * sr))
                    if end - start > sr * 0.3:
                        audio = audio[start:end]
                error = take_error(sentence, heard)
                if best is None or error < best[0]:
                    best = (error, audio, heard, attempt + 1)
                if error <= accept:
                    break
            if best is None:
                raise SystemExit(f"Synthèse impossible pour : {sentence!r}")
            report.append({"scene": p, "sentence": sentence, "takes": best[3], "error": round(best[0], 3), "heard": best[2]})
            chunks.append(best[1])
            chunks.append(sentence_gap if s < len(sentences) - 1 else np.zeros(0, dtype=np.float32))
        if p < len(job["parts"]) - 1:
            chunks.append(scene_gap)
    audio = np.concatenate([c for c in chunks if len(c)]) if chunks else np.zeros(1, dtype=np.float32)
    peak = float(np.max(np.abs(audio))) or 1.0
    sf.write(job["out"], (audio / peak * 0.89).astype(np.float32), sr, subtype="PCM_16")
    # This voice speaks slowly for an ad: bring it to the target pace with a pitch-preserving stretch.
    n_words = sum(len(words(p)) + p.lower().count("systeme") for p in job["parts"])
    pace = n_words / max(1e-3, len(audio) / sr) * 60
    factor = min(float(job.get("maxSpeedup", 1.25)), max(1.0, float(job.get("targetWpm", 160)) / max(1.0, pace)))
    if factor > 1.01:
        import subprocess

        tmp = job["out"] + ".tmp.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", job["out"], "-af", f"atempo={factor:.3f}", tmp], check=True)
        import os

        os.replace(tmp, job["out"])
        audio = audio[: int(len(audio) / factor)]
    return {
        "out": job["out"],
        "sampleRate": sr,
        "seconds": round(len(audio) / sr, 3),
        "elapsedSec": round(time.time() - t0, 1),
        "worstError": max((r["error"] for r in report), default=0),
        "paceBefore": round(pace),
        "speedup": round(factor, 3),
        "sentences": report,
    }


if __name__ == "__main__":
    command, job_file = sys.argv[1], sys.argv[2]
    with open(job_file, encoding="utf-8") as f:
        job = json.load(f)
    if command != "tts":
        raise SystemExit(f"commande inconnue : {command}")
    result = tts(job)
    sys.stdout.write("\n" + json.dumps(result, ensure_ascii=False) + "\n")
