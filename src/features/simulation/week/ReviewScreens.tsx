import styled, { css, keyframes } from 'styled-components';
import Portrait from '../ui/Portrait';
import { pill } from '../ui/primitives';
import { accentA, changeTone, claimTone, inkA, night, px, radius, space, type } from '../ui/theme';
import { nameOf, type Version } from './selectors';
import type { Claim, Evaluation, FeedbackChange, Week, WeekEvent, WeekRequest } from './types';

// The pages that read what the residents said, for one version of an event:
//
//   Evaluations - who was in the event and what each made of it, and which part of their interview it rests on;
//                 ver2 and on say what the last request changed, and first how it moved the feedback (resolved,
//                 remaining, new); a version with nothing to choose ends the event here, and says so;
//   Choose      - the requests the designer may make on that version, each with the resident words that support it.
//
// What these pages must not do: put a score, a grade or a winner on anyone, or let a simulated resident read as a
// real one. Every card says it is simulated; a request that the residents only weakly support says so.

/** $tight: the choice page holds three full cards, so its blocks sit a step closer - it must fit a laptop window too, where the type is not scaled up. */
const Page = styled.div<{ $tight?: boolean }>`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: ${(p) => (p.$tight ? space.md : space.xl)};
  padding: ${(p) => (p.$tight ? space.xl : space.xxl)} ${space.xxl} ${space.lg};
  background: ${night.ground};
  color: ${night.ink};
`;

