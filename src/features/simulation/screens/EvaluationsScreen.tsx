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
import Portrait from '../ui/Portrait';
import { beckon, pill } from '../ui/primitives';
import { accentA, font, inkA, night, px, radius, space } from '../ui/theme';

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

/** The day's setting and who is here: the thing the people below are evaluating. */
const Context = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.sm} ${space.xl};
  padding: ${space.md} ${space.lg};
  border-radius: ${radius.card};
  background: ${night.panel};
  border: 1px solid ${night.line};
  font-size: ${px(16)};
  color: ${night.mute};
  /* The setting, and what is said about who is here, are separate things that
     wrap as wholes: a bold label and a muted sentence on one line break in the middle. */
  > div { display: flex; align-items: center; gap: ${space.md}; white-space: nowrap; color: ${night.ink}; font-weight: 800; }
  > span { white-space: nowrap; }
  > span > b { color: ${night.ink}; font-weight: 800; }
  > span.long { white-space: normal; min-width: min(100%, ${px(320)}); flex: 1; }
`;

const ContextTag = styled.span`
  ${pill('md')}
  font-weight: 800;
  background: ${night.accent};
  color: #fff;
`;

const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(560px * var(--k, 1))), 1fr));
  gap: ${space.lg};
  align-items: start;
  /* A wall screen has the width for every resident of the day side by side. */
  @media (min-width: 2000px) {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(300px * var(--k, 1))), 1fr));
    > article { padding: ${space.lg} ${space.lg} ${space.lg}; gap: ${space.lg}; }
    > article blockquote { font-size: ${px(20)}; padding-top: ${space.xl}; }
  }
`;

const Card = styled.article`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
  padding: ${space.xl} ${space.xl} ${space.xl};
  border: 1px solid ${night.line};
  border-radius: ${radius.card};
  background: ${night.panel};
`;

const Who = styled.header`
  display: flex;
  align-items: center;
  gap: ${space.lg};
`;

