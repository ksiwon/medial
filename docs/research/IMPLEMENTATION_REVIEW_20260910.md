# MEDial 구현 검토 — 2026-09-10

## 검토 범위와 검증
실제 저장소의 신규/기존 진입점, importer, engine, service, persistence, observations, rule adapters, metrics, API 및 React UI를 읽었다. 기존 테스트를 직접 실행해 35/35 통과했고 npm run build도 통과했다. 별도 임시 SQLite DB/합성 fixture로 추가 재현했으며 실제 연구 DB는 수정하지 않았다. 이번 검토는 코드·실행 검증이며 브라우저 화면의 시각 검수를 새로 수행한 것은 아니다.

실제 로컬 registry로 A/B를 다시 계산했을 때 A 대기 9.9분/주민 과업 19.9분, B 대기 165분/담당자 25분은 보고와 일치했다. 이것은 현 정책·일과·가정 아래의 계산 재현이며 현실 효과의 검증이 아니다.

## 판정
T001~T003의 작은 규칙 기반 흐름은 구현됐다. 모든 대화 요구가 완성된 것은 아니다. 기존 companion은 격리됐지만 제거되지 않았다. 페르소나 JSON 기반 주민 모델, 자유 대화, 보건소장, 119, 다건 자원 예약, 일반적 정책 편집, 발견→변경 반복 도구는 아직 부족하거나 미구현이다.

## 우선 수정

### R01 [높음] 재시작 후 시도 덮어쓰기 — 실행 재현
service.py:29의 itertools.count(1)이 재시작마다 초기화된다. persistence/store.py:127 이후 INSERT OR REPLACE가 이를 덮어쓴다.
임시 DB: A 생성(label=before, seed=17) → 서비스 재시작 → A 생성(label=after, seed=99).
두 ID 모두 att-A-v1-1, 목록 개수 1, 이전 ID의 label이 after로 변했다.
고유 ID와 삽입 전용 불변 저장을 적용하고 충돌 시 명시적으로 실패시킬 것. events/decisions/observations/reviews의 부분 잔존·혼합과 fork 계보도 검사할 것.

### R02 [높음] 분기와 재실행의 의미 불일치 — 실행 재현
service.py:81~129는 parentSeq를 남기지만 run_attempt는 0부터 새 세계를 실행한다.
부모 seq22(34729740ms)에서 분기한 자식은 0ms부터 시작했고 이전 결정까지 바뀌었다.
초기 상태 정책 비교는 유효한 기능이다. 이를 rerun/정책 변형 시도로 명명하고, checkpoint fork와 구분할 것. checkpoint fork를 제공하면 해당 시점 이전 상태·기억·예약·외생 입력·로그 접두부를 보존해야 한다. 구현 전에는 시점 분기처럼 표시하지 말 것.

### R03 [높음] 미응답을 부재·응급 배제로 해석
rule_policies.py:37은 미응답을 '집에 없다'라고 단정하고 :74는 emergencyRuledOut=True.
MedialPanel도 '응급 아님으로 판정'을 표시한다.
미응답만으로 위치나 건강 상태를 알 수 없다. 이 deck에 악화 신호가 없다는 엔진 정보와 MEDial이 관측한 근거를 분리할 것. 분류는 확인 필요/임상 상태 미확인, 자동 응급 분류 근거 없음으로 표현할 것. 테스트 이름과 지표도 '모든 미응답은 비응급' 규칙으로 일반화되지 않게 수정할 것.

### R04 [높음] 관측 경계가 event type 수준에 그침
engine.py:688이 전체 baseline의 장소/시각을 MEDial에 전달하므로 이장만 FARM을 안다는 설명과 다르다. published_availability는 원자료에서 동의를 확인하지 않고 consentScope를 부여한다.
engine.py:302 contact.no_response의 MEDial-visible payload에 세계에서 고른 reachabilityBasis(밭이라 응답 못함)가 실린다. 현재 policy의 Observation 투영은 이를 덜어내지만 visible event/UI 경로에서는 읽힌다.
metrics.py:214는 개인의 경험 이벤트가 아닌 전체 disclosures를 개인 평가 이유에 사용한다.
UI의 MEDial 모드는 이벤트 목록만 필터링하며 SimulationApp.tsx:156의 전체 positions와 :309의 전체 주민 기록은 그대로다.
actor별 공유/보고/관측을 필드 단위로 투영할 것. consent는 verified/assumed/unknown을 구분할 것. 위치 기반 응답 기제 설명은 연구자 전용으로 둘 것. 연구자 전체 지도는 유지 가능하되 MEDial view와 명확히 구분할 것.

