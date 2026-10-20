"""Builds the screen review page: every screen of the exhibition on one scrolling HTML, from screenshots.

    node scripts/capture_week.cjs http://localhost:5180 .run/week E1 x close      # 모니터 + 태블릿 단계별 캡처
    (소개 · 마무리 컷은 .run/intro_shots_full/intro_NN.png · .run/all/outro_NN.png)
    python scripts/build_screens_html.py [--week .run/week] [--intro .run/intro_shots_full] [--outro .run/all]

The page and its pictures are written to docs/presentations/2026-10-07-exhibition/out/screens/ (outside git: the
pictures are large); index.html refers to them by relative paths, so the folder can be moved or zipped whole.
Open index.html in a browser. Nothing here calls a model or a server.
"""
from __future__ import annotations

import argparse
import html
import shutil
from datetime import date
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "presentations" / "2026-10-07-exhibition" / "out" / "screens"

INTRO = [
    "1 · 서비스 디자이너라는 직업 — 책상 위 여정 지도", "2 · 고민 — 작은 공동체 모형, 한 분의 반응", "3 · Desimer — 인터뷰가 에이전트가 된다",
    "4 · 사례: 시골의 낮", "5 · 사례: 의료는 멀다", "6 · 사례: 살펴 줄 사람이 없다", "7 · 이 사례의 어려움 (지도)",
    "8 · 은점마을의 열두 채 집", "9 · 관객이 서비스 디자이너가 된다",
]
WEEK = [
    ("01", "대기 화면", "idle"), ("02", "소개 영상 (태블릿은 건너뛰기만)", "intro"), ("03", "한 주 — 보고 싶은 사건을 고른다", "week"),
    ("04", "사건 장면 (한 줄씩)", "scene"), ("06", "사건 장면 끝 — 주민 평가로", "scene-end"), ("07", "주민 평가", "evaluations"),
    ("08", "수정 요청 고르기", "choose"), ("08b", "요청을 눌러 보는 중 · 반영할지 묻는 창", "ask"), ("08c", "새로운 시뮬레이션을 만드는 중", "generating"),
    ("11", "다시 한 주 — 그 사건에 v2 칩", "week-again"), ("12", "ver2 장면", "v2-scene"), ("13", "ver2 주민 평가", "v2-evaluations"),
    ("13b", "ver3 요청 고르기", "v3-choose"), ("13c", "한 주 — v3 칩", "week-v3"), ("13d", "ver3 장면", "v3-scene"),
    ("13e", "ver3 주민 평가", "v3-evaluations"), ("14", "본 버전 5개 — 마무리가 열린다", "week-five"),
    ("15", "마무리 — 사건 · 버전 · 수정", "closing"), ("16", "마무리 해설", "closing-words"),
]


