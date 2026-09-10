# MEDial 후속 구현과 사용자 연구 계획

2026-09-10 · 제안. [제품 흐름](10_DESIGN_POLICY_STUDIO.md), [문헌](09_DESIGN_POLICY_REFERENCES.md)을 함께 읽는다.
새 코드를 구현한 문서가 아니다. 최신 DEVELOPMENT.md가 현재 구현의 기준이다.

## 1. 추가 모델: 현재 Attempt/PolicyRevision/DesignFinding 위에 얹는다

| 객체 | 최소 필드 | 중요한 제약 |
|---|---|---|
| DesignBrief | id, revision, parent, coreItem, problemFrame, targetActors, openQuestions | 문제 정의가 바뀌면 새 revision |
| ServiceBlueprint | id, revision, briefId, steps, transitions, mechanismClaims | 지원하는 단계만 실행 가능 |
| BlueprintStep | type, actorRole, requiredObservations, consentRequirement, resourceType, completionEvent, failureTransition | 존재하지 않는 정보/역할/엔진 기능을 조용히 생성하지 않음 |
| MechanismClaim | intervention, proposedMechanism, nearOutcome, longOutcome, evidenceRefs, status | 가설과 실증 결과 분리 |
| AssumptionSet | revision, fields[path,value/range,source,status,owner], conflictRefs | policy choice와 world assumption 분리 |
| CriteriaRevision | ownerRole, metricId, threshold/direction, reason, status | 의료 기준 아닌 연구자/운영자 판단 기준임을 표시 |
| ExperimentMatrix | briefRevision, blueprintIds, axes, fixedHashes, cells, replicatePlan, budget | seed 동일만으로 통제 비교 판정 금지 |
| HumanReview | reviewerRole, actorRelationship, targetEpisode, agreement, correction, scope, consent, source | 실제 제출만 source=human. 모의 평가와 저장 경로 분리 |
| EvidenceRevision | sourceRefs, reviewRefs, changedClaims, acceptedBy, supersedes | 예전 persona와 시도는 불변 |
| DecisionBrief | chosenAlternativeOrDeferred, supportedConditions, tradeoffs, dissent, openQuestions, attemptRefs | 정책 최종승인을 자동으로 생성하지 않음 |

이름은 예시다. 기존 모델 중복을 만들기 전에 현재 코드를 확인한다. Pydantic→OpenAPI→TS 생성은 계약이 커지는 시점에 우선 적용한다.

## 2. 서비스 흐름 실행

초기 step library:
receive_need, ask_clarification, request_consent, propose_helper, check_availability,
reserve_transport, request_institution_review, schedule_callback, confirm_completion,
record_unresolved.

Blueprint compiler가 registry의 step handler와 resource type을 확인한다. 결과는 엔진이 이해하는 실행 계획이다. 인터페이스만 있고 handler가 없는 단계는 '설계 가능/실행 미지원'으로 표시한다.
LLM은 자연어를 이 구조의 초안으로 바꾸는 adapter다. 사람이 검토한 구조만 simulation에 투입한다.
관측·일정·예약을 바꾸는 것은 기존 엔진이며 LLM 출력 코드 eval은 쓰지 않는다.
역할 정책은 누가 제안/동의/거절/승인/수행 가능한지 분리한다. 보건소장과 직원의 책임 차이가 시간·인계에 반영돼야 한다.

UI의 '빠르게 다시 보기'는 저장 로그 replay다. '정책을 바꿔 다시 실행'은 새 rerun이다. '지금 사람으로 응답하기'는 인간 개입 fork다.

## 3. 구현 범위가 있는 Batch

18개 rule 조합을 첫 acceptance fixture로 사용한다. 3개 서비스 handler가 아직 없으면 우선2개×3개×2개=12개로 시작하고 지원 범위를 표시한다.
각 셀은 immutable input refs를 가진 독립 Attempt. queued/running/failed/cancelled/completed를 저장하고 실패한 셀을 삭제하지 않는다.
안정적인 exogenous event id를 기준으로 정책을 비교한다. 재현은 저장된 로그를 읽는 것과 새로운 모델 호출을 하는 것을 구분한다.
병렬 실행의 결과 순서는 UI 정렬만이며 공유 persona memory를 사용하지 않는다.
결정적 rule에는 불필요한 replicate가 없고, LLM은 모델·prompt·sampling·response trace를 기록한다.
cost/call budget에 도달하면 partial로 표시한다. 예산 때문에 몇 셀만 실행된 결과를 전체 결과처럼 보여 주지 않는다.
행렬의 통과 수는 입력 격자의 coverage이며 모집단 추정치가 아니다.

## 4. 실제 사람 평가와 모델 정정

기관/주민의 정정은 세 가지로 나눈다.
- 사실 정정: '이 시간에 순찰하지 않는다' → 근거/일과 revision 검토.
- 선호 조건: '전날 요청이면 가능하다' → 특정 상황의 행동 가설. 보편 확률로 자동 변환 금지.
- 가치 이견: '빨리 확인하는 것보다 목적 비공개가 중요하다' → criteria revision/의견으로 보존.

같은 사람의 피드백을 학습에 반영한 뒤 같은 문항으로만 개선을 평가하지 않는다. 미사용 상황을 따로 둔다.
공동 인터뷰 여부나 인터뷰 부재에 일괄 점수를 부여했다고 행동 정확도가 보증되는 것은 아니다. confidence는 수집 상태/주장 근거에 대한 주석이며 검증된 확률이 아님을 명시한다.
실제 참여자가 자신의 관점이 잘못 표현됐다고 표시할 권한과 채택/미채택 이유를 제공한다.
현재 포함된12명 밖 가족/생활지원사/다른 주민이 필요한 경우 unknown external actor로 표시하고 실제 마을 전체가 모델링됐다고 주장하지 않는다.

