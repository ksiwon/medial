# Resident Agents as Evaluators

**Improving MEDial with a Simulated Rural Village.** 이 저장소의 연구 주제는 MEDial 자체가
아니라, 인터뷰 기반 주민 에이전트가 자신이 경험한 서비스를 근거와 함께 평가하고 그 평가가
AI Care Orchestrator 수정에 어떻게 쓰일 수 있는지 탐색하는 것입니다.

은점마을 12인의 하루를 원자료에서 가져와 재구성하고, "응답이 없는 안부 확인을 누구의 시간으로
해결할 것인가" 같은 사례에서 **경험 사건 → 점수 없는 주민 평가 → 운영 규칙 하나의 수정 →
연구자 확인 → 재실행 → 평가 차이 → 실제 주민에게 물을 것**을 봅니다.

화면은 하나의 길입니다: **소개 영상 → 1일차(관찰) → 주민 평가 → 수정안 고르기 → 다음 날**. 하루가 끝나면
주민 평가로 안내하고, 바꿀 수 있는 것은 지원되는 운영 규칙의 **값**뿐이며, 화면의 문장과 실행되는
값은 같은 규칙에서 만들어집니다. 화면은 저장된 기록을 **읽기만** 합니다 — 화면에서 새 실행을 만드는 길은
없습니다(2026-10-10에 옛 준비 · 비교 · 현장 기록지 화면과 함께 지웠습니다).

- **두 버전이 있습니다.** `sim`은 미리 돌려 둔 기록을 재생하고 모델을 부르지 않습니다 — 지금은
  전시 기록(은점마을 사흘 · 27경로)이고, real에서 얼린 기록으로 바꿀 수 있습니다.
  `real`은 서버가 실시간으로 만든 기록을 읽는 버전입니다(서버에는 생성 API가 남아 있지만 화면에는 그것을
  시작하는 곳이 없습니다).
- 키는 real 서버 프로세스만 `server/.env` 에서 읽습니다. sim은 키를 읽지 않습니다. 키가 없으면
  온라인 어댑터를 고를 수 없고, 호출 실패를 규칙 결과로 대체하지 않습니다.
- 민감한 원자료는 저장소에도, 프론트 번들에도 들어가지 않습니다.
- 합성 데이터로도 그대로 실행되며, 화면 상단 배지가 합성인지 원자료인지 항상 표시합니다.

먼저 읽을 것: **[DEVELOPMENT.md](DEVELOPMENT.md)** (현재 상태 · 실행 방법 · 최근 기록),
그다음 [docs/research/](docs/research/).

---

## 실행

처음 한 번:

```bash
python -m pip install -r server/requirements-sim.txt
npm install
```

그다음부터는 둘 중 하나를 띄웁니다. 서버와 화면을 함께 띄우고 브라우저를 엽니다.

**Windows:** 탐색기에서 `run-sim.cmd` 또는 `run-real.cmd` 를 더블클릭합니다. 창이 하나 열려 로그를
보여 주고 브라우저가 열립니다. 끝낼 때는 그 창에서 **Ctrl+C**. 창을 그냥 닫았다면 서버가 남아 있을
수 있는데, 다음 실행이 그것을 그대로 쓰고 `run-sim.cmd --stop` 으로 내릴 수 있습니다.
Git for Windows(Git Bash)가 있어야 합니다 — `.cmd` 가 그 bash로 `scripts/launch.sh` 를 부릅니다.
macOS·Linux·Git Bash에서는 `./run-sim.sh` · `./run-real.sh` 입니다.

| | sim — 미리 돌려 둔 기록 | real — 실시간 생성 |
|---|---|---|
| 띄우기 | `./run-sim.sh` · `run-sim.cmd` | `./run-real.sh` · `run-real.cmd` |
| 하는 일 | 미리 돌려 둔 기록을 그대로 재생 (지금은 전시 기록: 첫 설정 → 하루 → 주민 평가 → 수정안 → 다음 날, 사흘) | 서버가 만든 기록을 같은 화면으로 읽음 |
| 모델·키 | 부르지 않음 · 읽지 않음 | `server/.env` 의 `OPENAI_API_KEY` 로 서버가 부름 (비용이 듭니다) |
| 새 실행·수정안 확정·현장 기록 | 하지 않음 (서버가 403으로 거부) | 서버 API로만 가능 (화면에는 없음) |
| 기록 | `local-data/runs/sim.sqlite3` (전시 기록, 또는 real의 얼린 사본) | `local-data/runs/real.sqlite3` |
| 주소 | 서버 8020 · <http://localhost:5180> | 서버 8010 · <http://localhost:5173> |

