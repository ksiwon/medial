import { useMemo, useState, type ReactNode } from 'react';
import styled from 'styled-components';
import ChangeComposer from '../components/ChangeComposer';
import {
  DIMENSION_LABELS,
  USAGE_LABELS,
  type GenerationComparison,
  type GenerationDetail,
  type RuleApplicationRecord,
  type SessionDetail,
  type UsageStatus,
} from '../api/iteration';
import { nameList, personName, withParticle } from '../selectors/story';
import { conditionDiff, versionFacts, type Measure, type VersionFacts } from '../selectors/versionFacts';
import { inputName, paramName, paramValue, refusalReason } from '../selectors/words';
import {
  Body,
  Button,
  Callout,
  Disclosure,
  HScroll,
  Hint,
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

// Screen C, 개선과 확인: the change, its confirmation, what actually changed,
// and the questions to take to the field.
//
// Three acts, in the order the research loop runs them:
//
//   1 the issue and the change    - ChangeComposer, which owns authoring,
//                                   saving, declining and confirming;
//   2 what changed                - the before/after table, plus whether the
//                                   changed rule *ran* at all (26번 F06);
//   3 what to ask the residents   - the field sheet.
//
// What this screen refuses to do is as much of its design as what it shows. No
// combined satisfaction score - the criteria have no shared unit. No percentage
// the runs did not measure. No trophy and no automatic adoption: the primary
// button at the end selects something *to take to the field*, which is a
// research decision, not a deployment. And a difference of zero is never
// reported as "no effect" without saying whether the rule was reached.

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

/**
 * A row label carrying its own caveat.
 *
 * Each of these rows has a sentence that keeps it honest - what the minutes mix
 * together, why a blank is not a zero, that the counts are not a score. Printed
 * under every cell, those sentences were most of the table's text and the
 * numbers were the part you had to hunt for (2026-09-15). The sentence is the
 * same, said once per row rather than twice, and it opens on the label.
 */
function RowLabel({ children, hint }: { children: string; hint?: ReactNode }) {
  return (
    <>
      {children}
      {hint ? <Hint label={children}>{hint}</Hint> : null}
    </>
  );
}

function show(measure: Measure): string {
  if (measure.value === null) return '미수집';
  return Number.isInteger(measure.value) ? String(measure.value) : measure.value.toFixed(1);
}

function measureCell(measure: Measure, sameBasis: boolean) {
  return (
    <>
      <strong style={{ color: measure.value === null ? colour.unknown : colour.text }}>
        {show(measure)}
      </strong>
      {!sameBasis && <Label style={{ marginTop: 2, marginBottom: 0 }}>{measure.basis}</Label>}
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
          {` — ${refusalReason(row.rule, row.reason)}`}
          {!row.seenByMedial && <Tag $kind="unknown" style={{ marginLeft: 6 }}>MEDial은 모름</Tag>}
        </span>
      ))}
    </div>
  );
}

/** What the record did not have, for the people this version's days involved,
 *  and the assumptions its decisions rested on. A blank in the interview is not
 *  an absence in the village, and the row keeps the two apart. */
