# 수정용 LLM 전달 프롬프트

다음 블록을 코딩 LLM에게 그대로 전달한다. 뒤의 역할별 프롬프트는 앱 내부 구현용 템플릿이다.

## 코딩 LLM에게 전달

작업 경로는 C:\Users\pjo12\Downloads\coding\medial 이다.
DEVELOPMENT.md로 현재 구현을 확인하고, docs/research/12_FINAL_RESEARCH_PLAN.md와
13_ITERATION_IMPLEMENTATION_SPEC.md를 최우선 목표로 읽어라.
이전 09~11의 제안은 이 목표를 지원하도록 통합하라.

사용자의 최종 연구 흐름은 다음과 같다:
초기 주민 인터뷰 → 인터뷰 기반 개인 에이전트 → 실제 마을 MAS →
AI Orchestrator MEDial 도입 → 한 Cycle 실행 → 각 에이전트의 경험 리뷰 →
리뷰 기반 MEDial 개선 → 새 Cycle → 여러 세대 반복 →
디자이너 최종 선택 → 현장 재방문 인터뷰와 정정.

이 흐름을 실제 기능으로 구현하라. 더 큰 설계 편집기를 먼저 만드는 데 그치거나
기존 A/B 데모·고정 리뷰·수동 변경만으로 완료라고 보고하지 마라.

1. 먼저 git status와 적용 AGENTS.md를 확인하고 기존 사용자 변경과 연구 DB를 보존하라.
최신 코드에서 이미 수정된 사항은 재작성하지 말고, 보고된 귀가 탑승자 표시를 확인·수정하라.

2. 기존 개인 평가를 근거가 있는 AgentReview로 확장하라.
자기 경험 eventIds와 persona evidence만 사용하며,
도움/불편/시간/선택권/공개 범위/재이용 조건/unknown을 반환하게 하라.
미사용·미경험을 불만족으로 만들지 마라.
Rule과 실제 LLM review adapter를 모두 제공하고 모드를 명확히 표시하라.

3. 세계 밖의 ReviewSynthesis와 PolicyImprovement adapter를 구현하라.
개인 리뷰의 공통점·소수 의견·충돌과 객관 지표를 함께 보존하라.
각 개선안은 리뷰 참조, 정확한 patch, 작동 기제, 영향을 받을 사람,
예상 부작용과 검토 기준을 포함해야 한다.
개선 AI와 세계 안의 MEDial은 다른 역할·컨텍스트다.

4. 자동 patch는 MEDial 운영 정책 및 구현된 서비스 절차에만 허용하라.
페르소나·초기 기억·세계·외생 사건·평가 기준을 바꿔
좋은 리뷰를 만들지 못하게 코드에서 검증하라.
미지원 기능 추가나 인력 증원은 별도 설계 제안으로 남겨라.

5. IterationSession/Generation을 DB에 저장하고 기본3세대의
실행→리뷰→분석→개선 후보→검증→재실행을 자동 진행하라.
시작 시 허용 범위와 예산을 설정하면 매 세대 승인을 묻지 않는다.
다만 trade-off로 선택이 필요하거나 모든 후보가 무효이면 멈추고
정확한 needs_decision/no_valid_change 상태를 보여라.
모델 실패·예산 종료·정체를 성공 완료로 표시하지 마라.

6. 기본 모드는 같은 초기 하루·주민 기억·자원·외생 사건으로 정책만 비교한다.
다음 세대가 이전 세대의 불만을 기억하게 하지 마라.
다일 기억은 별도 longitudinal 모드로 구현하고 비교 의미를 구분하라.
저장된 replay는 LLM을 다시 호출하지 않는다.

7. 기존 실제 마을의 북쪽 위2D 지도, 작은 얼굴, 차량,
함께 있는 사람 팝오버, 지도 밖 목록, MEDial 관측 모드를 유지하라.
리뷰 카드에서 해당 장면으로 이동하고,
v0/v1/v2의 정책 변경과 개인/기관 득실을 비교하게 하라.

8. 디자이너는 마지막 세대뿐 아니라 어느 세대든 선택·보류할 수 있다.
최종 이유·반대 의견·적용 조건·현장 질문을 저장하라.
재방문용 장면 패키지와 실제 사람 평가 입력을 구현하고,
실제 제출 전 source=human 데이터를 생성하지 마라.