## 5. 사용자 연구: 무엇이 유용해졌는가

RQ1: 서비스 기제 편집과 장면 비교가 디자이너의 문제 재정의와 대안 탐색을 돕는가?
RQ2: 정책 담당자가 행위자별 부담과 불확실한 가정이 만드는 선택의 변화를 설명할 수 있는가?
RQ3: 실제 이해관계자의 정정이 어떤 모델 가정과 운영안 변경으로 이어지는가?
RQ4: LLM이 필요한 곳에서 제공하는 유연성이 오류·근거 검토 부담보다 가치 있는가?

### 단계 A — 형성적 설계
제안 모집: 디자이너4~6명, 지역 운영/보건 실무자3~5명. 가능하면 주민·이장을 별도 소규모 세션으로 포함. 표본수는 모집 가능성을 고려한 제안이며 검정력 산출 아님.
실제 기존 업무를 이야기하게 하고 어떤 결정을 이 도구에서 내릴 수 있는지/없는지 확인한다.
'이 기능 좋나'보다 마지막 작성한 운영안·포기한 대안·확인하고 싶은 질문을 수집한다.

### 단계 B — 도구 사용 비교
두 가지 질문을 한 연구에서 혼동하지 않는다.
- UI 효과: 같은 엔진·자료·시나리오를 사용하고 기준 조건은 현행 파라미터/로그/비교, 개선 조건은 기제 편집+가정 행렬+근거 연결.
- LLM 효과: UI를 고정하고 Rule/LLM/사람 scripted 응답을 구분해 비교. 앞 연구와 분리하거나 추가 요인임을 명시.

이동 지원과 안부 확인을 난도가 유사한 과제로 구성하고 순서를 교차 배정한다. 처음 본 정답 없는 문제에서 설계 기회와 검토 부담을 평가한다.
정식 표본 크기는 형성적 파일럿에서 분산·효과 크기·설계 구조를 확인한 뒤 정한다. 작은 파일럿에서 유의성이 없다는 이유로 무효과를 주장하지 않는다.

### 주요 측정
- 생성한 대안의 '기제상 차이': 이름/간격만 다른 변형과 역할·접점·순서가 다른 변형 구분.
- 근거 연결 발견: 참조 사건, 명시된 가정, 대안 설명, 다음 확인 질문의 완결성.
- 문제 재정의: 사용 전/후 문제 카드의 실제 변경과 설명.
- 시스템 이해: 새로운 미사용 상황에서 누가 무엇을 알고 부담을 지는지 설명하는 능력.
- 불확실성 이해: 모의 수치와 실제 효과를 구분하고 어떤 가정에서 결론이 뒤집히는지 말할 수 있는가.
- 협업: 주민/기관의 이견이 삭제되지 않고 설계에 반영됐는가, 누가 수정 권한을 행사했는가.
- 부담: 도구 학습/로그 검토에 걸리는 시간, 막힘, 과도한 자동 제안 검토량.
사용 만족도/사용 의향은 보조 지표다. 시뮬레이션 횟수 증가만으로 유용성을 주장하지 않는다.

설계 산출물은 조건 정보를 가린 평가자 두 명이 명시된 rubric으로 평가하고 불일치를 조정한다. 질적 분석과 실제 수정 계보를 함께 제시한다.
'좋은 정책의 정답'을 모델이 정해서 참가자를 채점하지 않는다.

### 단계 C — 현장 공동 검토
하나의 실제 서비스 아이디어로 디자이너·기관 담당자·주민의 순차 검토를 실시한다. 반복된 의견이 어떻게 model revision과 운영안에 들어갔는지 사례 추적한다.
연구용 도구가 의사결정에 도움을 줬다는 주장과 실제 의료 성과가 개선됐다는 주장은 별개다. 후자는 이 연구만으로 입증하지 않는다.

## 6. 다음 수정용 LLM에게 줄 작업 범위

DEVELOPMENT.md 및 09~11 문서를 읽고 S0→S1의 작은 흐름부터 구현하라.
- 보고된 귀가 탑승자 표시를 실제 코드로 확인하고 테스트·UI를 일치시켜라.
- 현재 정책/발견/revision 구현을 보존하고 DesignBrief/ServiceBlueprint/AssumptionSet을 확장하라.
- 이동 지원의 '즉석 동승 부탁'과 '사전 가능 시간 공유' 두 기제를 지원하라. 사전 공유는 실제 자료가 아닌 실험 기능 가정으로 표시하라.
- 설계 단계에서 어떤 actor가 어떤 동의·정보·자원으로 작동하는지 편집할 수 있게 하라.
- 기존 일과와 가용 시간 예약, 미해결 요청, 동승 귀가까지 실제 사건을 연결하라.
- 같은 초기 상황에서 두 기제의 조건/결정/결과를 기존 비교에 보여라.
- 새 템플릿이 엔진 미지원이면 실행 가능한 것처럼 표시하지 마라.
- 기존 실제 지도·얼굴·그룹 팝오버·관측 모드를 유지하라.
- 합성 fixture 테스트와 브라우저 확인, 구현/미구현 문서화를 하라.
보건소 다건 모델과 행렬/사람 평가를 동시에 전부 만들지 말고 첫 설계 세션을 할 수 있는 작은 흐름을 완성하라.
