# 07. 개발 백로그와 완료 기준

각 단계는 구현과 검증이 끝나야 다음 단계로 넘어간다. 기간은 현재 코드 상태를 확인한 뒤 추정하며, 아래 목록은 일정 약속이 아니다.

## P0. 데이터와 사실 관계 정리

- [x] 원본·익명 JSON·원본 시뮬레이터 hash를 source manifest에 고정.
- [x] P12 인터뷰 미확보, P10/P11 합동 인터뷰, 12명 부분 관계망을 metadata에 반영.
- [x] P3/P9/P12 plan의 퀘스트 결과를 baseline과 overlay로 분리.
- [x] timetable의 소수 분 시각을 정수 ms로 변환.
- [x] 원본 상충 주장 목록과 JSON Pointer 근거 카드를 생성.
- [x] 지도·기관·도로·차량·연락 수단의 confirmed/assumed/unknown을 분리.
- [x] local-data의 git 제외와 공개 export 기준 설정.

완료 기준:
- importer가 같은 입력에서 같은 정규화 JSON/hash를 만든다.
- 12명 ID·HOME·원본 일과 재생의 좌표/시각이 원본과 일치한다.
- experiment에 source-replay의 수락·결과가 자동 유입되지 않는다.
- 원자료는 변경하지 않는다.

## P1. LLM 없는 시뮬레이션 커널

- [x] 정수 시계, 우선순위 event queue, 단일 reducer.
- [ ] 자원 예약/취소/동승/이동/복귀.
- [x] 요청·제안·응답·수행·완료/미해결 상태.
- [x] actor별 관측/정보 TTL.
- [x] SQLite event log + checkpoint + export.
- [x] P1 무응답 rule A/B 실행.

핵심 테스트:
- double_booking: 한 사람/차량을 같은 시간에 두 업무에 배정 불가.
- no_teleport: 모든 이동은 경로와 소요시간을 가짐.
- hidden_state: MEDial은 P1의 실제 밭 위치를 메시지 없이 모름.
- not_answered_is_not_declined: 무응답/거절 분리.
- request_not_success: 접수/연락을 완료로 집계하지 않음.
- replay: event log 재생 최종 hash 동일.
- deterministic_rules: 같은 seed·입력의 rule 실행 로그 동일.
- partial_network: 12명 내 후보 없음은 전 마을 후보 없음이 아님.

## P2. 연구 UI의 실제 엔진 연결

- [x] React 2D 지도와 마을 밖 주민 목록.
- [x] 함께 있는 주민의 compact popover와 선택·현재 행동.
- [x] 원래 일과 / 실제 바뀐 일과 비교.
- [x] 퀘스트 trace와 MEDial 관측 보기.
- [x] play/pause/step/seek를 엔진과 연결.
- [x] 기존 데모의 고정 만족도·원본 사건 자동 성공 표시를 신규 화면에서 제거.
- [x] 전체 채팅 대신 사건별 필요한 메시지 표시.

완료 기준:
- 지도·프로세스·통계가 같은 event seq에서 일치.
- hover/선택/줌이 시뮬레이션의 시간·정책을 변경하지 않음.
- 군집은 실제 위치/동승 상태로 계산, 단지 친한 사람이라 묶지 않음.
- 화면에서 바뀐 일과가 없는 상태로 서버에서만 task completed가 나오는 경우 없음.

## P3. 주민 에이전트

- [ ] 근거 카드 검색과 persona compiler.
- [ ] actor별 memory/observation 분리.
- [ ] structured action output와 검증.
- [ ] 수락/거절/조건부 수락/질문/채널 선택/공개 거부.
- [ ] 읽기 전용 probe와 개입 branch.
- [ ] 하루 회고를 experienced events로 제한.
- [ ] 미확보 정보 abstain.

완료 기준:
- 기본 60개 질문 + 핵심 인물 상충 상황 묶음을 human/rule review로 검사.
- P12가 새 지병·가족·선호를 만들어내지 않음.
- A의 비공개 상담이 B의 답변 근거로 누출되지 않음.
- JSON 오류·API 실패가 주민 반응으로 저장되지 않음.
- 원문 발언과 생성 발언이 UI에서 구분됨.

