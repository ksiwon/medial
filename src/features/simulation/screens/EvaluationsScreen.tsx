import { useMemo, useState } from 'react';
import styled from 'styled-components';
import {
  ASSESSMENT_LABELS,
  DIMENSION_LABELS,
  USAGE_LABELS,
  type AgentReview,
  type Assessment,
  type GenerationDetail,
  type ReviewItem,
  type SessionDetail,
  type UsageStatus,
} from '../api/iteration';
import type { PersonasPayload } from '../api/types';
import { personName } from '../selectors/story';
import {
  Body,
  Button,
  Callout,
  Clip,
  Disclosure,
  Hint,
  Mono,
  PageTitle,
  Row,
  Select,
  Sub,
  Tag,
  TextLink,
  versionName,
} from '../ui/primitives';
import { colour, font, radius } from '../ui/theme';

// Screen B: the resident evaluations, as the screen the loop arrives at.
//
// Doc 19 section 9 puts Resident Evaluations at the centre; until now reading
// them meant finding a person on the observation screen and opening a 회고
// toggle, which is good for understanding one person's day and bad for reading
// what the run did to twelve people (26번 F02).
//
// The order inside one resident is doc 20's: what they experienced, then the
// six dimensions with their reasons, then the evidence, then what they asked
// for, then what they could not judge. Two boundaries are load-bearing:
//
//  - 미경험 / 제안받고 거절 / 응답 못 함 / 미해결 are four different states and
//    none of them is a complaint. They are never sorted as negative;
//  - every card says 모의 주민 평가, and whether the persona came from source
//    material is a *separate* axis from whether the evaluation is simulated.
//    Source-grounded or not, the evaluation is simulated.
//
// There is no total, no average, no ranking and no winner here, and the counts
// at the top are counts of items, said as such.

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
  gap: 20px;
