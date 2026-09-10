# MEDial 구현 지시서: 주민 리뷰 기반 자동 반복

최우선 사용자 기획: [12_FINAL_RESEARCH_PLAN.md](12_FINAL_RESEARCH_PLAN.md).
현재 구현 사실은 DEVELOPMENT.md. 이전 09~11의 큰 서비스 편집기는 본 반복 흐름의 확장 기능이며 첫 구현의 선행 조건으로 전체 구현하지 않는다.
이 문서는 요구사항이다. 아래 API/객체는 제안이며 이미 동작한다는 뜻이 아니다.

## 1. 첫 구현 목표
기존 P9 이동 지원 및 P1 안부 확인 엔진을 재사용해, 한 화면에서
v0 실행→개인 리뷰→종합→정책 patch→v1 실행→다음 리뷰→v2→디자이너 선택을 완성한다.
장식용 리뷰, 고정된 성공 스토리, 모든 세대가 자동으로 좋아지는 연출은 금지.
실제 LLM 역할 어댑터를 구현하되 키 없이도 deterministic scripted adapter로 전 흐름을 검증한다.
처음에는 하루, v0 포함3세대, 개발 deck2개, 별도 합성 검토 deck을 사용. 수치는 설정 가능하며 연구 가정이다.

## 2. 먼저 확인할 코드
git status와 적용 AGENTS.md 확인. 기존 변경·local-data·local-archive 보존.
현재 simulation의 contracts, engine, service, persistence, personas/agents, metrics, policies,
API, UI store/Review/Compare/Findings 구현을 찾아 중복 모델 대신 확장.
이전 리뷰에 있던 재시작 ID 오류 등은 최신 코드가 수정됐을 수 있으므로 실제 상태를 확인하고 과거 오류를 무조건 재수정하지 말 것.
귀가 탑승자 표시와 사건·예약 일치를 먼저 수정/검증.

## 3. 데이터 계약

IterationSession:
id, briefRevision, coreItem, initialSnapshotRef/hash, personaRevision, world/resourceRevision,
developmentDeckRefs, evaluationDeckRefs, criteriaRevision,
mode=controlled_iteration|longitudinal, control=bounded_auto|manual,
maxGenerations, maxCandidatesPerGeneration, call/token/timeBudgets,
allowedPatchPaths, selectionRule, status, stopReason, createdAt.

Generation:
id, sessionId, index, parentGenerationId, policyRevisionId, attemptIds,
reviewIds, synthesisId, proposalIds, comparisonId, outcome, selectedBy, selectionReason.
여러 후보가 있으면 branch 기록을 보존. 선택되지 않은 후보도 삭제하지 않는다.

AgentReview:
개인별 경험 이벤트·근거 카드·source/adapter·모델 설정·차원별 평가·요청 변경·unknown.
초기 ExperienceReview와 호환 가능하되 rule/LLM/human 출처를 구분.
리뷰를 당시 주민 발화로 이벤트 로그에 삽입하지 말 것. Cycle 이후 회고 산출물이다.

ReviewSynthesis:
issueGroups, minorityConcerns, conflicts, objectiveMetricRefs, assumedMechanisms,
alternativeExplanations, ungroundedClaims, nextQuestions.

ChangeProposal:
id, generationId, reviewItemRefs, mechanism, patch[{op,path,before,after}],
expectedEffects, possibleRegressions, assumptionRefs, affectedActors,
requiredCapabilities, validationStatus, selectionStatus.
patch의 before는 baseRevision과 일치해야 한다. 적용 시 정책 새 revision.

FieldReview / HumanReview:
reviewerRole, relationshipToActor, selectedEpisodeIds,
elicitation=pre_simulation_response|after_simulation_response|concept_review|actual_use,
responses, corrections, consentScope, source=human, submittedAt.
사람이 실제 제출한 것만 human이다. 인터뷰 참여자가 답한 것과 연구자가 정리한 해석도 구분.

Decision:
designerId/role, chosenGenerationOrNone, alternativesConsidered, reasons,
supportedConditions, tradeoffs, dissent, unansweredQuestions, fieldReviewPackageId.

DB는 insert-only 버전/계보를 보존한다. 세대와 호출/patch 기록은 프로세스 재시작에도 복구한다.
기존 단순 Attempt 저장만으로 전체 iteration 상태를 메모리에 두지 말 것.

