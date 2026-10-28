import type { ReactNode } from 'react';
import styled from 'styled-components';
import { accentA, inkA, night, px, radius, space, type } from '../ui/theme';

// How the AI's rules are drawn, once, for the three places that show them: the draft the designer brought, the
// "현재 규칙" page over an event or the week, and what was changed at the closing. A rule is a name, the figures in its
// sentence set apart (they are what a request turns), and its sentence; a changed rule shows what it was and what it
// is now, with the figures that moved side by side. The two jobs the rules belong to are the page's two columns.

/** The AI's two jobs (AGENTS.md: the unanswered check-in, the ride to the clinic), and which rules belong to each. */
export const JOBS: { title: string; gist: string; rules: string[] }[] = [
  {
    title: '안부가 닿지 않을 때',
    gist: '어르신이 안부에 답하지 않으면, 다시 묻고 이웃과 기관에 알립니다.',
    rules: ['retry_before_help', 'quiet_period', 'contact_order', 'disclosure_scope', 'institution_deadline'],
  },
  {
    title: '이웃에게 부탁할 때',
    gist: '확인이나 병원 길을 이웃에게 부탁합니다. 한 사람에게 몰리지 않게 나눕니다.',
    rules: ['helper_daily_cap', 'neighbour_ask_limit', 'ride_candidate_order', 'ride_detour_limit'],
  },
];

/** A figure of a rule's sentence: minutes, times, people. ("제3자" is not one: a figure carries its unit.) */
const FIGURE = /(\d+(?:\.\d+)?\s?(?:분|회|번|명|시간|초))/g;
const figuresOf = (sentence: string): string[] => sentence.match(FIGURE) ?? [];

/** A sentence with its figures in bold, so the number a request moves is the first thing the eye finds. */
export function Sentence({ text }: { text: string }) {
  return <>{text.split(FIGURE).map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part))}</>;
}

const Chip = styled.span<{ $was?: boolean; $now?: boolean }>`
  display: inline-flex;
  align-items: center;
  padding: ${space.hair} ${space.sm};
  border-radius: ${radius.control};
  font-size: ${type.body};
  font-weight: 800;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: ${(p) => (p.$now ? night.accent : p.$was ? night.faint : night.ink)};
  background: ${(p) => (p.$was ? 'transparent' : inkA(0.1))};
  text-decoration: ${(p) => (p.$was ? 'line-through' : 'none')};
  text-decoration-color: ${inkA(0.4)};
`;

const Chips = styled.span`
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: ${space.sm};
  > span.pair { display: inline-flex; align-items: center; gap: ${space.xs}; color: ${night.faint}; font-size: ${type.body}; }
`;

/** The figures of a rule as chips; with `now`, the ones that changed show what they were and what they are. */
function Figures({ base, now }: { base: string; now?: string }) {
  const was = figuresOf(base);
  const is = now === undefined ? was : figuresOf(now);
  const n = Math.max(was.length, is.length);
  if (n === 0) return null;
  return (
    <Chips>
      {Array.from({ length: n }, (_, i) => {
        const a = was[i];
        const b = is[i];
        if (a === b) return <Chip key={i}>{a}</Chip>;
        return (
          <span className="pair" key={i}>
            {a && <Chip $was>{a}</Chip>}
            {a && b && '→'}
            {b && <Chip $now>{b}</Chip>}
          </span>
        );
      })}
    </Chips>
  );
}