## P4. MEDial과 기관 역할

- [ ] 후보 필터·정책 선택·동의·예약·follow-up.
- [ ] 이장 경유/보조/직접 연락 정책.
- [ ] 보건소장/담당자 역할·자원 큐.
- [ ] 119 상황실/구급대·접수 확인·도착·인계.
- [ ] S01~S05 외생 사건과 S06/S08/S11/S17/S22 확장.
- [ ] 정책 제안이 권한 밖일 때 차단 trace.

완료 기준:
- P3의 첫 약속이 두 번째 제안의 가능시간에 반영됨.
- 기관 인계 후 대기·거절·추가 정보 요청 가능.
- 일반 연락 상한/이장 승인 대기가 응급 연락 경로를 막지 않음.
- 119 도착을 의료 해결로 기록하지 않음.
- 확인 안 된 기관 주소·진료시간·처치 권한을 생성하지 않음.

## P5. 시도 분기와 설계 발견

- [ ] 동일 초기 snapshot에서 policy patch로 분기.
- [ ] independent stochastic streams와 LLM call trace.
- [ ] 같은 사건ID에 대한 A/B trace 정렬.
- [ ] 연락/수행/대기/개인 부담/기관 큐/공개 범위 비교.
- [ ] experience review source 구분과 unknown.
- [ ] DesignFinding → 다음 policy revision 연결.
- [ ] 미사용 시나리오 비교와 사람의 정정 기록.

완료 기준:
- fork가 부모 실행을 바꾸지 않음.
- seed가 같아도 새 LLM 실행과 replay를 다르게 표시.
- 정책을 바꿔도 persona·deck·평가 rubric은 통제 비교에서 고정.
- A/B 입력 차이와 모든 결과의 출처를 내보낼 수 있음.

## P6. 연구 운영

- [ ] 기관 역할과 핵심 시간·채널 가정을 현장 담당자에게 검토.
- [ ] 주민별 행동 가능성·거절 조건을 미사용 질문으로 확인.
- [ ] 연구자 파일럿 → 디자이너 세션 → 실제 당사자 검토.
- [ ] 설계 변경의 다양성·근거 추적·과신·현장 질문의 질 분석.
- [ ] 방법의 적용 범위·실패 조건을 결과와 함께 정리.

## 첫 구현 티켓 (다음 코딩 작업의 시작점)

T001: source importer와 baseline/replay 분리.
입력: local-data source paths. 출력: normalized persona registry, source replay, baseline draft, provenance report.
검증: ID 12개, 좌표·시각 유지, P12 unknown, P3/P9/P12의 task overlay 표시.
금지: 원본 clinical threshold 복제, 기존 companion 시작, 외부 LLM 호출, private JSON을 public에 저장.

T002: P1 fixture+event kernel+rule A/B.
T003: log replay+map projection+trace.
T004: P3/P9 예약·이동·조건부 수락.
T005: 에이전트 adapter를 scripted→LLM으로 교체 가능한 경계.

T001·T002·T003은 구현·검증 완료(2026-09-10). T004(P3/P9 예약·이동·조건부 수락)도 구현·검증
완료(2026-09-10). 범위와 검증 결과는 DEVELOPMENT.md 참조.

T005(LLM 어댑터)는 **부분 구현**이다. 리뷰·종합·개선 역할은 실제 provider를 호출하도록
구현했고(Anthropic Messages / OpenAI 호환), 주민의 **행동** 어댑터는 여전히 규칙뿐이다. 그래서
온라인 모드의 정확한 이름은 hybrid다. API 키 없이 전체 핵심 흐름이 돈다.

## 2026-09-10 v0.2에서 닫힌 항목

검토 문서 R01~R08에 대응해 아래를 구현하고 회귀 테스트로 고정했다 (총 87개 통과).

