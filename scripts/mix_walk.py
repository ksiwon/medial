"""화면 녹화 + 소리 기록을 하나의 영상으로 합친다 (scripts/record_walk.cjs 가 만든 폴더가 입력).

    python scripts/mix_walk.py <출력폴더>                  # 화면 영상이 없으면 만들고, 소리를 섞어 영상을 만든다
    python scripts/mix_walk.py <출력폴더> --video           # 화면 영상(모니터 + 태블릿 작은 창)도 다시 만든다
    python scripts/mix_walk.py <출력폴더> --audio-dir DIR    # 다른 음성 폴더로 섞는다(기본: 표준 모델 폴더)

소리는 `meta.json` 의 audioLog(누가 언제 어떤 파일을 틀고 멈췄는지)만 믿고, 소리 자체는 합칠 때 음성 폴더에서 읽는다.
그래서 임시 녹음을 표준 모델 녹음으로 바꾼 뒤에는 화면을 다시 녹화하지 않고 이 명령만 다시 돌리면 된다.
바뀐 소리가 기록된 구간보다 길면 그 구간에서 잘리고(다음 줄과 겹치지 않는다), 짧으면 뒤가 조용하다.
끝에 아직 임시 녹음(lite)이 들어 있는 줄을 알려 준다.

화면은 모니터 영상에 태블릿 작은 창을 얹고(오른쪽 아래), 소리는 모니터가 튼 것만 쓴다(대사·나레이션·배경음).
"""
from __future__ import annotations

import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding="utf-8")
VOICE_DIR = ROOT / "local-data" / "audio" / "gemini-3.8-flash-tts"
SR = 24000
PAD_WIDTH = 360          # 합친 영상(1920x1080) 위 태블릿 창의 너비: 작게, 오른쪽 아래 구석에 붙인다
MARGIN = 12
MARGIN_BOTTOM = 12      # 구석에 붙인다(모니터 아래 줄의 자동 넘김 안내 끝이 가려질 수 있다)
TAIL = 1.0               # 영상 끝 뒤에 남기는 조용한 시간(초)


def ffmpeg(*args: str) -> None:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args], check=True)


def make_screen(out: Path, meta: dict) -> Path:
    """모니터 영상(1920x1080) 위에 태블릿 작은 창을 얹은 영상, 소리 없음."""
    screen = out / "screen.mp4"
    pw, ph = meta["padSize"]["width"], meta["padSize"]["height"]
    pad_h = round(PAD_WIDTH * ph / pw)
    ffmpeg("-ss", str(meta["wallSkip"]), "-t", str(meta["length"]), "-i", meta["wallVideo"],
           "-ss", str(meta["padSkip"]), "-t", str(meta["length"]), "-i", meta["padVideo"],
           "-filter_complex",
           f"[1:v]scale={PAD_WIDTH}:{pad_h},format=yuv420p[p];[p]pad=iw+8:ih+8:4:4:color=0x2a2a28[pb];"
           f"[0:v][pb]overlay=W-w-{MARGIN}:H-h-{MARGIN_BOTTOM}[v]",
           "-map", "[v]", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-an", str(screen))
    return screen


def read_clip(src: str, audio_dir: Path, cache: dict) -> np.ndarray | None:
    """한 소리를 24kHz 모노 실수 배열로. 대사는 음성 폴더의 파일 이름으로, 배경음은 저장소의 파일로 찾는다."""
    if src in cache:
        return cache[src]
    name = Path(src.split("?")[0]).name
    from urllib.parse import unquote
    name = unquote(name)
    if "/village/voice/" in src:
        path = audio_dir / name
    else:
        found = sorted((ROOT / "src").rglob("bgm*.mp3"))
        path = found[0] if found else None
    data = None
    if path is not None and path.exists():
        proc = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                              capture_output=True, check=True)
        data = np.frombuffer(proc.stdout, dtype=np.float32).copy()
    cache[src] = data
    return data


def segments(log: list[dict], t0_ms: float, t1_ms: float):
    """소리 기록 -> (파일, 시작 초, 끝 초, 시작 위치 초, 반복, [(시각 초, 크기)...]).
    play 에서 시작해 pause 에서 끝난다. 끝이 없으면 영상 끝까지, 소리가 먼저 끝나면 거기까지(섞을 때 정한다)."""
    by_id: dict[int, list[dict]] = {}
    for e in log:
        by_id.setdefault(e["id"], []).append(e)
    out = []
    for events in by_id.values():
        events.sort(key=lambda e: e["t"])
        vols = [(e["t"], e["vol"]) for e in events if e["op"] == "volume"]
        open_ = None
        for e in events:
            if e["op"] == "play":
                if open_ is not None:
                    out.append({**open_, "end": e["t"]})
                open_ = {"src": e["src"], "start": e["t"], "at": e["at"], "loop": bool(e["loop"]), "vol0": e["vol"], "vols": vols}
            elif e["op"] == "pause" and open_ is not None:
                out.append({**open_, "end": e["t"]})
                open_ = None
        if open_ is not None:
            out.append({**open_, "end": t1_ms})
    for s in out:
        s["start_s"] = (s["start"] - t0_ms) / 1000
        s["end_s"] = (s["end"] - t0_ms) / 1000
    return out


