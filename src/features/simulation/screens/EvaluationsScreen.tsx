import { useEffect, useMemo, useRef, useState } from 'react';
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
import { askedReviews, pagesOf, PER_PAGE, wentThrough } from '../selectors/evaluations';
import { personName, sentenceFor } from '../selectors/story';
import { Inner, PageHead, Sheet } from '../ui/page';
import Portrait from '../ui/Portrait';
import { pill } from '../ui/primitives';
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
// paragraph each) has them in the interview page - reasons, evidence, what they
// could not judge.
//
// Two screens (2026-10-16): this one is the wall and nothing on it can be pressed.
// The cards are every resident who was asked; when the tablet picks one person the
// wall shows that person's whole interview instead, and the tablet brings the cards
// back. Which page, whose interview and the issue groups are the iteration store's,
// set by the tablet's presses (stage/wall.ts).

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
    /* A page holds five residents (PER_PAGE): five columns, so none drops to a second row. */
    grid-template-columns: repeat(5, minmax(0, 1fr));
    > article { padding: ${space.lg} ${space.lg} ${space.lg}; gap: ${space.lg}; }
    > article blockquote { font-size: ${px(16)}; line-height: 1.6; padding-top: ${space.lg}; }
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




const Count = styled.span`
  font-size: ${px(16)};
  font-weight: 700;
  color: ${night.mute};
  font-variant-numeric: tabular-nums;
`;

const Empty = styled.div`
  padding: ${space.xl};
  border-radius: ${radius.card};
  background: ${night.panel};
  border: 1px solid ${night.line};
  font-size: ${px(16)};
  color: ${night.mute};
`;

/** One person's interview: what they said and went through on the left, what they judged on the right. */
const Interview = styled.article<{ $wide: boolean }>`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: ${space.xl};
  padding: ${space.xl};
  border: 1px solid ${night.line};
  border-radius: ${radius.card};
  background: ${night.panel};
  @media (min-width: 1400px) {
    grid-template-columns: ${(p) => (p.$wide ? 'minmax(0, 1fr)' : 'minmax(0, 5fr) minmax(0, 6fr)')};
    gap: ${space.xxl};
    padding: ${space.xxl};
  }
  > section { display: flex; flex-direction: column; gap: ${space.lg}; min-width: 0; }
  blockquote { font-size: ${px(28)}; }
  /* A review that is one paragraph has no items to put beside it: the words take the width. */
  blockquote { max-width: ${(p) => (p.$wide ? px(1200) : 'none')}; }
`;

const Issue = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  padding: ${space.lg};
  border-radius: ${radius.card};
  background: ${night.panel};
  border: 1px solid ${night.line};
  font-size: ${px(16)};
  line-height: 1.6;
  color: ${night.mute};
  > header { display: flex; flex-wrap: wrap; gap: ${space.sm}; align-items: center; color: ${night.ink}; }
`;

const IssueGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(420px * var(--k, 1))), 1fr));
  gap: ${space.lg};
`;

const Foot = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.lg};
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

interface Props {
  detail: SessionDetail;
  generation: GenerationDetail | null;
  /** Everyone in the village: only to say how many went through nothing. */
  residents: string[];
  /** The small line above the title: which version, or which day ended. */
  eyebrow: string;
  /** Which page of cards, whose interview is open (null: the cards), and whether the issue groups are open. */
  page: number;
  openActor: string | null;
  issues: boolean;
  /** The wall goes on by itself, as the single screen did: the next page, then the choice (or the result). */
  onPage: (page: number) => void;
  onGoToImprove: () => void;
  /** An interview left open and unattended goes back to the cards. */
  onCloseOpen: () => void;
  /** The log of the attempt being read, so what people went through can be
   *  said as what happened rather than as ids. Absent or another attempt: ids only. */
  events?: { attemptId: string; list: DomainEvent[] } | null;
  /** Which pictures were drawn, for the faces on the cards. */
  art?: ReadonlySet<string>;
}

const NO_ART: ReadonlySet<string> = new Set();

/** How long a page of evaluations stays before the walk goes on by itself, in seconds: the next page, or the choice. */
export const EVAL_WAIT_S = 15;

/** How long an interview or the issue groups stay open with no press before the cards come back, in seconds. */
export const OPEN_WAIT_S = 60;

