# Dially — Resident Agents as Evaluators

**마을 주민 시뮬레이터.** 이 저장소의 연구 주제는 서비스(AI 조율자) 자체가 아니라, 인터뷰 기반 주민 에이전트가
자신이 경험한 서비스를 근거와 함께 평가하고 그 평가가 서비스 수정에 어떻게 쓰일 수 있는지 탐색하는 것입니다.
서비스에는 이름을 붙이지 않습니다 — 'AI 스피커', 'AI 조율자', 'AI'로 부릅니다.

한 주(월~일) 동안 은점마을에서 있었던 **사건 8개**를 서비스 디자이너가 골라 봅니다. 사건은 요일마다 하나씩
일어나지 않습니다 — 하루에 둘이 겹치기도 하고 아무 일 없는 날도 있습니다. 한 사건을 열면:

> **사건 장면 → 그 일을 겪은 주민의 평가(어느 대사를 근거로 삼았는지까지) → 평가에서 나온 수정 요청 →
> 고른 요청대로 다시 펼쳐지는 장면 → 그 장면을 겪은 주민의 평가**

모든 요청에는 바라는 것과 함께 **따를 부담**이 있고, 주민의 말에 근거가 약한 요청은 "근거가 약한 요청"으로
표시됩니다. 사람의 안전이 걸린 **응급 사건은 선택지가 없습니다** — 고르는 것이 아니라 일어난 일을 읽습니다.
합성 주민의 평가는 실제 주민의 의견·만족도·동의가 아닙니다. 모든 평가에 그렇게 적혀 있고, 실제 주민이 나중에
확인·반박·정정할 대상입니다.

- 화면은 미리 만들어 둔 기록을 **읽기만** 합니다. 서버에는 모델도 엔진도 실행 경로도 없습니다.
- 대화록과 평가는 오프라인 도구가 쓰고(`scripts/gen_week_*.py`), 서버는 그것을 읽어 **연구 규칙을 검사한 뒤**
  한 문서로 내려줍니다 — 규칙을 어긴 기록은 화면에 닿지 않고 오류와 이유로 멈춥니다.
- 민감한 원자료는 저장소에도, 프론트 번들에도 들어가지 않습니다. 이름은 가명, 그림은 지어낸 인물입니다.

먼저 읽을 것: **[AGENTS.md](AGENTS.md)** (작업 지침과 지켜야 할 경계), **[DEVELOPMENT.md](DEVELOPMENT.md)**
(현재 상태 · 최근 기록), [docs/research/30_WEEK_TIMELINE_REDESIGN.md](docs/research/30_WEEK_TIMELINE_REDESIGN.md)
(지금 구조가 왜 이런지).

> **브랜치.** 이 브랜치(`v4-week-timeline`)는 한 주 · 사건 풀 구조입니다. 이전의 사흘 · 27경로 구조와 시뮬레이션
> 엔진은 `audience-tablet-split`(v3, 두 화면)과 `single-screen`(한 화면)에 그대로 남아 있습니다.

---

## 실행

처음 한 번:

```bash
python -m pip install -r server/requirements.txt
npm install
```

그다음 서버와 화면을 함께 띄우고 브라우저를 엽니다.

**Windows:** 탐색기에서 `run-exhibition.cmd` 를 더블클릭합니다. 끝낼 때는 그 창에서 **Ctrl+C**. 창을 그냥 닫았다면
다음 실행이 떠 있는 것을 그대로 쓰고 `run-exhibition.cmd --stop` 으로 내립니다. Git for Windows(Git Bash)가 있어야
합니다. macOS·Linux·Git Bash에서는 `./run-exhibition.sh` (`--no-open` 브라우저를 열지 않음 · `--stop` 내림).

서버 <http://127.0.0.1:8020> · 화면 <http://localhost:5180> (`MEDIAL_SIM_PORT` · `MEDIAL_WEB_PORT` 로 바꿉니다).
모니터는 `/?role=wall`, 태블릿은 모니터의 QR 코드로 엽니다. 직접 띄우려면 `python server/sim_main.py` 와
`npm run dev`(프론트의 `/api/sim` 은 `MEDIAL_SIM_URL`, 기본 `127.0.0.1:8020` 으로 프록시됩니다).

### 대화록 · 평가 만들기 (모델을 부르는 유일한 곳)

서버는 모델을 부르지 않습니다. 사건의 대화록과 주민 평가는 아래 도구가 `fixtures/week/` 에 씁니다(비용이 듭니다).
키는 **`server/.env`** 의 `OPENAI_API_KEY` 에서만 읽습니다(양식은 `server/.env.example`). 모델은 `gpt-6.1-sol`.

