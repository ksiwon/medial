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
import type { DomainEvent } from '../api/types';
import { formatClock } from '../positions';
import { personName, sentenceFor } from '../selectors/story';
import { Body, Callout, Disclosure, Hint, Mono, Row, Sub, Tag, TextLink } from '../ui/primitives';
import { colour, font } from '../ui/theme';

// Screen B: the resident evaluations, as the screen the loop arrives at.
//
// Doc 19 section 9 puts Resident Evaluations at the centre. Two boundaries are
// load-bearing:
//
//  - 미경험 / 제안받고 거절 / 응답 못 함 / 미해결 are four different states and
//    none of them is a complaint. They are never sorted as negative;
//  - every evaluation is simulated, whether or not the persona came from source
//    material, and the page says so under the list.
//
// There is no total, no average, no ranking and no winner here.
//
// The layout is the exhibition wall's (2026-09-30): one row a person - who, how
// many things they went through, what they said in their own words, and when
// those things happened. People who met the service come first; everyone else
// is a quiet row saying they did not, which is not a complaint. A row whose
// review carries dimension items (the engine's reviews do; the exhibition's are
// one sentence each) opens to them - reasons, evidence, what they asked for and
// what they could not judge - with the 판단 불가 ones folded.

const Sheet = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 40px 20px 48px;
`;

const Inner = styled.div`
  max-width: 1132px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Eyebrow = styled.div`
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #e2542c;
`;

const Headline = styled.h1`
  margin: 4px 0 0;
  font-size: 32px;
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: -0.03em;
`;

const Lead = styled.p`
  margin: 0;
  max-width: 660px;
  font-size: 14.5px;
  line-height: 1.7;
  color: ${colour.secondary};
`;

const Table = styled.div`
  border: 1px solid ${colour.border};
  border-radius: 12px;
  overflow: hidden;
  background: ${colour.surface};
`;

const PersonRow = styled.div<{ $quiet: boolean }>`
  display: grid;
  grid-template-columns: 130px 64px minmax(0, 1fr);
  gap: 4px 12px;
  align-items: baseline;
  padding: ${(p) => (p.$quiet ? '12px 18px' : '16px 18px')};
  border-top: 1px solid ${colour.border};
  background: ${(p) => (p.$quiet ? '#f4f3f0' : colour.surface)};
  &:first-child { border-top: none; }
  > strong { font-size: 14px; font-weight: 800; }
  @media (max-width: 640px) {
    grid-template-columns: minmax(0, 1fr) auto;
    > div, > span:last-child { grid-column: 1 / -1; }
  }
`;

const Count = styled.span<{ $used: boolean }>`
  justify-self: start;
  font-size: 11px;
  font-weight: 800;
  border-radius: 999px;
  padding: 2px 8px;
  white-space: nowrap;
  background: ${(p) => (p.$used ? '#e6eefc' : 'transparent')};
  color: ${(p) => (p.$used ? '#1d4ed8' : colour.secondary)};
`;

const Said = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  > p { margin: 0; font-size: 14.5px; line-height: 1.6; color: ${colour.text}; }
  > small { font-size: 12px; color: ${colour.secondary}; }
`;

const Quiet = styled.span`
  font-size: 13px;
  color: ${colour.secondary};