### R05 [중간] 한 단계 재생이 같은 시각 사건을 건너뜀
store.ts:204~210은 seq를 시간으로 바꾼 후 seqAt로 재계산한다. 동일 시각 사건이 최대10개인 실제 테스트 실행이 존재한다. 첫 사건 선택이 같은 시각 마지막 사건까지 표시한다.
cursorSeq와 표시 시간을 분리하고 이벤트/결정 필터는 seq를 기준으로 할 것. 슬라이더·처음으로·시도 전환·재시작 커서 복원도 일치시킬 것. 현재 ResidentDetail은 전체 사건과 하루 평가를 초기 시점에도 보여 주므로 회고 보기로 구분하거나 시점 필터를 적용할 것.

### R06 [높음] 일부 정책/자원 필드가 결과에 반영되지 않음
quietWindowMin, escalateToInstitutionAfterMin, disclosure는 선언돼 있으나 정책 실행에서 읽지 않는다. disclosure=minimal로 분기해도 출력 공개가 동일했다. staffCount/shiftStartMs도 실행 로직에서 쓰이지 않는다. UI 분기 버튼은 helperContactCap=0 하나를 고정 적용한다.
노출하는 조건은 실제 기제에 연결하고 미지원 조건은 거부/비활성화할 것. 비교는 정책 전체와 inputHashes를 실제 비교해야 한다. metrics.compare는 입력 동등성 검사 없이 '같은 deck·초기 상태'라고 주장한다.

### R07 [중간] 기관 시간·대기 모델은 단일 사례용
initialQueueDepth×reviewMinutes는 예약을 가진 실대기열이 아니다. 직원 수·근무 시작·동시 업무를 반영하지 않는다.
visitTravelMinutes=25의 설명은 왕복인데 engine은 편도25와 왕복50으로 계산한다. 기관 통화는 시작 시점에 5분 업무를 가산하며 같은 시각 사건을 종결한다.
왕복/편도 단위를 명확히 하고 서비스 시작/완료·시간 예산·근무시간을 일치시킬 것. 기존 165분 결과를 유지하기 위해 논리를 고정하지 말 것.

### R08 [중간] API의 입력 검증과 제안 검증은 아직 최소 수준
contracts.py는 payload 필수 키 존재를 검사하되 값 타입·참조·권한까지 검증하지 않는다. engine._offer 등은 첫 proposal.action 중심으로 처리하고 actorId/attemptId/requestId/관측 근거를 공통 검증하지 않는다.
LLM 연결 전에 typed event payload와 actor/action/관측 근거 참조 검증을 추가할 것. llm.build_prompt_payload는 usedObservationIds를 요구하지만 observations에 id를 넣지 않는다.
command 저장과 cursor 변경은 별도 트랜잭션이며 동일 commandId의 다른 payload도 이전 결과로 처리한다. 멱등성과 명령 충돌을 구분할 것.

## 기존 코드와 UI 요구
AppRouter.tsx는 #/companion 경로를 열어 두고 lazy import한다. 빌드에도 기존 App 청크 74.49kB가 생성됐다. README 대부분, 기존 server/app/main.py·modules·requirements 및 프론트 companion 파일이 남는다. 현재 신규 서버는 이 모듈을 import하지 않는다는 점은 긍정적이다.
기존 변경 파일 두 개는 보존해야 한다. 제거/이관 전에 해시와 외부 로컬 보관본을 남기고 변경 내용을 잃지 않게 할 것. 활성 진입점/의존성/문서는 simulation 전용으로 정리할 것.

VillageMap은 도로 선·장소 사각형·숫자 원으로 그린다. 실제 지도 배경/해안선/필요 건물·집·농장, 얼굴과 독립 차량 표시 요구는 아직 충족하지 않았다. Face도 숫자 배지다. 팝오버는 클릭 기반이며 hover 대화는 없다. 2D 북쪽 위·그룹 선택·지도 밖 목록·좌우 분할은 유지할 부분이다.
원본 좌표와 축척에서 계산한 값을 '실측'이라고 부르지 말 것. 원자료에서 계산한 거리/방위와 현장 측량은 다르다. 349.4도는 북에서 서쪽10.6도이며 '북서'와 정확히 일치한다는 강한 표현을 피할 것. 간선 provenance는 원본 경로에 포함됨을 증명하며 실제 통행 가능성까지 증명하지 않는다.

## 다음 구현 순서
1. R01~R08의 연구 기록/관측/분기/정책 신뢰성 보수.
2. 기존 제품 활성 경로 정리, UI의 실제 지도와 얼굴/차량 복원.
3. 페르소나 JSON→근거 카드/개인별 관측·기억/수락 조건. P12 unknown 등 보존.
4. T004 P3/P9 이동 지원: 이동 필요를 baseline과 별개로 보존하고 요청/픽업 결과는 개입에서 생성. 집에 남기는 baseline을 외출 필요 없음으로 오해하지 않을 것.
5. 정책 편집→실제 차이 비교→DesignFinding→새 revision, read-only probe vs intervention 분기.
6. 보건소장/실무자 다건 자원 큐, 그다음119와 다일 기억 확장.

새 기능 전에 R01은 반드시 해결해야 한다. 과거 시도를 조용히 바꾸는 상태로 연구 데이터를 축적해서는 안 된다.