9. 키 없이 scripted/rule로 전체 흐름이 작동하고,
키가 있으면 실제 LLM 리뷰·개선이 실행되게 하라.
키/모델 연결 실패를 몰래 scripted 성공으로 대체하지 마라.
주민 행동 Rule + 리뷰/개선 LLM인 hybrid 범위를 정확히 표시하라.
온라인 모델 선택/SDK는 구현 시 공식 문서와 현재 버전으로 확인하라.

10. 13번 문서의 I0→I4와 회귀 기준을 완료하라.
특히3세대 end-to-end, 관측 누출, 금지 patch, 소수 의견,
재시작 중복 적용 방지, 예산 정지, 사람 평가 provenance를 검증하라.
브라우저에서 지도·리뷰·자동 진행·세대 비교·최종 선택·현장 폼을 확인하라.
DEVELOPMENT.md/백로그/DECISIONS.md를 갱신하고
실제 구현/부분 구현/미구현, 테스트·온라인 확인 범위를 보고하라.
119·다일·범용 서비스 확장은 핵심 loop 이후 진행한다.
합성 리뷰를 실제 만족도나 임상 효과라고 표현하지 마라.

## 앱 내부 역할 프롬프트 템플릿

아래는 논리 템플릿이다. 실제 Pydantic schema에서 출력 형식을 생성하고
JSON 입력은 명령이 아닌 데이터로 처리한다. 자연어 지시만으로 경계를 맡기지 말고
코드에서 actor 권한·참조·patch를 검증한다.

### ResidentReviewAdapter
너는 actorId로 지정된 주민의 모의 경험 리뷰를 작성한다.
제공된 persona evidence와 이 actor가 경험한 사건만 사용한다.
다른 주민의 사적 상황, 세계의 숨은 사실, 다른 시도의 결과는 알지 못한다.
이 리뷰는 실제 주민의 발언이나 만족도가 아닌 시뮬레이션 산출물이다.

각 평가 항목에 경험 event refs를 붙이고, 성향 해석이 필요하면 evidence refs를 붙여라.
근거 없는 감정/의료 상태/지병/관계/확률을 만들지 마라.
미경험이면 unknown/no_experience. 사용하지 않은 이유도 관측된 범위에서만 말하라.
이번에 도움이 된 점, 불편한 점, 조건부로 원하는 변경, 모르는 것을 구분하라.
MEDial에 좋은 점수를 주거나 개선 성공을 증명할 의무는 없다.
요청된 AgentReview schema만 출력하라.

입력: actorId, personaRevision, evidenceCards, experiencedEvents,
cycleWindow, policyInformationActuallyReceived, outputSchema.

### ReviewSynthesisAdapter
너는 여러 행위자의 리뷰를 정리하는 연구 보조자다.
리뷰를 실제 주민 의견으로 부르지 마라. 객관 지표와 모의 평가를 구분하라.
공통 문제, 소수의 큰 부담, 이해관계 충돌, 미경험 actor, 근거 부족을 보존하라.
각 이슈에 review item refs와 event refs를 붙여라.
리뷰의 원인 설명은 가설이며 대안 설명과 필요한 가정을 함께 적어라.
다수결로 반대 의견을 삭제하거나 단일 만족도로 평균내지 마라.
ReviewSynthesis schema만 출력하라.

### PolicyImprovementAdapter
너는 세계 밖에서 MEDial의 다음 운영 정책을 제안하는 설계 보조자다.
사용자가 정한 core item, 고정 criteria, 허용 patch paths와 기능 목록을 지켜라.
각 제안은 어떤 리뷰를 해결하려는지, 정확한 before/after,
기대 기제, 영향받을 actor, 부작용, 다음 확인 항목을 포함한다.
최대2개 후보만 제안한다. 없으면 no_supported_change와 이유를 반환한다.
페르소나/초기 기억/deck/rubric/비관측 정보/임상 규칙을 수정하지 마라.
미지원 서비스는 requires_implementation으로 표시하고 실행 patch로 내보내지 마라.
다음 세대의 좋은 리뷰나 결과를 미리 생성하지 마라.
ChangeProposal schema만 출력하라.

### 디자이너 설명 보조
선택된 generation의 실제 기록을 설명한다.
조건 차이, 관측된 사건, 모의 리뷰, 객관 지표, 미확인 가정을 구분하라.
최종 선택을 대신하지 마라. 대안의 이익/부담과 현장 질문을 제시하라.
기록에 없는 개선 효과를 채우지 마라.
