# Resident Agents as Evaluators — MEDial 연구 초점 기준

상태: **2026-09-14 사용자 확정 방향. 이후 연구·제품·UI 결정의 최우선 기준.**

이 문서는 기존 기획을 폐기하지 않고 연구의 위계를 바로잡고 기능 범위를 줄인다. 연구 방향이
12~18번 문서와 충돌하면 이 문서를 우선한다. 실제 구현 상태는 `DEVELOPMENT.md`, 세부 데이터
계약은 `13_ITERATION_IMPLEMENTATION_SPEC.md`와 코드/테스트를 따른다.

## 1. 제목과 위계

**Title:** Resident Agents as Evaluators  
**Evaluated system:** MEDial — an AI Care Orchestrator
**Subtitle / validation case:** Improving MEDial with a Simulated Rural Village

1. **연구 주제 — Resident Agents as Evaluators**
2. **연구 아티팩트 — Simulated Rural Village**
3. **검증 사례 — Improving MEDial, an AI Care Orchestrator**

의료 AI 자체의 성능이나 범용 사회 시뮬레이션이 중심이 아니다. 인터뷰에 근거한 주민 에이전트가
자신이 실제로 경험한 서비스 사건을 평가하고, 그 평가가 시스템 개선에 쓰일 수 있는지, 실제
주민 평가와 어디서 일치하거나 충돌하는지를 밝히는 것이 핵심이다.

## 2. 연구 한 문장

인터뷰에 근거한 주민 에이전트를 실제 농촌의 관계·일과·공간 안에 배치하고, 이들이 AI Care
Orchestrator를 반복적으로 경험하고 평가하게 함으로써 시스템 개선에 기여할 수 있는지, 그리고
그 평가가 실제 주민의 평가와 어디까지 일치하거나 충돌하는지를 조사한다.

> This research investigates whether interview-grounded resident agents, situated in a simulated
> rural village, can serve as traceable and bounded evaluators of an AI care orchestrator, and how
> their evaluations can support iterative system improvement before returning to residents for
> validation.

## 3. 문제와 연구의 역할

농어촌 고령자 맥락에서는 반복 현장 참여의 부담이 크고, 주민 관계·반복 일과·정보 중개자·긴
이동 거리 때문에 서비스 영향이 개인 인터뷰만으로 드러나지 않을 수 있다. MEDial은 실제 참여를
없애는 대신 **현장 방문 사이**에 다음을 사전 탐색한다.

- 누구에게 어떤 서비스 사건이 발생하는가?
- 도움과 부담이 관계망 안에서 누구에게 전가되는가?
- 어떤 운영 조건이 주민별 경험과 평가를 바꾸는가?
- 어떤 결과는 근거가 부족해 실제 주민에게 다시 물어야 하는가?

## 4. 핵심 연구 루프

```text
실제 주민 인터뷰
  → 근거와 unknown을 가진 Resident Agents
  → 관계·일과·거리로 구성된 Simulated Rural Village
  → MEDial 도입 및 서비스 경험
  → 주민별 Resident-Agent Evaluation
  → 평가 종합과 Orchestrator Revision
  → 같은 조건에서 재실행 및 평가 변화
  → 실제 주민 재방문
  → Human Evaluation과 비교·정정
```

시뮬레이션 애니메이션, 정책 버전, 로그, LLM은 이 루프를 위한 수단이다.

## 5. 연구 질문

- **RQ1 — Evaluation generation:** 주민 에이전트는 서비스를 어떻게 평가하며, 그 평가는 인터뷰
  근거와 경험 사건에 얼마나 충실한가?
- **RQ2 — Design utility:** 주민 평가를 사용하는 것이 로그·집계 지표만 사용하는 것과 비교해
  문제 발견과 개선 방향에 어떤 차이를 만드는가?
- **RQ3 — Human–agent correspondence:** 주민 에이전트와 실제 주민 평가가 어디서 일치하거나
  충돌하며, 그 경계는 어떤 자료·관계·상황에서 나타나는가?
- **RQ4 — Boundary of use:** 주민 에이전트 평가가 실제 참여를 보완할 수 있는 범위와 실제 참여가
  반드시 필요한 범위는 무엇인가?

## 6. 기여 구조

### C1. Resident Agents as Evaluators

주민 에이전트를 발화 생성기나 일반 synthetic user가 아니라, 서비스를 경험한 뒤 경험 사건과
인터뷰 근거를 인용해 평가하는 행위자로 제안한다. 평가에는 경험한 요청·연락·이동·대기·정보
공유, 도움과 미해결, 시간·노동·관계 부담, 선택권·거절·공개 범위, 필요한 변경, unknown이
포함된다.

### C2. Simulated Rural Village as evaluation context

평가는 독립 설문 응답이 아니라 주민 관계, 이장 같은 정보 중개자, 반복 일과, 긴 이동, 차량과
기관 자원, 도움의 편중 속에서 형성된다. 마을은 평가 맥락이지 장식적 시각화가 아니다.

### C3. Evaluation-driven iteration

`경험 → 주민 평가 → 종합 → 운영안 수정 → 재경험 → 평가 변화`를 추적 가능하게 연결한다.
자동 최적화가 아니라 어떤 평가 때문에 무엇이 바뀌었는지를 보존한다.

### C4. Empirical boundary through human validation

재방문에서 agent evaluation과 human evaluation의 agreement, correction, disagreement,
unknown을 기록한다. 인간을 완벽히 흉내 낸다는 주장이 아니라 어떤 평가에서는 유용하고 어디서
실패하는지 밝힌다.

