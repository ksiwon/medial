# Resident Agents as Evaluators

**Improving MEDial with a Simulated Rural Village.** 이 저장소의 연구 주제는 MEDial 자체가
아니라, 인터뷰 기반 주민 에이전트가 자신이 경험한 서비스를 근거와 함께 평가하고 그 평가가
AI Care Orchestrator 수정에 어떻게 쓰일 수 있는지 탐색하는 것입니다.

은점마을 12인의 하루를 원자료에서 가져와 재구성하고, "응답이 없는 안부 확인을 누구의 시간으로
해결할 것인가" 같은 사례에서 **경험 사건 → 점수 없는 주민 평가 → 운영 규칙 하나의 수정 →
연구자 확인 → 재실행 → 평가 차이 → 실제 주민에게 물을 것**을 봅니다.

기본 화면은 셋입니다: **사례와 서비스 경험 / 주민 평가 / 개선과 확인**. 하루가 끝나면 주민
평가로 안내하고, 바꿀 수 있는 것은 지원되는 운영 규칙의 **값**뿐이며, 화면의 문장과 실행되는
값은 같은 규칙에서 만들어집니다.

- **두 버전이 있습니다.** `sim`은 real에서 미리 돌려 둔 기록을 재생하고 모델을 부르지 않습니다.
  `real`은 실행할 때마다 새로 계산하고, 모델 어댑터로 마을·기관·리뷰·개선을 실시간으로 생성합니다.
  화면 상단 배지가 지금 어느 버전인지 항상 말합니다.
- 키는 real 서버 프로세스만 `server/.env` 에서 읽습니다. sim은 키를 읽지 않습니다. 키가 없으면
  온라인 어댑터를 고를 수 없고, 호출 실패를 규칙 결과로 대체하지 않습니다.
- 민감한 원자료는 저장소에도, 프론트 번들에도 들어가지 않습니다.
- 합성 데이터로도 그대로 실행되며, 화면 상단 배지가 합성인지 원자료인지 항상 표시합니다.

먼저 읽을 것: **[DEVELOPMENT.md](DEVELOPMENT.md)** (구현 범위 · 검증 결과 · 미구현 항목),
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
| 하는 일 | real에서 돌려 둔 실험을 그대로 재생 | 새 사례를 돌리고, 모델이 그 자리에서 생성 |
| 모델·키 | 부르지 않음 · 읽지 않음 | `server/.env` 의 `OPENAI_API_KEY` 로 부름 (비용이 듭니다) |
| 새 실행·수정안 확정·현장 기록 | 하지 않음 (서버가 403으로 거부) | 함 |
| 기록 | `local-data/runs/sim.sqlite3` (real의 얼린 사본) | `local-data/runs/real.sqlite3` |
| 주소 | 서버 8020 · <http://localhost:5180> | 서버 8010 · <http://localhost:5173> |

포트와 기록이 달라서 둘을 동시에 띄워 둘 수 있습니다. 이미 떠 있는 쪽은 그대로 쓰고
(다른 버전의 서버에는 붙지 않습니다), `--stop` 으로 내리고, `--no-open` 이면 브라우저를
열지 않습니다. Ctrl+C 는 그 스크립트가 띄운 것만 정리합니다. 하는 일은 전부
`scripts/launch.sh` 에 있습니다.

**sim이 재생하는 것은 real에서 얼린 것입니다.** real에서 실험을 돌린 뒤:

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

공급자는 OpenAI 하나입니다 (`OPENAI_API_KEY`). 판단이 결과인 자리는 `gpt-6-sol`, 가벼운 모델로
충분한 자리는 `gpt-6-luna` — 리뷰·개선과 MEDial 머리·기관은 `gpt-6-sol`, 주민은 `gpt-6-luna`.
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

현재 기준선 (2026-09-29에 이 저장소에서 실행): build 통과 · vitest 64 · pytest 444 ·
Playwright 6건 · 발표용 캡처 5건. 테스트 수보다 실패 여부와 연구 경계 검사를 우선하며, 전부 합성 픽스처와
별도 DB(`.run/e2e/`)로 실행됩니다 — 연구 DB는 건드리지 않습니다. e2e 서버는 키를 비운
real 버전이라 모델을 부르지 않습니다.

## 저장소 구조

| 경로 | 내용 |
|---|---|
| `server/app/simulation/` | 사건 엔진 · 관측 경계 · 정책 · 기관 · 동승 · 페르소나 컴파일러 · 사례 자료(CaseBundle) · SQLite |
| `server/tests/simulation/` | 회귀 테스트 (전부 합성 픽스처 사용) |
| `src/features/simulation/` | 세 화면 · 지도 · 장면 재생(`scene/`) · 주민 평가 · 규칙 편집기 · 비교 · 현장 기록 · sim의 기록 목록 |
| `run-sim.*` · `run-real.*` · `scripts/launch.sh` | 두 버전의 실행 파일과 그 공통 스크립트 |
| `scripts/freeze_sim.py` | real의 기록을 sim이 재생할 사본으로 얼린다 |
| `scripts/art.mjs` | 관찰 화면의 장면 그림(배경·인물 레이어)을 그린다 → `local-data/art/` |
| `scripts/import_village/` | 원자료 → 정규화 레지스트리 (출처 검증 포함) |
| `docs/research/` | 지금 기준인 연구 문서 · 데이터 계약 · 설계 결정 기록 |
| `docs/research/history/` | 지나온 기획·명세·프롬프트 (역사. 지금 구조를 정당화하지 않습니다) |
| `docs/presentations/` | 발표자료 · 연구노트 (캡처와 PDF는 커밋하지 않습니다) |
| `local-data/` | 원자료에서 파생된 레지스트리, 두 버전의 실행 기록(`runs/`), 장면 그림(`art/`). **커밋하지 않습니다** |
| `local-archive/` | 실행 DB 백업. **커밋하지 않습니다** |
