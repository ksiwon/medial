# 캡처한 화면(png)을 가로 A4 2x2 로 모은 영어 유인물 HTML 을 만든다.
#   python make_handout.py <캡처폴더> screens_in_english.html
import base64, html, io, sys
from PIL import Image

FR = sys.argv[1]
OUT = sys.argv[2]


def img(n):
    im = Image.open(f'{FR}/{n}.png').convert('RGB')
    if im.width > 1800:
        im = im.resize((1800, round(im.height * 1800 / im.width)), Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=90, optimize=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()


# (frame, title, short note for text that lives inside the picture)
CARDS = [
    ('00_cover', 'Cover', ''),
    ('05_intro_01', 'Intro · The job of a service designer', 'Notes: Meet / Use / Finish'),
    ('05_intro_05', 'Intro · The worry', 'Notes: One person’s reaction / Far · Busy / Service draft'),
    ('05_intro_07', 'Intro · Desimer', ''),
    ('05_intro_09', 'Intro · The case', 'Sign: This case · Rural-village medical AI Care Orchestrator'),
    ('01_draft', 'Draft: first rules', ''),
    ('02_week', 'This week', ''),
    ('10_E1v1_scene', 'Event 1 · Scene (ver1)', ''),
    ('10_E1v1_feedback', 'Event 1 · Resident feedback (ver1)', ''),
    ('10_E1v1_requests', 'Event 1 · Revision requests', ''),
    ('10_E1v1_week', 'This week · Event 1 is now ver2', ''),
    ('11_E1v2_feedback', 'Event 1 · Feedback changes (ver2)', ''),
    ('11_E1v2_rules', 'Event 1 · Current rules (ver2)', ''),
    ('20_E3v1_scene', 'Event 3 · Scene (ver1)', ''),
    ('20_E3v1_feedback', 'Event 3 · Resident feedback (ver1)', ''),
    ('20_E3v1_requests', 'Event 3 · Revision requests', ''),
    ('21_E3v2_scene', 'Event 3 · Scene (ver2)', ''),
    ('21_E3v2_feedback', 'Event 3 · Feedback changes (ver2)', ''),
    ('30_closing_scene', 'Wrap-up', ''),
    ('31_closing_6', 'Closing words', ''),
]
assert len(CARDS) % 4 == 0

# A4 landscape 297 x 210 mm, 2 x 2, no header or footer.
CSS = """
@page{size:A4 landscape;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{background:#e8eef8;color:#0f1b33;font-family:"Pretendard Variable",Pretendard,-apple-system,"Segoe UI",system-ui,"Malgun Gothic",sans-serif;-webkit-font-smoothing:antialiased}
.page{width:297mm;height:210mm;margin:16px auto;padding:5mm 9mm;background:#fff;display:grid;grid-template-columns:136mm 136mm;grid-template-rows:1fr 1fr;gap:0 6mm;justify-content:center;overflow:hidden;break-after:page;page-break-after:always}
.page:last-child{break-after:auto;page-break-after:auto}
.card{display:flex;flex-direction:column;min-height:0}
.card img{display:block;width:100%;aspect-ratio:1440/1000;object-fit:cover;border:.25mm solid #d7e3f5}
.cap{display:flex;align-items:center;gap:1.6mm;height:5.2mm;white-space:nowrap;overflow:hidden}
.n{flex:none;min-width:4mm;height:4mm;line-height:4mm;text-align:center;border-radius:50%;background:#2563eb;color:#fff;font-size:6.5pt;font-weight:800}
.t{font-size:8pt;font-weight:800}
.s{font-size:6.5pt;color:#5b6b86}
@media print{body{background:#fff}.page{margin:0}}
"""


def card(i, c):
    n, t, s = c
    note = f'<span class="s">{html.escape(s)}</span>' if s else ''
    return (f'<div class="card"><img src="{img(n)}" alt=""><div class="cap"><span class="n">{i}</span>'
            f'<span class="t">{html.escape(t)}</span>{note}</div></div>')


pages = []
npg = len(CARDS) // 4
for p in range(npg):
    cs = ''.join(card(p * 4 + k + 1, CARDS[p * 4 + k]) for k in range(4))
    pages.append(f'<div class="page">{cs}</div>')

doc = ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
       f'<title>Desimer Screens in English</title><style>{CSS}</style></head><body>{"".join(pages)}</body></html>')
open(OUT, 'w', encoding='utf-8').write(doc)
print('cards', len(CARDS), 'pages', npg, 'bytes', len(doc))