## 7. 최소 연구 프로토타입

기본 사례는 두 개면 충분하다.

1. **무응답 안부 확인** — 주민 관계, 이장의 정보 중개, 연락 순서, 공개 범위, 확인 업무의 전가
2. **의료 이동 지원** — 거리, 기존 일과, 동승 예약, 반복 부탁, 주민 편의와 이웃 부담의 충돌

기본 반복은 `v0 실행 → 주민 평가 → 변경 한두 개 선택 → v1 재실행 → 평가 변화 → 실제 주민
검토`다. 자동 3세대 반복은 연구 조건이나 고급 기능으로 보존할 수 있지만 기본 경험으로 두지
않는다.

## 8. 기능 우선순위

### 기본 경험에 반드시 보일 것

- 탐색 질문과 현재 Orchestrator 운영안
- 주민별로 실제 경험한 핵심 사건
- Resident-Agent Evaluation과 사건/인터뷰 근거
- 공통점, 충돌, 큰 부담, no experience, unknown
- 평가 때문에 바꾼 정확한 운영 조건
- v0/v1에서 달라진 주민별 평가와 객관 사건
- 실제 주민에게 확인할 장면과 질문
- agent와 human 평가의 구분과 정정 기록

### 유지하되 고급·감사 영역으로 내릴 것

- 원시 사건 로그, payload, 해시, JSON pointer, 전체 EvidenceCard
- fork/rerun, 전체 attempt·세대 계보, 수동 DesignFinding
- 모든 정책 파라미터, ResourceRevision, 모델·예산·어댑터 설정
- 사건 단위 재생과 MEDial 관측 디버거

### 연구 질문이 요구하기 전에는 확장하지 않을 것

- 119 전체 프로세스와 복잡한 기관 다건 업무 배분
- 다일 기억, 주민의 완전 자율 행동 LLM, 자유 주민 채팅
- 범용 시나리오·정책 제작기, 자동 최적안 선정, 임의 종합 점수
- 장식적 3D, 고급 GIS, WebSocket, 범용 공개 플랫폼 기능

## 9. UI 정보 구조

1. **Village Scenario** — Orchestrator가 작동하고 누구에게 어떤 일이 생겼는지 본다.
2. **Resident Evaluations** — 주민별 경험, 평가, requested change, 근거, unknown을 읽는다.
3. **Improve & Validate** — 평가로 인한 수정, 전후 평가 변화, 실제 주민 검토를 연결한다.

`Resident Evaluations`가 중심 화면이다. 지도는 서비스 경험의 관계·공간 맥락과 근거 장면을
이해하는 도구이며 평가 읽기보다 큰 우선순위를 갖지 않는다. 기본 화면에서는 Cycle/Attempt/
Generation/Revision 같은 내부 용어를 최소화한다.

## 10. 검증 계획

### 평가의 근거성과 경계

- 각 평가가 본인이 경험한 사건과 허용된 인터뷰 근거만 인용하는가?
- 자료가 없는 경우 unknown/abstain 하는가?
- 다른 주민의 사적 사건이나 세계 전용 정보를 사용하지 않는가?

### 평가가 설계에 주는 효과

같은 시나리오에서 `사건 로그·집계 지표만 제공` 조건과 `주민 에이전트 평가와 근거를 추가 제공`
조건을 비교한다. 발견 수보다 구체성, 관계·부담·소수 의견 포착, 변경 이유의 추적성, 새 현장
질문의 질을 본다.

### 실제 주민 재방문

1. 장면과 운영 조건 설명
2. 실제 주민의 예상 행동·평가를 먼저 질문
3. 에이전트 평가 공개
4. agreement/correction/disagreement/unknown과 이유 기록
5. 페르소나 근거와 Orchestrator 운영안 중 무엇을 고칠지 분리

### 형성적 UI 평가

연구자가 도움 없이 주민의 핵심 경험, 평가와 근거, v0/v1 변경 이유, 부담이 늘어난 사람과
unknown을 찾고 실제 주민에게 확인할 질문을 만들 수 있어야 한다.

## 11. 주장 경계와 용어

사용할 표현:

- support or augment iterative design between field engagements
- repeated simulated service episodes / longitudinal design iteration
- human–agent evaluation correspondence
- evaluation boundary and failure conditions

피할 표현:

- replace residents or human participants
- validate real resident satisfaction / predict actual policy outcomes
- prove clinical effectiveness
- longitudinal study — 실제 사람을 시간에 따라 연구하지 않은 경우
- representative digital twins — 별도 검증 없이

권장 방법 표현:

> A method for evaluating and iteratively designing AI-mediated rural care services.

핵심 질문:

> Can resident agents evaluate a service on behalf of—not instead of—the people they were grounded
> in, sufficiently well to support iterative design before the next field engagement?

## 12. 이후 기능 결정 체크

1. 어느 RQ와 기여를 직접 지원하는가?
2. 평가를 더 타당하게 만드는가, 시뮬레이션을 더 화려하게만 만드는가?
3. 어떤 인터뷰 근거와 경험 사건으로 검증할 수 있는가?
4. 실제 주민이 나중에 확인·반박·정정할 수 있는가?
5. 제거해도 평가→수정→재평가→현장 확인이 가능한가?

5번이 가능하면 기본 UI에서는 제거하거나 고급 영역으로 내린다.