function elicitationCell(facts: VersionFacts) {
  if (facts.attemptCount === 0) return <span style={{ color: colour.unknown }}>미수집</span>;
  const { gaps, leanedOn, ledgerId } = facts.elicitation;
  if (ledgerId === null) return <span style={{ color: colour.unknown }}>장부 기록 없음 (예전 실행)</span>;
  const byPerson = new Map<string, string[]>();
  for (const g of gaps) {
    const topic = g.text.slice(g.text.indexOf(' · ') + 3);
    byPerson.set(g.actorId, [...(byPerson.get(g.actorId) ?? []), topic]);
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {leanedOn.length === 0 ? (
        <span>결정이 기댄 연구자 가정 없음</span>
      ) : (
        leanedOn.map((l, i) => (
          <span key={i}>
            <Tag $kind="warn">가정에 기댐</Tag>{' '}
            {l.knowerId && l.subjectId
              ? `${withParticle(personName(l.knowerId), 'subject')} ${personName(l.subjectId)}의 평소 장소를 안다고 가정`
              : l.kind}
            {l.reason ? ` — ${l.reason}` : ''}
          </span>
        ))
      )}
      {byPerson.size > 0 && (
        <Disclosure>
          <summary>안 물어봤거나 일부만 기록된 것 {gaps.length}건 · {byPerson.size}명</summary>
          <div>
            {[...byPerson.entries()].map(([who, topics]) => (
              <div key={who}>
                <strong>{personName(who)}</strong> — {topics.join(' · ')}
              </div>
            ))}
          </div>
        </Disclosure>
      )}
      <Label style={{ marginBottom: 0, marginTop: 2 }}>장부 {ledgerId}</Label>
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
      <Label style={{ marginBottom: 0 }}>미경험 {c.noExperience}명</Label>
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
  /** Resolves to the server's refusal text, so the composer can keep its input. */
  onSaveResearcherChangeSet: (body: Record<string, unknown>) => Promise<string | null>;
  onDeclineChanges: (reason: string) => void;
  onOpenFieldSheet: () => void;
  onOpenAllAttempts: () => void;
  onReadEvaluations: () => void;
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
  onDeclineChanges,
  onOpenFieldSheet,
  onOpenAllAttempts,
  onReadEvaluations,
}: Props) {
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
              아직 읽을 버전이 없습니다. 사례와 서비스 경험에서 하루를 실행하면 여기에 나타납니다.
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

  // The generation the composer works on: the one the loop is currently
  // reading, which is where a new Change Set may be authored even when it
  // produced no usable draft (26번 F03).
  const composerGeneration = useMemo(
    () =>
      generations.find((g) => g.index === detail.session.currentGenerationIndex) ??
      generations[generations.length - 1] ??
      null,
    [generations, detail.session.currentGenerationIndex],
  );
  const drafts = (composerGeneration?.changeSets ?? []).filter(
    (item) => item.validationStatus === 'valid' && item.confirmationStatus === 'draft',
  );
  // Did the rule that was confirmed actually run in the right-hand version?
  const application: RuleApplicationRecord[] = right.metrics.ruleApplication ?? [];

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

        {left.id === right.id ? (
          // One version against itself is not a comparison at all, and the
          // lineage check read it as "not parent and child" - an uncontrolled
          // comparison warning on a screen that compared nothing.
          <Callout $tone="info">
            <div>
              <strong>같은 버전을 양쪽에 골랐습니다</strong>
              <div style={{ marginTop: 4 }}>
                {generations.length > 1
                  ? '비교하려면 한쪽을 다른 버전으로 바꾸세요.'
                  : '아직 비교할 다음 버전이 없습니다. 개선안을 확정하면 다음 버전이 실행됩니다.'}
              </div>
            </div>
          </Callout>
        ) : diff && (
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
                <td>
                  <RowLabel
                    hint="지원됨 · 적용 상황이 생김 · 실제로 그 분기를 지남은 서로 다른 질문입니다. 차이가 0인 것과 그 규칙이 발동할 상황이 없었던 것은 다른 결과입니다.">
                    바뀐 규칙이 실행됐나
                  </RowLabel>
                </td>
                <td colSpan={2}>
                  {/* "차이 0"과 "그 규칙이 발동할 상황이 없었다"는 다른 결과다.
                      이 행이 없으면 디자이너는 전자를 후자로 읽는다 (26번 F06). */}
                  {application.length === 0 ? (
                    <span style={{ color: colour.unknown }}>
                      이 버전에는 규칙 적용 기록이 없습니다 (예전 실행이거나 확정된 변경이
                      없습니다).
                    </span>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {application.map((row, index) => (
                        <div key={`${row.ruleType}-${row.attemptId}-${index}`}>
                          <Tag
                            $kind={
                              row.executionStatus === 'applied'
                                ? 'positive'
                                : row.executionStatus === 'not_reached'
                                  ? 'warn'
                                  : 'unknown'
                            }
                          >
                            {row.executionStatus === 'applied'
                              ? '적용됨'
                              : row.executionStatus === 'not_reached'
                                ? '적용 상황 없었음'
                                : '판정 불가'}
                          </Tag>{' '}
                          {row.label ?? row.ruleType} — {row.reason}
                        </div>
                      ))}
                    </div>
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
                <td>
                  <RowLabel
                    hint={
                      leftFacts.meanWaitMinutes.basis === rightFacts.meanWaitMinutes.basis
                        ? leftFacts.meanWaitMinutes.basis
                        : `${leftFacts.meanWaitMinutes.basis} / ${rightFacts.meanWaitMinutes.basis}`
                    }
                  >
                    해결까지 걸린 시간
                  </RowLabel>
                </td>
                <td>
                  {measureCell(
                    leftFacts.meanWaitMinutes,
                    leftFacts.meanWaitMinutes.basis === rightFacts.meanWaitMinutes.basis,
                  )}
                </td>
                <td>
                  {measureCell(
                    rightFacts.meanWaitMinutes,
                    leftFacts.meanWaitMinutes.basis === rightFacts.meanWaitMinutes.basis,
                  )}
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
                <td>
                  <RowLabel hint="분 단위로, 원래 일과에서 벗어난 시간입니다. 도와준 이웃과 도움을 받은 본인이 같은 값에 들어갑니다 — 이 지표는 둘을 구분하지 않습니다.">
                    누구의 일과가 바뀌었나
                  </RowLabel>
                </td>
                <td>{burdenCell(leftFacts)}</td>
                <td>{burdenCell(rightFacts)}</td>
              </tr>

              <tr>
                <td>
                  <RowLabel hint="걸린 줄 하나가 곧 사유입니다. 합산 점수가 아닙니다.">
                    누가 거절했나
                  </RowLabel>
                </td>
                <td>{refusalCell(leftFacts)}</td>
                <td>{refusalCell(rightFacts)}</td>
              </tr>

              <tr>
                <td>
                  <RowLabel hint="빈칸은 '없음'이 아니라 '모름'입니다. 인터뷰에서 안 물어본 것이 마을에 없는 것은 아닙니다.">
                    기록에 없던 것
                  </RowLabel>
                </td>
                <td>{elicitationCell(leftFacts)}</td>
                <td>{elicitationCell(rightFacts)}</td>
              </tr>

              <tr>
                <td>
                  <RowLabel hint="시뮬레이션 기간 안의 수치입니다. 미경험과 제안 없음을 따로 셉니다.">
                    서비스 이용
                  </RowLabel>
                </td>
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
                <td>
                  <RowLabel hint="평가 항목의 개수입니다. 점수가 아니고 실제 주민 만족도가 아닙니다.">
                    주민 에이전트 리뷰
                  </RowLabel>
                </td>
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
                <summary>대안 설명 · 약한 근거 · 충돌</summary>
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
              <Row style={{ gap: 2 }}>
                <Sub as="span">확정 권한</Sub>
                <Hint label="확정 권한">
                  초안은 세계 밖 개선 에이전트가 만들 수 있지만, 연구자가 이유와 함께 확정한
                  뒤에만 MEDial의 다음 운영 조건으로 실행됩니다.
                </Hint>
              </Row>
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
                <Disclosure>
                  <summary>아직 답하지 못한 것 {left.synthesis.nextQuestions.length}건</summary>
                  <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                    {left.synthesis.nextQuestions.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </Disclosure>
              ) : null}
            </Link_>
          </Chain>
        </div>

        {composerGeneration && (detail.canAuthor || drafts.length > 0) && (
          <ChangeComposer
            generation={composerGeneration}
            drafts={drafts}
            busy={busy}
            canAuthor={detail.canAuthor}
            onSave={onSaveResearcherChangeSet}
            onConfirm={onConfirmChangeSet}
            onDecline={onDeclineChanges}
            onOpenScene={onOpenScene}
          />
        )}

        {!detail.canAuthor && drafts.length === 0 && !detail.running && (
          <Callout>
            <div>
              <strong>지금은 새 수정안을 작성할 수 없습니다.</strong>
              <div style={{ marginTop: 4 }}>
                {detail.stopReasonText ?? '실행이 끝난 상태입니다.'} 다음 반복은 이 버전을
                기준으로 새 사례를 준비해 시작합니다.
              </div>
              <div style={{ marginTop: 8 }}>
                <TextLink onClick={onReadEvaluations}>주민 평가 다시 읽기</TextLink>
              </div>
            </div>
          </Callout>
        )}

        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div>
            {loopFinished ? (
              <>
                <Row style={{ gap: 2 }}>
                  <Button $primary onClick={onOpenFieldSheet}>
                    현장에서 검토할 안 선택
                  </Button>
                  <Hint label="현장 검토 선택">
                    고르는 것은 현장에서 물어볼 운영안입니다. 서비스 도입 승인이 아닙니다.
                    유지·보류·기각도 여기서 기록합니다.
                  </Hint>
                </Row>
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

        <Row style={{ gap: 2 }}>
          <Sub as="span">더 바꾸고 싶다면</Sub>
          <Hint label="더 바꾸고 싶다면">
            고른 버전을 기준으로 사례와 서비스 경험에서 새 실험을 만듭니다. 기존 결과는 덮어쓰지
            않습니다.
          </Hint>
        </Row>
      </Inner>
    </Sheet>
  );
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