def small(src: Path, dst: Path, width: int = 1600) -> str:
    """A webp copy no wider than `width`; the page links it, and the original png is not kept."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src).convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.save(dst, "WEBP", quality=88)
    return dst.relative_to(OUT).as_posix()


def card(title: str, body: str) -> str:
    return f'<figure><figcaption>{html.escape(title)}</figcaption>{body}</figure>'


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", default=str(ROOT / ".run" / "week"))
    ap.add_argument("--intro", default=str(ROOT / ".run" / "intro_shots_full"))
    ap.add_argument("--outro", default=str(ROOT / ".run" / "all"))
    a = ap.parse_args()
    week, intro, outro = Path(a.week), Path(a.intro), Path(a.outro)
    if OUT.exists():
        shutil.rmtree(OUT)
    sections: list[tuple] = []

    rows = []
    for i, title in enumerate(INTRO, start=1):
        f = intro / f"intro_{i:02d}.png"
        if f.exists():
            rows.append(card(title, f'<img loading="lazy" src="{small(f, OUT / "intro" / f"{i:02d}.webp")}" alt="{html.escape(title)}">'))
    sections.append(("소개 영상", "모니터. 소리와 함께 흐르는 장면마다 한 컷.", "grid", rows))

    rows = []
    for key, title, name in WEEK:
        wall = next(iter(sorted(week.glob(f"{key}-wall-*.png"))), week / "none.png")
        pad = next(iter(sorted(week.glob(f"{key}-pad-*.png"))), week / "none.png")
        body = ""
        if wall.exists():
            body += f'<img class="wall" loading="lazy" src="{small(wall, OUT / "wall" / f"{key}.webp")}" alt="모니터 · {html.escape(title)}">'
        if pad.exists():
            body += f'<img class="pad" loading="lazy" src="{small(pad, OUT / "pad" / f"{key}.webp", 1180)}" alt="태블릿 · {html.escape(title)}">'
        if body:
            rows.append(card(f"{key} · {title}", f'<div class="pair">{body}</div>'))
    sections.append(("한 주의 걸음 — 모니터(왼쪽)와 태블릿(오른쪽)", "사건 E1을 ver3까지 읽고, 다른 사건을 고쳐 본 버전 5개를 채워 마무리까지.", "stack", rows))

    rows = []
    for i in range(1, 8):
        f = outro / f"outro_{i:02d}.png"
        if f.exists():
            rows.append(card(f"마무리 {i}", f'<img loading="lazy" src="{small(f, OUT / "outro" / f"{i:02d}.webp")}" alt="마무리 {i}">'))
    sections.append(("마무리 해설", "마무리 요약 다음, 해설 다섯 줄이 하나씩 쌓인다.", "grid", rows))

    parts = []
    for title, note, kind, cards in sections:
        parts.append(f'<section><h2>{html.escape(title)}</h2><p class="note">{html.escape(note)}</p><div class="{kind}">{"".join(cards)}</div></section>')
    page = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Desimer · 화면 점검</title>
<style>
:root {{ --bg:#15150f; --ink:#f6f1e8; --mute:rgba(246,241,232,.66); --line:rgba(246,241,232,.14); --accent:#e2542c; }}
* {{ box-sizing: border-box; }}
body {{ margin:0; background:var(--bg); color:var(--ink); font-family: Pretendard, 'Noto Sans KR', system-ui, sans-serif; }}
header, section {{ max-width: 1500px; margin: 0 auto; padding: 32px 24px; }}
h1 {{ margin:0 0 8px; font-size: 30px; letter-spacing:-.02em; }} h1 b {{ color: var(--accent); }}
h2 {{ margin: 24px 0 4px; font-size: 22px; padding-top: 24px; border-top: 1px solid var(--line); }}
.note, header p {{ margin: 0 0 20px; color: var(--mute); }}
.grid {{ display:grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 20px; }}
.stack {{ display:grid; gap: 28px; }}
figure {{ margin:0; }} figcaption {{ margin: 0 0 8px; font-size: 14px; font-weight: 700; color: var(--mute); }}
img {{ display:block; width:100%; height:auto; border-radius: 10px; border: 1px solid var(--line); background:#000; }}
.pair {{ display:grid; grid-template-columns: 1fr 340px; gap: 16px; align-items:start; }}
@media (max-width: 900px) {{ .pair {{ grid-template-columns: 1fr; }} }}
</style></head><body>
<header><h1><b>Desimer</b> · 화면 점검</h1>
<p>소규모 그룹을 위한 서비스 디자인 시뮬레이션 도구 — 5안 · {date.today().isoformat()} 캡처. 모니터 2560×1440, 태블릿 1180×820. 그림과 대화는 모두 시뮬레이션입니다.</p></header>
{''.join(parts)}
</body></html>"""
    (OUT / "index.html").write_text(page, encoding="utf-8")
    n = sum(1 for _ in OUT.rglob("*.webp"))
    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file()) / 1e6
    print(f"{OUT / 'index.html'} : {n} pictures, {size:.1f}MB")


if __name__ == "__main__":
    main()
