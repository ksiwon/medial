"""Looks over the recordings tts_scenes.py made, without a model or a key.

    python scripts/tts_audit.py            # what is there, what is missing, what looks wrong

A recording is suspect when it is much shorter or longer than the text it speaks, or far from the speaker's usual pace.
This cannot hear whether a voice is the right voice or the line is acted well: it finds what is missing or odd, and the
researcher's ear does the rest.
"""
from __future__ import annotations

import json
import statistics
import sys
import wave
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.stdout.reconfigure(encoding="utf-8")

import tts_scenes as t  # noqa: E402

AUDIO = ROOT / "local-data" / "audio" / t.MODEL


def main() -> None:
    plan = list(t.planned())
    manifest_path = AUDIO / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    missing = [it for it in plan if not (AUDIO / it["file"]).exists()]
    unlisted = [it for it in plan if (AUDIO / it["file"]).exists() and "%s|%s" % (it["speaker"], it["text"]) not in manifest]
    print("planned %d · recorded %d · missing %d · not in the manifest %d" % (len(plan), len(plan) - len(missing), len(missing), len(unlisted)))
    for it in missing[:10]:
        print("  missing", it["file"], "-", it["text"][:30])

    pace: dict[str, list[float]] = defaultdict(list)
    seconds: dict[str, float] = {}
    for it in plan:
        path = AUDIO / it["file"]
        if not path.exists():
            continue
        with wave.open(str(path)) as w:
            secs = w.getnframes() / w.getframerate()
        seconds[it["file"]] = secs
        pace[it["speaker"]].append(secs / max(1, len(it["spoken"].replace(" ", ""))))

    odd = []
    for it in plan:
        if it["file"] not in seconds:
            continue
        mine = pace[it["speaker"]]
        mid = statistics.median(mine)
        p = seconds[it["file"]] / max(1, len(it["spoken"].replace(" ", "")))
        if len(mine) >= 4 and (p > mid * 1.8 or p < mid * 0.55):
            odd.append((it["file"], it["speaker"], seconds[it["file"]], p / mid, it["text"][:28]))
    print("\nclips far from their speaker's own pace: %d" % len(odd))
    for f, sp, secs, ratio, text in sorted(odd, key=lambda r: -abs(r[3] - 1))[:12]:
        print("  %-20s %-8s %.1fs  x%.2f of the speaker's usual pace | %s" % (f, sp, secs, ratio, text))

    print("\nper speaker: lines · total seconds · median seconds per character")
    for sp, rates in sorted(pace.items()):
        total = sum(seconds[it["file"]] for it in plan if it["speaker"] == sp and it["file"] in seconds)
        print("  %-8s %3d lines %6.1fs  %.3f s/char" % (sp, len(rates), total, statistics.median(rates)))
    print("\ntotal audio: %.0f s (%.1f min)" % (sum(seconds.values()), sum(seconds.values()) / 60))


if __name__ == "__main__":
    main()
