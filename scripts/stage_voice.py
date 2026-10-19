"""녹화용 음성 폴더를 만든다: 임시 녹음(lite)인 줄에만 소리 길이를 넉넉히(+2.5초) 적어 둔다.

    python scripts/stage_voice.py [폴더=.run/voice_stage]
    MEDIAL_VOICE_DIR=<폴더> bash run-exhibition.sh      # 이 폴더로 서버를 띄운 뒤 record_walk.cjs 를 돌린다

모니터는 한 줄을 (소리 길이 + 0.8초) 동안 보여 준다. 임시 녹음을 나중에 표준 모델 녹음으로 바꾸면 소리가 조금 길어질 수 있어
(lite와 표준은 한 줄에 최대 1.3초쯤 달랐다), 녹화 때는 그 줄을 길게 보여 줘서 바뀐 소리가 다음 줄에 잘리지 않게 한다.
이 폴더는 걷는 속도를 정하는 데만 쓴다. 합칠 때(mix_walk.py)는 진짜 음성 폴더의 소리를 읽는다.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.stdout.reconfigure(encoding="utf-8")
SOURCE = ROOT / "local-data" / "audio" / "gemini-3.8-flash-tts"
RESERVE = 2.5  # 초


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / ".run" / "voice_stage"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    for wav in SOURCE.glob("*.wav"):
        shutil.copy2(wav, out / wav.name)
    rows = [r for v in json.load(open(SOURCE / "scenes.json", encoding="utf-8")).values() for r in v]
    temporary = {r["file"] for r in rows if str(r["hash"]).startswith("fallback:")}
    manifest = json.load(open(SOURCE / "manifest.json", encoding="utf-8"))
    for row in manifest.values():
        if row["file"] in temporary:
            row["seconds"] = round(row["seconds"] + RESERVE, 2)
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{out}: 소리 {len(list(out.glob('*.wav')))}개, 임시 녹음 {len(temporary)}줄에 +{RESERVE}초")


if __name__ == "__main__":
    main()
