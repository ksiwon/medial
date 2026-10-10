import { useMemo, useState } from 'react';
import styled from 'styled-components';
import {
  ASSESSMENT_LABELS,
  DIMENSION_LABELS,
  type AgentReview,
  type Assessment,
  type GenerationDetail,
  type ReviewItem,
  type SessionDetail,
} from '../api/iteration';
import type { DomainEvent } from '../api/types';
import { formatClock } from '../positions';
import { personName, sentenceFor } from '../selectors/story';
import { Inner, PageHead, Sheet } from '../ui/page';
import { Body, Callout, Disclosure, Hint, Mono, Row, Sub, Tag, TextLink, pill } from '../ui/primitives';
import { colour, font, night, px } from '../ui/theme';

// Screen B: the resident evaluations, as the screen the loop arrives at.
//
// Doc 19 section 9 puts Resident Evaluations at the centre. Two boundaries are
// load-bearing:
//
//  - a resident who went through nothing that day is not here: nothing was
//    experienced, so nothing is evaluated, and their silence is not a complaint
//    or a score. The page says how many there were, once, and no more;
//  - every evaluation is simulated, whether or not the persona came from source
//    material, and the page says so under the cards.
//
// There is no total, no average, no ranking and no winner here.
//
// What a service designer reads (2026-10-10), per resident who went through the
// day and was asked: who they are, what the service did to them (the day's own
// events, each one opening its scene), what they said in their own words, what
// they asked to change, and what they said the day before. A card whose review
// carries dimension items (the engine's reviews do; the exhibition's are one
// paragraph each) opens to them - reasons, evidence, what they could not judge.

/** What day this is and what was in force: the thing the people below are
 *  evaluating. */
const Context = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${px(8)} ${px(14)};
  font-size: ${px(14.5)};
  color: ${colour.secondary};
  > b, > span > b { color: ${colour.text}; font-weight: 800; }
`;

const ContextTag = styled.span`
  ${pill('md')}
  font-weight: 800;
  background: ${night.deep};
  color: #fff;
`;

const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(520px * var(--k, 1))), 1fr));
  gap: ${px(16)};
  align-items: start;
`;

const Card = styled.article`
  display: flex;
  flex-direction: column;
  gap: ${px(14)};
  padding: ${px(20)} ${px(22)};
  border: 1px solid ${colour.border};
  border-radius: 14px;
  background: ${colour.surface};
`;

const Who = styled.header`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${px(8)};
  > strong { font-size: ${px(17)}; font-weight: 800; letter-spacing: -0.02em; }
`;

const Role = styled.span`
  ${pill('xs')}
  font-weight: 800;
  color: ${colour.secondary};
  background: #f1efea;
`;

const Count = styled.span`
  ${pill('xs')}
  margin-left: auto;
  font-weight: 800;
  background: #e6eefc;
  color: #1d4ed8;
`;

/** What they said, as the card's centre: their own words, set apart. */
const Quote = styled.blockquote`
  margin: 0;
  padding: ${px(2)} 0 ${px(2)} ${px(16)};
  border-left: 4px solid ${night.accent};
  font-size: ${px(16)};
  line-height: 1.7;
  letter-spacing: -0.01em;
  color: ${colour.text};
  word-break: keep-all;
`;

const Label = styled.div`
  font-size: ${px(11.5)};
  font-weight: 800;
  letter-spacing: 0.06em;
  color: ${colour.secondary};
`;

/** The day's events the person went through, in the order they happened. */
const WentList = styled.ol`
  margin: ${px(6)} 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: ${px(4)};
  > li { display: flex; align-items: baseline; gap: ${px(10)}; font-size: ${px(14)}; line-height: 1.5; }
  > li > time { flex: none; font-weight: 800; font-variant-numeric: tabular-nums; color: ${colour.text}; }
  > li > span { min-width: 0; color: ${colour.text}; }
`;

/** What they asked to be different: the line a designer acts on. */
const Asked = styled.div`
  padding: ${px(12)} ${px(14)};
  border-radius: 10px;
  background: #fdf1ec;
  > ul { margin: ${px(6)} 0 0; padding-left: ${px(18)}; font-size: ${px(14.5)}; line-height: 1.6; color: ${colour.text}; font-weight: 700; }
`;

const Yesterday = styled.div`
  font-size: ${px(14)};
  line-height: 1.65;
  color: ${colour.secondary};
  margin-top: ${px(4)};
`;

const Items = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${px(10)};
`;

const Dimension = styled.div`
  border-top: 1px solid ${colour.border};
  padding-top: ${px(10)};
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Next = styled.button`
  ${pill('lg')}
  align-self: flex-start;
  font: inherit;
  font-weight: 800;
  cursor: pointer;
  border: none;
  background: ${night.deep};
  color: #ffffff;
  &:focus-visible { outline: 2px solid ${night.accent}; outline-offset: 2px; }
`;

const ASSESSMENT_TAG: Record<Assessment, 'positive' | 'mixed' | 'negative' | 'unknown'> = {
  positive: 'positive',
  mixed: 'mixed',
  negative: 'negative',
  unknown: 'unknown',
};

/** What a service designer reads an assessment as. */
const ASSESSMENT_SAYS: Record<Assessment, string> = {
  positive: '좋았던 점',
  mixed: '엇갈린 점',
  negative: '불편했던 점',
  unknown: '판단 불가',
};

const ROLE_LABELS: Record<AgentReview['actorRole'], string> = {
  resident: '주민',
  village_head: '이장',
  health_staff: '보건소 직원',
  health_director: '보건소장',
};