- 재시작·동시 생성에서 이전 시도 불변 (UUID + 삽입 전용 저장, 충돌 시 실패)
- rerun / 시점 fork 분리와 UI 라벨 일치, fork의 로그 접두부 보존 검증
- 무응답을 부재·응급 배제로 해석하던 코드·문구·테스트 제거
- actor별 관측 투영(공유 일과 vs 사적 지식), 동의 상태 기록, 세계 사유의 연구자 전용 분리
- 개인 경험 평가에서 전체 공개 기록·미래 사건 제거
- 같은 시각 사건도 하나씩 재생, 커서 DB 보존, 회고 보기 분리
- 노출한 정책 조건 전부를 실제 기제에 연결, 미지원은 400으로 거부, 정책 편집기 도입
- 기관 시간 모델(직원 캘린더·근무시간·편도/왕복 통일)
- 제안·payload 값 타입 검증, commandId 충돌 처리
- 페르소나 컴파일러와 근거 카드
- T004 이동 필요 → 예약 → 픽업 → 도착 → 귀가, 충돌·중복·잔존 검사
- 조건→결정→결과→발견→다음 revision 연결
- 레거시 companion을 활성 빌드에서 분리(사본·diff·해시 보관), README 정리
- 지도: 원본 배경·해안선·확인된 집/건물/밭, 얼굴, 차량, hover/focus 팝오버

## 2026-09-10 v0.3에서 닫힌 항목 (13번 문서 I0~I4)

리뷰 기반 반복을 구현하고 회귀 테스트로 고정했다 (총 139개 통과, 모델 호출 0).

- I0 · 귀가 동승 leg의 탑승자 표시 수정(같은 Segment 객체 공유 문제 포함), 기존 87개 회귀 확인
- I1 · `AgentReview` 계약, rule/LLM/scripted 리뷰 어댑터, 경험 경계 검증, 개인 리뷰 화면
- I2 · `ReviewSynthesis`(소수 의견·이견·충돌 보존), `ChangeProposal`, 코드 기반 `PatchValidator`,
  정책 revision 연결
- I3 · `IterationSession`/`Generation` DB 저장, 자동 3세대, 예산·정지 사유 분리, 재시작 복구,
  세대 비교(통제 여부 계산·사람별 득실)
- I4 · 디자이너 선택/보류 기록, 재방문 장면 패키지, `HumanReview` 입력과 출처 분리
- 부수 수정: 한 sqlite3 연결의 읽기에 잠금이 없어 반복 루프 스레드와 겹칠 때 나던 간헐 500

## 다음 단계로 남긴 것

**완료라고 쓰지 않는다.**

- **보건소장과 다건 자원 관리** — 담당자 1명의 일정은 동작하지만, 소장 화면과 여러 건을 동시에
  안고 있는 실무자의 우선순위 배분은 없다.
- **119** — 접수/출동/도착/인계를 분리하고, 도착 자체를 의료 문제 해결로 세지 않아야 한다.
  지금은 아예 없다. 실제 기관 전송은 어떤 경우에도 하지 않는다.
- **I5 · 기관 역할 확장** — 보건소장의 배정·우선순위, 실무자 다건 큐와 그 역할의 리뷰.
- **다일 기억** — 하루 단위 실행만 있다. `longitudinal` 모드는 이름만 있고 session 생성이
  400으로 거부한다. 날 사이의 개인 경험·미해결 요청·피로 가정을 잇는 것이 남아 있다.
- **온라인 LLM smoke test** — 어댑터·스키마·호출 기록·실패 처리·예산 정지는 구현했으나 이
  환경에 키가 없어 **실제 provider 호출을 한 번도 하지 않았다.** 키가 있는 환경에서 수행하고
  호출 횟수·모드를 보고해야 한다.
- **주민 행동의 LLM 어댑터** — `agents/llm.py` 는 여전히 프롬프트 페이로드만 있다.
- **평가용 deck** — session에 `evaluationDeckRefs` 자리는 있으나 미공개 검토 deck을 실제로
  만들어 두지 않았다.
- **읽기 전용 probe와 개입 대화의 분기** — 설계에만 있다.
- **OpenAPI → TS 타입 생성**, WebSocket 스트리밍, 원본 replay 모드, 공개용 export 프로필.
- **P6 연구 운영 전체** — 기관 담당자 검토, 당사자 확인, 툴 사용 연구.