```bash
python scripts/gen_week_dialogue.py make --only E1 E4.B   # 사건 · 장면별로 다시 쓴다 (이미 있는 것은 그대로)
python scripts/gen_week_dialogue.py read                  # dialogue.json → 검토용 dialogue.html · .md
python scripts/gen_week_evaluations.py make --only E1     # 겪은 줄만 인용하는 주민 평가
python scripts/gen_week_evaluations.py link               # 요청마다 근거가 된 평가 대목을 찾는다 (없으면 none)
```

검토용 `fixtures/week/dialogue.html` · `evaluations.html` 은 장면 · 평가마다 좋음/고침과 메모를 남기고 한 번에 복사할
수 있는 한 장짜리 페이지입니다. **연구자가 읽고 확정하기 전에는 평가 · 음성 · 화면에 쓰지 않습니다.**

그림과 음성은 저장소 밖(`local-data/`)에 둡니다. 그림은 `node scripts/art.mjs`(`--add P1.resting` 처럼 새 컷을
더함), 음성은 `scripts/tts_voices.py` · `scripts/tts_scenes.py` 입니다.

## 검증

```bash
npm run build && npm test && python -m pytest server/tests -q
```

실제 브라우저까지 보려면 (진짜 서버 + 모니터 2560×1440 + 태블릿 1180×820으로 한 주를 끝까지 걷습니다):

```bash
npm run e2e
```

테스트 수보다 실패 여부와 연구 경계 검사를 우선합니다. 서버 테스트는 한 주의 기록이 규칙(겪은 줄만 인용 · 시뮬레이션
표기 · 근거 없는 요청 거부 · 인과 순서)을 어기면 읽기를 멈추는지, 서버가 읽기만 하는지를 봅니다.

## 저장소 구조

| 경로 | 내용 |
|---|---|
| `fixtures/week/` | **연구 자료의 단일 출처.** `briefs.json`(사건 풀 · 요청 · 규칙) · `schedule.json`(요일 배치) · `dialogue.json`(대화록) · `evaluations.json`(주민 평가 · 평가→요청 연결) |
| `server/app/simulation/` | 읽기 전용 서버: `week.py`(검증해 한 문서로) · `assets.py`(그림 · 음성) · `api/routes.py` · `api/stage.py`(모니터↔태블릿 중계) |
| `src/features/simulation/week/` | 한 주 · 장면 · 평가 · 요청 · 결과 화면과 걷기 상태 |
| `src/features/simulation/stage/` | 모니터(`wall.ts`)와 태블릿(`PadApp`)이 주고받는 것 |
| `scripts/gen_week_*.py` · `model.py` | 대화록 · 평가를 쓰는 오프라인 도구와 모델 호출 |
| `scripts/art.mjs` · `tts_*.py` | 장면 그림 · 음성 만들기 |
| `scripts/two_screens.cjs` · `stress_two_screens.cjs` · `capture_*.cjs` | 전시장 운영 도우미 · 두 화면 괴롭히기 · 캡처 |
| `run-exhibition.*` | 서버와 화면을 함께 띄우는 단일 진입점 |
| `docs/research/` | 지금 기준인 연구 문서 · 설계 결정 기록 (`history/` 는 지나온 것) |
| `local-data/` | 장면 그림(`art/`), 음성(`audio/`), 원자료에서 파생된 것. **커밋하지 않습니다** |

## 전시장 두 화면 (모니터 + 태블릿)

전시는 화면이 둘입니다. 한 화면으로 걷는 판은 `single-screen` 브랜치에 있습니다.

| 화면 | 주소 | 기기 | 하는 일 |
|---|---|---|---|
| 모니터 | `/?role=wall` | 2560px 이상 모니터 | 보여 주기만 한다. 눌리는 것이 없다. 소리(음성 · 배경음)도 여기서 난다 |
| 태블릿 | `/?role=pad` | iPad Air 4세대 (가로, 1180×820) | 만지는 것은 전부 여기. 시작 · 사건 고르기 · 줄 넘기기 · 주민 고르기 · 요청 고르기 · 처음으로 |

흐름은 하나입니다. 태블릿 "시작하기" → 모니터에 소개 영상 → **이번 주**(태블릿에서 사건 하나를 고름) → 사건 장면(한 줄씩
저절로 넘어가고 태블릿으로 되돌리거나 건너뜀) → 주민 평가(한 사람을 누르면 모니터가 그 사람의 평가와 근거 대사를 보여 줌) →
수정 요청(태블릿에서 한 번 터치로 확정) → 반영된 장면과 평가 → 이번 주(읽은 사건이 표시됨).

