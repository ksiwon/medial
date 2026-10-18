import styled, { css } from 'styled-components';
import Portrait from '../ui/Portrait';
import { pill } from '../ui/primitives';
import { accentA, claimTone, inkA, night, px, radius, space } from '../ui/theme';
import { nameOf } from './selectors';
import type { Claim, Evaluation, Line, Week, WeekEvent, WeekRequest, WeekScene } from './types';

// The three pages that read what the residents said and what came of it:
//
//   Evaluations - who was in the event and what each made of it, with the lines each rests on;
//   Choose      - the requests the designer may make, each with the resident words that support it;
//   Result      - the request that was chosen, and what the residents made of the scene that followed.
//
// What these pages must not do: put a score, a grade or a winner on anyone, or let a simulated resident read as a
// real one. Every card says it is simulated; a request that the residents only weakly support says so.

const Page = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: ${space.xl};
  padding: ${space.xxl} ${space.xxl} ${space.lg};
  background: ${night.ground};
  color: ${night.ink};
`;

const Head = styled.header`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  > small { display: inline-flex; align-items: center; gap: ${space.sm}; font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.08em; color: ${night.accent}; }
  > small::before { content: ''; width: ${px(28)}; height: 2px; background: ${night.accent}; }
  > h1 { margin: 0; font-size: ${px(48)}; line-height: 1.12; font-weight: 800; letter-spacing: -0.04em; word-break: keep-all; }
  > p { margin: 0; max-width: calc(900px * var(--k, 1)); font-size: ${px(20)}; line-height: 1.6; color: ${night.mute}; word-break: keep-all; }
`;

const Cards = styled.div<{ $n: number }>`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(${(p) => Math.min(Math.max(p.$n, 1), 3)}, minmax(0, 1fr));
  grid-auto-rows: minmax(0, 1fr);
  gap: ${space.lg};
  align-content: stretch;
`;

const Card = styled.article<{ $lit?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
  min-height: 0;
  padding: ${space.xl};
  border-radius: ${radius.card};
  background: ${night.panel};
  border: 1px solid ${(p) => (p.$lit ? night.accent : night.line)};
  ${(p) => p.$lit && css`box-shadow: 0 0 0 ${px(2)} ${accentA(0.4)};`}
`;

const Who = styled.header`
  display: flex;
  align-items: center;
  gap: ${space.lg};
  > div { display: flex; flex-direction: column; gap: ${space.xs}; min-width: 0; }
  strong { font-size: ${px(28)}; font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; }
`;

const Chip = styled.span<{ $tone?: 'accent' | 'warn' }>`
  ${pill('xs')}
  align-self: flex-start;
  font-weight: 800;
  color: ${(p) => (p.$tone === 'accent' ? '#fff' : p.$tone === 'warn' ? night.deep : night.mute)};
  background: ${(p) => (p.$tone === 'accent' ? night.accent : p.$tone === 'warn' ? '#e8c46a' : inkA(0.1))};
`;

/** What they said, as the card's centre: their own words, large, under an open quote. */
const Quote = styled.blockquote`
  position: relative;
  margin: 0;
  padding: ${space.lg} 0 0;
  font-size: ${px(28)};
  line-height: 1.6;
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
  gap: ${space.xl};
  min-height: 0;
  overflow: hidden;
`;

const ClaimRow = styled.li<{ $color: string }>`
  display: grid;
  grid-template-columns: ${px(32)} minmax(0, 1fr);
  gap: ${space.md};
  > b { font-size: ${px(24)}; line-height: 1.3; font-weight: 800; color: ${(p) => p.$color}; text-align: center; }
  > div { display: flex; flex-direction: column; gap: ${space.xs}; min-width: 0; }
  > div > small { font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.06em; color: ${(p) => p.$color}; }
  > div > p { margin: 0; font-size: ${px(28)}; line-height: 1.45; font-weight: 600; word-break: keep-all; }
`;

const Heard = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space.xs};
  padding-left: ${space.md};
  border-left: 2px solid ${night.line};
  > span { display: flex; gap: ${space.sm}; font-size: ${px(16)}; line-height: 1.4; color: ${night.mute}; word-break: keep-all; }
  > span > b { flex: none; font-weight: 800; color: ${night.ink}; }
