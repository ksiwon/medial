# 리팩터링 실행 기록 — 2026-09-15

26번 기획서(`26_REFACTOR_AUDIT_AND_PLAN_2026-09-15.md`)와 27번 실행 프롬프트에 따른 구현 기록이다.
각 단계는 **실제로 실행한 검사와 그 결과**만 적는다. 실행하지 못한 검증은 '하지 않음'으로 남긴다.

## Phase 0 — 기준선과 보존 대상

### git 상태 (착수 시점)

- 브랜치 `main`, 작업 트리 clean. 추적되지 않는 파일 두 개: 26번·27번 문서. 둘 다 그대로 보존한다.
- reset/checkout/discard를 하지 않는다. 커밋도 이 작업에 포함되지 않는다.

### 실제 실행한 기준선 (2026-09-15, 이 환경)

```
python -m pytest server/tests -q        # 386 passed, 1 warning (8.6 s)
npm test                                 # 53 passed (4 files)
npm run build                            # tsc + vite 통과 (index-*.js 344 kB)
```

DEVELOPMENT.md의 마지막 기록(서버 343 · 프런트 52)보다 서버 43개가 많다. 문서가 뒤처진 것이며
테스트가 사라진 것이 아니다. 이 수치가 이후 단계의 회귀 기준이다.

### 보존해야 하는 저장 데이터와 migration 전략

- 연구 DB: `local-data/runs/simulation.sqlite3` (git 제외). 이 작업에서 열지도, 쓰지도 않는다.
- e2e DB: `playwright.config.ts` → `MEDIAL_SIM_DB=.run/e2e/simulation.sqlite3`. `e2e/reset-db.mjs`가
  지우는 경로는 `.run/e2e/` 안의 두 파일뿐임을 코드로 확인했다. 연구 DB는 건드리지 않는다.
- 스키마: `persistence/store.py`(attempts·events·decisions·observations·reviews·commands·policies·
  findings·attempt_model_calls) + `persistence/iteration_store.py`(iteration_sessions·generations·
  agent_reviews·review_syntheses·change_sets·model_calls·model_results·designer_decisions·
  field_packages·human_reviews·iteration_commands). 전부 `CREATE TABLE IF NOT EXISTS`이고 본문은
  `*_json` 열에 JSON으로 저장한다. 명시적 schema version은 **없었다**.
- 이번 작업의 migration 원칙: **DDL은 추가만** (새 테이블 `IF NOT EXISTS`, 새 열 `ALTER TABLE ADD COLUMN`
  기본값 포함). JSON 본문의 새 필드는 전부 optional/default이며 옛 행은 그대로 읽힌다.
  `schema_meta` 테이블에 `schemaVersion`을 기록한다(`_migrate`).
- Rollback: 새 빌드가 쓴 행을 옛 빌드가 열면 — 옛 빌드의 Pydantic 모델은 `extra="forbid"`라
  새 필드가 있는 change set/human review 행은 검증에 실패한다. 옛 빌드는 이미 그런 행을 "폐기된 형식"으로
  분리해 409를 돌려주므로(`IterationService.load`) 서버가 죽지는 않는다. 데이터는 삭제·변환되지 않는다.
  옛 빌드로 되돌리려면 새 빌드에서 만든 session만 활성 목록에서 빠진다.
- legacy 읽기 전략: 옛 change set(`semantic` 없음)은 읽기 전용 이력으로 보존하고, 새 실행 경로에는
  올리지 않는다. 옛 human review(`agreement=partial` 등)는 값을 변환하지 않고 그대로 보여 준다.

### 기준선 fixture

- 합성 마을·페르소나·장부: `fixtures/synthetic/`.
- 실행·근거·확정 흐름: `server/tests/simulation/test_iteration.py::run_session`이 v0 실행 → 리뷰 → 종합 →
  초안 → 확정 → v1 실행을 합성 fixture로 돈다. Phase 1은 이 흐름을 새 의미 규칙 경로로 옮기고 같은
  검사를 통과시킨다.
