import { useMemo, useState } from 'react';
import styled from 'styled-components';
import {
  DIMENSION_LABELS,
  USAGE_LABELS,
  type ChangeSet,
  type GenerationComparison,
  type GenerationDetail,
  type SessionDetail,
  type UsageStatus,
} from '../api/iteration';
import { nameList, personName } from '../selectors/story';
import { conditionDiff, versionFacts, type Measure, type VersionFacts } from '../selectors/versionFacts';
import { inputName, paramName, paramValue, ruleName } from '../selectors/words';
import {
  Body,
  Button,
  Callout,
  Disclosure,
  HScroll,
  Input,
  Mono,
  PageTitle,
  Row,
  Select,
  Sub,
  Table,
  Tag,
  TextArea,
  TextLink,
  showDelta,
  versionName,
} from '../ui/primitives';
import { colour, font } from '../ui/theme';

// Screen C: two versions, side by side, with the reason the second one exists.
//
// What this screen refuses to do is as much of its design as what it shows. No
// combined satisfaction score - the criteria have no shared unit. No percentage
// the runs did not measure. No trophy and no automatic adoption: the primary
// button at the end selects something *to take to the field*, which is a
// research decision, not a deployment.

const Sheet = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 20px 40px;
`;

const Inner = styled.div`
  max-width: 1080px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const Sides = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  @media (max-width: 700px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const CompareTable = styled(Table)`
  th:first-child,
  td:first-child {
    width: 168px;
    color: ${colour.secondary};
    font-weight: 600;
  }
  td {
    font-size: ${font.body};
  }
`;

const SectionTitle = styled.h2`
  margin: 0;
  font-size: ${font.section};
  font-weight: 600;
  color: ${colour.text};
`;

const Chain = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
`;

const Link_ = styled.li`
  padding: 12px 0 12px 16px;
  border-left: 2px solid ${colour.border};
  font-size: ${font.body};
  line-height: 1.55;
  color: ${colour.text};
  position: relative;
  &::before {
    content: '';
    position: absolute;
    left: -5px;
    top: 18px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${colour.primary};
  }
`;

const Label = styled.span`
  font-size: ${font.small};
  color: ${colour.secondary};
  display: block;
  margin-bottom: 2px;
`;

const Bad = styled.li`
  color: ${colour.error};
  line-height: 1.6;
`;

function show(measure: Measure): string {
  if (measure.value === null) return '미수집';
  return Number.isInteger(measure.value) ? String(measure.value) : measure.value.toFixed(1);
}

function measureCell(measure: Measure) {
  return (
    <>
      <strong style={{ color: measure.value === null ? colour.unknown : colour.text }}>
        {show(measure)}
      </strong>
      <Label style={{ marginTop: 2, marginBottom: 0 }}>{measure.basis}</Label>
    </>
  );
}

const USAGE_ORDER: UsageStatus[] = [
  'used',
  'offered_declined',
  'offered_no_response',
  'offered_unfulfilled',
  'not_offered',
  'no_experience',
];

function usageCell(facts: VersionFacts) {
  const rows = USAGE_ORDER.filter((key) => facts.usage[key]);
  if (rows.length === 0) return <span style={{ color: colour.unknown }}>미수집</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {rows.map((key) => (
        <span key={key}>
          {USAGE_LABELS[key]} <strong>{facts.usage[key]}</strong>명
        </span>
      ))}
      <Label style={{ marginBottom: 0, marginTop: 2 }}>
        시뮬레이션 기간 내 · 미경험과 제안 없음을 따로 셉니다
      </Label>
    </div>
  );
}

/**
 * Who spent time on this.
 *
 * The engine's ``residentBurden.addedTaskMinutes`` counts every minute a
 * person's realized plan diverged from their baseline, and it does that for the
 * person the request was *about* as well as for the neighbour who was asked. So
 * P9's own 180-minute trip to town lands in the same field as a neighbour's
 * 20-minute detour. Calling the largest of those "가장 부담이 큰 사람" made the
 * screen assert a distinction the measure does not make, so the row says what
 * is actually counted and names the mixing out loud. The metric itself is
 * unchanged; see the data issue in DEVELOPMENT.md.
 */
function burdenCell(facts: VersionFacts) {
  const most = facts.burden.find((row) => row.minutes > 0) ?? facts.burden[0];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span>
        주민 합계 <strong>{show(facts.neighbourMinutes)}</strong>분
      </span>
      <span>
        보건소 담당자 <strong>{show(facts.institutionMinutes)}</strong>분
      </span>
      {most && most.minutes > 0 ? (
        <span>
          가장 오래 바뀐 사람: <strong>{personName(most.actorId)}</strong>{' '}
          {most.minutes.toFixed(1)}분 · 받은 연락 {most.contacts}회
        </span>
      ) : (
        <span style={{ color: colour.unknown }}>일과가 바뀐 사람 기록 없음</span>
      )}
      {/* MEDial's ledger against the village's. The second list is people a
          neighbour pulled in; MEDial never learns they were involved. */}
      {facts.askedByMedial.length > 0 && (
        <span>
          MEDial이 부탁한 사람 <strong>{facts.askedByMedial.length}</strong>명
          {facts.askedByNeighbour.length > 0 && (
            <>
              {' '}
              · 이웃이 대신 끌어들인 사람 <strong>{facts.askedByNeighbour.length}</strong>명 (
              {nameList(facts.askedByNeighbour)}) — MEDial은 모름
            </>
          )}
        </span>
      )}
      <Label style={{ marginBottom: 0, marginTop: 2 }}>
        분 · 원래 일과에서 벗어난 시간입니다. 도와준 이웃과 도움을 받은 본인이 같은 값에
        들어갑니다 — 이 지표는 둘을 구분하지 않습니다.
      </Label>
    </div>
  );
}

/** Every no and every not-now, with the sentence the person gave. A count per
 *  rule is what changes between versions; the sentences are why. */
function refusalCell(facts: VersionFacts) {
  if (facts.refusals.length === 0) {
    return <span style={{ color: colour.unknown }}>거절한 사람 없음</span>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {facts.refusals.map((row) => (
        <span key={`${row.actorId}-${row.atMs}-${row.requestId ?? ''}`}>
          <strong>{personName(row.actorId)}</strong> {row.kind === 'deferred' ? '나중에' : '거절'}
          {row.reason ? ` — ${row.reason}` : ` — ${ruleName(row.rule)}`}
          {!row.seenByMedial && <Tag $kind="unknown" style={{ marginLeft: 6 }}>MEDial은 모름</Tag>}
        </span>
      ))}
      <Label style={{ marginBottom: 0, marginTop: 2 }}>
        거절 표에서 걸린 줄 하나가 곧 사유입니다. 합산 점수가 아닙니다.
      </Label>
    </div>
  );
}

/** Which day each side ran on. Same seed, same day; a different label here is
 *  a different input, not a policy effect, and the callout above says so. */
function dayCell(facts: VersionFacts) {
  // No attempt yet is "not collected", like every other row. Attempts that
  // exist but carry no day were stored before days were drawn.
  if (facts.attemptCount === 0) return <span style={{ color: colour.unknown }}>미수집</span>;
  if (facts.days.length === 0) {
    return <span style={{ color: colour.unknown }}>하루 기록 없음 (예전 실행)</span>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {facts.days.map((day) => (
        <span key={day.attemptId}>
          <strong>{day.label}</strong>
          {day.changes.length > 0 && (
            <Disclosure>
              <summary>바뀐 것 {day.changes.length}개</summary>
              <div>
                {day.changes.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </Disclosure>
          )}
        </span>
      ))}
    </div>
  );
}

function reviewCell(facts: VersionFacts) {
  const c = facts.reviewCounts;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Row style={{ gap: 4 }}>
        <Tag $kind="positive">긍정 {c.positive}</Tag>
        <Tag $kind="mixed">혼합 {c.mixed}</Tag>
        <Tag $kind="negative">부정 {c.negative}</Tag>
        <Tag $kind="unknown">판단 불가 {c.unknown}</Tag>
      </Row>
      <Label style={{ marginBottom: 0 }}>
        평가 항목 수입니다. 점수가 아니고 실제 주민 만족도가 아닙니다. 이 하루에 서비스를 만나지
        않은 사람 {c.noExperience}명.
      </Label>
    </div>
  );
}

interface Props {
  detail: SessionDetail;
  comparison: GenerationComparison | null;
  leftId: string | null;
  rightId: string | null;
  busy: boolean;
  onSetSides: (left: string | null, right: string | null) => void;
  onOpenScene: (attemptId: string, eventId: string) => void;
  onConfirmChangeSet: (changeSetId: string, reason: string) => void;
  onSaveResearcherChangeSet: (body: Record<string, unknown>) => void;
  onOpenFieldSheet: () => void;
  onOpenAllAttempts: () => void;
  /** Researcher confirmation reason, held by the caller so it survives refreshes. */
  decisionReason: string;
  onDecisionReason: (value: string) => void;
}

export default function CompareScreen({
  detail,
  comparison,
  leftId,
  rightId,
  busy,
  onSetSides,
  onOpenScene,
  onConfirmChangeSet,
  onSaveResearcherChangeSet,
  onOpenFieldSheet,
  onOpenAllAttempts,
  decisionReason,
  onDecisionReason,
}: Props) {
  const [editor, setEditor] = useState<ResearcherEditor | null>(null);
  const generations = useMemo(
    () => [...detail.generations].sort((a, b) => a.index - b.index),
    [detail.generations],
  );
  const left = generations.find((g) => g.id === leftId) ?? generations[0] ?? null;
  const right =
    generations.find((g) => g.id === rightId) ?? generations[generations.length - 1] ?? null;

  if (!left || !right) {
    return (
      <Sheet>
        <Inner>
          <PageTitle>무엇이 달라졌나요?</PageTitle>
          <Callout>
            <div>
              아직 비교할 버전이 없습니다. 마을 관찰에서 첫 하루가 끝나고 개선안이 실행되면 여기에
              나타납니다.
            </div>
          </Callout>
        </Inner>
      </Sheet>
    );
  }

  const leftFacts = versionFacts(left);
  const rightFacts = versionFacts(right);
  const diff = conditionDiff(left, right);
  const needsConfirmation = detail.session.status === 'awaiting_confirmation';
  const loopFinished =
    !detail.running &&
    !needsConfirmation &&
    ['ready_for_designer', 'stalled', 'budget_exhausted', 'no_valid_change', 'cancelled'].includes(
      detail.session.status,
    );

  // The reviews that the change on the right was actually built from. This is
  // the link the whole loop exists to make readable.
  const drivingReviews = useMemo(() => {
    const changeSet = left.changeSets.find(
      (item) => item.resultingPolicyRevisionId === right.policyRevisionId,
    );
    if (!changeSet) return { changeSet: null, quotes: [] as VersionFacts['groundedQuotes'] };
    const wanted = new Set(changeSet.reviewItemRefs);
    const quotes: VersionFacts['groundedQuotes'] = [];
    for (const review of left.reviews) {
      review.items.forEach((item, index) => {
        const ref = `${review.id}#${index}`;
        if (!wanted.has(ref) && !wanted.has(review.id)) return;
        if (item.eventRefs.length === 0) return;
        quotes.push({
          actorId: review.actorId,
          attemptId: review.attemptId,
          eventId: item.eventRefs[0],
          text: item.reason,
        });
      });
    }
    return { changeSet, quotes: quotes.length > 0 ? quotes : leftFacts.groundedQuotes.slice(0, 3) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, right]);

  const confirmationPoint = useMemo(
    () => [...generations].reverse().find((generation) =>
      generation.changeSets.some(
        (item) => item.validationStatus === 'valid' && item.confirmationStatus === 'draft',
      ),
    ) ?? null,
    [generations],
  );
  const drafts = confirmationPoint?.changeSets.filter(
    (item) => item.validationStatus === 'valid' && item.confirmationStatus === 'draft',
  ) ?? [];

  return (
    <Sheet>
      <Inner>
        <PageTitle>무엇이 달라졌나요?</PageTitle>
        <Sub>{detail.session.coreItem}</Sub>

        <Sides>
          <div>
            <Label>비교 기준</Label>
            <Select
              aria-label="왼쪽 버전"
              value={left.id}
              onChange={(e) => onSetSides(e.target.value, right.id)}
            >
              {generations.map((g) => (
                <option key={g.id} value={g.id}>
                  {versionName(g.index, g.label)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>비교 대상</Label>
            <Select
              aria-label="오른쪽 버전"
              value={right.id}
              onChange={(e) => onSetSides(left.id, e.target.value)}
            >
              {generations.map((g) => (
                <option key={g.id} value={g.id}>
                  {versionName(g.index, g.label)}
                </option>
              ))}
            </Select>
          </div>
        </Sides>

        {diff && (
          <Callout $tone={diff.controlled ? 'info' : 'warn'}>
            <div>
              <strong>{diff.controlled ? '같은 하루, 운영 조건만 다름' : '통제 비교가 아닙니다'}</strong>
              <div style={{ marginTop: 4 }}>{diff.claim}</div>
              {diff.differingInputs.length > 0 && (
                <Sub style={{ marginTop: 4 }}>
                  달라진 입력: {diff.differingInputs.map(inputName).join(', ')}
                </Sub>
              )}
              <Disclosure>
                <summary>초기 상태 해시</summary>
                <Mono>{comparison?.initialSnapshotHash ?? detail.session.initialSnapshotHash}</Mono>
              </Disclosure>
            </div>
          </Callout>
        )}

        <HScroll>
          <CompareTable>
            <thead>
              <tr>
                <th />
                <th>{versionName(left.index, left.label)}</th>
                <th>{versionName(right.index, right.label)}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>바꾼 운영 조건</td>
                <td colSpan={2}>
                  {diff && diff.rows.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {diff.rows.map((row) => (
                        <div key={row.field}>
                          <strong>{paramName(row.field)}</strong>: {paramValue(row.before)} →{' '}
                          <strong>{paramValue(row.after)}</strong>
                        </div>
                      ))}
                      {drivingReviews.changeSet && (
                        <Sub>바꾼 이유: {drivingReviews.changeSet.mechanism}</Sub>
                      )}
                      <Disclosure>
                        <summary>기술 diff (필드 경로)</summary>
                        <div>
                          {diff.rows.map((row) => (
                            <div key={row.field}>
                              <Mono>{row.field}</Mono>: <Mono>{JSON.stringify(row.before)}</Mono> →{' '}
                              <Mono>{JSON.stringify(row.after)}</Mono>
                            </div>
                          ))}
                        </div>
                      </Disclosure>
                    </div>
                  ) : (
                    <span style={{ color: colour.unknown }}>
                      이 두 버전 사이에 기록된 운영 조건 차이가 없습니다.
                    </span>
                  )}
                </td>
              </tr>

              <tr>
                <td>요청 해결 / 미해결</td>
                <td>
                  <strong>
                    {show(leftFacts.requestsResolved)} / {show(leftFacts.requestsUnresolved)}
                  </strong>
                  <Label style={{ marginTop: 2, marginBottom: 0 }}>
                    접수 {show(leftFacts.requestsRaised)}건 중 · {leftFacts.requestsRaised.basis}
                  </Label>
                </td>
                <td>
                  <strong>
                    {show(rightFacts.requestsResolved)} / {show(rightFacts.requestsUnresolved)}
                  </strong>
                  <Label style={{ marginTop: 2, marginBottom: 0 }}>
                    접수 {show(rightFacts.requestsRaised)}건 중 · {rightFacts.requestsRaised.basis}
                  </Label>
                </td>
              </tr>

              <tr>
                <td>해결까지 걸린 시간</td>
                <td>{measureCell(leftFacts.meanWaitMinutes)}</td>
                <td>
                  {measureCell(rightFacts.meanWaitMinutes)}
                  {leftFacts.meanWaitMinutes.value !== null &&
                    rightFacts.meanWaitMinutes.value !== null && (
                      <Tag
                        $kind={
                          rightFacts.meanWaitMinutes.value > leftFacts.meanWaitMinutes.value
                            ? 'negative'
                            : rightFacts.meanWaitMinutes.value < leftFacts.meanWaitMinutes.value
                              ? 'positive'
                              : 'unknown'
                        }
                      >
                        {showDelta(
                          rightFacts.meanWaitMinutes.value - leftFacts.meanWaitMinutes.value,
                        )}
                        분
                      </Tag>
                    )}
                </td>
              </tr>

              <tr>
                <td>어느 하루였나</td>
                <td>{dayCell(leftFacts)}</td>
                <td>{dayCell(rightFacts)}</td>
              </tr>

              <tr>
                <td>누구의 일과가 바뀌었나</td>
                <td>{burdenCell(leftFacts)}</td>
                <td>{burdenCell(rightFacts)}</td>
              </tr>

              <tr>
                <td>누가 거절했나</td>
                <td>{refusalCell(leftFacts)}</td>
                <td>{refusalCell(rightFacts)}</td>
              </tr>

              <tr>
                <td>서비스 이용</td>
                <td>
                  {usageCell(leftFacts)}
                  <Label style={{ marginTop: 4, marginBottom: 0 }}>
                    이동 필요 {show(leftFacts.transportNeeds)}건 중 동승 성사{' '}
                    {show(leftFacts.transportCompleted)}건 · 연락 {show(leftFacts.contactAttempts)}회
                  </Label>
                </td>
                <td>
                  {usageCell(rightFacts)}
                  <Label style={{ marginTop: 4, marginBottom: 0 }}>
                    이동 필요 {show(rightFacts.transportNeeds)}건 중 동승 성사{' '}
                    {show(rightFacts.transportCompleted)}건 · 연락{' '}
                    {show(rightFacts.contactAttempts)}회
                  </Label>
                </td>
              </tr>

              <tr>
                <td>주민 에이전트 리뷰</td>
                <td>{reviewCell(leftFacts)}</td>
                <td>{reviewCell(rightFacts)}</td>
              </tr>

              <tr>
                <td>새로 생긴 문제 · 나빠진 점</td>
                <td>
                  <ProblemList
                    items={leftFacts.newProblems}
                    empty="이 버전에서 기록된 blocking·significant 문제 없음"
                  />
                </td>
                <td>
                  <ProblemList
                    items={[
                      ...rightFacts.newProblems,
                      ...(drivingReviews.changeSet?.possibleRegressions ?? []).map(
                        (line) => `예상했던 부작용: ${line}`,
                      ),
                    ]}
                    empty="이 버전에서 기록된 blocking·significant 문제 없음"
                  />
                </td>
              </tr>
            </tbody>
          </CompareTable>
        </HScroll>

        <div>
          <SectionTitle>다음 시도에서 바꾼 이유</SectionTitle>
          <Chain style={{ marginTop: 12 }}>
            <Link_>
              <Label>1 · 주민이 겪은 일</Label>
              {drivingReviews.quotes.length === 0 ? (
                <span style={{ color: colour.unknown }}>
                  이 변경과 연결된, 사건 근거가 있는 리뷰 항목이 없습니다.
                </span>
              ) : (
                drivingReviews.quotes.slice(0, 3).map((quote) => (
                  <div key={`${quote.actorId}-${quote.eventId}`} style={{ marginBottom: 6 }}>
                    <strong>{personName(quote.actorId)}</strong>: {quote.text}{' '}
                    <TextLink onClick={() => onOpenScene(quote.attemptId, quote.eventId)}>
                      그 장면 보기
                    </TextLink>
                  </div>
                ))
              )}
            </Link_>
            <Link_>
              <Label>2 · 리뷰에서 묶인 문제</Label>
              {(left.synthesis?.issueGroups ?? []).length === 0 ? (
                <span style={{ color: colour.unknown }}>종합 기록이 없습니다.</span>
              ) : (
                (left.synthesis?.issueGroups ?? []).slice(0, 3).map((issue) => (
                  <div key={issue.id} style={{ marginBottom: 4 }}>
                    <Tag $kind={issue.minority ? 'warn' : 'neutral'}>
                      {DIMENSION_LABELS[issue.dimension]}
                    </Tag>{' '}
                    {issue.title}
                    {issue.dissentingActors.length > 0 && (
                      <Sub>같은 항목을 반대로 평가한 사람: {nameList(issue.dissentingActors)}</Sub>
                    )}
                  </div>
                ))
              )}
              {(left.synthesis?.minorityConcernIds.length ?? 0) > 0 && (
                <Sub>
                  소수 의견 {left.synthesis!.minorityConcernIds.length}건을 함께 남겨 두었습니다.
                </Sub>
              )}
              {/* The synthesis records what else could explain the same
                  complaint, and which of its own claims nothing in the log
                  supports. Both are the difference between a finding and a
                  guess, so neither is folded away silently. */}
              <Disclosure>
                <summary>
                  다르게 설명할 수 있는 것 · 근거가 약한 주장 · 이해관계 충돌
                </summary>
                <div>
                  {(left.synthesis?.issueGroups ?? [])
                    .filter((issue) => issue.alternativeExplanations.length > 0)
                    .map((issue) => (
                      <Sub key={`alt-${issue.id}`} style={{ marginBottom: 4 }}>
                        <strong>{issue.title}</strong> — 대안 설명:{' '}
                        {issue.alternativeExplanations.join(' / ')}
                        {issue.objectiveMetricRefs.length > 0 && (
                          <> · 대조한 지표: {issue.objectiveMetricRefs.join(', ')}</>
                        )}
                      </Sub>
                    ))}
                  {(left.synthesis?.conflicts ?? []).map((conflict) => (
                    <Sub key={conflict.id} style={{ marginBottom: 4 }}>
                      <strong>충돌:</strong> {conflict.description} (
                      {nameList(conflict.sideA)} ↔ {nameList(conflict.sideB)})
                      {conflict.note && <> — {conflict.note}</>}
                    </Sub>
                  ))}
                  {(left.synthesis?.ungroundedClaims.length ?? 0) > 0 && (
                    <Sub style={{ color: colour.warn }}>
                      <strong>로그가 뒷받침하지 않는 주장:</strong>{' '}
                      {left.synthesis!.ungroundedClaims.join(' · ')}
                    </Sub>
                  )}
                  {(left.synthesis?.noExperienceActors.length ?? 0) > 0 && (
                    <Sub>
                      이 하루에 서비스를 만나지 않은 사람:{' '}
                      {nameList(left.synthesis!.noExperienceActors)} — 관찰 결과이며 불만이
                      아닙니다.
                    </Sub>
                  )}
                  {(left.synthesis?.issueGroups ?? []).every(
                    (i) => i.alternativeExplanations.length === 0,
                  ) &&
                    (left.synthesis?.conflicts.length ?? 0) === 0 &&
                    (left.synthesis?.ungroundedClaims.length ?? 0) === 0 && (
                      <Sub>이 세대의 종합에는 기록된 대안 설명·충돌·근거 부족 항목이 없습니다.</Sub>
                    )}
                </div>
              </Disclosure>
            </Link_>
            <Link_>
              <Label>3 · 연구자가 확정한 MEDial Change Set</Label>
              {drivingReviews.changeSet ? (
                <>
                  <strong>{drivingReviews.changeSet.label}</strong>
                  <div>{drivingReviews.changeSet.mechanism}</div>
                  {drivingReviews.changeSet.changes.map((change) => (
                    <div key={`${change.questId}-${change.field}`} style={{ marginTop: 8 }}>
                      <Tag $kind="neutral">{change.scope === 'quest' ? 'Quest' : 'Task'}</Tag>{' '}
                      <strong>{change.beforeRule}</strong> → {change.afterRule}
                    </div>
                  ))}
                  {drivingReviews.changeSet.expectedEffects.length > 0 && (
                    <Sub>기대: {drivingReviews.changeSet.expectedEffects.join(' · ')}</Sub>
                  )}
                  {drivingReviews.changeSet.possibleRegressions.length > 0 && (
                    <Sub style={{ color: colour.warn }}>
                      예상한 부작용: {drivingReviews.changeSet.possibleRegressions.join(' · ')}
                    </Sub>
                  )}
                  {drivingReviews.changeSet.watchNext.length > 0 && (
                    <Sub>다음에 확인할 것: {drivingReviews.changeSet.watchNext.join(' · ')}</Sub>
                  )}
                  {drivingReviews.changeSet.validationStatus !== 'valid' && (
                    <Sub style={{ color: colour.warn }}>
                      검증 상태: {drivingReviews.changeSet.validationStatus === 'requires_implementation'
                        ? '구현 필요 — 자동 실행하지 않았습니다'
                        : drivingReviews.changeSet.validationStatus}
                      {drivingReviews.changeSet.requiredCapabilities.length > 0 && (
                        <> · 필요한 기능: {drivingReviews.changeSet.requiredCapabilities.join(', ')}</>
                      )}
                    </Sub>
                  )}
                  <Disclosure>
                    <summary>기술 세부사항 · 내부 실행 바인딩</summary>
                    {drivingReviews.changeSet.changes.flatMap((change) =>
                      change.executionBindings.map((binding) => (
                        <div key={`${change.field}-${binding.key}`}>
                          <Mono>{binding.key}</Mono>: {paramValue(binding.before)} →{' '}
                          {paramValue(binding.after)}
                        </div>
                      )),
                    )}
                  </Disclosure>
                </>
              ) : (
                <span style={{ color: colour.unknown }}>
                  오른쪽 버전을 만든 Change Set을 찾지 못했습니다 (두 버전이 파생 관계가 아닐 수
                  있습니다).
                </span>
              )}
              <Sub>
                초안은 세계 밖 개선 에이전트가 만들 수 있지만, 연구자가 이유와 함께 확정한 뒤에만
                MEDial의 다음 운영 조건으로 실행됩니다.
              </Sub>
            </Link_>
            <Link_>
              <Label>4 · 실제로 바뀐 것과 결과 차이</Label>
              {diff && diff.rows.length > 0 ? (
                diff.rows.map((row) => (
                  <div key={row.field}>
                    {paramName(row.field)}: {paramValue(row.before)} → {paramValue(row.after)}
                  </div>
                ))
              ) : (
                <span style={{ color: colour.unknown }}>기록된 조건 차이 없음</span>
              )}
              {left.synthesis?.nextQuestions.length ? (
                <Sub style={{ marginTop: 4 }}>
                  아직 답하지 못한 것: {left.synthesis.nextQuestions.join(' · ')}
                </Sub>
              ) : null}
            </Link_>
          </Chain>
        </div>

        {needsConfirmation && drafts.length === 0 && (
          <Callout $tone="warn">
            <div>
              <strong>확인이 필요한 상태인데 실행할 Change Set을 찾지 못했습니다.</strong>
              <div style={{ marginTop: 4 }}>
                서버는 <Mono>awaiting_confirmation</Mono>에서 멈춰 있습니다. 실행을 중지한 뒤
                주민 평가와 Change Set 기록을 확인하세요.
              </div>
              <div style={{ marginTop: 12 }}>
                <Button onClick={onOpenAllAttempts}>전체 시도 보기</Button>
              </div>
            </div>
          </Callout>
        )}

        {needsConfirmation && drafts.length > 0 && (
          <Callout $tone="warn">
            <div style={{ width: '100%' }}>
              <strong>실행할 MEDial Change Set을 연구자가 확정해야 합니다.</strong>
              <div style={{ marginTop: 4 }}>
                아래 초안은 아직 실행되지 않았습니다. 주민 평가 근거와 예상 부담을 확인하세요.
              </div>
              {confirmationPoint && (
                <Sub style={{ marginTop: 4 }}>
                  {versionName(confirmationPoint.index, confirmationPoint.label)}의 주민 평가에서 나온 초안입니다.
                </Sub>
              )}
              <Sides style={{ marginTop: 12 }}>
                {drafts.map((changeSet) => (
                  <div key={changeSet.id}>
                    <strong>{changeSet.label}</strong>
                    <Body style={{ marginTop: 4 }}>{changeSet.mechanism}</Body>
                    {changeSet.changes.map((change) => (
                      <div key={`${change.questId}-${change.field}`} style={{ marginTop: 6 }}>
                        <Tag $kind="neutral">{change.scope === 'quest' ? 'Quest' : 'Task'}</Tag>{' '}
                        {change.beforeRule} → <strong>{change.afterRule}</strong>
                      </div>
                    ))}
                    {changeSet.expectedEffects.length > 0 && (
                      <Sub>기대: {changeSet.expectedEffects.join(' · ')}</Sub>
                    )}
                    {changeSet.possibleRegressions.length > 0 && (
                      <Sub style={{ color: colour.error }}>
                        가능한 부담: {changeSet.possibleRegressions.join(' · ')}
                      </Sub>
                    )}
                    {changeSet.affectedActors.length > 0 && (
                      <Sub>영향: {nameList(changeSet.affectedActors)}</Sub>
                    )}
                    <div style={{ marginTop: 8 }}>
                      <Button
                        $primary
                        disabled={busy || decisionReason.trim().length === 0}
                        title={
                          decisionReason.trim().length === 0
                            ? '아래에 확정 이유를 적어야 실행할 수 있습니다'
                            : undefined
                        }
                        onClick={() => onConfirmChangeSet(changeSet.id, decisionReason.trim())}
                      >
                        확정하고 새 revision 실행
                      </Button>
                      <TextLink
                        style={{ marginLeft: 12 }}
                        onClick={() => setEditor(makeEditor(changeSet, true))}
                      >
                        이 초안 직접 수정
                      </TextLink>
                      <TextLink
                        style={{ marginLeft: 12 }}
                        onClick={() => setEditor(makeEditor(changeSet, false))}
                      >
                        새 연구자 가설로 작성
                      </TextLink>
                    </div>
                  </div>
                ))}
              </Sides>
              {editor && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${colour.border}` }}>
                  <SectionTitle>
                    {editor.sourceChangeSetId ? '초안 수정본' : '새 연구자 가설'}
                  </SectionTitle>
                  <Sub style={{ marginTop: 4 }}>
                    저장하면 새 Change Set이 됩니다. 원본과 실행 기록은 덮어쓰지 않습니다.
                  </Sub>
                  <Label style={{ marginTop: 12 }}>이름</Label>
                  <Input
                    value={editor.label}
                    onChange={(e) => setEditor({ ...editor, label: e.target.value })}
                  />
                  <Label style={{ marginTop: 10 }}>변경 원리</Label>
                  <TextArea
                    value={editor.mechanism}
                    onChange={(e) => setEditor({ ...editor, mechanism: e.target.value })}
                  />
                  {editor.afterRules.map((rule, index) => (
                    <div key={`rule-${index}`}>
                      <Label style={{ marginTop: 10 }}>변경 후 Quest/Task 규칙 {index + 1}</Label>
                      <TextArea
                        value={rule}
                        onChange={(e) => setEditor({
                          ...editor,
                          afterRules: editor.afterRules.map((item, i) => i === index ? e.target.value : item),
                        })}
                      />
                    </div>
                  ))}
                  <Disclosure style={{ marginTop: 10 }}>
                    <summary>기술 세부사항 · 내부 실행값 수정</summary>
                    {Object.entries(editor.bindingValues).map(([key, value]) => (
                      <div key={key}>
                        <Label style={{ marginTop: 10 }}>{paramName(key)} · 실행값</Label>
                        <Input
                          value={value}
                          onChange={(e) => setEditor({
                            ...editor,
                            bindingValues: { ...editor.bindingValues, [key]: e.target.value },
                          })}
                        />
                      </div>
                    ))}
                  </Disclosure>
                  <Label style={{ marginTop: 10 }}>기대 효과 (한 줄에 하나)</Label>
                  <TextArea
                    value={editor.expectedEffects}
                    onChange={(e) => setEditor({ ...editor, expectedEffects: e.target.value })}
                  />
                  <Label style={{ marginTop: 10 }}>가능한 부담 (한 줄에 하나)</Label>
                  <TextArea
                    value={editor.possibleRegressions}
                    onChange={(e) => setEditor({ ...editor, possibleRegressions: e.target.value })}
                  />
                  <Label style={{ marginTop: 10 }}>다음 실행에서 볼 것 (한 줄에 하나)</Label>
                  <TextArea
                    value={editor.watchNext}
                    onChange={(e) => setEditor({ ...editor, watchNext: e.target.value })}
                  />
                  <Row style={{ marginTop: 12 }}>
                    <Button
                      $primary
                      disabled={busy || !editor.label.trim() || !editor.mechanism.trim() || editor.afterRules.some((x) => !x.trim())}
                      onClick={() => {
                        onSaveResearcherChangeSet(editorPayload(editor));
                        setEditor(null);
                      }}
                    >
                      연구자 Change Set으로 저장
                    </Button>
                    <Button onClick={() => setEditor(null)}>취소</Button>
                  </Row>
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <Label>왜 이 변경을 실행하는지 (기록에 남습니다)</Label>
                <TextArea
                  value={decisionReason}
                  onChange={(e) => onDecisionReason(e.target.value)}
                />
              </div>
            </div>
          </Callout>
        )}

        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            {loopFinished ? (
              <>
                <Button $primary onClick={onOpenFieldSheet}>
                  현장에서 검토할 안 선택
                </Button>
                <Sub style={{ marginTop: 6 }}>
                  고르는 것은 현장에서 물어볼 운영안입니다. 서비스 도입 승인이 아닙니다. 유지·보류·
                  기각도 여기서 기록합니다.
                </Sub>
              </>
            ) : (
              <Sub>
                {detail.running
                  ? '아직 실행 중입니다. 끝나면 현장 검토할 안을 고를 수 있습니다.'
                  : needsConfirmation
                    ? '먼저 위에서 Change Set을 검토하고 확정하세요.'
                    : '반복이 끝나면 현장 검토 선택이 열립니다.'}
                {' '}
                <TextLink onClick={onOpenFieldSheet}>지금까지의 결정 기록 보기</TextLink>
              </Sub>
            )}
          </div>
          <TextLink onClick={onOpenAllAttempts}>전체 시도 보기 ({generations.length}개 버전)</TextLink>
        </Row>

        <Sub>
          운영안을 더 바꾸고 싶으면 고른 버전을 기준으로 실험 준비로 돌아가 새 실험을 만듭니다.
          기존 결과는 덮어쓰지 않습니다.
        </Sub>
      </Inner>
    </Sheet>
  );
}

interface ResearcherEditor {
  templateChangeSetId: string;
  sourceChangeSetId: string | null;
  label: string;
  mechanism: string;
  afterRules: string[];
  bindingValues: Record<string, string>;
  bindingOriginals: Record<string, unknown>;
  expectedEffects: string;
  possibleRegressions: string;
  watchNext: string;
}

function makeEditor(changeSet: ChangeSet, supersede: boolean): ResearcherEditor {
  const bindings = changeSet.changes.flatMap((change) => change.executionBindings);
  return {
    templateChangeSetId: changeSet.id,
    sourceChangeSetId: supersede ? changeSet.id : null,
    label: supersede ? changeSet.label : `${changeSet.label} · 연구자 가설`,
    mechanism: changeSet.mechanism,
    afterRules: changeSet.changes.map((change) => change.afterRule),
    bindingValues: Object.fromEntries(bindings.map((binding) => [binding.key, String(binding.after)])),
    bindingOriginals: Object.fromEntries(bindings.map((binding) => [binding.key, binding.after])),
    expectedEffects: changeSet.expectedEffects.join('\n'),
    possibleRegressions: changeSet.possibleRegressions.join('\n'),
    watchNext: changeSet.watchNext.join('\n'),
  };
}

function editorPayload(editor: ResearcherEditor): Record<string, unknown> {
  return {
    templateChangeSetId: editor.templateChangeSetId,
    sourceChangeSetId: editor.sourceChangeSetId,
    label: editor.label.trim(),
    mechanism: editor.mechanism.trim(),
    afterRules: editor.afterRules.map((item) => item.trim()),
    bindingValues: Object.fromEntries(Object.entries(editor.bindingValues).map(([key, value]) => {
      const original = editor.bindingOriginals[key];
      if (typeof original === 'number') return [key, Number(value)];
      if (typeof original === 'boolean') return [key, value.trim().toLowerCase() === 'true'];
      if (Array.isArray(original)) {
        try { return [key, JSON.parse(value)]; } catch { return [key, value.split(',').map((x) => x.trim())]; }
      }
      return [key, value.trim()];
    })),
    expectedEffects: lines(editor.expectedEffects),
    possibleRegressions: lines(editor.possibleRegressions),
    watchNext: lines(editor.watchNext),
  };
}

function lines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

function ProblemList({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <span style={{ color: colour.unknown }}>{empty}</span>;
  return (
    <ul style={{ margin: 0, paddingLeft: 16 }}>
      {items.map((line) => (
        <Bad key={line}>{line}</Bad>
      ))}
    </ul>
  );
}