export default function EvaluationsScreen({
  detail, generation, residents, eyebrow, page, openActor, issues, onPage, onGoToImprove, onCloseOpen,
  events = null, art = NO_ART,
}: Props) {
  const asked = useMemo(() => askedReviews(generation), [generation]);
  const eventsById = useMemo(() => new Map((events?.list ?? []).map((e) => [e.id, e])), [events]);
  const pages = pagesOf(asked.length);
  const open = openActor ? asked.find((r) => r.actorId === openActor) ?? null : null;
  const reading = open !== null || issues;

  // The countdown belongs to what is on the wall: a new page, interview or issue list starts it afresh,
  // and the old count is never read for the new one.
  const slot = `${generation?.id}:${page}:${openActor ?? ''}:${issues}`;
  const limit = reading ? OPEN_WAIT_S : EVAL_WAIT_S;
  const [wait, setWait] = useState({ slot, left: limit });
  useEffect(() => {
    setWait({ slot, left: limit });
    const tick = window.setInterval(() => setWait((w) => (w.slot === slot ? { slot, left: w.left - 1 } : w)), 1000);
    return () => window.clearInterval(tick);
  }, [slot, limit]);
  const left = wait.slot === slot ? wait.left : limit;
  const act = useRef({ onPage, onGoToImprove, onCloseOpen });
  act.current = { onPage, onGoToImprove, onCloseOpen };
  useEffect(() => {
    if (wait.slot !== slot || wait.left > 0 || asked.length === 0) return;
    if (reading) act.current.onCloseOpen();
    else if (page < pages - 1) act.current.onPage(page + 1);
    else act.current.onGoToImprove();
  }, [wait, slot, page, pages, asked.length, reading]);

  const synthesis = generation?.synthesis ?? null;
  const parentDay = detail.generations.find((g) => g.id === generation?.parentGenerationId) ?? null;
  const before = useMemo(
    () => new Map(askedReviews(parentDay).map((r) => [r.actorId, r])),
    [parentDay],
  );

  if (!generation || asked.length === 0) {
    return (
      <Sheet>
        <Inner>
          <PageHead title="주민 에이전트 평가" />
          <Empty>
            {detail.running
              ? '아직 이 버전의 주민 에이전트 평가를 모으는 중입니다. 끝나면 여기에 나타납니다.'
              : '이 버전에는 주민 에이전트 평가 기록이 없습니다.'}
          </Empty>
        </Inner>
      </Sheet>
    );
  }

  const others = residents.filter((id) => !asked.some((r) => r.actorId === id)).length;
  const cited = (review: AgentReview) => (events?.attemptId === review.attemptId ? eventsById : null);

  return (
    <Sheet>
      <Inner>
        <PageHead eyebrow={eyebrow} title={open ? `${personName(open.actorId)}의 인터뷰` : issues ? '쟁점 묶음' : '주민 에이전트 평가'} />
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

        {open ? (
          <InterviewPage review={open} art={art} cited={cited(open)} yesterday={before.get(open.actorId) ?? null}
            yesterdayName={parentDay?.label ?? null} />
        ) : issues && synthesis ? (
          <IssueGrid>
            {synthesis.issueGroups.map((issue) => (
              <Issue key={issue.id}>
                <header>
                  <Chip>{DIMENSION_LABELS[issue.dimension]}</Chip>
                  {issue.minority && <Chip $strong>소수 의견</Chip>}
                  <strong>{issue.title}</strong>
                </header>
                {issue.reviewItemRefs.map((ref) => {
                  const [reviewId, indexText] = ref.split('#');
                  const review = asked.find((r) => r.id === reviewId);
                  const item = review?.items[Number(indexText)];
                  return review && item ? (
                    <Note key={ref}>
                      <strong>{personName(review.actorId)}</strong> · {ASSESSMENT_LABELS[item.assessment]} — {item.reason}
                    </Note>
                  ) : null;
                })}
              </Issue>
            ))}
          </IssueGrid>
        ) : (
          <Cards>
            {asked.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map((review) => (
              <SummaryCard key={review.id} review={review} art={art} cited={cited(review)} />
            ))}
          </Cards>
        )}

        <Note>
          합성 평가입니다. 실제 주민의 만족도나 동의가 아니며, 나중에 실제 주민이 확인·반박할 대상입니다.
        </Note>
        <Foot>
          {pages > 1 && !reading && <Count>{page + 1} / {pages} · 주민 {asked.length}명</Count>}
          <Count aria-live="off">
            {Math.max(left, 0)}초 뒤 {reading ? '목록으로 돌아갑니다' : '자동으로 넘어갑니다'}
          </Count>
        </Foot>
      </Inner>
    </Sheet>
  );
}

function WhoCard({ review, art }: { review: AgentReview; art: ReadonlySet<string> }) {
  return (
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
  );
}

function Asks({ review }: { review: AgentReview }) {
  const asks = review.items.map((i) => i.requestedChange).filter((c): c is string => Boolean(c));
  if (asks.length === 0) return null;
  return (
    <Asked>
      <Label>바라는 것</Label>
      <ul>{asks.map((ask, index) => <li key={index}>{ask}</li>)}</ul>
    </Asked>
  );
}