- 실제 원자료(`local-data/`)와 연구 DB는 fixture로 복사하지 않는다.

### 코드 동작 보존 vs 연구적 의미 변경 (작업 목록 분리)

| 구분 | 항목 |
|---|---|
| 동작 보존 | 엔진 사건 순서·stableSeq·관측 경계·불변 로그·입력 해시·확정 전 실행 0회·`source=human` 단일 경로 |
| 의미 변경 (26번이 요구) | afterRule 자유문장 → 타입 있는 의미 규칙 하나에서 문장·binding·hash 생성 (F01) · 초안 없이 직접 작성 (F03) · '수정하지 않음' 종료 · 규칙 적용 기록 (F06) · 종합 제외 주장의 원본 참조 (F08) · 인간 검토 단계·응답자·충돌 (F07) · 이장 하드코딩 제거 (F04/F05) |

## Phase 1 — 의미 규칙의 단일 경로 (F01·F03·F09)

**만든 것.** `server/app/simulation/iteration/semantic_rules.py`. 지원 규칙 9종
(`retry_before_help` · `quiet_period` · `helper_daily_cap` · `neighbour_ask_limit` ·
`disclosure_scope` · `institution_deadline` · `contact_order` · `ride_candidate_order` ·
`ride_detour_limit`)을 Pydantic discriminated union으로 정의하고, 하나의 `SemanticChange`에서

- `format_rule()` → 전후 문장,
- `compile_bindings()` → 엔진 바인딩,
- `semantic_hash()` → 실행 해시(라벨·이유 제외),
- `catalog()` → 화면과 모델이 쓰는 입력 명세

를 전부 만든다. `RuleChange.semantic`이 원천이고 나머지 필드는 파생이며, 검증이 파생을 다시
계산해 다르면 거부한다.

**없앤 것.** `CompareScreen`의 `ResearcherEditor`·`makeEditor`·`editorPayload`(자유 문장 입력과
binding 입력), `service._save_researcher_change_set`의 `afterRules`/`bindingValues` 경로,
`improvement.py`의 문장 람다와 `_binding` 헬퍼.

**바뀐 계약.**

| 명령 | 전 | 후 |
|---|---|---|
| `save_researcher_change_set` | `templateChangeSetId` 필수 · `afterRules[]` · `bindingValues{}` | `rules: [{ruleType, after}]` · 초안 없이 가능 · 적지 않은 매개변수는 현재 값 유지 |
| `confirm_change_set` | `awaiting_confirmation`에서만 | 작성 가능 상태(`awaiting_confirmation`·`no_valid_change`·`stalled`)에서 |
| `decline_changes` | 없음 | 새로 추가. 이유 필수, 실행 0, 초안은 `declined`로 보존 |

**작업 중 발견해 고친 것 두 가지.**

1. **세대 사이의 사건 id 충돌.** 사건 id(`ev-14`)는 attempt마다 매겨지는데, 세계 전용 사건
   검사가 "어느 attempt에서든 연구자 전용이면 금지"로 되어 있었다. 덱 두 개를 함께 돌리면 한쪽의
   평범한 경험 사건이 다른 쪽의 세계 사건과 같은 id를 갖고, 멀쩡한 Change Set이 "세계 진실 인용"
   으로 거부됐다. 이제 그 세대의 검증된 평가가 실제로 인용한 id는 제외한다.
2. **멱등성이 실행 뒤에 검사됐다.** `record_iteration_command`가 명령을 실행한 *다음* 중복을
   확인했다. 확정을 재전송하면 두 번째 실행이 일어난 뒤에야 중복인 것이 드러난다. 검사를 실행
   앞으로 옮겼다(`find_iteration_command`).

## Phase 2 — 주민 평가 중심 UX (F02)

최상위 세 화면: `사례와 서비스 경험` / `주민 평가` / `개선과 확인`.