const Name = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  min-width: 0;
  > strong { font-size: ${px(28)}; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
  > div { display: flex; flex-wrap: wrap; gap: ${px(8)}; }
`;

const Chip = styled.span<{ $strong?: boolean }>`
  ${pill('xs')}
  font-weight: 800;
  color: ${(p) => (p.$strong ? night.deep : night.mute)};
  background: ${(p) => (p.$strong ? night.ink : 'rgba(246, 241, 232, 0.1)')};
`;

/** What they said, as the card's centre: their own words, large, under an open quote. */
const Quote = styled.blockquote`
  position: relative;
  margin: 0;
  padding: ${space.xl} 0 0;
  font-size: ${px(24)};
  line-height: 1.62;
  font-weight: 500;
  letter-spacing: -0.02em;
  color: ${night.ink};
  word-break: keep-all;
  &::before {
    content: '“';
    position: absolute;
    left: calc(-2px * var(--k, 1));
    top: calc(-8px * var(--k, 1));
    font-family: Georgia, 'Times New Roman', serif;
    font-size: ${px(76)};
    line-height: 1;
    color: ${night.accent};
  }
`;

const Label = styled.div`
  font-size: ${px(12)};
  font-weight: 800;
  letter-spacing: 0.1em;
  color: ${night.faint};
`;

/** The day's events the person went through, on one thread, in the order they happened. */
const WentList = styled.ol`
  position: relative;
  margin: ${space.md} 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  &::before {
    content: '';
    position: absolute;
    left: ${px(4)};
    top: ${px(12)};
    bottom: ${px(12)};
    width: 1px;
    background: ${inkA(0.22)};
  }
  > li {
    position: relative;
    display: flex;
    align-items: baseline;
    gap: ${space.md};
    padding-left: ${px(24)};
    font-size: ${px(16)};
    line-height: 1.45;
  }
  > li::before {
    content: '';
    position: absolute;
    left: 0;
    top: ${px(8)};
    width: ${px(12)};
    height: ${px(12)};
    border-radius: ${radius.round};
    background: ${night.panel};
    border: 2px solid ${night.ink};
  }
  > li > time { flex: none; font-weight: 800; font-variant-numeric: tabular-nums; color: ${night.ink}; }
  > li > span { min-width: 0; color: ${night.mute}; }
`;

/** What they asked to be different: the line a designer acts on. */
const Asked = styled.div`
  padding: ${space.lg} ${space.lg} ${space.lg};
  border-radius: ${radius.card};
  background: ${night.accentSoft};
  border: 1px solid ${accentA(0.45)};
  > ul { margin: ${px(8)} 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: ${px(8)}; }
  > ul > li { font-size: ${px(20)}; line-height: 1.5; font-weight: 700; color: ${night.ink}; word-break: keep-all; }
  > ul > li::before { content: '→ '; color: ${night.accent}; font-weight: 800; }
  > div:first-child { color: ${night.accent}; }
`;

const Yesterday = styled.div`
  font-size: ${px(16)};
  line-height: 1.7;
  color: ${night.mute};
  margin-top: ${px(8)};
  word-break: keep-all;
`;

const Items = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space.md};
`;

const Dimension = styled.div`
  border-top: 1px solid ${night.line};
  padding-top: ${px(16)};
  display: flex;
  flex-direction: column;
  gap: ${space.xs};
  font-size: ${px(16)};
  line-height: 1.6;
  color: ${night.mute};
  > div:nth-child(2) { color: ${night.ink}; }
`;

const Link = styled.button`
  font: inherit;
  font-size: ${px(12)};
  font-weight: 700;
  color: ${night.mute};
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-decoration: underline;
  text-decoration-color: ${inkA(0.3)};
  text-underline-offset: 4px;
  &:hover { color: ${night.ink}; text-decoration-color: ${night.accent}; }
  &:focus-visible { outline: 2px solid ${night.accent}; outline-offset: 2px; }
`;

/** A fold that stays quiet until it is wanted: yesterday's words, the judged items. */
const Fold = styled.details`
  font-size: ${px(16)};
  color: ${night.mute};
  > summary {
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    gap: ${space.sm};
    padding: ${space.sm} 0;
    border-top: 1px solid ${night.line};
    font-weight: 700;
    color: ${night.mute};
  }
  > summary::-webkit-details-marker { display: none; }
  > summary::before { content: '＋'; color: ${night.accent}; font-weight: 800; }
  &[open] > summary::before { content: '－'; }
  > summary:hover { color: ${night.ink}; }
`;

const Mono = styled.span`
  font-family: ui-monospace, 'SF Mono', Consolas, monospace;
  font-size: 0.92em;
  color: ${night.mute};
`;

const Note = styled.p`
  margin: 0;
  font-size: ${px(12)};
  line-height: 1.6;
  color: ${night.faint};
`;

const Next = styled.button`
  ${pill('lg')}
  ${beckon}
  align-self: flex-start;
  height: ${px(56)};
  padding: 0 ${space.xl};
  font: inherit;
  font-size: ${px(20)};
  font-weight: 800;
  cursor: pointer;
  border: none;
  background: ${night.accent};
  color: #ffffff;
  transition: transform 0.15s ease;
  &::after { content: '→'; margin-left: ${px(4)}; }
  &:hover { transform: translateY(-2px); }
  &:focus-visible { outline: 2px solid ${night.ink}; outline-offset: 4px; }
`;

const Empty = styled.div`
  padding: ${space.xl};
  border-radius: ${radius.card};
  background: ${night.panel};
  border: 1px solid ${night.line};
  font-size: ${px(16)};
  color: ${night.mute};
`;

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
  /** Which pictures were drawn, for the faces on the cards. */
  art?: ReadonlySet<string>;
}

const NO_ART: ReadonlySet<string> = new Set();