**구조.** 모니터 브라우저가 걷기 상태와 타이머를 쥐고, 태블릿은 누른 것을 서버에 알립니다. 서버(`api/stage.py`)는 태블릿의
명령을 모니터로, 모니터가 지금 보여 주는 것을 태블릿으로 전달만 하고(SSE) 아무것도 저장하지 않습니다.

**띄우기와 짝짓기 (QR).** 서버와 화면은 한 기계에서 돌리고, iPad는 같은 와이파이로 붙습니다.

```
./run-exhibition.sh --no-open          # (Windows: run-exhibition.cmd --no-open) 서버 8020 + 화면 5180
node scripts/two_screens.cjs wall      # 모니터 창을 키오스크로 연다 (Chrome/Edge, 소리 자동 재생 허용)
node scripts/two_screens.cjs qr        # QR을 터미널에 찍는다
node scripts/two_screens.cjs check     # 서버 · 프록시가 이 기계에서 열리는지 확인한다
```

1. 모니터가 열리면 **QR 코드 화면**이 뜹니다(터미널의 QR과 같은 주소). 주소를 손으로 입력하는 일은 없습니다.
2. iPad 카메라로 QR을 비추면 Safari가 열리고 **연결하기** 버튼이 나옵니다. 누르면 모니터가 대기 화면으로, 태블릿이 시작하기 화면으로 넘어갑니다.
3. QR 속 토큰은 서버를 켤 때마다 새로 만들어집니다. 토큰이 없는 접속은 거절되므로(같은 와이파이의 낯선 기기가 주소만 알아서 조작하는 것을 막습니다) 매 실행마다 QR로 들어옵니다.
4. 태블릿은 한 대만 붙습니다. 다른 iPad가 QR로 들어오면 먼저 붙은 것은 "다른 태블릿이 연결되었습니다"가 되고 해제됩니다. 같은 iPad가 끊겼다 돌아오면 하던 자리에서 이어집니다.
5. QR이 안 읽히면 터미널의 "이 주소를 iPad Safari에 입력" 줄을 씁니다. 주소를 잘못 고르면 `MEDIAL_LAN_HOST=192.168.0.x` 로 직접 지정합니다.

- **Windows 노트북**: 와이파이가 "공용"이면 Windows 방화벽이 iPad의 접속을 막습니다. 관리자 PowerShell에서 한 번
  `powershell -ExecutionPolicy Bypass -File scripts/allow_tablet_firewall.ps1` (5180 포트, 같은 서브넷만 허용. 끝나면 `-Remove`). 절전 · 화면 끄기는 전시 동안 끕니다.
- **Mac Studio**: 시스템 설정 → 네트워크 → 방화벽이 켜져 있으면 `node` 의 수신 연결을 허용합니다. iPad와 같은 와이파이(또는 같은 공유기의 유선)여야 합니다.
- **전시장 와이파이**: 기기끼리 통신을 막는 와이파이(클라이언트 격리, 게스트망)에서는 QR을 읽어도 열리지 않습니다. 전시 전에 현장 와이파이로 한 번 시험하고, 안 되면 휴대용 공유기나 폰 핫스팟에 두 기기를 붙입니다.
- 두 기계 모두: API(8020)는 `127.0.0.1` 에만 열려 있어 iPad는 5180의 프록시로만 들어옵니다. 연결 정보(토큰)를 읽는 호출은 `localhost` 로 연 모니터 화면에만 답합니다.
  화면이 끊기면 태블릿에 "끊겼습니다"가 뜨고 브라우저가 스스로 다시 붙습니다.

**눈으로 확인 · 괴롭히기.** `node scripts/capture_week.cjs` 가 모니터와 태블릿을 동시에 열어 한 사건을 끝까지 걷고 `.run/week/` 에
캡처합니다(`[주소] [폴더] [사건id] [요청id]`). `node scripts/capture_pairing.cjs` 는 QR 짝짓기를, `node scripts/stress_two_screens.cjs` 는
모니터 새로고침 · 모니터 두 개 · 연결 끊김과 복귀 · 연타 · 낡은 눌림 · 토큰 없는 눌림을 시험합니다(서버가 떠 있어야 합니다).

## 전시장 브라우저 (소리)

장면의 대사는 미리 만들어 둔 음성(`local-data/audio/`, git 밖)을 화면이 틀어 줍니다. 브라우저는 사용자가 한 번 만지기 전에는 소리를 막으니, 전시장 PC의 브라우저는
자동 재생을 허용해 띄웁니다. Chrome: `chrome --kiosk --autoplay-policy=no-user-gesture-required http://localhost:5180/?role=wall`. 소리가 막혀도 장면은 소리 없이 계속 갑니다.
음성 파일이 없으면 대사는 읽는 시간만큼 조용히 흐릅니다.