- `screens/EvaluationsScreen.tsx` 신규. 주민 목록 → 경험 → 6차원 → 요청한 변경 → 모름 순서.
  근거는 항목 안에서 열고 닫히며 같은 자리로 돌아온다. 미경험·거절·무응답·미해결을 다르게
  표시하고 부정으로 정렬하지 않는다. 카드마다 '모의 주민 평가'와 페르소나 출처를 **다른 축**으로
  표시한다.
- `components/ChangeComposer.tsx` 신규. 규칙 카탈로그에서 생성한 타입별 컨트롤, 값에서 만든
  전후 문장, 저장 실패 시 입력 보존, '이번에는 수정하지 않음', 확정 이유는 실행 버튼 옆에.
  다른 안으로 바꾸면 이전 이유를 지운다.
- 실행이 끝나면 평가 화면으로 한 번 안내한다. 다른 화면을 읽고 있으면 끌어오지 않는다.
- 기본 반복은 초기안과 수정안 한 쌍(`maxGenerations` 기본 2).

## Phase 3 — 자료와 서비스 경계 (F04·F05·C01·C02)

- `case_bundle.py`: `CaseBundle`(주민·역할·관계·장부·시나리오·자원·근거 색인) + 검증 +
  `unsupported_reason()`. 엔진의 `VILLAGE_HEAD_ID = "P6"`가 사라지고 이장은 레지스트리의
  `isVillageHead`에서 온다. 역할이 없으면 `None`이고, 그 역할을 거치는 운영안은 거부된다.
- 두 번째 공동체: `fixtures/synthetic/village.small-case.json`(R1~R5, 이장 없음),
  `ledger.small-case.json`(다섯 항목 중 넷이 `not_asked`, `routineKnowledge` 없음),
  `decks/r1_no_response.py`. 생성 스크립트는 `scripts/make_small_case_fixture.py`.
- 장부 파일은 마을 파일의 접미사로 짝을 짓는다. 폴더에 공동체가 둘이 되자 glob이 남의 장부를
  집어 왔다.
- `iteration/services.py`: `ServiceAdapter` 프로토콜과 MEDial 어댑터. 코어가 서비스 이름으로
  분기하지 않고 지원 규칙·기능·사례 적합성을 어댑터에서 받는다.

### 26번에서 벗어난 항목 — 비의료 합성 서비스

**하지 않았다.** 26번 Phase 3의 인수 조건 중 "제한된 비의료 합성 서비스 하나로 같은 평가 루프를
검사한다"를 구현하지 않았다.

- **코드 근거.** 엔진의 사건 어휘(`contracts.EventType`)와 워크플로가 의료 두 사례에 맞춰져
  있다: `request.*`/`transport.*`/`handoff.*`와 `_offer`·`_ask_next_driver`·`_arm_escalation`이
  안부 확인과 동승을 직접 표현한다. '요청 → 안내/배정 → 지연/거절 → 이용 결과'만 가진 서비스를
  돌리려면 새 사건 타입, 새 워크플로, 그 사례의 지표와 평가 경험 투영이 필요하다. 어댑터 경계를
  만드는 것과 두 번째 서비스를 실제로 실행하는 것은 크기가 다른 작업이다.
- **대안으로 한 것.** 어댑터 경계를 실제로 세워 코어에서 서비스 이름 분기를 없앴고(F04의 절반),
  **공동체 이전(G1)** 은 끝까지 검사했다 — 새 ID·이장 없음·장부 없음의 5인 사례가 같은 루프를
  돈다.
- **연구 영향.** 26번의 G2(같은 공동체의 다른 서비스) 주장은 **하지 못한다.** 이 저장소가 지금
  보일 수 있는 것은 "소프트웨어가 다른 공동체로 옮겨간다"까지이며, "방법이 다른 서비스에도
  적용된다"는 아직 근거가 없다. 다음에 할 사람이 필요한 것은 사건 타입 3~4개와 워크플로 하나,
  그리고 그 사례의 CaseBundle이다.