포트와 기록이 달라서 둘을 동시에 띄워 둘 수 있습니다. 표의 포트는 첫 후보입니다 — 거기에 같은
버전의 MEDial 이 떠 있으면 그대로 쓰고, 다른 프로그램이나 다른 버전이 쓰고 있으면 다음 빈 포트
(5181, 5182 …)로 옮겨 띄우고 창에 그 주소를 알립니다. `--stop` 은 지난 실행이 쓴 포트에서 MEDial 만
내리고, `--no-open` 이면 브라우저를
열지 않습니다. Ctrl+C 는 그 스크립트가 띄운 것만 정리합니다. 하는 일은 전부
`scripts/launch.sh` 에 있습니다.

**sim이 재생하는 기록은 둘 중 하나입니다.** 지금은 전시 기록입니다 — 전시 생성기가 사흘 동안
날마다 셋 중 하나를 고르는 27경로를 전부 미리 돌려 둔 것(대화·주민 평가·수정안 포함)이고, 앱의 엔진이
만든 것이 아니라는 것을 기록과 화면이 함께 말합니다. 그 기록은 `local-data/runs/sim.sqlite3` 하나이며(git 밖),
가져오는 스크립트는 없습니다(2026-10-10 삭제). 이 파일을 잃으면 다시 만들 수 없으니 따로 복사해 둡니다.

real에서 돌린 실험을 대신 재생하려면 얼립니다 (전시 기록을 덮어씁니다):

```bash
python scripts/freeze_sim.py             # real.sqlite3 → sim.sqlite3
python scripts/freeze_sim.py --replace   # 이미 있는 sim 기록을 덮어쓸 때
```

아직 돌고 있는 세션이 있으면 얼리지 않습니다. 얼린 뒤 real에서 더 돌린 것은 다시 얼리기
전까지 sim에 나타나지 않습니다.

직접 띄우려면 `python server/sim_main.py --mode sim|real` 과 `npm run dev` 를 각각 실행합니다.
버전을 정하지 않으면 서버가 뜨지 않습니다. 프론트의 `/api/sim` 요청은 `MEDIAL_SIM_URL`
(기본 `127.0.0.1:8010`)로 프록시됩니다. Windows의 `bash.exe`가 Linux Python을 먼저 찾더라도
의존성이 설치된 Windows Python을 자동으로 사용합니다. 특정 Python을 고정하려면
`MEDIAL_PYTHON=/path/to/python ./run-real.sh` 로 지정합니다.

### 모델 키

real 버전에만 필요합니다. 키는 **`server/.env` 에 두며 real 서버 프로세스만 읽습니다**
(실행 스크립트는 키가 적혀 있는지만 보고 값은 읽지 않습니다). 양식은 `server/.env.example`.

공급자는 OpenAI 하나입니다 (`OPENAI_API_KEY`). 판단이 결과인 자리는 `gpt-6.1-sol`, 가벼운 모델로
충분한 자리는 `gpt-6-luna` — 리뷰·개선과 MEDial 머리·기관은 `gpt-6.1-sol`, 주민은 `gpt-6-luna`.
고르는 기준은 [DEVELOPMENT.md](DEVELOPMENT.md) 의 "모델 키는 `server/.env` 에 있습니다".

real의 준비 화면은 키가 있으면 네 층(마을·기관·리뷰·개선)을 모두 모델로 두고 호출 상한 300회로
시작합니다. 층마다 규칙으로 되돌릴 수 있습니다. 키가 없으면 온라인 어댑터를 고를 수 없고
(session 생성 400), 호출이 실패해도 규칙 결과로 대체하지 않습니다.

### 원자료 없이 실행

원자료가 없으면 자동으로 `fixtures/synthetic/` 의 합성 마을·합성 페르소나로 돕니다. 지형·이름·
나이·관계가 전부 지어낸 값이고, 화면과 API가 `synthetic` 이라고 표시합니다.

### 원자료로 실행

`docs/research/source-manifest.json` 이 가리키는 로컬 경로에 원자료가 있을 때만 동작합니다.
원자료 자체는 저장소 밖에 있고 커밋되지 않습니다.

