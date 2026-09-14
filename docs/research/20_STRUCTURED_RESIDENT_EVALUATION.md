# 결정 01 — 점수 없는 근거 기반 구조화 Resident Evaluation

상태: **2026-09-14 사용자 확정**  
상위 기준: `19_RESIDENT_AGENTS_AS_EVALUATORS.md`

## 결정

Resident Agent의 평가 출력은 자유 대화나 수치형 만족도 점수가 아니라 **점수 없는 근거 기반
구조화 평가**로 한다.

주민 에이전트의 평가는 실제 주민 만족도, 정책 효과 점수, 사람을 대표하는 확률이 아니다. 각
주민 에이전트가 해당 실행에서 직접 경험한 사건을 자신의 허용된 인터뷰 근거와 함께 해석한
시뮬레이션 산출물이다.

## 평가 단위

각 주민 평가는 다음 여섯 차원을 사용한다.

1. `help_resolution` — 도움이 되었는가, 요청이 해결되었는가
2. `time_labour` — 시간·노동·관계 부담이 생겼는가
3. `choice_refusal` — 선택하거나 거절할 수 있었는가
4. `disclosure` — 어떤 정보가 누구에게 공유되었는가
5. `understandability` — 무엇이 왜 일어났는지 이해할 수 있었는가
6. `reuse_condition` — 다음에 이용하려면 무엇이 달라져야 하는가

각 차원은 다음 구조를 가진다.

```text
dimension
assessment: positive | mixed | negative | unknown
reason
eventRefs[]
evidenceRefs[]
requestedChange | null
```

`positive / mixed / negative / unknown`은 계산용 점수가 아니라 평가의 종류다. 평균, 가중합,
백분율, 별점, 전체 만족도 점수로 변환하지 않는다.

## 리뷰 전체 구조

```text
actorId
actorRole
attemptId
policyRevisionId
source: simulated
adapter
usageStatus
experiencedEventIds[]
items[6 dimensions]
overallNarrative
unknowns[]
model/promptVersion
disclaimer
```

`usageStatus`는 `used / offered_declined / offered_no_response /
offered_unfulfilled / not_offered / no_experience`를 구분한다. 미사용과 미경험은 불만족으로
간주하지 않으며, 경험하지 않은 차원은 `unknown`이어야 한다.

## 강제할 근거 규칙

- `unknown`이 아닌 평가는 본인이 경험한 `eventRefs`를 하나 이상 인용해야 한다.
- 성향·선호를 근거로 해석할 때는 본인 페르소나의 `evidenceRefs`만 사용한다.
- 다른 주민의 사적 사건, 미래 사건, 연구자 전용 세계 사실은 인용할 수 없다.
- 근거가 부족하면 그럴듯한 답을 만들지 않고 `unknown` 또는 abstain한다.
- 평가 reason은 근거 기반 설명이지 실제 주민의 발언이나 LLM 내부 인과의 증거가 아니다.
- `source=simulated`와 실제 재방문에서 입력된 `source=human`을 합치지 않는다.

## UI 원칙

기본 화면은 주민별로 다음 순서로 보여 준다.

1. 이번 실행에서 무엇을 경험했는가
2. 차원별 평가와 이유
3. 평가에 연결된 사건 장면
4. 인터뷰 근거
5. 요청한 변경
6. 판단할 수 없는 것

기본 화면에 주민별 총점, 마을 평균 만족도, 순위, 승자 배지를 표시하지 않는다. 여러 주민의
평가는 공통점과 충돌을 묶어 보여 줄 수 있지만 소수 의견과 `unknown`을 지우지 않는다.

## 현재 구현과의 대응

현재 `server/app/simulation/iteration/contracts.py`의 `AgentReview`와 `ReviewItem`은 위 구조와
대부분 일치한다. 여섯 차원, 네 assessment, usage status, event/evidence refs, requested change,
unknown, simulated 출처와 disclaimer가 이미 있다. `experience.py`도 경험하지 않은 사건 인용과
근거 없는 non-unknown 평가를 거부한다.

따라서 이번 결정만으로 계약 코드를 다시 만들 필요는 없다. 다음 UI 개편에서는 이미 있는 계약을
연구의 중심으로 승격한다.

## 확인된 후속 쟁점

`server/app/simulation/iteration/selection.py`의 기본 비교 기준은 현재
`negativeReviewItems`를 숫자로 세어 후보 선택에 사용한다. 개별 Resident Evaluation 자체에는
점수가 없지만, 이 집계가 사실상 하나의 품질 점수처럼 작동할 수 있다.

다음 결정에서 아래 중 하나를 확정해야 한다.

1. 평가 집계는 설명용 빈도만 제공하고 자동 선택에는 사용하지 않는다.
2. 차원별 분포를 선택 기준으로 사용하되 단일 점수로 합치지 않는다.
3. 현재 부정 항목 수 기준을 유지한다.

19번 연구 초점과 이번 결정에는 1번 또는 2번이 부합하며, 3번은 권장하지 않는다.