`;

const Items = styled.div`
  align-self: stretch;
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Dimension = styled.div`
  border-top: 1px solid ${colour.border};
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Next = styled.button`
  align-self: flex-start;
  font: inherit;
  font-weight: 800;
  font-size: 15px;
  cursor: pointer;
  border: none;
  border-radius: 999px;
  padding: 12px 22px;
  background: #15150f;
  color: #ffffff;
  &:focus-visible { outline: 2px solid #e2542c; outline-offset: 2px; }
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

/** What someone went through, as the log says it: "09:30 본인에게 연락". A Task
 *  event says its title; any other event its own sentence. At most five. */
function experiencedLine(review: AgentReview, eventsById: Map<string, DomainEvent> | null): string | null {
  if (!eventsById) return null;
  const said: string[] = [];
  for (const id of review.experiencedEventIds) {
    const event = eventsById.get(id);
    if (!event) continue;
    const title = typeof event.payload.title === 'string' ? event.payload.title : sentenceFor(event)?.text;
    if (title) said.push(`${formatClock(event.simTimeMs)} ${title}`);
  }
  if (said.length === 0) return null;
  return said.length > 5 ? `${said.slice(0, 5).join(' · ')} 외 ${said.length - 5}건` : said.join(' · ');
}

interface Props {
  detail: SessionDetail;
  generation: GenerationDetail | null;
  /** Everyone in the village, so a person without a review is still listed -
   *  as not having met the service, never as a blank or a complaint. */
  residents: string[];
  /** Opens the cited scene on the experience screen and moves its cursor. A
   *  read of a stored log; no adapter runs. */
  onOpenScene: (attemptId: string, eventId: string) => void;
  onGoToImprove: () => void;
  /** The small line above the title: which version, or which day ended. */
  eyebrow: string;
  /** The log of the attempt being read, so what people went through can be
   *  said as what happened rather than as ids. Absent or another attempt: ids only. */
  events?: { attemptId: string; list: DomainEvent[] } | null;
}

export default function EvaluationsScreen({
  detail,
  generation,
  residents,
  onOpenScene,
  onGoToImprove,
  eyebrow,
  events = null,
}: Props) {
  const reviews = useMemo(() => sortReviews(generation?.reviews ?? []), [generation]);
  const [openId, setOpenId] = useState<string | null>(null);
  const eventsById = useMemo(() => new Map((events?.list ?? []).map((e) => [e.id, e])), [events]);
  const synthesis = generation?.synthesis ?? null;

  if (!generation || reviews.length === 0) {
    return (
      <Sheet>
        <Inner>
          <Headline>주민 평가</Headline>
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

  // Met the service: anything but 미경험. Everyone else, reviewed or not, is one
  // quiet row - the review of someone who went through nothing says nothing.
  const met = reviews.filter((r) => r.usageStatus !== 'no_experience');
  const reviewed = new Set(reviews.map((r) => r.actorId));
  const quiet = [
    ...reviews.filter((r) => r.usageStatus === 'no_experience').map((r) => r.actorId),
    ...residents.filter((id) => !reviewed.has(id)),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return (
    <Sheet>
      <Inner>
        <div>
          <Eyebrow>{eyebrow}</Eyebrow>
          <Headline>주민 평가</Headline>
        </div>
        <Lead>
          각자 <strong style={{ color: colour.text }}>자기가 겪은 일만</strong> 근거로 말합니다. 겪지 않은
          사람은 아래에 따로 두고, 불만족으로 세지 않습니다. 점수도 순위도 매기지 않습니다.
        </Lead>

        <Table>
          {met.map((review) => {
            const cited = events?.attemptId === review.attemptId ? eventsById : null;
            const line = experiencedLine(review, cited);
            const judged = review.items.filter((item) => item.assessment !== 'unknown');
            const abstained = review.items.filter((item) => item.assessment === 'unknown');
            const open = openId === review.id;
            return (
              <PersonRow key={review.id} $quiet={false}>
                <strong>{personName(review.actorId)}</strong>
                <Count $used>겪음 {review.experiencedEventIds.length}건</Count>
                <Said>
                  <p>{review.overallNarrative}</p>
                  {line && <small>{line}</small>}
                  {review.items.length > 0 && (
                    <TextLink onClick={() => setOpenId(open ? null : review.id)}>
                      {open ? '평가 항목 닫기' : `평가 항목 ${review.items.length}개 보기`}
                    </TextLink>
                  )}
                  {open && (
                    <Items>
                      {judged.map((item) => (
                        <DimensionRow key={item.dimension} item={item} attemptId={review.attemptId}
                          eventsById={cited} onOpenScene={onOpenScene} />
                      ))}
                      {abstained.length > 0 && (
                        <Disclosure>
                          <summary>
                            판단 불가 {abstained.length}개 —{' '}
                            {abstained.map((item) => DIMENSION_LABELS[item.dimension]).join(', ')}
                          </summary>
                          <div>
                            {abstained.map((item) => (
                              <DimensionRow key={item.dimension} item={item} attemptId={review.attemptId}
                                eventsById={cited} onOpenScene={onOpenScene} />
                            ))}
                          </div>
                        </Disclosure>
                      )}
                      {review.items.some((i) => i.requestedChange) && (
                        <div>
                          <Sub>요청한 변경</Sub>
                          <ul style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                            {review.items.filter((i) => i.requestedChange).map((item, index) => (
                              <li key={index}>{item.requestedChange}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {review.unknowns.length > 0 && (
                        <div>
                          <Sub>판단할 수 없는 것</Sub>
                          <ul style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                            {review.unknowns.map((unknown) => <li key={unknown}>{unknown}</li>)}
                          </ul>
                        </div>
                      )}
                      <Sub>
                        {USAGE_LABELS[review.usageStatus]} · {review.adapter} 어댑터 · 리뷰{' '}
                        <Mono>{review.id}</Mono>
                      </Sub>
                    </Items>
                  )}
                </Said>
              </PersonRow>
            );
          })}
          {quiet.map((id) => (
            <PersonRow key={id} $quiet>
              <strong>{personName(id)}</strong>
              <Count $used={false}>미경험</Count>
              <Quiet>오늘 이 서비스와 아무 일도 겪지 않았습니다.</Quiet>
            </PersonRow>
          ))}
        </Table>

        <Sub>
          합성 평가입니다. 실제 주민의 만족도나 동의가 아니며, 나중에 실제 주민이 확인·반박할 대상입니다.
        </Sub>

        {synthesis && synthesis.issueGroups.length > 0 && (
          <Disclosure>
            <summary>쟁점 묶음 {synthesis.issueGroups.length}개 · 원본 평가의 읽기용 요약</summary>
            <div>
              {synthesis.issueGroups.map((issue) => (
                <div key={issue.id} style={{ marginTop: 8 }}>
                  <Row style={{ gap: 6, flexWrap: 'wrap' }}>
                    <Tag $kind={issue.minority ? 'warn' : 'neutral'}>{DIMENSION_LABELS[issue.dimension]}</Tag>
                    {issue.minority && <Tag $kind="warn">소수 의견</Tag>}
                    <strong>{issue.title}</strong>
                  </Row>
                  {issue.reviewItemRefs.map((ref) => {
                    const [reviewId, indexText] = ref.split('#');
                    const review = reviews.find((r) => r.id === reviewId);
                    const item = review?.items[Number(indexText)];
                    return review && item ? (
                      <Sub key={ref}>
                        <strong>{personName(review.actorId)}</strong> · {ASSESSMENT_LABELS[item.assessment]} —{' '}
                        {item.reason}
                      </Sub>
                    ) : null;
                  })}
                </div>
              ))}
            </div>
          </Disclosure>
        )}

        <Next onClick={onGoToImprove}>이 평가를 보고 무엇을 고칠지 고른다</Next>
      </Inner>
    </Sheet>
  );
}

function DimensionRow({
  item,
  attemptId,
  eventsById,
  onOpenScene,
}: {
  item: ReviewItem;
  attemptId: string;
  eventsById: Map<string, DomainEvent> | null;
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
          {item.eventRefs.map((eventId) => {
            // What happened, in the log's own sentence, when this attempt's log
            // is loaded; the id otherwise. No sentence is made up here.
            const event = eventsById?.get(eventId) ?? null;
            const said = event ? sentenceFor(event)?.text ?? null : null;
            return (
              <div key={eventId} style={{ fontSize: font.small }}>
                {event && said ? (
                  <>
                    <Mono>{formatClock(event.simTimeMs)}</Mono> {said}
                  </>
                ) : (
                  <Mono>{eventId}</Mono>
                )}{' '}
                <TextLink onClick={() => onOpenScene(attemptId, eventId)}>그 장면 열기</TextLink>
              </div>
            );
          })}
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
