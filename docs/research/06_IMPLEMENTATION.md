# 06. 구현 구조와 코딩 설계

상태: 구현 진행 중. **1·3·4·6·7·8절의 첫 세로 흐름은 구현되어 동작한다**(`server/app/simulation/`, `server/sim_main.py`, `src/features/simulation/`). 5절의 예약·동승, 6절의 LLM 어댑터 본체, 7절의 WebSocket·probe·export는 아직 없다. 구현된 범위와 미구현 범위의 정확한 목록은 [DEVELOPMENT.md](../../DEVELOPMENT.md)에 있다.

## 1. 스택 결정

기존 React·TypeScript·Vite 구조를 살리고, 연구용 시뮬레이션을 별도 도메인으로 만든다. 서버는 Python/FastAPI, 데이터 검증은 Pydantic, 저장은 SQLite에서 시작한다.

- 지도: React SVG/Canvas 2D. 원본 지도 PNG와 좌표·경로를 사용. Three.js와 입체 모형 의존은 신규 지도에 필요 없음.
- 프론트: existing React 18 구조, Zustand는 선택/패널/재생 포인터만 관리. 시뮬레이션의 사실을 클라이언트 상태로 따로 생성하지 않음.
- 서버: simulation clock, event queue, policy, agents, route/reservation, log. 실제 시간과 시뮬레이션 시간 구분.
- 전송: 명령 HTTP + 로그 WebSocket. reconnect 시 lastEventSeq 이후 재수신.
- 저장: SQLite transaction으로 이벤트·버전·체크포인트 저장. 처음부터 외부 DB/벡터 DB/분산 에이전트 시스템을 도입하지 않음.
- LLM: provider-neutral adapter. 오프라인 scripted adapter가 기본 테스트 경로.
- LangGraph: 정책의 중단·재개·사람 검토가 복잡해질 때 policy 내부에 도입 가능. 세계 시계와 실제 상태의 소유자는 여전히 자체 엔진.