function byActor(a: AgentReview, b: AgentReview) {
  return a.actorId.localeCompare(b.actorId, undefined, { numeric: true });
}

interface WentRow { id: string; time: string; title: string }

/** What someone went through, as the log says it: "09:30 본인에게 연락". A Task
 *  event says its title; any other event its own sentence. */
function wentThrough(review: AgentReview, eventsById: Map<string, DomainEvent> | null): WentRow[] {
  if (!eventsById) return [];
  const said: WentRow[] = [];
  const seen = new Set<string>();
  for (const id of review.experiencedEventIds) {
    const event = eventsById.get(id);
    if (!event) continue;
    const title = typeof event.payload.title === 'string' ? event.payload.title : sentenceFor(event)?.text;
    if (!title) continue;
    const time = formatClock(event.simTimeMs);
    if (seen.has(`${time} ${title}`)) continue;
    seen.add(`${time} ${title}`);
    said.push({ id, time, title });
  }
  return said;
}

interface Props {
  detail: SessionDetail;
  generation: GenerationDetail | null;
  /** Everyone in the village: only to say how many went through nothing. */
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
  // Only those who went through the day and were asked. A review of someone who
  // went through nothing says nothing, so it is not shown.
  const asked = useMemo(
    () => (generation?.reviews ?? []).filter((r) => r.usageStatus !== 'no_experience').sort(byActor),
    [generation],
  );
  const eventsById = useMemo(() => new Map((events?.list ?? []).map((e) => [e.id, e])), [events]);
  const synthesis = generation?.synthesis ?? null;
  const parentDay = detail.generations.find((g) => g.id === generation?.parentGenerationId) ?? null;
  const before = useMemo(
    () => new Map((parentDay?.reviews ?? []).filter((r) => r.usageStatus !== 'no_experience').map((r) => [r.actorId, r])),
    [parentDay],
  );

  if (!generation || asked.length === 0) {
    return (
      <Sheet>
        <Inner>
          <PageHead title="주민 평가" />
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

  const others = residents.filter((id) => !asked.some((r) => r.actorId === id)).length;

  return (
    <Sheet>
      <Inner>
        <PageHead eyebrow={eyebrow} title="주민 평가" />
        <Context>
          <ContextTag>이 날의 설정</ContextTag>
          <b>{generation.label}</b>
          <span>
            · 서비스를 겪고 평가한 주민 <b>{asked.length}명</b>
            {others > 0 && ` · 나머지 ${others}명은 겪은 일이 없어 평가에 넣지 않았고, 불만족으로 세지 않습니다`}
          </span>
        </Context>

        <Cards>
          {asked.map((review) => (
            <PersonCard key={review.id} review={review}
              cited={events?.attemptId === review.attemptId ? eventsById : null}
              yesterday={before.get(review.actorId) ?? null}
              yesterdayName={parentDay?.label ?? null}
              onOpenScene={onOpenScene} />
          ))}
        </Cards>

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
                    const review = asked.find((r) => r.id === reviewId);
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

function PersonCard({
  review,
  cited,
  yesterday,
  yesterdayName,
  onOpenScene,
}: {
  review: AgentReview;
  cited: Map<string, DomainEvent> | null;
  yesterday: AgentReview | null;
  yesterdayName: string | null;
  onOpenScene: (attemptId: string, eventId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const went = wentThrough(review, cited);
  const judged = review.items.filter((item) => item.assessment !== 'unknown');
  const abstained = review.items.filter((item) => item.assessment === 'unknown');
  const asks = review.items.map((i) => i.requestedChange).filter((c): c is string => Boolean(c));
  return (
    <Card title={`${review.adapter} 어댑터 · ${review.id}`}>
      <Who>
        <strong>{personName(review.actorId)}</strong>
        <Role>{ROLE_LABELS[review.actorRole]}</Role>
        <Count>겪은 일 {review.experiencedEventIds.length}건</Count>
      </Who>

      <Quote>{review.overallNarrative}</Quote>

      {asks.length > 0 && (
        <Asked>
          <Label>바라는 것</Label>
          <ul>{asks.map((ask, index) => <li key={index}>{ask}</li>)}</ul>
        </Asked>
      )}

      {went.length > 0 && (
        <div>
          <Label>겪은 일</Label>
          <WentList>
            {went.map((w) => (
              <li key={w.id}>
                <time>{w.time}</time>
                <span>
                  {w.title}{' '}
                  <TextLink onClick={() => onOpenScene(review.attemptId, w.id)}>장면 보기</TextLink>
                </span>
              </li>
            ))}
          </WentList>
        </div>
      )}

      {yesterday && yesterdayName && (
        <Disclosure>
          <summary>{yesterdayName} 날에는 이렇게 말했습니다</summary>
          <Yesterday>{yesterday.overallNarrative}</Yesterday>
        </Disclosure>
      )}

      {review.items.length > 0 && (
        <>
          <TextLink style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(!open)}>
            {open ? '평가 항목 닫기' : `평가 항목 ${review.items.length}개 보기`}
          </TextLink>
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
              {review.unknowns.length > 0 && (
                <div>
                  <Label>판단할 수 없는 것</Label>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
                    {review.unknowns.map((unknown) => <li key={unknown}>{unknown}</li>)}
                  </ul>
                </div>
              )}
            </Items>
          )}
        </>
      )}
    </Card>
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
        <Tag $kind={ASSESSMENT_TAG[item.assessment]}>{ASSESSMENT_SAYS[item.assessment]}</Tag>
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
