"""Transcribes one audio file with word-level timestamps (mlx-whisper, runs locally on Apple Silicon).

    python transcribe.py <audio file> <model repo> <language | auto>

Prints one JSON object on stdout: {"language": "fr", "segments": [{start, end, text, no_speech_prob, avg_logprob,
compression_ratio, words: [{start, end, word}]}]}. Called by the worker with an argument vector (no shell).
"""
import json
import sys


def main() -> None:
    path, model, language = sys.argv[1], sys.argv[2], sys.argv[3]
    import mlx_whisper  # imported late so a missing install gives a clear error line

    result = mlx_whisper.transcribe(
        path,
        path_or_hf_repo=model,
        word_timestamps=True,
        # Songs repeat themselves: feeding the previous window back makes the model loop on a chorus.
        condition_on_previous_text=False,
        language=None if language == "auto" else language,
        verbose=None,
    )
    out = {"language": result.get("language"), "segments": []}
    for s in result.get("segments", []):
        out["segments"].append({
            "start": float(s["start"]), "end": float(s["end"]), "text": s["text"],
            "no_speech_prob": float(s.get("no_speech_prob", 0)), "avg_logprob": float(s.get("avg_logprob", 0)),
            "compression_ratio": float(s.get("compression_ratio", 0)),
            "words": [{"start": float(w["start"]), "end": float(w["end"]), "word": w["word"]} for w in s.get("words", [])],
        })
    json.dump(out, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 — one line for the worker's log, no traceback with paths
        print(f"transcribe failed: {type(e).__name__}: {str(e)[:200]}", file=sys.stderr)
        sys.exit(1)
