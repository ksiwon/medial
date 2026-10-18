import styled, { css } from 'styled-components';
import { api } from '../api/client';
import { pill } from '../ui/primitives';
import { accentA, claimTone, inkA, night, px, radius, space } from '../ui/theme';
import { figureOf } from './art';
import { progress, requestOf, timetable, type Block } from './selectors';
import type { Claim, Evaluation, Week, WeekEvent } from './types';

// The week as a timetable: seven columns, Monday to Sunday, the hours of the day down the left, and each event a
// block from the time it happened. What has to read from across the room is what happened and how the residents
// received it - so a block says the event's name and their feedback, large, and nothing else (its time is the axis).
// Behind each block its own scene, very faint: the place and the people in it. A day with nothing is a narrow,
// empty column on purpose: the week is not one event a day.
//
// (Professor's review and the researcher, 2026-10-18: the earlier list with a title column said neither what each
// event was nor how it was received; the card needs neither the time nor the event's summary.)
//
// The wall is read-only: the tablet picks an event and the wall lights it.

/** The hours the axis runs: the village's day starts early; the latest event is after 20:00. */
export const AXIS = { from: 6, to: 24, minHours: 6.2, gapHours: 0.5 };
/** The hour lines drawn on the axis. */
const HOURS = [6, 9, 12, 15, 18, 21];

const Page = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: ${px(48)} minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  gap: ${space.sm};
  padding: ${space.lg} ${space.xl} ${space.sm};
  background: ${night.ground};
  color: ${night.ink};
`;

const Axis = styled.div`
  position: relative;
  > span { position: absolute; right: 0; transform: translateY(-50%); font-size: ${px(16)}; font-weight: 700; color: ${night.faint}; font-variant-numeric: tabular-nums; }
`;

/** The hour lines, under every column. */
const Lines = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  > i { position: absolute; left: 0; right: 0; border-top: 1px dashed ${night.line}; }
`;

const Row = styled.div<{ $cols: string }>`
  display: grid;
  grid-template-columns: ${(p) => p.$cols};
  gap: ${space.md};
`;

const Head = styled.div<{ $empty: boolean }>`
  display: flex;
  align-items: baseline;
  gap: ${space.sm};
  padding: 0 ${space.xs} ${space.xs};
  border-bottom: 2px solid ${(p) => (p.$empty ? night.line : inkA(0.3))};
  > b { font-size: ${px(32)}; font-weight: 800; letter-spacing: -0.02em; color: ${(p) => (p.$empty ? night.faint : night.ink)}; }
  > span { font-size: ${px(12)}; color: ${night.faint}; }
  > em { margin-left: auto; font-style: normal; font-size: ${px(12)}; font-weight: 800; color: ${night.accent}; }
`;

const Body = styled(Row)`
  position: relative;
  min-height: 0;
`;

const Column = styled.div<{ $empty: boolean }>`
  position: relative;
  display: flex;
  min-height: 0;
  > em { margin: auto 0; text-align: center; font-style: normal; font-size: ${px(16)}; line-height: 1.5; color: ${night.faint}; word-break: keep-all; }
`;

const Card = styled.article<{ $now: boolean }>`
  position: absolute;
  box-sizing: border-box;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  padding: ${space.md} ${space.lg};
  border-radius: ${radius.card};
  background: ${night.panel};
  border: 1px solid ${(p) => (p.$now ? night.accent : inkA(0.16))};
  ${(p) => p.$now && css`box-shadow: 0 0 0 ${px(4)} ${accentA(0.45)};`}
  > * { position: relative; }
`;

/** The event's own scene behind the words: the place and its people, very faint. */
const Ghost = styled.div<{ $src: string | null }>`
  position: absolute !important;
  inset: 0;
  background: ${(p) => (p.$src ? `center / cover url(${p.$src})` : 'none')};
  opacity: 0.22;
  > img { position: absolute; bottom: 0; height: 80%; max-width: none; object-fit: contain; }
  &::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(27, 28, 24, 0.1) 0%, rgba(27, 28, 24, 0.8) 60%); }
`;

const Title = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  > strong { font-size: ${px(24)}; font-weight: 800; letter-spacing: -0.03em; line-height: 1.2; word-break: keep-all; }
`;

const Mark = styled.span<{ $kind: 'now' | 'seen' | 'emergency' }>`
  ${pill('xs')}
  align-self: flex-start;
  font-weight: 800;
  color: ${(p) => (p.$kind === 'now' ? '#fff' : p.$kind === 'emergency' ? night.deep : night.mute)};
  background: ${(p) => (p.$kind === 'now' ? night.accent : p.$kind === 'emergency' ? night.ink : inkA(0.12))};
`;

/** How the residents received it: one entry each - who, the kinds of what they said, and the one thing to read. */
const Feedback = styled.ul`
  margin: 0;
  padding: ${space.sm} 0 0;
  list-style: none;
  border-top: 1px solid ${inkA(0.16)};
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  min-height: 0;
  > small { font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.06em; color: ${night.mute}; }
`;

/** One thing a resident said: its kind as a mark, then the words. No face and no name - the card is about the
 *  feedback, and who said what is on the evaluation page. */
const Voice = styled.li`
  display: grid;
  grid-template-columns: ${px(20)} minmax(0, 1fr);
  column-gap: ${space.xs};
  font-size: ${px(12)};
  line-height: 1.45;
  > b { font-weight: 800; text-align: center; }
  > span { font-weight: 600; color: ${inkA(0.92)}; word-break: keep-all; }
