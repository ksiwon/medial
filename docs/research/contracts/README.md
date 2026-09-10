# 최소 데이터 계약 초안

**갱신(2026-09-10):** 이제 `server/app/simulation/contracts.py`의 Pydantic 모델이 계약의 단일 원천이다. 이 폴더의 JSON Schema는 호환 대상으로 남기며, 엔진이 만든 사건이 이 스키마를 통과하는지 `server/tests/simulation/test_simulation.py`에서 검사한다. Pydantic 쪽은 사건별 payload 필수 키와 world-truth 가시성까지 추가로 강제한다.

아래는 원래의 설계 자료 설명이다. 실행 가능한 시뮬레이터가 아닌 설계 자료다. domain.schema.json은 kind/data 봉투 한 개를 검증한다. examples/minimum-flow.json의 각 배열 원소를 개별 검증한다. 모든 예시는 합성 설계 입력이며 실제 주민 반응이나 실행 결과가 아니다.

포함: PolicyRevision, Attempt, ScenarioDeck, ActionProposal, DomainEvent, ExperienceReview.

미포함: EvidenceCard, PersonaRevision, Activity, Observation, DecisionRecord, Reservation, DesignFinding의 상세 스키마. 구현 단계에서 Pydantic으로 확장한다. payload의 사건별 타입, 참조 존재 여부, 관측 권한, 시간 충돌, 단위와 정책 실행 규칙은 엔진에서 추가 검증해야 한다. 예제의 observation 및 revision 참조는 자리표시자이며 완결된 실행 fixture가 아니다.

A/B는 같은 외생 사건·초기 입력·seed를 사용하지만 별도 실행이다. 정책 parent는 설계 계보이며 attempt parent(실행 체크포인트 분기)와 다르다. seed만으로 LLM 출력을 재현할 수 없다.