## 4. 실행 상태 머신
created → running_cycle → collecting_reviews → synthesizing →
proposing_changes → validating_changes → evaluating_candidates →
selecting_next → running_cycle ...
종료: ready_for_designer, needs_decision, budget_exhausted, no_valid_change,
stalled, paused, failed, cancelled.
ready_for_designer는 의료 서비스 검증 완료가 아니다.

명령: start/pause/resume/cancel, select_proposal, accept_final/hold.
동일 commandId는 멱등, 다른 payload 충돌. 상태 전이와 결과 참조를 원자 저장.
외부 모델 호출은 long transaction 밖에서 수행하고 callId/idempotency와 validated result를 저장해 재시작 시 중복 적용을 막는다.
중단된 LLM 호출은 모델 장애이며 주민의 거절/평가 unknown과 구분한다.
예산 종료 때 진행 중인 결과·완료 세대는 보존하고 완료로 위장하지 않는다.

## 5. 행동/리뷰/개선/검증의 권한

ResidentActionAdapter: 현재 관측·개인 근거·약속→허용 행동.
ResidentReviewAdapter: 종료된 자기 경험·근거→AgentReview.
InstitutionReviewAdapter: 자기 접수/업무·관측→기관 리뷰.
ReviewSynthesisAdapter: 여러 리뷰+연구자 객관 지표→충돌을 보존한 이슈.
PolicyImprovementAdapter: 이슈+현재 정책+허용 기능→typed ChangeProposal.
PatchValidator: 코드 기반. model verdict만으로 통과시키지 않음.
CandidateSelector: 사전 기준+객관 지표+리뷰 이슈, unknown/trade-off 분리.
Designer: 최종 선택.

최소 구현에서 adapter는 한 provider를 공유해도 된다. 역할별 prompt/context/schema/version/log는 분리한다.
기존 Rule 동작과 LLM 동작의 실제 반영 범위를 UI에 각각 표시한다.
'주민 행동은 Rule, 리뷰/개선만 LLM'도 유효한 hybrid 모드지만 전체 주민 판단이 LLM이라고 쓰지 말 것.

## 6. 검증 규칙
- 리뷰 event refs는 actor의 실제 경험 집합의 부분집합이며 해당 Cycle 종료 이전 사건이어야 함.
- evidence refs는 해당 persona revision의 카드만. 다른 주민 사적 정보를 조회하지 않음.
- 모든 actor에게 리뷰를 생성하되 미경험은 no_experience/unknown.
- 리뷰는 반환된 문장으로 타인의 내면을 확정하지 않음.
- synthesis는 의견 충돌과 affectedActors를 보존. 다수만 남기지 않음.
- patch는 allowlist, type/range, before value, baseRevision, handler 지원 여부 검사.
- 데이터/기억/평가 기준/deck/resource 추가는 policy patch로 수정 불가.
- 정책이 hidden location·미래 event를 참조하면 거부.
- 모든 후보의 실행 입력 hash 비교. 정책 이외 변경이 있으면 controlled=false.
- 선호 지표의 방향/기준은 iteration 시작 때 고정. 변경 요청은 새 criteria/session.
- 평가 deck은 개선 adapter prompt에 들어가지 않음. 보고서를 보고 다시 튜닝하면 해당 deck을 더 이상 미사용으로 표시하지 않음.
- 반복 patch hash/정책 순환 감지. 자동 반복 정지 이유 저장.
- 마지막 세대나 highest synthetic satisfaction을 자동 정답으로 선택하지 않음.

## 7. 모델 연결과 비용
키는 서버 환경에서만 읽고 frontend/로그/문서에 노출하지 않음.
provider-neutral JSON schema 출력·validation·제한 재시도·timeout·call budget.
요청/응답 content hash, provider/model id, prompt version, generation settings,
input refs, token usage, latency, validation, error를 기록한다. private 전문은 공개 export에서 제외.
실행 전 예상 호출 개수는 계획값으로 표시하고 실제 사용량을 별도 집계.
키 없음은 명시적 offline demo. 온라인 설정에 실패했는데 몰래 scripted 성공으로 대체하지 않는다.
선택 모델/공식 SDK를 실제 구현할 때 현재 공식 문서와 설치 버전을 확인한다.