## Phase 4 — 실패 경계와 현장 기록 (F06·F07·F08·C04·C05·C06)

- `rule_application.py`: 규칙마다 조건 발생 여부와 실제 실행 여부를 자식 로그에서 판정한다.
  판정할 수 없으면 `unknown`이고 추측하지 않는다.
- 세대 지표에 `manifest`(덱·seed·엔진·환경·관계·장부·하루·모델 정책·입력 해시·어댑터).
- `ExcludedClaim`: 원본 평가 참조 · 기계 검사 · 의미 판정 · 라벨 주체를 분리. 참조가 없는
  주장은 "종합이 스스로 만든 주장"으로 표시한다.
- `HumanReview` 확장과 `DisclosureRecord` 신설, 그리고 순서 강제. 공개 전 응답 없이는 공개를
  기록할 수 없고, 공개 기록 없이는 비교 응답을 저장할 수 없다. 옛 `agreement=partial`은 값을
  바꾸지 않고 '옛 기록'으로 표시한다.
- 화면: `FieldSheet`가 1단계(공개 전, 모의 평가를 보여 주지 않음) → 2단계(공개 기록) →
  3단계(비교)로만 진행한다.

## Phase 5 — 구조 정리 (F10·F11)

- 삭제: `components/PolicyEditor.tsx`, `components/FindingPanel.tsx`, 스토어의
  `runPolicy`·`rerun`·`forkAt`·`createFinding`·`applyFinding`·`beginApplyFinding`·
  `editorOpen`·`pendingFinding`. 새 실행을 만드는 경로는 Change Set 확정 하나다.
- 보존: 서버의 rerun/fork/finding 엔드포인트와 저장된 기록, 세대 표, 시도 단위 비교는 고급
  영역에서 읽기 전용으로 남는다.
- `schema_meta.schemaVersion = "2"`. DDL은 추가만, JSON 새 필드는 전부 기본값.

**성능은 측정하지 않았다.** 폴링 응답량·렌더 횟수·스크롤 복구를 재지 않았으므로 개선을
주장하지 않는다. 26번 F11이 요구한 "먼저 책임 분리, 그다음 계측"의 앞 절반만 했다.

## 실행한 검사와 실행하지 못한 검사

실행한 것(2026-09-15, 이 환경):

```
python -m pytest server/tests -q   # 418 passed  (기준선 386)
npm test                            # 63 passed   (기준선 53)
npm run build                       # tsc + vite 통과
npm run e2e                         # 6 passed (Chromium · 합성 마을 · .run/e2e/)
```

`e2e/reset-db.mjs`가 지우는 경로가 `.run/e2e/` 안의 두 파일뿐임을 코드로 확인했고, 연구 DB
(`local-data/runs/simulation.sqlite3`)는 이 작업에서 열지 않았다.

브라우저에서 사람이 캡처를 열어 확인한 것과 그 결과로 고친 것은 `DEVELOPMENT.md`의 같은 절에
표로 있다. 자동 검사로 고정한 것은 다음 두 가지다.

- `세 화면이 1440·1366·800에서 가로로 넘치지 않는다` — 세 폭 × 세 화면에서
  `documentElement.scrollWidth <= innerWidth`. 800px에서 상단 내비게이션이 낱말 단위로 잘리던
  것을 캡처에서 보고 헤더를 두 줄로 접도록 고쳤다.
- `키보드만으로 세 화면과 평가 근거에 닿는다` — Tab으로 세 화면 이름에 순서대로 닿고, Enter로
  이동하며, 평가 항목의 사건 근거를 포인터 없이 펼친다.

## 후속 · 읽기 부담 정리 (같은 날, 연구자 요청)

연구자·정책 결정자가 화면을 열었을 때 무엇을 먼저 볼지 알 수 없다는 지적을 받고, 화면에서
**기본으로 보이는 글의 양**을 줄였다. 문장을 지우지 않았다: 각 수치·항목의 단서 조항(무엇이
아닌지, 무엇과 무엇을 섞어 세는지, 빈칸이 '없음'이 아니라는 것)은 그 대상 옆의 `?`(hint)와
접기로 옮겼다 (D100).