`;

const Foot = styled.p`
  margin: 0;
  font-size: ${px(12)};
  line-height: 1.5;
  color: ${night.faint};
`;

const lineOf = (scenes: WeekScene[], n: number): { speaker: string; text: string } | null => {
  let seen = 0;
  for (const scene of scenes) {
    if (n <= seen + scene.lines.length) {
      const line: Line = scene.lines[n - seen - 1];
      return { speaker: line.speaker, text: line.text };
    }
    seen += scene.lines.length;
  }
  return null;
};

function ClaimItem({ week, claim, scenes, open }: { week: Week; claim: Claim; scenes: WeekScene[]; open: boolean }) {
  const tone = claimTone[claim.kind];
  const heard = claim.citedLines.map((n) => lineOf(scenes, n)).filter((l): l is { speaker: string; text: string } => !!l);
  return (
    <ClaimRow $color={tone.color}>
      <b aria-hidden>{tone.mark}</b>
      <div>
        <small>{tone.label}</small>
        <p>{claim.text}</p>
        <Heard aria-label="이 말이 근거로 든 대사">
          {heard.slice(0, open ? heard.length : 1).map((l, i) => (
            <span key={i}><b>{l.speaker === 'AI' ? 'AI' : nameOf(week, l.speaker)}</b>{l.text}</span>
          ))}
        </Heard>
      </div>
    </ClaimRow>
  );
}

function EvaluationCard({ week, evaluation, scenes, art, open }: {
  week: Week; evaluation: Evaluation; scenes: WeekScene[]; art: ReadonlySet<string>; open: boolean;
}) {
  return (
    <Card $lit={open}>
      <Who>
        <Portrait actorId={evaluation.actor} art={art} size={88} />
        <div>
          <strong>{nameOf(week, evaluation.actor)}</strong>
          <Chip>시뮬레이션 주민의 평가</Chip>
        </div>
      </Who>
      <Quote>{evaluation.paragraph}</Quote>
      <Claims aria-label="주민이 겪은 일에 대해 한 말">
        {evaluation.claims.map((c, i) => <ClaimItem key={i} week={week} claim={c} scenes={scenes} open={open} />)}
      </Claims>
    </Card>
  );
}

export function EvaluationsScreen({ week, event, evaluations, scenes, art, openActor, eyebrow, title, lead }: {
  week: Week; event: WeekEvent; evaluations: Evaluation[]; scenes: WeekScene[]; art: ReadonlySet<string>;
  openActor: string | null; eyebrow: string; title: string; lead: string;
}) {
  const list = openActor ? evaluations.filter((e) => e.actor === openActor) : evaluations;
  return (
    <Page aria-label={title}>
      <Head>
        <small>{eyebrow}</small>
        <h1>{title}</h1>
        <p>{lead}</p>
      </Head>
      <Cards $n={list.length}>
        {list.map((e) => <EvaluationCard key={e.actor} week={week} evaluation={e} scenes={scenes} art={art} open={openActor === e.actor} />)}
      </Cards>
      <Foot>합성 평가입니다. 실제 주민의 만족도나 동의가 아니며, 나중에 실제 주민이 확인·반박할 대상입니다. · {event.title}</Foot>
    </Page>
  );
}

// ---- the request cards ------------------------------------------------------

const Rule = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space.xs};
  padding-top: ${space.md};
  border-top: 1px solid ${night.line};
  font-size: ${px(16)};
  line-height: 1.5;
  > small { ${pill('xs')} align-self: flex-start; font-weight: 800; letter-spacing: 0.06em; color: ${night.mute}; background: ${inkA(0.08)}; }
  > small.after { color: ${night.accent}; background: ${night.accentSoft}; }
  > s { display: block; padding: ${space.sm} ${space.md}; border-radius: ${radius.card}; color: ${night.faint}; background: ${inkA(0.04)}; text-decoration-color: ${inkA(0.3)}; }
  > i { font-style: normal; color: ${night.accent}; font-weight: 800; line-height: 1; padding-left: ${space.md}; font-size: ${px(20)}; }
  > b { display: block; padding: ${space.sm} ${space.md}; border-radius: ${radius.card}; font-weight: 700; background: ${night.accentSoft}; box-shadow: inset ${px(4)} 0 0 ${night.accent}; }
`;