def mix_audio(meta: dict, audio_dir: Path) -> tuple[np.ndarray, list[str]]:
    t0, t1 = meta["tStart"], meta["tEnd"]
    total = int((meta["length"] + TAIL) * SR)
    master = np.zeros(total, dtype=np.float32)
    cache: dict = {}
    missing: list[str] = []
    used_voice = 0
    for s in sorted(segments(meta["audioLog"], t0, t1), key=lambda s: s["start_s"]):
        clip = read_clip(s["src"], audio_dir, cache)
        if clip is None or len(clip) == 0:
            if "/village/voice/" in s["src"]:
                missing.append(Path(s["src"]).name)
            continue
        a = max(s["start_s"], 0.0)                        # 본편이 시작하기 전에 튼 소리(배경음)는 시작 지점부터
        b = min(s["end_s"], meta["length"] + TAIL)
        if b <= a:
            continue
        n = int((b - a) * SR)
        pos0 = int((s["at"] + (a - s["start_s"])) * SR)   # 클립 안의 시작 위치
        idx = pos0 + np.arange(n)
        if s["loop"]:
            samples = clip[idx % len(clip)]
        else:
            ok = idx < len(clip)
            samples = np.zeros(n, dtype=np.float32)
            samples[ok] = clip[idx[ok]]
        # 크기: play 때의 값에서 시작해 volume 기록이 있는 시각마다 바뀐다(계단).
        gain = np.full(n, s["vol0"], dtype=np.float32)
        for t, v in sorted(s["vols"]):
            ts = (t - t0) / 1000
            if ts <= s["start_s"] or ts >= s["end_s"]:
                continue
            if ts <= a:
                gain[:] = v
            else:
                gain[int((ts - a) * SR):] = v
        start = int(a * SR)
        master[start:start + n] += samples[: len(master) - start] * gain[: len(master) - start]
        if "/village/voice/" in s["src"]:
            used_voice += 1
    peak = float(np.abs(master).max()) if len(master) else 0.0
    if peak > 0.98:                                       # 겹쳐서 넘으면 통째로 낮춘다
        master *= 0.98 / peak
    print(f"소리: 대사·나레이션 {used_voice}개, 최대 크기 {peak:.2f}")
    return master, missing


def write_wav(path: Path, data: np.ndarray) -> None:
    pcm = (np.clip(data, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def temporary_lines(audio_dir: Path) -> list[str]:
    index = audio_dir / "scenes.json"
    if not index.exists():
        return []
    rows = [r for v in json.load(open(index, encoding="utf-8")).values() for r in v]
    return sorted(r["file"] for r in rows if str(r["hash"]).startswith("fallback:"))


def main() -> None:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", help="record_walk.cjs 가 만든 출력 폴더")
    ap.add_argument("--video", action="store_true", help="화면 영상도 다시 만든다")
    ap.add_argument("--audio-dir", default=str(VOICE_DIR), help="음성 폴더(기본: 표준 모델 폴더)")
    args = ap.parse_args()
    out, audio_dir = Path(args.out), Path(args.audio_dir)
    meta = json.load(open(out / "meta.json", encoding="utf-8"))
    screen = out / "screen.mp4"
    if args.video or not screen.exists():
        screen = make_screen(out, meta)
    master, missing = mix_audio(meta, audio_dir)
    wav = out / "audio.wav"
    write_wav(wav, master)
    final = out / f"Desimer_v5_{meta['walk']}.mp4"
    ffmpeg("-i", str(screen), "-i", str(wav), "-map", "0:v", "-map", "1:a", "-c:v", "copy",
           "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest", str(final))
    print("영상:", final)
    if missing:
        print("소리 파일을 못 찾은 줄:", ", ".join(sorted(set(missing))))
    temp = temporary_lines(audio_dir)
    if temp:
        print(f"아직 임시 녹음(lite)인 줄 {len(temp)}개: {', '.join(temp)}")
        print(f"  -> 표준 모델로 다시 뽑은 뒤  python scripts/mix_walk.py {out}  만 다시 돌리면 소리만 바뀝니다.")


if __name__ == "__main__":
    main()
