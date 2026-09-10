# MEDial 연구 시뮬레이터

**완성된 의료 서비스를 평가하는 도구가 아닙니다.** core item에서 출발해 정책 조건을 바꾸며
여러 attempt를 실행하고, 그 결과를 비교하면서 아이템을 구체화하는 **탐색적 디자인 도구**입니다.

은점마을 12인의 하루를 원자료에서 가져와 재구성하고, "응답이 없는 안부 확인을 누구의 시간으로
해결할 것인가" 같은 조건을 바꿔 가며 **조건 차이 → 결정 차이 → 결과 차이**를 봅니다.

- 기본값은 **모델 호출 없음**이고 API 키가 필요 없습니다. 규칙 어댑터로 전체 흐름이 돕니다.
- 리뷰·개선 역할만 실제 모델로 바꿀 수 있습니다(그때의 이름은 hybrid이며, 주민의 행동은
  여전히 규칙입니다). 키는 서버 환경변수에서만 읽고, 키가 없으면 온라인 어댑터를 고를 수
  없으며, 호출 실패를 규칙 결과로 대체하지 않습니다.
- 민감한 원자료는 저장소에도, 프론트 번들에도 들어가지 않습니다.
- 합성 데이터로도 그대로 실행되며, 화면 상단 배지가 합성인지 원자료인지 항상 표시합니다.

먼저 읽을 것: **[DEVELOPMENT.md](DEVELOPMENT.md)** (구현 범위 · 검증 결과 · 미구현 항목),
그다음 [docs/research/](docs/research/).

---

## 실행

```bash
python -m pip install -r server/requirements-sim.txt
```

```bash
python server/sim_main.py
```

```bash
npm install && npm run dev
```

<http://localhost:5173> 을 엽니다. 프론트의 `/api/sim` 요청은 `127.0.0.1:8010` 으로 프록시됩니다.

`server/requirements.txt` 는 아래 "아카이브"의 컴패니언 데모용이고, Whisper·torch·FAISS·Gemini를
받습니다. 시뮬레이터는 그중 아무것도 import 하지 않으므로 `requirements-sim.txt` 만 있으면 됩니다.

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
python -m pytest server/tests/simulation -q
```

```bash
npm run build
```

## 저장소 구조

| 경로 | 내용 |
|---|---|
| `server/app/simulation/` | 사건 엔진 · 관측 경계 · 정책 · 기관 · 동승 · 페르소나 컴파일러 · SQLite |
| `server/tests/simulation/` | 회귀 테스트 (전부 합성 픽스처 사용) |
| `src/features/simulation/` | 지도 · MEDial 패널 · 재생 · 정책 편집기 · 비교 · 발견 |
| `scripts/import_village/` | 원자료 → 정규화 레지스트리 (출처 검증 포함) |
| `docs/research/` | 연구 문서 · 데이터 계약 · 설계 결정 기록 |
| `local-data/` | 원자료에서 파생된 레지스트리와 실행 기록. **커밋하지 않습니다** |
| `local-archive/` | 기존 작업 보관본. **커밋하지 않습니다** |

## 아카이브 — MEDial 3.0 컴패니언 데모

이 저장소의 이전 방향이었던 음성 AI 말동무 데모는 **보관 상태**입니다. 소스를 지우거나 되돌리지
않았고, 기본 빌드에만 포함되지 않습니다.

```bash
VITE_INCLUDE_COMPANION=1 npm run dev
```

`#/companion` 에서 열립니다. 그쪽 서버는 `server/app/main.py` 이며 API 키와 GPU 설정이 필요합니다
— 문서는 [docs/archive/COMPANION_3.0.md](docs/archive/COMPANION_3.0.md).

미커밋 상태였던 `CompanionOnboarding.tsx` 와 `useAppStore.ts` 는 손대지 않았습니다. 사본·diff·해시가
`local-archive/companion/` 에 있습니다.