const Ask = styled.h2`
  margin: 0;
  font-size: ${px(32)};
  line-height: 1.3;
  font-weight: 800;
  letter-spacing: -0.03em;
  word-break: keep-all;
`;

const Because = styled.blockquote<{ $weak: boolean }>`
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  padding: ${space.md} ${space.lg};
  border-radius: ${radius.card};
  background: ${inkA(0.05)};
  flex: 1;
  justify-content: center;
  font-size: ${px(16)};
  line-height: 1.55;
  word-break: keep-all;
  > header { display: flex; align-items: center; gap: ${space.md}; }
  > p { margin: 0; font-size: ${px(28)}; line-height: 1.5; font-weight: 600; letter-spacing: -0.02em; color: ${(p) => (p.$weak ? night.mute : night.ink)}; }
`;

/** What the designer hopes for and what it may cost, side by side and large: no request is only good. */
const Trade = styled.div`
  margin-top: auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${space.md};
  > div { display: flex; flex-direction: column; gap: ${space.sm}; padding: ${space.lg}; border-radius: ${radius.card}; background: ${inkA(0.05)}; min-height: 0; }
  > div > small { ${pill('xs')} align-self: flex-start; font-weight: 800; letter-spacing: 0.06em; color: ${night.mute}; background: ${inkA(0.1)}; }
  > div > p { margin: 0; font-size: ${px(24)}; line-height: 1.45; font-weight: 700; word-break: keep-all; }
  > div.cost > small { color: ${night.deep}; background: #e8c46a; }
`;

/** Which kind of claim a request grew out of: a discomfort, a wish, or something else the resident said. */
const Kind = styled.span<{ $color: string }>`
  ${pill('xs')}
  align-self: flex-start;
  font-weight: 800;
  color: ${(p) => p.$color};
  background: ${inkA(0.08)};
`;

export function RequestCard({ week, request, index, art, chosen }: {
  week: Week; request: WeekRequest; index: number; art: ReadonlySet<string>; chosen?: boolean;
}) {
  const weak = request.basis.verdict === 'weak';
  return (
    <Card $lit={chosen}>
      <Chip $tone="accent">{index + 1}</Chip>
      <Ask>{request.label}</Ask>
      {request.basis.actor && (
        <Because $weak={weak}>
          <header>
            <Portrait actorId={request.basis.actor} art={art} size={56} />
            <Chip $tone={weak ? 'warn' : undefined}>{weak ? '근거가 약한 요청' : `${nameOf(week, request.basis.actor)}의 평가에서`}</Chip>
            {request.basis.kind && <Kind $color={claimTone[request.basis.kind].color}>{claimTone[request.basis.kind].mark} {claimTone[request.basis.kind].label}</Kind>}
          </header>
          {request.basis.quote && <p>“{request.basis.quote}”</p>}
        </Because>
      )}
      <Trade>
        <div><small>바라는 것</small><p>{request.expect}</p></div>
        <div className="cost"><small>따를 부담</small><p>{request.cost}</p></div>
      </Trade>
    </Card>
  );
}

export function ChooseScreen({ week, event, art, considering }: {
  week: Week; event: WeekEvent; art: ReadonlySet<string>;
  /** The card a finger rests on at the tablet, before it is confirmed. */
  considering: string | null;
}) {
  return (
    <Page aria-label="무엇을 고칠 것인가">
      <Head>
        <small>{event.title} · 수정 요청 고르기</small>
        <h1>무엇을 고칠 것인가</h1>
        <p>
          주민들이 겪은 일에서 나온 요청입니다. 하나만 고를 수 있고, 고르면 같은 일이 그 요청대로 다시 펼쳐집니다.
          모든 요청에는 바라는 것과 함께 따를 부담이 있습니다.
        </p>
      </Head>
      <Cards $n={event.requests.length}>
        {event.requests.map((r, i) => <RequestCard key={r.id} week={week} request={r} index={i} art={art} chosen={r.id === considering} />)}
      </Cards>
      <Foot>합성 평가입니다. 실제 주민의 만족도나 동의가 아니며, 나중에 실제 주민이 확인·반박할 대상입니다.</Foot>
    </Page>
  );
}

