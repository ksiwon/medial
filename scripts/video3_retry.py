"""Makes a line's take again with other seeds until what is heard matches what was written; keeps the closest.

    python scripts/video3_retry.py <scene> <line index> [<scene> <line index> ...]      env SEEDS=21,31 (default), TAG=.v2

Each seed is one paid generation (about 1 USD at 480p). The takes are kept as <line>.<tag>-s<seed>.mp4; the closest to the
written line replaces <line>.<tag>.mp4 (the earlier one stays as <line>.<tag>-prev.mp4).
"""
import base64
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import tts_scenes as T  # noqa: E402
import video3 as V  # noqa: E402

TAG = os.environ.get("TAG", ".v2")
SEEDS = os.environ.get("SEEDS", "21,31").split(",")
CLIPS = V.OUT
SCENES = json.load(open(T.ROOT / "local-data/audio/gemini-3.8-flash-tts/scenes.json", encoding="utf-8"))
sys.stdout.reconfigure(encoding="utf-8")


def hear(mp4):
    mp3 = mp4.with_suffix(".stt.mp3")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(mp4), "-vn", "-b:a", "96k", str(mp3)], check=True)
    body = {"contents": [{"parts": [{"text": "이 오디오에서 들리는 한국어 말을 그대로 받아 적어라. 사투리 억양은 표준 철자로 적고, 받아쓴 글만 출력하라."},
                                    {"inline_data": {"mime_type": "audio/mp3", "data": base64.b64encode(mp3.read_bytes()).decode()}}]}]}
    mp3.unlink()
    req = urllib.request.Request("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": T.api_key()})
    return json.load(urllib.request.urlopen(req, timeout=120))["candidates"][0]["content"]["parts"][0]["text"].strip()


def norm(t):
    return re.sub(r"[^\w]", "", t.replace("에이아이", "AI").replace("MEDial", "AI"))


def score(want, got):
    return difflib.SequenceMatcher(None, norm(V.spoken(want)).replace("메디얼이라는AI", "메디얼이라는AI"), norm(got)).ratio()


def make(job):
    scene, idx, seed = job
    env = dict(os.environ, TAG="%s-s%s" % (TAG, seed), SEED=seed, ONLY="%02d" % idx)
    r = subprocess.run([sys.executable, str(Path(__file__).parent / "video3.py"), "scene", scene], env=env, capture_output=True, text=True, encoding="utf-8")
    if r.returncode:  # a refused or failed request: this seed is skipped (a rejected one costs nothing)
        print("  seed", seed, scene, idx, "failed:", (r.stderr or r.stdout).strip().splitlines()[-1][:200], flush=True)


args = sys.argv[1:]
wanted = [(args[i], int(args[i + 1])) for i in range(0, len(args), 2)]
jobs = [(sc, idx, seed) for sc, idx in wanted for seed in SEEDS]
with ThreadPoolExecutor(4) as ex:
    list(ex.map(make, jobs))
for sc, idx in wanted:
    row = next(r for r in SCENES[sc] if r["index"] == idx)
    base = CLIPS / row["file"].replace(".wav", TAG + ".mp4")
    cands = [base] + [CLIPS / row["file"].replace(".wav", "%s-s%s.mp4" % (TAG, seed)) for seed in SEEDS]
    scored = []
    for c in cands:
        if c.exists():
            got = hear(c)
            scored.append((score(row["text"], got), c, got))
            print("  %.2f %s  %s" % (scored[-1][0], c.name, got))
    best = max(scored, key=lambda s: s[0])
    if best[1] != base:
        shutil.copy(base, base.with_name(base.name.replace(".mp4", "-prev.mp4")))
        shutil.copy(best[1], base)
    print(sc, idx, "->", best[1].name, "%.2f" % best[0], "|", row["text"])