`;

const Split = styled.div`
  display: grid;
  grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
  @media (max-width: 899px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const PersonList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

/* A name, a usage status and - when the session ran more than one scenario -
   which day it was, in one row that neither wraps nor spills. The scenario name
   was running past the right edge of the button and 보건소 담당자 was being
   broken across two lines (seen in a browser, 2026-09-15). */
const PersonRow = styled.button<{ $active: boolean }>`
  font-family: inherit;
  font-size: ${font.body};
  text-align: left;
  border: 1px solid ${(p) => (p.$active ? colour.primary : colour.border)};
  background: ${(p) => (p.$active ? colour.selected : colour.surface)};
  border-radius: ${radius.control};
  padding: 8px 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  color: ${colour.text};
  &:focus-visible {
    outline: 2px solid ${colour.primary};
  }
`;

/* The name keeps its width; the scenario label is what gives way. Letting both
   shrink turned 보건소 담당자 into "P.." while the row still had room. */
const PersonName = styled.strong`
  flex: 0 0 auto;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Card = styled.div`
  border: 1px solid ${colour.border};
  border-radius: 8px;
  background: ${colour.surface};
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const Dimension = styled.div`
  border-top: 1px solid ${colour.border};
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ASSESSMENT_TAG: Record<Assessment, 'positive' | 'mixed' | 'negative' | 'unknown'> = {
  positive: 'positive',
  mixed: 'mixed',
  negative: 'negative',
  unknown: 'unknown',
};

/** Reading order, not a ranking. People who met the service come first because
 *  they are the ones with something to read; 미경험 is not "worst". */
const USAGE_ORDER: UsageStatus[] = [
  'used',
  'offered_unfulfilled',
  'offered_declined',
  'offered_no_response',
  'not_offered',
  'no_experience',
];

function sortReviews(reviews: AgentReview[]): AgentReview[] {
  return [...reviews].sort((a, b) => {
    const byUsage = USAGE_ORDER.indexOf(a.usageStatus) - USAGE_ORDER.indexOf(b.usageStatus);
    if (byUsage !== 0) return byUsage;
    return a.actorId.localeCompare(b.actorId, undefined, { numeric: true });
  });
}

function itemCounts(reviews: AgentReview[]): Record<Assessment, number> {
  const out: Record<Assessment, number> = { positive: 0, mixed: 0, negative: 0, unknown: 0 };
  for (const review of reviews) for (const item of review.items) out[item.assessment] += 1;
  return out;
}

interface Props {
  detail: SessionDetail;
  generation: GenerationDetail | null;
  personas: PersonasPayload | null;
  onSelectGeneration: (id: string) => void;
  /** Opens the cited scene on the experience screen and moves its cursor. A
   *  read of a stored log; no adapter runs. */
  onOpenScene: (attemptId: string, eventId: string) => void;
  onGoToImprove: () => void;
}

export default function EvaluationsScreen({
  detail,
  generation,
  personas,
  onSelectGeneration,
  onOpenScene,
  onGoToImprove,
}: Props) {
  const generations = useMemo(
    () => [...detail.generations].sort((a, b) => a.index - b.index),
    [detail.generations],
  );
  const reviews = useMemo(() => sortReviews(generation?.reviews ?? []), [generation]);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const selected = reviews.find((r) => r.id === reviewId) ?? reviews[0] ?? null;

  /**
   * Which scenario an evaluation is about.
   *
   * A session that runs two scenarios produces two evaluations per person - one
   * for the check-in day, one for the transport day - and the list showed both
   * as bare "P1", twice, with no way to tell which was which (seen in a browser,
   * 2026-09-15). The deck comes from the generation's own objective row, so the
   * name shown is the run's, not a guess.
   */
  const scenarioOf = useMemo(() => {
    const byAttempt = new Map<string, string>();
    const objective = generation?.metrics.objective ?? {};
    const labels = new Map(detail.capabilities.decks.map((d) => [d.id, d.label]));
    for (const [attemptId, row] of Object.entries(objective)) {
      const deckId = String((row as { deckId?: string }).deckId ?? '');
      if (deckId) byAttempt.set(attemptId, labels.get(deckId) ?? deckId);
    }
    return (attemptId: string) => byAttempt.get(attemptId) ?? null;
  }, [generation, detail.capabilities.decks]);
  const manyScenarios = useMemo(
    () => new Set(reviews.map((r) => scenarioOf(r.attemptId))).size > 1,
    [reviews, scenarioOf],
  );
  const counts = itemCounts(reviews);
  const synthesis = generation?.synthesis ?? null;

  if (!generation || reviews.length === 0) {
    return (
      <Sheet>
        <Inner>
          <PageTitle>주민 평가</PageTitle>
          <Callout>
            <div>
              {detail.running
                ? '아직 이 버전의 주민 평가를 모으는 중입니다. 끝나면 여기에 나타납니다.'
                : '이 버전에는 주민 평가 기록이 없습니다. 사례와 서비스 경험에서 하루를 실행하세요.'}
            </div>
          </Callout>
        </Inner>
      </Sheet>
    );
  }

  const persona = selected
    ? personas?.profiles.find((p) => p.subjectId === selected.actorId) ?? null
    : null;
  // Whether the persona came from source material is one axis; whether the
  // evaluation is simulated is another, and it is always simulated.
  const synthetic = personas?.provenance?.dataSource === 'synthetic';

  return (
    <Sheet>
      <Inner>
        <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
          <div>
            <PageTitle>주민 평가</PageTitle>
            <Sub>누구에게 어떤 도움과 부담이 생겼나.</Sub>
          </div>
          <div style={{ minWidth: 220 }}>
            <Sub>어느 버전의 평가</Sub>
            <Select
              aria-label="평가를 읽을 버전"
              value={generation.id}
              onChange={(e) => onSelectGeneration(e.target.value)}
            >
              {generations.map((g) => (
                <option key={g.id} value={g.id}>
                  {versionName(g.index, g.label)}
                </option>
              ))}
            </Select>
          </div>
        </Row>

        <Callout>
          <div>
            <Row style={{ gap: 4 }}>
              <strong>평가 항목의 개수</strong>
              <Hint label="이 숫자">
                모의 주민 평가입니다. 실제 주민의 만족도가 아니고 점수도 아닙니다. 항목을 세었을
                뿐이므로 합계·순위·우열로 읽지 마세요.
              </Hint>
            </Row>
            <Row style={{ gap: 4, marginTop: 6 }}>
              <Tag $kind="positive">긍정 {counts.positive}</Tag>
              <Tag $kind="mixed">혼합 {counts.mixed}</Tag>
              <Tag $kind="negative">부정 {counts.negative}</Tag>
              <Tag $kind="unknown">판단 불가 {counts.unknown}</Tag>
            </Row>
          </div>
        </Callout>

        <Split>
          <PersonList>
            {reviews.map((review) => (
              <PersonRow
                key={review.id}
                $active={selected?.id === review.id}
                aria-pressed={selected?.id === review.id}
                onClick={() => setReviewId(review.id)}
              >
                <PersonName title={personName(review.actorId)}>
                  {personName(review.actorId)}
                </PersonName>
                <Tag $kind={review.usageStatus === 'used' ? 'neutral' : 'unknown'}>
                  {USAGE_LABELS[review.usageStatus]}
                </Tag>
                {manyScenarios && (
                  <Sub
                    as="span"
                    title={scenarioOf(review.attemptId) ?? ''}
                    style={{ marginLeft: 'auto', minWidth: 0, flex: '0 1 auto' }}
                  >
                    <Clip>{scenarioOf(review.attemptId)}</Clip>
                  </Sub>
                )}
              </PersonRow>
            ))}
            <Row style={{ marginTop: 6, gap: 2 }}>
              <Sub as="span">읽는 순서</Sub>
              <Hint label="읽는 순서">
                서비스를 만난 사람부터 나옵니다. 미경험과 제안 없음은 불만이 아니므로 부정 평가로
                정렬하지 않습니다.
              </Hint>
            </Row>
          </PersonList>

          {selected && (
            <Card>
              <Row style={{ gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: font.section }}>{personName(selected.actorId)}</strong>
                {scenarioOf(selected.attemptId) && (
                  <Tag $kind="neutral">{scenarioOf(selected.attemptId)}</Tag>
                )}
                <Tag $kind="unknown">모의 주민 평가</Tag>
                <Hint label="모의 주민 평가">
                  원자료에 근거한 페르소나여도 이 평가 자체는 simulated입니다. 실제 사람의 응답은
                  개선과 확인 화면의 현장 기록에만 있습니다.
                </Hint>
                <Tag $kind={synthetic ? 'warn' : 'neutral'}>
                  페르소나 {synthetic ? '합성' : '원자료 기반'}
                  {persona ? '' : ' (기록 없음)'}
                </Tag>
                <Tag $kind="unknown">{selected.adapter} 어댑터</Tag>
              </Row>

              <div>
                <Sub>1 · 이번에 무엇을 경험했나</Sub>
                <Body>{selected.overallNarrative}</Body>
                <Row style={{ gap: 6, marginTop: 4 }}>
                  <Tag $kind="neutral">{USAGE_LABELS[selected.usageStatus]}</Tag>
                  <Sub as="span">경험한 사건 {selected.experiencedEventIds.length}건</Sub>
                </Row>
              </div>

              <div>
                <Sub>2 · 차원별 평가와 이유</Sub>
                {selected.items.map((item, index) => (
                  <DimensionRow
                    key={`${item.dimension}-${index}`}
                    item={item}
                    attemptId={selected.attemptId}
                    onOpenScene={onOpenScene}
                  />
                ))}
              </div>

              {selected.items.some((i) => i.requestedChange) && (
                <div>
                  <Sub>3 · 요청한 변경</Sub>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                    {selected.items
                      .filter((i) => i.requestedChange)
                      .map((item, index) => (
                        <li key={index} style={{ fontSize: font.body }}>
                          {item.requestedChange}
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              <div>
                <Sub>4 · 판단할 수 없는 것</Sub>
                {selected.unknowns.length > 0 ? (
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                    {selected.unknowns.map((line) => (
                      <li key={line} style={{ fontSize: font.body }}>
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Sub>이 사람이 적어 둔 '모르는 것'은 없습니다.</Sub>
                )}
              </div>

              <Disclosure>
                <summary>기술 정보 · 감사</summary>
                <div>
                  <Sub>
                    리뷰 <Mono>{selected.id}</Mono> · 시도 <Mono>{selected.attemptId}</Mono>
                  </Sub>
                  <Sub>
                    계약 버전 <Mono>{selected.promptVersion}</Mono> · 출처{' '}
                    <Mono>{selected.source}</Mono>
                  </Sub>
                  <Sub>{selected.disclaimer}</Sub>
                </div>
              </Disclosure>
            </Card>
          )}
        </Split>

        {synthesis && (
          <div>
            <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Row style={{ gap: 2 }}>
                <strong style={{ fontSize: font.section }}>쟁점 묶음</strong>
                <Hint label="쟁점 묶음">
                  원본 평가의 읽기용 요약입니다. 몇 명이 말했는지로 우선순위를 정하지 않습니다.
                </Hint>
              </Row>
            </Row>
            {synthesis.issueGroups.length === 0 ? (
              <Sub>이 실행의 평가에서 묶인 쟁점이 없습니다.</Sub>
            ) : (
              synthesis.issueGroups.map((issue) => (
                <div key={issue.id} style={{ marginTop: 8 }}>
                  <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                    <Tag $kind={issue.minority ? 'warn' : 'neutral'}>
                      {DIMENSION_LABELS[issue.dimension]}
                    </Tag>
                    {issue.minority && <Tag $kind="warn">소수 의견</Tag>}
                    <strong>{issue.title}</strong>
                  </Row>
                  {issue.dissentingActors.length > 0 && (
                    <Sub>
                      같은 항목을 반대로 평가한 사람:{' '}
                      {issue.dissentingActors.map(personName).join(', ')}
                    </Sub>
                  )}
                  {/* Which original items this issue is made of - a claim the
                      synthesis cannot make without them (26번 F08). */}
                  <Disclosure>
                    <summary>원본 평가 {issue.reviewItemRefs.length}건 보기</summary>
                    <div>
                      {issue.reviewItemRefs.map((ref) => {
                        const [reviewId, indexText] = ref.split('#');
                        const review = reviews.find((r) => r.id === reviewId);
                        const item = review?.items[Number(indexText)];
                        if (!review || !item) {
                          return (
                            <Sub key={ref} style={{ color: colour.warn }}>
                              <Mono>{ref}</Mono> — 이 실행의 평가에서 찾지 못했습니다.
                            </Sub>
                          );
                        }
                        return (
                          <Sub key={ref}>
                            <strong>{personName(review.actorId)}</strong> ·{' '}
                            {DIMENSION_LABELS[item.dimension]} ·{' '}
                            {ASSESSMENT_LABELS[item.assessment]} — {item.reason}
                          </Sub>
                        );
                      })}
                    </div>
                  </Disclosure>
                </div>
              ))
            )}
            {synthesis.ungroundedClaims.length > 0 && (
              <Callout $tone="warn" style={{ marginTop: 10 }}>
                <div>
                  <strong>근거가 확인되지 않은 주장 {synthesis.ungroundedClaims.length}건</strong>
                  <Hint label="근거 확인">
                    사건 참조가 있는지는 기계가 봅니다. 그 사건이 이 주장을 뒷받침하는지는 사람이
                    판단해야 합니다.
                  </Hint>
                  <div style={{ marginTop: 4 }}>{synthesis.ungroundedClaims.join(' · ')}</div>
                </div>
              </Callout>
            )}
            {synthesis.noExperienceActors.length > 0 && (
              <Sub style={{ marginTop: 6 }}>
                이 하루에 서비스를 만나지 않은 사람:{' '}
                {synthesis.noExperienceActors.map(personName).join(', ')}
                <Hint label="서비스를 만나지 않은 사람">
                  관찰 결과이며 불만이 아닙니다. 평가 항목이 없다는 뜻입니다.
                </Hint>
              </Sub>
            )}
          </div>
        )}

        <Row>
          <Button $primary onClick={onGoToImprove}>
            이 평가에서 개선안 만들기
          </Button>
          <Hint label="개선안 만들기">
            다음 화면에서 바꿀 규칙을 고르고, 이유를 적어 실행합니다.
          </Hint>
        </Row>
      </Inner>
    </Sheet>
  );
}

function DimensionRow({
  item,
  attemptId,
  onOpenScene,
}: {
  item: ReviewItem;
  attemptId: string;
  onOpenScene: (attemptId: string, eventId: string) => void;
}) {
  // Evidence opens in place and closes back to the same item, so the round trip
  // from an evaluation to its scene and back is one explicit action each way.
  const [open, setOpen] = useState<'events' | 'evidence' | null>(null);
  return (
    <Dimension>
      <Row style={{ gap: 8 }}>
        <Tag $kind={ASSESSMENT_TAG[item.assessment]}>{ASSESSMENT_LABELS[item.assessment]}</Tag>
        <strong>{DIMENSION_LABELS[item.dimension]}</strong>
      </Row>
      <Body style={{ margin: 0 }}>{item.reason}</Body>
      <Row style={{ gap: 12 }}>
        {item.eventRefs.length > 0 && (
          <TextLink onClick={() => setOpen(open === 'events' ? null : 'events')}>
            사건 근거 {item.eventRefs.length}건 {open === 'events' ? '닫기' : '보기'}
          </TextLink>
        )}
        {item.evidenceRefs.length > 0 && (
          <TextLink onClick={() => setOpen(open === 'evidence' ? null : 'evidence')}>
            인터뷰 근거 {item.evidenceRefs.length}건 {open === 'evidence' ? '닫기' : '보기'}
          </TextLink>
        )}
        {item.assessment === 'unknown' && item.eventRefs.length === 0 && (
          <Sub as="span">겪은 일이 없어 판단하지 않음</Sub>
        )}
      </Row>
      {open === 'events' && (
        <div style={{ paddingLeft: 12 }}>
          {item.eventRefs.map((eventId) => (
            <div key={eventId} style={{ fontSize: font.small }}>
              <Mono>{eventId}</Mono>{' '}
              <TextLink onClick={() => onOpenScene(attemptId, eventId)}>그 장면 열기</TextLink>
            </div>
          ))}
        </div>
      )}
      {open === 'evidence' && (
        <div style={{ paddingLeft: 12 }}>
          {item.evidenceRefs.map((ref) => (
            <div key={ref} style={{ fontSize: font.small }}>
              <Mono>{ref}</Mono>
              <Hint label="인터뷰 근거">
                본인 페르소나의 근거 카드입니다. 원문은 권한이 있는 서버 경로에만 있고 화면과
                번들에는 들어오지 않습니다.
              </Hint>
            </div>
          ))}
        </div>
      )}
    </Dimension>
  );
}