export default function EvaluationsScreen({
  detail,
  generation,
  residents,
  onOpenScene,
  onGoToImprove,
  eyebrow,
  events = null,
  art = NO_ART,
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
          <Empty>
            {detail.running
              ? '아직 이 버전의 주민 평가를 모으는 중입니다. 끝나면 여기에 나타납니다.'
              : '이 버전에는 주민 평가 기록이 없습니다. 사례와 서비스 경험에서 하루를 실행하세요.'}
          </Empty>
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
          <div>
            <ContextTag>이 날의 설정</ContextTag>
            <span>{generation.label}</span>
          </div>
          <span>서비스를 겪고 평가한 주민 <b>{asked.length}명</b></span>
          {others > 0 && (
            <span className="long">나머지 {others}명은 겪은 일이 없어 평가에 넣지 않았고, 불만족으로 세지 않습니다</span>
          )}
        </Context>

        <Cards>
          {asked.map((review) => (
            <PersonCard key={review.id} review={review} art={art}
              cited={events?.attemptId === review.attemptId ? eventsById : null}
              yesterday={before.get(review.actorId) ?? null}
              yesterdayName={parentDay?.label ?? null}
              onOpenScene={onOpenScene} />
          ))}
        </Cards>

        {synthesis && synthesis.issueGroups.length > 0 && (
          <Fold>
            <summary>쟁점 묶음 {synthesis.issueGroups.length}개 · 원본 평가의 읽기용 요약</summary>
            <div>
              {synthesis.issueGroups.map((issue) => (
                <div key={issue.id} style={{ marginTop: 12 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <Chip>{DIMENSION_LABELS[issue.dimension]}</Chip>
                    {issue.minority && <Chip $strong>소수 의견</Chip>}
                    <strong style={{ color: night.ink }}>{issue.title}</strong>
                  </div>
                  {issue.reviewItemRefs.map((ref) => {
                    const [reviewId, indexText] = ref.split('#');
                    const review = asked.find((r) => r.id === reviewId);
                    const item = review?.items[Number(indexText)];
                    return review && item ? (
                      <Note key={ref}>
                        <strong>{personName(review.actorId)}</strong> · {ASSESSMENT_LABELS[item.assessment]} —{' '}
                        {item.reason}
                      </Note>
                    ) : null;
                  })}
                </div>
              ))}
            </div>
          </Fold>
        )}

        <Note>
          합성 평가입니다. 실제 주민의 만족도나 동의가 아니며, 나중에 실제 주민이 확인·반박할 대상입니다.
        </Note>
        {/* The last day has nothing left to change: its evaluations lead to the result. */}
        <Next onClick={onGoToImprove}>
          {generation.changeSets.length > 0 ? '이 평가를 보고 무엇을 고칠지 고른다' : '결과 보러 가기'}
        </Next>
      </Inner>
    </Sheet>
  );
}

function PersonCard({
  review,
  art,
  cited,
  yesterday,
  yesterdayName,
  onOpenScene,
}: {
  review: AgentReview;
  art: ReadonlySet<string>;
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
        <Portrait actorId={review.actorId} art={art} size={84} />
        <Name>
          <strong>{personName(review.actorId)}</strong>
          <div>
            <Chip>{ROLE_LABELS[review.actorRole]}</Chip>
            <Chip $strong>겪은 일 {review.experiencedEventIds.length}건</Chip>
          </div>
        </Name>
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
                  <Link onClick={() => onOpenScene(review.attemptId, w.id)}>장면 보기</Link>
                </span>
              </li>
            ))}
          </WentList>
        </div>
      )}

      {yesterday && yesterdayName && (
        <Fold>
          <summary>{yesterdayName} 날에는 이렇게 말했습니다</summary>
          <Yesterday>{yesterday.overallNarrative}</Yesterday>
        </Fold>
      )}

      {review.items.length > 0 && (
        <>
          <Link style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(!open)}>
            {open ? '평가 항목 닫기' : `평가 항목 ${review.items.length}개 보기`}
          </Link>
          {open && (
            <Items>
              {judged.map((item) => (
                <DimensionRow key={item.dimension} item={item} attemptId={review.attemptId}
                  eventsById={cited} onOpenScene={onOpenScene} />
              ))}
              {abstained.length > 0 && (
                <Fold>
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
                </Fold>
              )}
              {review.unknowns.length > 0 && (
                <div>
                  <Label>판단할 수 없는 것</Label>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.7, color: night.mute }}>
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Chip $strong={item.assessment === 'negative'}>{ASSESSMENT_SAYS[item.assessment]}</Chip>
        <strong style={{ color: night.ink }}>{DIMENSION_LABELS[item.dimension]}</strong>
      </div>
      <div>{item.reason}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' }}>
        {item.eventRefs.length > 0 && (
          <Link onClick={() => setOpen(open === 'events' ? null : 'events')}>
            사건 근거 {item.eventRefs.length}건 {open === 'events' ? '닫기' : '보기'}
          </Link>
        )}
        {item.evidenceRefs.length > 0 && (
          <Link onClick={() => setOpen(open === 'evidence' ? null : 'evidence')}>
            인터뷰 근거 {item.evidenceRefs.length}건 {open === 'evidence' ? '닫기' : '보기'}
          </Link>
        )}
        {item.assessment === 'unknown' && item.eventRefs.length === 0 && (
          <Note as="span">겪은 일이 없어 판단하지 않음</Note>
        )}
      </div>
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
                <Link onClick={() => onOpenScene(attemptId, eventId)}>그 장면 열기</Link>
              </div>
            );
          })}
        </div>
      )}
      {open === 'evidence' && (
        <div style={{ paddingLeft: 12 }}>
          {item.evidenceRefs.map((ref) => (
            <div key={ref} style={{ fontSize: font.small }}>
              <Mono>{ref}</Mono>{' '}
              <Note as="span">
                본인 페르소나의 근거 카드입니다. 원문은 권한이 있는 서버 경로에만 있고 화면과
                번들에는 들어오지 않습니다.
              </Note>
            </div>
          ))}
        </div>
      )}
    </Dimension>
  );
}