`;

const Chosen = styled.div`
  font-size: ${px(16)};
  line-height: 1.45;
  font-weight: 700;
  padding: ${space.xs} ${space.sm};
  border-radius: ${radius.control};
  background: ${night.accentSoft};
  box-shadow: inset ${px(4)} 0 0 ${night.accent};
  word-break: keep-all;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
`;

/** How many things a card says. */
const SAY = 3;

/**
 * The feedback a card shows: what the residents said, each resident in turn so no one fills the card, and within a
 * resident what bothered them or what they wish before what helped. Never a count or a score - their words.
 */
export function feedbackOf(evaluations: Evaluation[], limit = SAY): Claim[] {
  const order: Claim['kind'][] = ['bad', 'wish', 'unknown', 'good', 'neutral'];
  const queues = evaluations.map((ev) => [...ev.claims].sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind)));
  const out: Claim[] = [];
  for (let round = 0; out.length < limit && queues.some((q) => q.length > round); round += 1) {
    for (const q of queues) if (q[round] && out.length < limit) out.push(q[round]);
  }
  return out;
}

/** The event's own scene, as the card's faint picture: the first frame that has people in it. */
function sceneOf(event: WeekEvent, art: ReadonlySet<string>): { backdrop: string | null; figures: string[] } {
  const frames = event.before.scenes.flatMap((s) => s.frames);
  const frame = frames.find((f) => Object.keys(f.who).length > 0) ?? frames[0];
  if (!frame) return { backdrop: null, figures: [] };
  const figures = Object.entries(frame.who).map(([id, pose]) => figureOf(id, pose, frame, art)).filter((n): n is string => n !== null);
  return { backdrop: art.has(frame.place) ? api.artUrl(frame.place) : null, figures: figures.slice(0, 2).map((n) => api.artUrl(n)) };
}

function EventCard({ week, block, art, now, seen, chosen }: {
  week: Week; block: Block; art: ReadonlySet<string>; now: boolean; seen: boolean; chosen: string | null;
}) {
  const { event } = block;
  const picture = sceneOf(event, art);
  const request = requestOf(event, chosen);
  const voices = request ? request.after.evaluations : event.before.evaluations;
  return (
    <Card $now={now} aria-current={now}
      style={{
        top: `${block.top * 100}%`, height: `${block.height * 100}%`, left: 0, right: 0,
      }}>
      <Ghost $src={picture.backdrop} aria-hidden>
        {picture.figures.map((src, i) => <img key={src} src={src} alt="" style={{ right: `${i * 34}%` }} />)}
      </Ghost>
      <Title>
        {now ? <Mark $kind="now">지금 보는 중</Mark>
          : event.noChoice ? <Mark $kind="emergency">응급</Mark>
            : seen ? <Mark $kind="seen">읽음</Mark> : null}
        <strong>{event.title}</strong>
      </Title>
      {request && <Chosen>고른 요청 · {request.label}</Chosen>}
      <Feedback aria-label="주민의 피드백">
        <small>{request ? '반영 후 주민의 피드백' : '주민의 피드백'}</small>
        {feedbackOf(voices).map((c, i) => (
          <Voice key={i}>
            <b style={{ color: claimTone[c.kind].color }} aria-label={claimTone[c.kind].label}>{claimTone[c.kind].mark}</b>
            <span>{c.text}</span>
          </Voice>
        ))}
      </Feedback>
    </Card>
  );
}

interface Props {
  week: Week;
  art: ReadonlySet<string>;
  /** The event the tablet has picked: the wall lights it. */
  now: string | null;
  seen: readonly string[];
  /** The request chosen in each read event: its card then says what was chosen and how it was received. */
  chosen: Record<string, string | null>;
}

export default function WeekScreen({ week, art, now, seen, chosen }: Props) {
  const days = timetable(week, AXIS);
  // A quiet day is narrow; the rest share the width.
  const cols = days.map((d) => (d.blocks.length === 0 ? 'minmax(0, 0.4fr)' : 'minmax(0, 1fr)')).join(' ');
  const read = progress(week, new Set(seen));
  const span = AXIS.to - AXIS.from;
  const at = (h: number) => `${((h - AXIS.from) / span) * 100}%`;
  return (
    <Page aria-label="이번 주">
      <i />
      <Row $cols={cols}>
        {days.map((d, i) => (
          <Head key={d.day} $empty={d.blocks.length === 0}>
            <b>{d.day}</b>
            {d.blocks.length > 0 && <span>사건 {d.blocks.length}</span>}
            {i === days.length - 1 && <em>읽음 {read.seen}/{read.of}</em>}
          </Head>
        ))}
      </Row>
      <Axis aria-hidden>
        {HOURS.map((h) => <span key={h} style={{ top: at(h) }}>{String(h).padStart(2, '0')}시</span>)}
      </Axis>
      <Body $cols={cols}>
        <Lines aria-hidden>{HOURS.map((h) => <i key={h} style={{ top: at(h) }} />)}</Lines>
        {days.map((d) => (
          <Column key={d.day} $empty={d.blocks.length === 0}>
            {d.blocks.length === 0 && <em>아무 일 없이<br />지나간 날</em>}
            {d.blocks.map((b) => (
              <EventCard key={b.event.id} week={week} block={b} art={art}
                now={b.event.id === now} seen={seen.includes(b.event.id)} chosen={chosen[b.event.id] ?? null} />
            ))}
          </Column>
        ))}
      </Body>
    </Page>
  );
}