## 8. 기본 자동 선택
사전 지정된 필수 조건을 깨는 후보는 제외한다.
정량 기준에 대한 Pareto 비교는 unknown이 있는 차원을 우세 증거로 취급하지 않는다.
명확히 하나만 비지배 후보라면 bounded_auto에서 다음 세대로 진행 가능.
여러 후보 trade-off이거나 리뷰와 객관 지표가 충돌하면 needs_decision. 사용자 사전 우선순위가 있으면 그것에 따라 선택하고 근거를 기록.
동일하거나 새 발견이 없는 반복은 stalled. 설정된 최대 세대까지 무조건 같은 patch를 실행하지 않는다.
디자이너는 모든 기록을 보고 final 선택/보류 가능. 중간 세대 선택도 가능.

## 9. UI acceptance
A. 연구 설정: core item, 대상 서비스, 기간, 초기 policy, 자동/수동, 세대/예산/허용 수정.
B. Cycle: 기존 지도/팝오버/차량, world-vs-observation 표시 유지.
C. 리뷰: actor 탭, 사용/미사용, 긍정/불편/조건/unknown, 근거 장면 열기.
D. 개선: 이슈 묶음과 이견, patch 전후 값, 예상 영향, 검증 결과.
E. 세대 비교: v0/v1/v2와 후보 branches, 정책 diff와 동일 입력, 개인/기관 부담 변화.
F. 최종 결정: 선택·보류와 이유, 장면3~5개, 현장 질문.
G. 현장 검토: 실제 입력 폼. 생성 예시 제출을 actual human으로 저장하지 않음.

자동 상태 진행은 사용자에게 단계가 보이며 pause/resume 가능. 반복 진행 중 과거 세대 조회로 실행 상태를 바꾸지 않는다.
오른쪽 상단의 MEDial 운영 상태와 세계 밖 개선 AI 상태는 별도 표시.

## 10. 기관 및 범위 확장
첫 flow에서 기존 담당자 리뷰도 구현해 주민 개선이 기관 부담을 숨기지 않게 한다.
다음 단계로 HC_DIRECTOR의 배정/우선순위·실무자 다건 큐·리뷰를 연결.
119는 EMS_DISPATCH/EMS_CREW의 접수·출동·도착·인계, 실제 기관 전송 없음. 의료 결과를 도착만으로 해결 처리하지 않음.
다일 기억은 별도 모드로 다음 날의 개인 경험/미해결 요청/피로 가정을 이어간다. 가정이 없는 피로·신뢰 점수를 자의 생성하지 않는다.
지원하지 않는 기능은 capability와 UI에 명시. 현재 한정된 서비스의 반복을 완성하는 것이 우선.

## 11. 테스트와 검증 산출물
- scripted synthetic로 v0→review→patch→v1→review→v2→decision 전 흐름.
- 실제 모델 online smoke test는 키/연결이 있을 때 수행하고 횟수·모드를 보고.
- 미경험 actor unknown; 다른 actor/미래 사건 참조 거부.
- 소수 반대 리뷰 보존; 객관 개선/개인 불편 충돌 표시.
- persona/deck/rubric 편집 patch 거부.
- 무효/반복/역행 후보·budget stop·모델 장애 각각 상태 검증.
- restart가 generation/모델 결과/patch를 중복 적용하지 않음.
- controlled iteration에서 초기 기억 동일; longitudinal에서만 기억 지속.
- checkpoint fork와 initial rerun의 prefix/시간 의미 보존.
- human review가 실제 제출 전 존재하지 않음.
- 실제 지도/얼굴/차량 귀가·리뷰 seek·자동 진행·세대 비교·현장 폼 브라우저 확인.
- 전체 기존 회귀 테스트 및 build; 테스트 숫자만 아니라 어떤 실패를 막았는지 보고.
실제 자료가 없어서 skip한 것은 pass와 구분. 합성 검증을 실제 주민 대표성 검증이라고 하지 않음.

## 12. 구현 순서
I0 현재 코드 점검/귀가 표시/기존 회귀 확인.
I1 AgentReview 계약·LLM/Rule review adapter·개인 UI·근거 검증.
I2 synthesis/patch validator/정책 revision 연결·한 번의 개선 실행.
I3 IterationSession 지속 저장·자동3세대·예산·정지·복구·세대 비교.
I4 디자이너 최종 선택·현장 질문 패키지·HumanReview/정정 기록.
I5 기관 역할·다일·추가 서비스 확장.

I1~I4를 끝내야 사용자의 핵심 연구 loop가 연결된다. I5를 했다고 I1~I4 미완성을 덮지 않는다.
개발 단계마다 DEVELOPMENT.md/DECISIONS.md/07_BACKLOG.md를 갱신하되 기획과 구현 사실을 분리한다.
