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

처음 한 번:

```bash
python -m pip install -r server/requirements-sim.txt
npm install
```

그다음부터는 한 줄입니다. 서버(8010)와 개발 서버(5173)를 띄우고 브라우저를 엽니다:

```bash
./run.sh
```

이미 떠 있으면 그대로 쓰고, `./run.sh --stop` 으로 내립니다. 직접 띄우려면
`python server/sim_main.py` 와 `npm run dev` 를 각각 실행하면 됩니다.
프론트의 `/api/sim` 요청은 `127.0.0.1:8010` 으로 프록시됩니다.

### 모델 키

기본 실행에는 필요 없습니다 — 규칙 어댑터는 모델을 한 번도 부르지 않습니다. 리뷰·개선을 실제
모델로 돌릴 때만 필요하고, 키는 **`server/.env` 에 두며 서버 프로세스만 읽습니다**
(`run.sh` 가 읽어서 넣어 줍니다). 양식은 `server/.env.example`.

기본값은 `google` / `gemini-3.8-flash` 이고, `openai` 로 바꾸면 `gpt-5.6-terra` 입니다. 고르는
기준과 상위 등급으로 올리는 법은 [DEVELOPMENT.md](DEVELOPMENT.md) 의 "모델 키는
`server/.env` 에 있습니다".

키가 없으면 온라인 어댑터를 고를 수 없고(session 생성 400), 호출이 실패해도 규칙 결과로
대체하지 않습니다.

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

기준선: build 통과 · vitest 41 · pytest 151. 숫자가 줄면 회귀입니다.

## 저장소 구조

| 경로 | 내용 |
|---|---|
| `server/app/simulation/` | 사건 엔진 · 관측 경계 · 정책 · 기관 · 동승 · 페르소나 컴파일러 · SQLite |
| `server/tests/simulation/` | 회귀 테스트 (전부 합성 픽스처 사용) |
| `src/features/simulation/` | 세 화면 · 지도 · 재생 · 정책 편집기 · 비교 · 현장 검토 |
| `scripts/import_village/` | 원자료 → 정규화 레지스트리 (출처 검증 포함) |
| `docs/research/` | 연구 문서 · 데이터 계약 · 설계 결정 기록 |
| `local-data/` | 원자료에서 파생된 레지스트리와 실행 기록. **커밋하지 않습니다** |
| `local-archive/` | 실행 DB 백업. **커밋하지 않습니다** |