const Item = styled.li<{ $changed: boolean; $dense: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${space.xs};
  padding: ${space.md} ${space.lg};
  border-radius: ${radius.card};
  box-shadow: ${(p) => (p.$changed ? `inset ${px(2)} 0 0 ${night.accent}` : 'none')};
  > header { display: flex; align-items: center; justify-content: space-between; gap: ${space.md}; flex-wrap: wrap; }
  > header > h3 { margin: 0; display: flex; align-items: center; gap: ${space.sm}; flex-wrap: wrap;
    font-size: ${(p) => (p.$dense ? type.lead : type.title)}; font-weight: 800; letter-spacing: -0.02em; line-height: 1.3; word-break: keep-all; }
  > header > h3 > em { font-style: normal; font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.06em; color: ${night.accent}; }
  > p, > s { margin: 0; font-size: ${(p) => (p.$dense ? type.body : type.lead)}; line-height: 1.5; word-break: keep-all; }
  > p { color: ${inkA(0.86)}; }
  > p > b, > s > b { font-weight: 800; }
  > p.now { color: ${night.ink}; font-weight: 600; }
  > s { color: ${night.faint}; text-decoration-color: ${inkA(0.35)}; }
`;

const Edit = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space.xs};
  margin-top: ${space.sm};
  padding: ${space.xs} ${space.md};
  box-shadow: inset ${px(2)} 0 0 ${accentA(0.7)};
  font-size: ${type.body};
  line-height: 1.5;
  word-break: keep-all;
  > strong { color: ${night.accent}; font-weight: 800; }
  > span { color: ${night.ink}; }
  > span > b { font-weight: 800; }
`;

export interface RuleEdit { by: string; version: number; sentence: string }

/** One rule. Plain (the draft); changed (`now`: it was `was`, it is the sentence of `now.version`); or with the
 *  events where the visitor changed it (`edits`), when the week is shown and the rule itself is the draft's. */
export function RuleItem({ label, was, now, edits, dense = false, compact = false, terse = false }: {
  label: string; was: string; now?: { sentence: string; version: number }; edits?: RuleEdit[]; dense?: boolean;
  /** Where room is short (the closing): when the figures say what moved, the old sentence is left out ... */
  compact?: boolean;
  /** ... and where it is shorter still, it always is. */
  terse?: boolean;
}) {
  const moved = now !== undefined && figuresOf(was).join('|') !== figuresOf(now.sentence).join('|');
  return (
    <Item $changed={now !== undefined} $dense={dense}>
      <header>
        <h3>{label}{now && <em>ver{now.version}에서 바뀜</em>}</h3>
        <Figures base={was} now={now?.sentence} />
      </header>
      {now ? (
        <>
          {!(terse || (compact && moved)) && <s><Sentence text={was} /></s>}
          <p className="now"><Sentence text={now.sentence} /></p>
        </>
      ) : (
        <p><Sentence text={was} /></p>
      )}
      {edits?.map((e) => (
        <Edit key={`${e.by}${e.version}`}><strong>{e.by} · ver{e.version}</strong><span><Sentence text={e.sentence} /></span></Edit>
      ))}
    </Item>
  );
}

const Panel = styled.section<{ $ground: string; $dense: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${space.md};
  padding: ${space.xl};
  border-radius: ${radius.card};
  background: ${(p) => p.$ground};
  border: 1px solid ${night.line};
  > header { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; grid-template-areas: 'n t c' '. p p'; gap: ${space.xs} ${space.lg}; align-items: center; padding: 0 ${space.lg}; }
  > header > i { grid-area: n; font-style: normal; font-size: ${type.display}; font-weight: 800; line-height: 1; color: ${night.faint}; font-variant-numeric: tabular-nums; }
  > header > h2 { grid-area: t; margin: 0; font-size: ${(p) => (p.$dense ? type.title : type.heading)}; font-weight: 800; letter-spacing: -0.03em; line-height: 1.2; }
  > header > span { grid-area: c; }
  > header > p { grid-area: p; margin: 0; font-size: ${type.body}; line-height: 1.5; color: ${night.mute}; word-break: keep-all; }
  > ol { list-style: none; margin: 0; padding: ${space.md} 0 0; border-top: 1px solid ${night.line}; display: flex; flex-direction: column; gap: ${space.sm}; }
  > footer { margin-top: auto; padding: ${space.md} ${space.lg} 0; border-top: 1px solid ${night.line}; }
`;

const Tag = styled.span<{ $hot: boolean }>`
  font-size: ${type.body};
  font-weight: 700;
  white-space: nowrap;
  color: ${(p) => (p.$hot ? night.accent : night.faint)};
`;

/** One job and its rules: a number, the job and what it comes to, and how many rules it holds (or how many changed). */
export function JobPanel({ index, job, ground, dense = false, count, hot = false, footer, children }: {
  index: number; job: { title: string; gist: string }; ground: string; dense?: boolean;
  count: string; hot?: boolean; footer?: ReactNode; children: ReactNode;
}) {
  return (
    <Panel $ground={ground} $dense={dense}>
      <header>
        <i>{String(index + 1).padStart(2, '0')}</i>
        <h2>{job.title}</h2>
        <Tag $hot={hot}>{count}</Tag>
        <p>{job.gist}</p>
      </header>
      <ol>{children}</ol>
      {footer && <footer>{footer}</footer>}
    </Panel>
  );
}