function Went({ review, cited }: { review: AgentReview; cited: Map<string, DomainEvent> | null }) {
  const went = wentThrough(review, cited);
  if (went.length === 0) return null;
  return (
    <div>
      <Label>겪은 일</Label>
      <WentList>
        {went.map((w) => (
          <li key={w.id}>
            <time>{w.time}</time>
            <span>{w.title}</span>
          </li>
        ))}
      </WentList>
    </div>
  );
}

/** The card the wall shows for everyone who was asked: who, their words, what they asked for, what they went through. */
function SummaryCard({ review, art, cited }: { review: AgentReview; art: ReadonlySet<string>; cited: Map<string, DomainEvent> | null }) {
  return (
    <Card title={`${review.adapter} 어댑터 · ${review.id}`}>
      <WhoCard review={review} art={art} />
      <Quote>{review.overallNarrative}</Quote>
      <Asks review={review} />
      <Went review={review} cited={cited} />
    </Card>
  );
}

/** Everything the card holds, and what it folded away: yesterday's words, each judged item with its reasons and
 *  evidence, what they could not judge. Nothing on the wall opens, so nothing here is folded. */
function InterviewPage({ review, art, cited, yesterday, yesterdayName }: {
  review: AgentReview; art: ReadonlySet<string>; cited: Map<string, DomainEvent> | null;
  yesterday: AgentReview | null; yesterdayName: string | null;
}) {
  const judged = review.items.filter((item) => item.assessment !== 'unknown');
  const abstained = review.items.filter((item) => item.assessment === 'unknown');
  return (
    <Interview $wide={review.items.length === 0 && review.unknowns.length === 0}
      aria-label={`${personName(review.actorId)}의 인터뷰`}>
      <section>
        <WhoCard review={review} art={art} />
        <Quote>{review.overallNarrative}</Quote>
        <Asks review={review} />
        <Went review={review} cited={cited} />
        {yesterday && yesterdayName && (
          <div>
            <Label>{yesterdayName} 날에는 이렇게 말했습니다</Label>
            <Yesterday>{yesterday.overallNarrative}</Yesterday>
          </div>
        )}
      </section>
      {(review.items.length > 0 || review.unknowns.length > 0) && <section>
        {judged.length > 0 && (
          <Items>
            {judged.map((item) => <DimensionRow key={item.dimension} item={item} cited={cited} />)}
          </Items>
        )}
        {abstained.length > 0 && (
          <Items>
            <Label>판단 불가 {abstained.length}개 — {abstained.map((item) => DIMENSION_LABELS[item.dimension]).join(', ')}</Label>
            {abstained.map((item) => <DimensionRow key={item.dimension} item={item} cited={cited} />)}
          </Items>
        )}
        {review.unknowns.length > 0 && (
          <div>
            <Label>판단할 수 없는 것</Label>
            <ul style={{ margin: '8px 0 0', paddingLeft: 20, lineHeight: 1.7, color: night.mute }}>
              {review.unknowns.map((unknown) => <li key={unknown}>{unknown}</li>)}
            </ul>
          </div>
        )}
      </section>}
    </Interview>
  );
}

function DimensionRow({ item, cited }: { item: ReviewItem; cited: Map<string, DomainEvent> | null }) {
  return (
    <Dimension>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Chip $strong={item.assessment === 'negative'}>{ASSESSMENT_SAYS[item.assessment]}</Chip>
        <strong style={{ color: night.ink }}>{DIMENSION_LABELS[item.dimension]}</strong>
      </div>
      <div>{item.reason}</div>
      {item.eventRefs.length > 0 && (
        <div>
          <Label>사건 근거 {item.eventRefs.length}건</Label>
          {item.eventRefs.map((eventId) => {
            // What happened, in the log's own sentence, when this attempt's log is loaded; the id
            // otherwise. No sentence is made up here.
            const event = cited?.get(eventId) ?? null;
            const said = event ? sentenceFor(event)?.text ?? null : null;
            return (
              <div key={eventId} style={{ fontSize: font.small }}>
                {event && said ? <><Mono>{formatClock(event.simTimeMs)}</Mono> {said}</> : <Mono>{eventId}</Mono>}
              </div>
            );
          })}
        </div>
      )}
      {item.evidenceRefs.length > 0 && (
        <div>
          <Label>인터뷰 근거 {item.evidenceRefs.length}건</Label>
          {item.evidenceRefs.map((ref) => (
            <div key={ref} style={{ fontSize: font.small }}><Mono>{ref}</Mono></div>
          ))}
          <Note>본인 페르소나의 근거 카드입니다. 원문은 권한이 있는 서버 경로에만 있고 화면과 번들에는 들어오지 않습니다.</Note>
        </div>
      )}
      {item.assessment === 'unknown' && item.eventRefs.length === 0 && (
        <Note>겪은 일이 없어 판단하지 않음</Note>
      )}
    </Dimension>
  );
}