기술 근거: [FastAPI WebSockets](https://fastapi.tiangolo.com/advanced/websockets/), [Pydantic models](https://docs.pydantic.dev/latest/concepts/models/), [LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview). 공식 문서에서 기능을 확인했다. 현재 설치 버전의 호환성은 구현 시작 시 별도로 검증하고 잠근다. 이번 문서화 중 패키지 업데이트·설치는 하지 않았다.

## 2. 디렉터리 제안

    src/
      features/studio/          # core item, 정책, 분기
      features/village-map/     # 지도·사람·차량·그룹 팝업
      features/quest-trace/     # 결정과 인계
      features/resident/        # 일과·대화·경험 평가
      features/institutions/    # 소장·담당자·119
      features/comparison/      # 조건 차이·사건 정렬·지표
      api/                      # generated types + HTTP/WS clients
    server/app/simulation/
      contracts.py
      clock.py
      queue.py
      engine.py
      reducer.py
      observations.py
      schedules.py
      routes.py
      reservations.py
      institutions.py
      policies/
      agents/
      evidence/
      metrics/
      persistence/
      api/
    server/tests/simulation/
    scripts/import_village/
    docs/research/
    local-data/                 # git 제외, 원자료·실행·LLM 응답
    fixtures/synthetic/         # 공유 가능한 가상 테스트만

기존 companion 화면·음성·트리아지 모듈은 신규 도메인에서 import하지 않는다. 리팩터링이 아니라 연구 목적이 다른 새 기능 경로다.

## 3. 모델 계약

contracts/domain.schema.json에 최소 계약 초안, examples/*.json에 입력 예시를 둔다. 구현 때 Pydantic을 서버 계약의 단일 원천으로 정하고 OpenAPI/JSON Schema에서 TypeScript 타입을 생성한다. 현재 JSON Schema 초안은 그 이전의 합의 문서다.

핵심 객체:
- EvidenceCard: 개인 주장·출처 포인터·확실성·상충
- PersonaRevision: P번호·근거 카드·능력·선호·관계 edge
- Activity: 기본/수정 일과 구간, 제약과 출처
- ScenarioDeck: 외생 사건과 가정, hash
- PolicyRevision: core item + 실행 정책 + 부모·patch
- Attempt: 초기 snapshot·policy·persona·deck·resource 버전
- Observation: actor별 읽기 가능한 사실, TTL, source event
- ActionProposal: actor가 원하는 행동. 아직 세계에 반영되지 않음
- DomainEvent: 검증 후 확정한 사건. committed=true일 때만 reducer 적용
- DecisionRecord: 후보·제외 이유·선택·근거·알려진 사실
- Reservation: actor/vehicle/seat/staff, 시간, 조건, 만료·취소
- ExperienceReview: source=simulated/human/researcher, known events, 항목별 응답
- DesignFinding: 사건→설계 질문→patch→후속 검토

state 변경 권한:
UI → Command
Agent → ActionProposal
Validator + Engine → DomainEvent
Reducer → WorldState
Metric engine → DerivedMetric
이를 어기고 agent가 DB나 지도 좌표를 직접 변경할 수 없게 한다.

## 4. 시뮬레이션 커널

    while queue and run.status == RUNNING:
        event = queue.pop_by(sim_time_ms, priority, stable_seq)
        settle_positions_and_reservations(event.time)
        commit(event)
        for actor in addressed_actors(event):
            view = observations.visible_to(actor, state, event)
            proposals = adapter.propose(actor, view, allowed_actions(actor))
            for proposal in stable_order(proposals):
                validation = validate(proposal, state, permissions, resources)
                commit(validation.accepted_or_rejected_event)
                enqueue(validation.follow_up_events)
        checkpoint_if_needed()

상세:
- sim_time_ms는 시작일 기준 정수; 485.5분 같은 원본 시각을 손실 없이 변환.
- requestAnimationFrame은 위치 보간만 한다.
- HTTP/LLM timeout은 실행 상태 waiting_model/error로 표시. 무응답 주민으로 위장하지 않음.
- engine state를 바꾸는 writer는 실행당 한 개. DB commit에 runId+sequence 고유성.
- LLM 호출은 읽기 snapshot으로 병렬 가능하지만, 상충 예약 확정은 정해진 순서로 직렬.
- LLM이 검증에 실패하면 1회 수정 요청 후 기록된 실패/검토대기로 전환. 임의 수락값으로 대체하지 않음.
- seed 함수는 stable hash(run seed, scenario event id, actor id, mechanism, replicate). 언어 런타임의 비안정 hash 사용 금지.
- 로그 재생은 LLM을 다시 호출하지 않음.

## 5. 경로와 예약

원본 ROUTES는 임의 출발/도착 조합을 모두 포함한 완전한 도로 그래프가 아니다.
1. 기존 polyline을 segment/node로 변환하고 연결성 검사.
2. HOME/PLACE를 가까운 도로 노드에 연결하되 도로 외 지름길을 자동으로 만들지 않음.
3. 검증된 graph 구간만 최단 경로 계산. 알려지지 않은 외부 구간은 명시적 duration assumption.
4. 픽업·동승은 driver route와 passenger seat reservation을 묶음.
5. 취소 시 actor·차량·좌석 예약을 원자적으로 해제하고 영향받은 후속 예약을 재검사.
6. 귀가·기본 일정 복귀는 teleport가 아니라 새 경로/일정 계산.
7. 바다 이동은 도로망과 분리. 육상 차량이 SEA node로 갈 수 없음.

차량 보유/면허·좌석·동행 조건 unknown은 후보 필터에서 확인 필요로 남긴다. 친척이라는 사실만으로 운전 가능을 생성하지 않는다.

## 6. 에이전트 실행 어댑터

    AgentAdapter.propose(actor_id, observation, allowed_actions, evidence) -> ActionProposal
    PolicyAdapter.decide(request, observation, candidate_set, policy) -> DecisionRecord
    ReviewAdapter.reflect(actor_id, experienced_events, evidence) -> ExperienceReview

- ScriptedAdapter: fixture 기준 정해진 행동. 기능/회귀 테스트에 사용.
- RuleAdapter: 가정과 규칙이 공개된 기준선.
- LLMAdapter: structured output, evidence retrieval, prompt version, raw output hash 보관.
- HumanOverrideAdapter: 연구자/실제 당사자의 수정 제안, 별도 source와 branch.

prompt에는 actor identity, 근거, 현재 관측, 현재 약속, 알려진 상대, 허용 행동, 스키마만 전달한다. 다른 actor의 사적 기억이나 미래 deck, 다른 정책의 결과는 넣지 않는다.

검색: 처음에는 actor별 JSON Pointer/태그·키워드 검색부터. 12명 자료를 위해 외부 벡터 DB는 불필요하다. 필요하면 로컬 embedding으로 확장하고 검색 적중 근거를 저장한다. 인터뷰 전문을 매 호출에 통째로 넣는 방식은 피한다.

## 7. API 초안

| Method | Path | 내용 |
|---|---|---|
| GET | /api/sim/catalog | 페르소나·시나리오·정책 revision 목록 |
| POST | /api/sim/attempts | 고정한 입력으로 새 실행 생성 |
| POST | /api/sim/attempts/{id}/commands | play, pause, step, inject, cancel |
| GET | /api/sim/attempts/{id}/snapshot?seq= | 시점 상태 재구성 |
| GET | /api/sim/attempts/{id}/events?after= | 이벤트 증분 로그 |
| WS | /api/sim/attempts/{id}/stream | committed events / run status |
| POST | /api/sim/attempts/{id}/fork | snapshot+patch로 새 시도 |
| POST | /api/sim/attempts/{id}/probe | 읽기 전용 snapshot 대화 |
| POST | /api/sim/attempts/{id}/reviews | source가 표시된 평가 입력 |
| GET | /api/sim/compare?ids= | 동일 사건의 조건·결정·결과 비교 |
| POST | /api/sim/policies/revisions | 새 policy + 변경 이유 |
| GET | /api/sim/attempts/{id}/export | 공개/내부 프로파일별 내보내기 |

명령에 commandId를 요구해 중복 클릭/재연결을 멱등 처리한다. 데이터 수정 요청은 baseRevision을 받아 stale write를 거절한다. 타임라인 seek는 기록된 snapshot 재생; 실행 중 과거 seek와 미래 계산을 혼합하지 않는다.

## 8. 저장 설계

SQLite 테이블: sources, evidence_cards, persona_revisions, policy_revisions, scenario_decks, attempts, events, observations, reservations, checkpoints, llm_calls, reviews, findings.

- attempts: parent_id, parent_seq, input_hashes, seed, model_config_hash, engine_version, code_commit, status
- events: run_id+seq PK, sim_time_ms, type, actor, request_id, causation_id, correlation_id, visibility, payload
- llm_calls: prompt_hash, model_id, provider/version, generation settings, input refs, response, validation, latency, token usage, status
- reviews: source, reviewer_id, actor_id, experienced_event_ids, dimensions, unknowns, evidence_refs
- findings: observation, alternative explanations, proposed patch, accepted_by, next_check

단순 localStorage에 모든 연구 결과를 맡기지 않는다. 개인 응답·의료정보는 로컬 저장하고 공개 내보내기에서 식별 정보·원문·정확한 좌표를 선택적으로 제거한다. 공개 데이터를 위한 권한/동의는 별도 관리한다.

## 9. 비용·재현·장애 설계

1일 이벤트 수를 80개 agent reaction, 12개 daily review, 20개 MEDial decision으로 가정하면 약 112회 호출/실행이다. 이것은 비용 산정을 위한 개발 가정이다. 실제 단가는 선택한 모델의 현재 가격으로 구현 시 계산한다.

- 12명×매초 호출 금지.
- 정책 비교용 동일 관측의 캐시는 actor·persona revision·policy-visible context·model·prompt hash를 모두 키로 포함.
- 공유 캐시가 실행 간 기억을 섞지 않게 함.
- max model calls/tokens/wall time budget으로 자동 일시정지; completed로 표시하지 않음.
- API 키 없음: scripted mode를 명시해 실행.
- API 실패: 보류/재시도/연구자 결정. 주민이 거절했다고 기록하지 않음.
- 중단 후 event seq에서 복구. 응답은 받았으나 commit 전 중단된 경우 중복 수행 방지.
- 첫 버전은 로컬 단일 사용자. 실제 119/보건소 전송 adapter는 만들지 않음.

## 10. 가장 먼저 코딩할 세로 흐름

P1 무응답:
import source → baseline schedule → pending contact at 09:30 → device no_response → limited MEDial observation → rule policy A/B → request/visit/defer events → schedule change → map positions → metrics/trace → attempt compare.

그다음 P3+P9:
conditional acceptance → vehicle reservation → route extension → second request conflict → arrival/handoff → return to baseline.

화면 개선보다 위 두 흐름의 상태 일관성을 먼저 통과시킨다.