- 비교 표의 칸 각주 여섯 개가 행 이름의 힌트 하나씩으로 합쳐졌다. 두 칸에 같은 근거 문구가
  반복되던 '해결까지 걸린 시간'도 근거가 같으면 행에서 한 번만 말한다.
- 개선 화면의 서술 상자 다섯 개 중 셋(기대 효과·가능한 부담·다음에 볼 것)이 접힘으로 들어갔다.
  현장 검토 결정의 네 상자도 같다. 이유는 접지 않는다 — 없으면 저장도 확정도 막히기 때문이다.
- 주민 평가 화면은 제목 아래 한 줄과 항목 개수만 남고, '점수가 아니다'·'미경험은 불만이
  아니다'·'페르소나가 원자료 기반이어도 평가는 simulated'는 각각 그 대상 옆에서 열린다.
- 막는 문제, 상태, 실패 이유, 저장 거부 사유는 접지 않는다.

같은 지적의 다른 절반인 **잘린 글자**도 캡처를 보고 고쳤다 (D101): 사람 목록에서 '보건소
담당자'가 'P..'가 되던 것(이름이 폭을 지키고 시나리오 라벨만 줄임표), 44px 진행 막대에서 '하루
실행'이 '하루'로 잘리던 것(좁으면 현재 단계만), 지도 헤더의 버튼이 세로 한 글자씩으로 눌리던
것(줄바꿈), 좁은 select가 글자 가운데를 자르던 것(줄임표).

검사는 힌트를 **열어서** 문장을 확인한다. jsdom과 Playwright 양쪽에 `hint(label)` 도우미를 두고,
옮긴 문장마다 그 문장이 여전히 화면의 주장임을 검사가 붙들고 있다.

## 후속 · 발표 캡처와 연구노트 2 (같은 날)

`npm run shots`(`e2e/shots.spec.ts`, 기본 e2e와 분리)로 화면·기능별 캡처 31장을 `docs/research/screenshots/2026-09-15-ui/`에 남기고(합성 마을, 2880px), `RESEARCH_NOTE_2026-09-15_vol2.html`에 연구 목표와 이번 리팩터링을 정리했다. 캡처를 열어 보다 엔진 키 노출 두 곳(거절 사유 `driving_status_unknown`, 현장 장면 제목 `time_labour`)과 2단계에 남은 1단계 입력칸을 찾아 고쳤다.

**하지 못한 것 — 완료라고 쓰지 않는다.**

- **실제 모델 호출 0회.** 이번 작업에서 Gemini를 한 번도 부르지 않았다. 개선 프롬프트를
  `medial-improve/2.0.0`으로 바꿨으므로(모델이 규칙 값을 제안하는 형태) 그 프롬프트가 실제
  모델에서 어떻게 동작하는지는 **확인되지 않았다.** 기록 재생과 새 호출을 구분해 검증해야 한다.
- **실제 사용자 사용성 검증 0회.** 브라우저에서 사람이 확인한 것은 개발자 내부 확인이며, 26번
  5장의 형성평가 목표 시간은 달성 사실이 아니라 목표다.
- **주민 평가 화면의 접근성 전반.** 1440·1366·800px의 가로 넘침과 세 화면·근거 펼치기의 키보드
  도달은 Playwright로 확인했지만(아래), 스크린리더·대비·포커스 순서 전반은 보지 않았다.
- **실제 사람의 현장 응답 0건.** 기록 도구만 세웠다.
- **종합의 의미 판정 사람 라벨 0건.** 전부 `unreviewed`다.
- **힌트로 옮긴 문장을 사람이 실제로 찾아 읽는지 확인하지 않았다.** 접은 글이 안 읽히는 글이
  되는 것은 실제 위험이고, 이 작업은 그 위험을 사용자에게 시험하지 않았다.
