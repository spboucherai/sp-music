# =============================================================================
#                  SP BOUCHER | SOFTWARE & RESEARCH
#             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
# =============================================================================
#
# PROJECT METADATA
# -----------------------------------------------------------------------------
# Project          : Music SP
# File             : scripts/transcribe.py
# Description      : Transcribes one audio file with word-level timestamps
#                    (mlx-whisper, runs locally on Apple Silicon).
# Module           : scripts
# Repository       : https://git.spboucher.ai/sp-music
# Project Website  : https://music.spboucher.ai
# Created          : 2026-11-17
# Last Modified    : 2026-11-17
#
# =============================================================================
# AUTHOR & PROFESSIONAL AFFILIATION
# =============================================================================
#
# Author           : Simon-Pierre Boucher
# Position         : Professor of Finance
# Institution      : Université du Québec en Outaouais (UQO)
# Department       : Département des sciences administratives
# Organization     : SP Boucher
#
# Website          : https://spboucher.ai
# Git              : https://git.spboucher.ai
#
# =============================================================================
# OFFICIAL CONTACT DIRECTORY
# =============================================================================
#
# General          : info@spboucher.ai
# Professional     : contact@spboucher.ai
# Direct           : simon@spboucher.ai
# Research         : research@spboucher.ai
# Development      : dev@spboucher.ai
# Support          : support@spboucher.ai
# Security/Admin   : admin@spboucher.ai
# Notifications    : notifications@spboucher.ai
#
# Preferred Contact: support@spboucher.ai
#
# =============================================================================
# COPYRIGHT & INTELLECTUAL PROPERTY
# =============================================================================
#
# Copyright (c) 2026
# Simon-Pierre Boucher
#
# All rights reserved where applicable.
#
# This file is governed by the applicable project license,
# copyright notices, institutional agreements and relevant law.
#
# Unless expressly authorized by the applicable license or
# rights holder, copying, redistribution, sublicensing,
# publication and commercial exploitation are not permitted.
#
# Existing third-party rights and notices remain unaffected.
#
# =============================================================================
# CONFIDENTIALITY & SECURITY
# =============================================================================
#
# Classification   : Public
# Distribution     : Public repository; use is governed by the project license
# Security Contact : admin@spboucher.ai
#
# Access to this source does not independently grant permission
# to redistribute or disclose confidential materials.
#
# Do not embed credentials, private keys, access tokens,
# certificates or confidential personal information.
#
# =============================================================================
# LICENSE & MAINTENANCE
# =============================================================================
#
# License          : None specified (no license file in this repository)
# Maintainer       : Simon-Pierre Boucher
# Technical Contact: dev@spboucher.ai
#
# =============================================================================
# END OF SP BOUCHER SOURCE HEADER
# =============================================================================

"""Transcribes one audio file with word-level timestamps (mlx-whisper, runs locally on Apple Silicon).

    python transcribe.py <audio file> <model repo> <language | auto>

Prints one JSON object on stdout: {"language": "fr", "segments": [{start, end, text, no_speech_prob, avg_logprob,
compression_ratio, words: [{start, end, word}]}]}. Called by the worker with an argument vector (no shell).
"""
import json
import math
import sys


def num(value, fallback: float) -> float:
    """Whisper yields NaN for a segment with no tokens (silence, pure instrumental); NaN is not valid JSON."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return fallback
    return f if math.isfinite(f) else fallback


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
            "no_speech_prob": num(s.get("no_speech_prob"), 0.0), "avg_logprob": num(s.get("avg_logprob"), -5.0),
            "compression_ratio": num(s.get("compression_ratio"), 0.0),
            "words": [{"start": float(w["start"]), "end": float(w["end"]), "word": w["word"]} for w in s.get("words", [])],
        })
    json.dump(out, sys.stdout, ensure_ascii=False, allow_nan=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 — one line for the worker's log, no traceback with paths
        print(f"transcribe failed: {type(e).__name__}: {str(e)[:200]}", file=sys.stderr)
        sys.exit(1)