```bash
cd scripts && python -m import_village
```

`local-data/normalized/` (git-ignored) 에 레지스트리와 지도 래스터를 만듭니다. 페르소나는
서버가 실행 시점에 직접 컴파일하며, 이름·인터뷰 인용·역할 프롬프트는 컴파일 결과에 담기지
않습니다.

## 검증

```bash
npm run build && npm test && python -m pytest server/tests/simulation -q
```

실제 브라우저까지 보려면:

```bash
npm run e2e
```

현재 기준선 (2026-10-10에 이 저장소에서 실행): build 통과 · vitest 91 · pytest 446 · Playwright 2건.
테스트 수보다 실패 여부와 연구 경계 검사를 우선하며, 전부 합성 픽스처와 별도 DB(`.run/e2e/`)로
실행됩니다 — 연구 DB는 건드리지 않습니다. e2e는 키를 비운 서버의 API로 기록 하나를 만든 뒤 화면이 소개부터
수정안 고르기까지 걷는지 봅니다.

## 저장소 구조

| 경로 | 내용 |
|---|---|
| `server/app/simulation/` | 사건 엔진 · 관측 경계 · 정책 · 기관 · 동승 · 페르소나 컴파일러 · 사례 자료(CaseBundle) · SQLite |
| `server/tests/simulation/` | 회귀 테스트 (전부 합성 픽스처 사용) |
| `src/features/simulation/` | 세 화면 · 지도 · 장면 재생(`scene/`) · 주민 평가 · 규칙 편집기 · 비교 · 현장 기록 · sim의 기록 목록 |
| `run-sim.*` · `run-real.*` · `scripts/launch.sh` | 두 버전의 실행 파일과 그 공통 스크립트 |
| `scripts/freeze_sim.py` | real의 기록을 sim이 재생할 사본으로 얼린다 |
| `scripts/gen_dialogue.py` · `tts_voices.py` · `tts_scenes.py` | 전시 대화록(장면 설명 → 줄) · 주민별 목소리 · 줄별 음성 만들기. 확정 대본은 `fixtures/exhibition/` |
| `scripts/art.mjs` | 관찰 화면의 장면 그림(배경·인물 레이어)을 그린다 → `local-data/art/` |
| `scripts/import_village/` | 원자료 → 정규화 레지스트리 (출처 검증 포함) |
| `docs/research/` | 지금 기준인 연구 문서 · 데이터 계약 · 설계 결정 기록 |
| `docs/research/history/` | 지나온 기획·명세·프롬프트 (역사. 지금 구조를 정당화하지 않습니다) |
| `docs/presentations/` | 발표자료 · 연구노트 — `2026-09/`(9월 발표·연구노트) · `2026-10-07-exhibition/`(전시 발표·영상). 캡처와 PDF는 커밋하지 않습니다 |
| `local-data/` | 원자료에서 파생된 레지스트리(`normalized/`), 두 버전의 실행 기록(`runs/`), 장면 그림(`art/`), 음성(`audio/`), 3안 영상(`video/`), 목소리 설정(`tts/`). **커밋하지 않습니다.** 어디에 무엇이 있는지는 `docs/README.md` |


## 전시장 브라우저 (소리)

장면의 대사는 미리 만들어 둔 음성(`local-data/audio/`, git 밖)을 화면이 틀어 준다. 브라우저는 사용자가 한 번 만지기 전에는 소리를 막으니, 전시장 PC의 브라우저는
자동 재생을 허용해 띄운다. Chrome: `chrome --kiosk --autoplay-policy=no-user-gesture-required http://localhost:5180/`. 소리가 막혀도 장면은 소리 없이 계속 간다.
음성 파일이 없으면(합성 마을 · 파일 없음) 대사는 읽는 시간만큼 조용히 흐른다.

**영상 모드(3안)** — 주소 뒤에 `?video=1` 을 붙이면(`http://localhost:5180/?video=1`) 영상이 있는 대사 줄은 생성 영상으로 나온다
(`local-data/video/clips/`, git 밖 · `python scripts/video3_manifest.py` 가 `manifest.json` 을 만든다). 영상이 없는 줄은 사진 그대로이고,
`?video=1` 이 없으면 사진 모드로 영상 파일이 있어도 쓰지 않는다. 영상 소리도 위와 같이 자동 재생을 허용해야 난다.