const Head = styled.header<{ $compact?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  > small { display: inline-flex; align-items: center; gap: ${space.sm}; font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.08em; color: ${night.accent}; }
  > small::before { content: ''; width: ${px(28)}; height: 2px; background: ${night.accent}; }
  > h1 { margin: 0; font-size: ${(p) => (p.$compact ? type.display : type.hero)}; line-height: 1.12; font-weight: 800; letter-spacing: -0.04em; word-break: keep-all; }
  > p { margin: 0; max-width: calc(900px * var(--k, 1)); font-size: ${(p) => (p.$compact ? type.body : type.lead)}; line-height: 1.6; color: ${night.mute}; word-break: keep-all; }
  > p > b { display: block; font-weight: 800; color: ${night.ink}; }
  > p > span { display: block; }
`;

/** $center: cards as tall as their words, the block set in the middle of the page - on the wall they are not stretched to the page's foot. */
const Cards = styled.div<{ $n: number; $center?: boolean; $rows?: number }>`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(${(p) => Math.min(Math.max(p.$n, 1), 3)}, minmax(0, 1fr));
  /* As tall as the tallest card says, never past the page; the cards of a row are one height, the room left at the foot of the shorter one is its bottom padding. */
  grid-auto-rows: fit-content(100%);
  gap: ${space.xl};
  align-content: ${(p) => (p.$center ? 'center' : 'start')};
  /* One request is one card, not a row's worth: it keeps the width of a reading line instead of spanning the wall. */
  /* Cards that share their rows (subgrid): the sentence, the words, each box of every card in a row stand at one height. */
  ${(p) => p.$rows && css`
    grid-template-rows: repeat(${p.$rows}, auto);
    grid-auto-rows: auto;
    gap: 0 ${space.xl};
  `}
  ${(p) => p.$center && p.$n === 1 && css`
    grid-template-columns: minmax(0, ${px(1000)});
    justify-content: center;
  `}
`;

const Card = styled.article<{ $lit?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${space.xl};
  min-height: 0;
  padding: ${space.xxl};
  border-radius: ${radius.card};
  background: ${night.panel};
  border: 1px solid ${(p) => (p.$lit ? night.accent : night.line)};
  ${(p) => p.$lit && css`box-shadow: 0 0 0 ${px(2)} ${accentA(0.4)};`}
`;

/** An evaluation card: a paragraph and up to three claims must fit under the head on a laptop window too, so a step tighter than the shared card. */
const EvaluationBox = styled(Card)`
  gap: ${space.lg};
  padding: ${space.xl};
`;

const Who = styled.header`
  display: flex;
  align-items: center;
  gap: ${space.lg};
  > div { display: flex; flex-direction: column; gap: ${space.xs}; min-width: 0; }
  strong { font-size: ${type.heading}; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
`;

const Chip = styled.span<{ $tone?: 'accent' | 'warn' }>`
  ${pill('xs')}
  align-self: flex-start;
  font-weight: 800;
  color: ${(p) => (p.$tone === 'accent' ? night.white : p.$tone === 'warn' ? night.deep : night.mute)};
  background: ${(p) => (p.$tone === 'accent' ? night.accent : p.$tone === 'warn' ? night.warn : inkA(0.1))};
`;

/** What they said, as the card's centre: their own words, large, under an open quote. */
const Quote = styled.blockquote`
  position: relative;
  margin: 0;
  padding: ${space.lg} 0 0;
  font-size: ${type.lead};
  line-height: 1.55;
  font-weight: 500;
  letter-spacing: -0.02em;
  word-break: keep-all;
  &::before { content: '“'; position: absolute; left: 0; top: ${px(-8)}; font-size: ${px(56)}; line-height: 1; font-weight: 800; color: ${night.accent}; }
`;

/** What they made of it, one thing at a time. The tone and the mark both say the kind; the lines it rests on sit under it. */
const Claims = styled.ul`
  margin: 0;
  padding: ${space.md} 0 0;
  list-style: none;
  border-top: 1px solid ${night.line};
  display: flex;
  flex-direction: column;
  gap: ${space.md};
  min-height: 0;
  overflow: hidden;
`;

const ClaimRow = styled.li<{ $color: string; $compact?: boolean }>`
  display: grid;
  grid-template-columns: ${px(32)} minmax(0, 1fr);
  gap: ${space.md};
  > b { font-size: ${type.title}; line-height: 1.3; font-weight: 800; color: ${(p) => p.$color}; text-align: center; }
  > div { display: flex; flex-direction: column; gap: ${space.xs}; min-width: 0; }
  > div > small { font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.06em; color: ${(p) => p.$color}; }
  > div > p { margin: 0; font-size: ${(p) => (p.$compact ? type.lead : type.title)}; line-height: 1.45; font-weight: 600; word-break: keep-all; }
`;

const Foot = styled.p`
  margin: 0;
  font-size: ${type.caption};
  line-height: 1.5;
  color: ${night.faint};
`;

/** What the page says when a version has nothing to choose: where the event ends, and what to do next. */
const End = styled.p`
  margin: 0;
  padding: ${space.lg} ${space.xl};
  border-radius: ${radius.card};
  background: ${night.accentSoft};
  font-size: ${type.title};
  line-height: 1.4;
  font-weight: 700;
  letter-spacing: -0.02em;
  word-break: keep-all;
`;

function ClaimItem({ claim, compact }: { claim: Claim; compact?: boolean }) {
  const tone = claimTone[claim.kind];
  return (
    <ClaimRow $color={tone.color} $compact={compact}>
      <b aria-hidden>{tone.mark}</b>
      <div>
        <small>{tone.label}</small>
        <p>{claim.text}</p>
      </div>
    </ClaimRow>
  );
}

/** Which part of the resident's interview the reading rests on - or that it rests on none, said as plainly. */
const Ground = styled.p`
  margin: 0;
  padding-top: ${space.md};
  border-top: 1px solid ${night.line};
  display: flex;
  align-items: baseline;
  gap: ${space.sm};
  font-size: ${type.body};
  line-height: 1.5;
  color: ${night.mute};
  word-break: keep-all;
  > small { ${pill('xs')} flex: none; font-weight: 800; color: ${night.ink}; background: ${inkA(0.1)}; }
  > b { flex: none; font-weight: 800; color: ${night.ink}; }
`;

function groundOf(e: Evaluation): { field: string | null; text: string } {
  if (e.grounding.field && e.grounding.note) return { field: e.grounding.field, text: e.grounding.note };
  return { field: null, text: e.grounding.interviewed ? '인터뷰에서 이 반응의 근거를 찾지 못함' : '인터뷰하지 않은 역할 · 근거 없음' };
}

/** compact: under the change of the version before (ver2 and on) the page holds both, so a card is its claims - the
 *  units the change sorts - and the paragraph they were drawn from is left out. */
function EvaluationCard({ week, evaluation, art, compact }: { week: Week; evaluation: Evaluation; art: ReadonlySet<string>; compact?: boolean }) {
  const ground = groundOf(evaluation);
  return (
    <EvaluationBox>
      <Who>
        <Portrait actorId={evaluation.actor} art={art} size={48} />
        <div>
          <strong>{nameOf(week, evaluation.actor)}</strong>
          <Chip>시뮬레이션 주민의 피드백</Chip>
        </div>
      </Who>
      {!compact && <Quote>{evaluation.paragraph}</Quote>}
      <Claims aria-label="주민이 겪은 일에 대해 한 말">
        {evaluation.claims.map((c, i) => <ClaimItem key={i} claim={c} compact={compact} />)}
      </Claims>
      <Ground aria-label="인터뷰 근거"><small>인터뷰 근거</small>{ground.field && <b>{ground.field}</b>}{ground.text}</Ground>
    </EvaluationBox>
  );
}

/** What the version's last request changed, in the designer's words: shown above the residents' words on ver2 and on. */
function changedLine(version: Version): { head: string; rules: string[] } | null {
  const last = version.chain[version.chain.length - 1];
  if (!last) return null;
  return { head: `ver${version.number - 1}에서 바뀐 규칙`, rules: last.rules.map((q) => `${q.label}: ${q.afterSentence}`) };
}

// ---- how the last request moved the feedback ---------------------------------

const Moved = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${space.md};
  padding: ${space.xl};
  border-radius: ${radius.card};
  background: ${night.panel};
  border: 1px solid ${night.line};
  > header { display: flex; align-items: baseline; justify-content: space-between; gap: ${space.lg}; }
  > header > h2 { margin: 0; font-size: ${type.heading}; font-weight: 800; letter-spacing: -0.03em; line-height: 1.2; }
  > header > small { font-size: ${type.caption}; color: ${night.faint}; text-align: right; }
  > p { margin: 0; font-size: ${type.body}; line-height: 1.5; color: ${night.faint}; word-break: keep-all; }
`;

const Ways = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: ${space.xl};
`;

const Way = styled.div<{ $color: string }>`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  min-width: 0;
  border-top: ${px(4)} solid ${(p) => p.$color};
  padding-top: ${space.md};
  > small { font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.06em; color: ${(p) => p.$color}; }
  > ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: ${space.sm}; }
  > ul > li { display: grid; grid-template-columns: ${px(24)} minmax(0, 1fr); gap: ${space.sm}; font-size: ${type.title}; line-height: 1.4; font-weight: 600; word-break: keep-all; }
  > ul > li > b { color: ${(p) => p.$color}; text-align: center; }
  > ul > li > span > em { font-style: normal; font-weight: 800; margin-right: ${space.sm}; color: ${night.mute}; }
  > i { font-style: normal; font-size: ${type.body}; color: ${night.faint}; }
`;

/** One way a trouble went, as a column: who said it and what. */
function WayColumn({ way, items }: { way: keyof typeof changeTone; items: { name: string; text: string }[] }) {
  const tone = changeTone[way];
  return (
    <Way $color={tone.color}>
      <small>{tone.label}</small>
      {items.length
        ? <ul>{items.map((x) => <li key={x.name + x.text}><b aria-hidden>{tone.mark}</b><span><em>{x.name}</em>{x.text}</span></li>)}</ul>
        : <i>없음</i>}
    </Way>
  );
}

/** The feedback of the version before beside this one's: what the request resolved, left and brought. Who is in only
 *  one of the two versions is said so under the columns, not sorted: their trouble was neither solved nor kept. */
function FeedbackMoved({ change, from, to }: { change: FeedbackChange[]; from: number; to: number }) {
  const pick = (k: 'resolved' | 'remaining' | 'new') => change.flatMap((c) => c[k].map((text) => ({ name: c.name, text })));
  const unclear = change.filter((c) => c.presence === 'both' && c.unclear.length > 0);
  const gone = change.filter((c) => c.presence === 'before');
  return (
    <Moved aria-label="피드백의 변화">
      <header>
        <h2>ver{from} → ver{to}, 피드백이 이렇게 달라졌습니다</h2>
        <small>두 버전의 피드백을 모델이 읽고 나눈 해석입니다</small>
      </header>
      <Ways>
        <WayColumn way="resolved" items={pick('resolved')} />
        <WayColumn way="remaining" items={pick('remaining')} />
        <WayColumn way="new" items={pick('new')} />
      </Ways>
      {(unclear.length > 0 || gone.length > 0) && (
        <p>
          {unclear.map((c) => `${c.name}: ${c.unclear.length}가지는 이번 피드백에 다시 나오지 않아 알 수 없음`).join(' · ')}
          {unclear.length > 0 && gone.length > 0 && ' · '}
          {gone.map((c) => `${c.name}: 이번 버전에는 나오지 않아 불편이 풀렸는지 알 수 없음`).join(' · ')}
        </p>
      )}
    </Moved>
  );
}

export function EvaluationsScreen({ week, event, version, art }: { week: Week; event: WeekEvent; version: Version; art: ReadonlySet<string> }) {
  const list = version.evaluations;
  const leaf = version.requests.length === 0;
  const changed = changedLine(version);
  return (
    <Page aria-label="주민의 피드백" $tight>
      <Head $compact>
        <small>{event.title} · ver{version.number} · 주민의 피드백</small>
        <h1>서비스를 겪은 주민의 피드백</h1>
        {changed
          ? <p><b>{changed.head}</b>{changed.rules.map((r) => <span key={r}>{r}</span>)}</p>
          : <p>이 일에 있었던 주민이 자기가 겪은 것을 어떻게 읽었는지 보입니다.</p>}
      </Head>
      {version.change && <FeedbackMoved change={version.change} from={version.number - 1} to={version.number} />}
      <Cards $n={list.length}>
        {list.map((e) => <EvaluationCard key={e.actor} week={week} evaluation={e} art={art} compact={version.change !== null} />)}
      </Cards>
      {leaf && (
        <End role="status">
          {event.noChoice
            ? '사람의 안전이 걸린 순간은 고르는 것이 아니라 일어난 일을 읽습니다.'
            : '이 사건은 여기까지입니다. 다른 사건을 개선해 보세요.'}
        </End>
      )}
      <Foot>시뮬레이션 주민의 피드백입니다. 실제 주민의 만족도나 동의가 아니며, 나중에 실제 주민이 확인·반박할 대상입니다. · {event.title}</Foot>
    </Page>
  );
}

// ---- the request cards ------------------------------------------------------

/** A request card holds a sentence, a resident's words and two small boxes in one third of the wall, so its type is a step
 *  smaller than the evaluation cards' and its padding a step tighter: the longest requests must still fit. */
const RequestBox = styled(Card)<{ $rows: number }>`
  display: grid;
  grid-row: 1 / span ${(p) => p.$rows};
  grid-template-rows: subgrid;
  row-gap: ${space.md};
  padding: ${space.lg};
  > ${Chip} { justify-self: start; }
`;

const Ask = styled.h2`
  margin: 0;
  font-size: ${type.heading};
  line-height: 1.3;
  font-weight: 800;
  letter-spacing: -0.03em;
  word-break: keep-all;
`;

/** The resident words a request rests on, flat on the card between two hairlines - no box inside the box, so the padding
 *  of one card is paid once. The speaker on the left (the face, the name under it), what was said on the right. */
const Because = styled.blockquote<{ $weak: boolean }>`
  margin: 0;
  display: flex;
  align-items: center;
  gap: ${space.lg};
  flex: 1;
  padding: ${space.lg} 0;
  border-top: 1px solid ${night.line};
  font-size: ${type.body};
  line-height: 1.55;
  word-break: keep-all;
  > header { display: flex; flex-direction: column; align-items: center; gap: ${space.xs}; flex: none; }
  > header > b { font-size: ${type.caption}; font-weight: 800; }
  > div { min-width: 0; display: flex; flex-direction: column; gap: ${space.sm}; align-items: flex-start; }
  > div > p { margin: 0; font-size: ${type.lead}; line-height: 1.5; font-weight: 600; letter-spacing: -0.02em; color: ${(p) => (p.$weak ? night.mute : night.ink)}; }
`;

/** What the designer hopes for and what it may cost, one over the other under the words, each at one height across the
 *  cards of a row (the rows are shared, see RequestBox): no request is only good. A hairline above, not boxes. */
const Trade = styled.div`
  display: contents;
  > div { padding-top: ${space.md}; }
  > div:first-child { border-top: 1px solid ${night.line}; padding-top: ${space.lg}; }
  > div { display: flex; flex-direction: column; gap: ${space.sm}; min-width: 0; }
  > div > small { ${pill('xs')} align-self: flex-start; font-weight: 800; letter-spacing: 0.06em; color: ${night.mute}; background: ${inkA(0.1)}; }
  > div > p { margin: 0; font-size: ${type.lead}; line-height: 1.45; font-weight: 700; word-break: keep-all; }
  > div.cost > small { color: ${night.deep}; background: ${night.warn}; }
`;

/** The rows a request card spans: the number, the sentence, the words, and the two boxes one over the other. */
const ROWS = 5;

export function RequestCard({ week, request, index, art, chosen }: {
  week: Week; request: WeekRequest; index: number; art: ReadonlySet<string>; chosen?: boolean;
}) {
  const weak = request.basis.verdict === 'weak';
  return (
    <RequestBox $lit={chosen} $rows={ROWS}>
      <Chip $tone="accent">{index + 1}</Chip>
      <Ask>{request.label}</Ask>
      {request.basis.actor && (
        <Because $weak={weak}>
          <header>
            <Portrait actorId={request.basis.actor} art={art} size={48} />
            <b>{nameOf(week, request.basis.actor)}</b>
          </header>
          <div>
            {weak && <Chip $tone="warn">근거가 약한 요청</Chip>}
            {request.basis.quote && <p>“{request.basis.quote}”</p>}
          </div>
        </Because>
      )}
      <Trade>
        <div><small>바라는 것</small><p>{request.expect}</p></div>
        <div className="cost"><small>따를 부담</small><p>{request.cost}</p></div>
      </Trade>
    </RequestBox>
  );
}

export function ChooseScreen({ week, event, version, art, considering }: {
  week: Week; event: WeekEvent; version: Version; art: ReadonlySet<string>;
  /** The card a finger rests on at the tablet, before it is confirmed. */
  considering: string | null;
}) {
  const requests = version.requests;
  return (
    <Page aria-label="무엇을 고칠 것인가" $tight>
      <Head $compact>
        <small>{event.title} · ver{version.number} → ver{version.number + 1}</small>
        {/* One request is not a choice among requests: it is said as what it is, a change to apply or not. */}
        <h1>{requests.length > 1 ? '무엇을 고칠 것인가' : '이 요청을 반영해 볼까요?'}</h1>
        <p>{requests.length > 1 ? '하나를 고르면, 같은 일이 그 요청대로 다시 펼쳐집니다.' : '반영하면, 같은 일이 그 요청대로 다시 펼쳐집니다.'}</p>
      </Head>
      <Cards $n={requests.length} $center $rows={ROWS}>
        {requests.map((r, i) => <RequestCard key={r.id} week={week} request={r} index={i} art={art} chosen={r.id === considering} />)}
      </Cards>
      <Foot>시뮬레이션 주민의 피드백입니다. 실제 주민의 만족도나 동의가 아니며, 나중에 실제 주민이 확인·반박할 대상입니다.</Foot>
    </Page>
  );
}

// ---- after a choice: the new simulation, for a few seconds -------------------------

const sweep = keyframes`from { transform: translateX(-100%); } to { transform: translateX(260%); }`;

const Making = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${space.xl};
  background: ${night.ground};
  color: ${night.ink};
  text-align: center;
  > small { font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.09em; color: ${night.accent}; }
  > h1 { margin: 0; font-size: ${type.hero}; line-height: 1.15; font-weight: 800; letter-spacing: -0.04em; word-break: keep-all; }
  > p { margin: 0; max-width: calc(900px * var(--k, 1)); font-size: ${type.lead}; line-height: 1.6; color: ${night.mute}; word-break: keep-all; }
  > div { position: relative; width: ${px(480)}; height: ${px(4)}; border-radius: ${radius.pill}; background: ${inkA(0.12)}; overflow: hidden; }
  > div > i { position: absolute; inset: 0 auto 0 0; width: 40%; border-radius: ${radius.pill}; background: ${night.accent}; animation: ${sweep} 1.4s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { > div > i { animation: none; width: 100%; } }
`;

/** The wall's wait between choosing a request and the week, with the event one version on. */
export function GeneratingScreen({ event, request, version }: { event: WeekEvent; request: WeekRequest | null; version: number }) {
  return (
    <Page aria-label="새 시뮬레이션">
      <Making role="status">
        <small>{event.title} · ver{version - 1} → ver{version}</small>
        <h1>새로운 시뮬레이션을 만들고 있습니다</h1>
        <div aria-hidden><i /></div>
        {request && <p>고른 요청 · {request.label}</p>}
      </Making>
    </Page>
  );
}