export function ResultScreen({ week, event, request, art, openActor }: {
  week: Week; event: WeekEvent; request: WeekRequest | null; art: ReadonlySet<string>; openActor: string | null;
}) {
  if (!request) {
    // An emergency has nothing chosen: it is read, and what the residents made of it is the whole page.
    return (
      <EvaluationsScreen week={week} event={event} evaluations={event.before.evaluations} scenes={event.before.scenes} art={art}
        openActor={openActor} eyebrow={`${event.title} · 응급`}
        title="주민들이 겪은 일" lead="사람의 안전이 걸린 순간은 고르는 것이 아니라 일어난 일을 읽습니다. 규칙을 바꾸는 선택지는 두지 않았습니다." />
    );
  }
  const index = event.requests.findIndex((r) => r.id === request.id);
  return (
    <Page aria-label="반영된 결과">
      <Head>
        <small>{event.title} · 고른 요청이 반영된 모습</small>
        <h1>이 결정이 이렇게 반영되었습니다</h1>
        <p>같은 일이 고른 요청대로 다시 펼쳐졌습니다. 같은 주민이 수정 전과 반영 후에 각각 자기 말로 어땠는지 나란히 봅니다.</p>
      </Head>
      <Decision>
        <Chip $tone="accent">{index + 1}</Chip>
        <div>
          <strong>{request.label}</strong>
          <ul>
            {request.rules.map((r) => (
              <li key={r.type}><b>{r.label}</b><s>{r.beforeSentence}</s><i aria-hidden>→</i><span>{r.afterSentence}</span></li>
            ))}
          </ul>
        </div>
        <Trade2>
          <div><small>바라는 것</small><p>{request.expect}</p></div>
          <div className="cost"><small>따를 부담</small><p>{request.cost}</p></div>
        </Trade2>
      </Decision>
      <Pairs $n={request.after.evaluations.length}>
        {request.after.evaluations.map((after) => {
          const before = event.before.evaluations.find((e) => e.actor === after.actor) ?? null;
          return (
            <Pair key={after.actor} $lit={openActor === after.actor}>
              <Who>
                <Portrait actorId={after.actor} art={art} size={72} />
                <div>
                  <strong>{nameOf(week, after.actor)}</strong>
                  <Chip>시뮬레이션 주민의 평가</Chip>
                </div>
              </Who>
              <Side>
                <small>수정 전</small>
                {before ? <Said evaluation={before} week={week} scenes={event.before.scenes} />
                  : <p className="none">수정 전 장면에는 이 주민이 없었습니다.</p>}
              </Side>
              <Arrow aria-hidden>→</Arrow>
              <Side $after>
                <small>반영 후</small>
                <Said evaluation={after} week={week} scenes={[request.after.scene]} />
              </Side>
            </Pair>
          );
        })}
      </Pairs>
      <Foot>
        합성 평가입니다. 실제 주민의 만족도나 동의가 아니며, 나중에 실제 주민이 확인·반박할 대상입니다. 반영된 장면에 다시 나온 주민만 견줍니다.
      </Foot>
    </Page>
  );
}

// ---- before and after, side by side ----------------------------------------------

/** The chosen request, as one band: what it asked, the rules it changed (before → after), and what it costs. */
const Decision = styled.section`
  display: grid;
  grid-template-columns: auto minmax(0, 1.6fr) minmax(0, 1fr);
  align-items: start;
  gap: ${space.lg};
  padding: ${space.lg} ${space.xl};
  border-radius: ${radius.card};
  background: ${night.panel};
  border: 1px solid ${night.accent};
  > div > strong { display: block; font-size: ${px(24)}; font-weight: 800; letter-spacing: -0.03em; line-height: 1.3; word-break: keep-all; }
  > div > ul { margin: ${space.sm} 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: ${space.xs}; }
  > div > ul > li { display: flex; flex-wrap: wrap; align-items: baseline; gap: ${space.sm}; font-size: ${px(16)}; line-height: 1.5; word-break: keep-all; }
  > div > ul > li > b { font-weight: 800; color: ${night.mute}; }
  > div > ul > li > s { color: ${night.faint}; text-decoration-color: ${inkA(0.35)}; }
  > div > ul > li > i { font-style: normal; font-weight: 800; color: ${night.accent}; }
  > div > ul > li > span { font-weight: 700; }
`;

const Trade2 = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: ${space.sm};
  > div { display: flex; flex-direction: column; gap: ${space.xs}; padding: ${space.md}; border-radius: ${radius.card}; background: ${inkA(0.05)}; }
  > div > small { ${pill('xs')} align-self: flex-start; font-weight: 800; color: ${night.mute}; background: ${inkA(0.1)}; }
  > div > p { margin: 0; font-size: ${px(16)}; line-height: 1.45; font-weight: 700; word-break: keep-all; }
  > div.cost > small { color: ${night.deep}; background: #e8c46a; }
`;

const Pairs = styled.div<{ $n: number }>`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-rows: repeat(${(p) => Math.max(p.$n, 1)}, minmax(0, 1fr));
  gap: ${space.lg};
`;

const Pair = styled.article<{ $lit: boolean }>`
  display: grid;
  grid-template-columns: ${px(200)} minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: stretch;
  gap: ${space.lg};
  min-height: 0;
  padding: ${space.lg} ${space.xl};
  border-radius: ${radius.card};
  background: ${night.panel};
  border: 1px solid ${(p) => (p.$lit ? night.accent : night.line)};
  > header { flex-direction: column; align-items: flex-start; align-self: start; }
`;

const Side = styled.div<{ $after?: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  min-height: 0;
  overflow: hidden;
  padding: ${space.md} ${space.lg};
  border-radius: ${radius.card};
  background: ${(p) => (p.$after ? night.accentSoft : inkA(0.04))};
  > small { ${pill('xs')} align-self: flex-start; font-weight: 800; letter-spacing: 0.06em;
    color: ${(p) => (p.$after ? '#fff' : night.mute)}; background: ${(p) => (p.$after ? night.accent : inkA(0.1))}; }
  > p.none { margin: 0; font-size: ${px(20)}; color: ${night.faint}; }
`;

const Arrow = styled.div`
  align-self: center;
  font-size: ${px(32)};
  font-weight: 800;
  color: ${night.accent};
`;

const SaidText = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  > p { margin: 0; font-size: ${px(20)}; line-height: 1.55; word-break: keep-all; }
  > ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: ${space.xs}; }
  > ul > li { display: grid; grid-template-columns: ${px(20)} minmax(0, 1fr); gap: ${space.sm}; font-size: ${px(20)}; line-height: 1.45; font-weight: 600; word-break: keep-all; }
  > ul > li > b { text-align: center; font-weight: 800; }
  > ul > li > span > small { display: block; font-size: ${px(16)}; font-weight: 500; color: ${night.mute}; }
`;

/** One resident's reading, compact: their paragraph, then each claim with its kind and the first line it rests on. */
function Said({ evaluation, week, scenes }: { evaluation: Evaluation; week: Week; scenes: WeekScene[] }) {
  return (
    <SaidText>
      <p>{evaluation.paragraph}</p>
      <ul>
        {evaluation.claims.map((c, i) => {
          const tone = claimTone[c.kind];
          const heard = c.citedLines.map((n) => lineOf(scenes, n)).find((l) => l);
          return (
            <li key={i}>
              <b style={{ color: tone.color }} aria-label={tone.label}>{tone.mark}</b>
              <span>{c.text}{heard && <small>{heard.speaker === 'AI' ? 'AI' : nameOf(week, heard.speaker)} · {heard.text}</small>}</span>
            </li>
          );
        })}
      </ul>
    </SaidText>
  );
}
