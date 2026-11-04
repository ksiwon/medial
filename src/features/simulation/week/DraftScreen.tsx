import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { api } from '../api/client';
import type { Village } from '../api/types';
import { pill } from '../ui/primitives';
import { accentA, deepA, groundA, inkA, night, px, radius, space, type } from '../ui/theme';
import { clipsContent, useFit } from '../ui/useFit';
import { RuleItem } from './RuleViews';
import { pct, viewOf } from './VillageMap';
import type { Rule, Week } from './types';

// The draft the designer brought, between the film and the week: the AI Care Orchestrator's rules before anything is
// chosen, laid on the village the way the poster lays them - each rule beside the people it is about, with a line to
// where they live. One set for the whole week (the server refuses a week whose events disagree), so every version the
// visitor reads later is this draft with their requests in force. The tablet only goes on (or the clock does,
// week/auto.ts). The rules themselves are drawn by week/RuleViews, as they are over an event ("현재 규칙").
//
// Residents are named by role only. A role stands at one home of the map that fits it (the head's, the driver's ...):
// the map says "around here", and the rules a role carries are the ones the AI applies to people like them.

/** Who each rule is about, and where on the map they stand. `home` is a resident's home in the village's map; the clinic is out of the village. */
export const ROLES: { key: string; title: string; home: string | null; side: 'left' | 'right'; rules: string[] }[] = [
  { key: 'head', title: '이장', home: 'P6', side: 'left', rules: ['contact_order', 'disclosure_scope'] },
  { key: 'driver', title: '운전하는 이웃', home: 'P3', side: 'left', rules: ['ride_candidate_order', 'ride_detour_limit'] },
  { key: 'clinic', title: '보건소 · 구급대원', home: null, side: 'right', rules: ['institution_deadline'] },
  { key: 'neighbour', title: '이웃', home: 'P8', side: 'right', rules: ['helper_daily_cap', 'neighbour_ask_limit'] },
  { key: 'elder', title: '안부를 받는 어르신', home: 'P1', side: 'right', rules: ['retry_before_help', 'quiet_period'] },
];

const rise = keyframes`from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; }`;
const glow = keyframes`0%, 100% { box-shadow: 0 0 0 0 ${accentA(0.55)}; } 50% { box-shadow: 0 0 0 ${px(8)} ${accentA(0)}; }`;

const Film = styled.div<{ $src: string | null }>`
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  background: ${night.deep} ${(p) => (p.$src ? `url(${p.$src})` : 'none')} center / cover no-repeat;
  &::before { content: ''; position: absolute; inset: 0; background: ${deepA(0.9)}; }
  > * { position: relative; }
`;

const Inner = styled.div`
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: ${space.xxl} ${space.xxl};
  overflow: hidden;
`;

const Board = styled.div`
  position: relative;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: ${space.xxl};
`;

const Column = styled.div<{ $side: 'left' | 'right' }>`
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
  /* The left column's last card stands at the bottom, where its people are on the map. The right column is stacked from
     the top: the recorded film lays the tablet over the lower right, and a card must end above it. */
  ${(p) => p.$side === 'left' && 'section:last-child { margin-top: auto; }'}
  ${(p) => p.$side === 'right' && `padding-top: calc(${space.xxl} * 3);`}
`;

/** The page's head, the same as the residents' feedback page and the others (week/ReviewScreens): a small line saying
 *  where we are, the title in one colour, and a muted line under it. */
const Head = styled.header`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  margin-bottom: ${space.sm};
  > small { display: inline-flex; align-items: center; gap: ${space.sm}; font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.08em; color: ${night.accent}; }
  > small::before { content: ''; width: ${px(28)}; height: 2px; background: ${night.accent}; }
  > h1 { margin: 0; font-size: ${type.display}; line-height: 1.12; font-weight: 800; letter-spacing: -0.04em; word-break: keep-all; }
  > p { margin: 0; font-size: ${type.body}; line-height: 1.6; color: ${night.mute}; word-break: keep-all; }
`;

/** The draft is the first version of something that is revised. What turns one version into the next sits between them,
 *  in a tray: the week is run (the screen), the residents answer (a speech bubble), and the designer - the one step the
 *  machine does not do, in the accent - reads them and marks what to change. Plain line pictograms, the stroke the
 *  other pages' chips and rules are drawn with; ver2 and ver3 are not made yet. */
const Pass = styled.div`
  flex: none;
  align-self: flex-start;
  display: flex;
  align-items: center;
  gap: ${space.sm};
  margin: ${space.lg} 0 calc(${space.xxl} * 2) ${space.lg};
  i.to { flex: none; position: relative; width: ${px(16)}; height: 2px; background: ${night.line}; }
  i.to::after { content: ''; position: absolute; right: 0; top: -4px; width: 8px; height: 8px; border-top: 2px solid ${night.faint}; border-right: 2px solid ${night.faint}; transform: rotate(45deg); }
  b { flex: none; padding: ${space.xs} ${space.md}; border-radius: ${radius.control}; font-size: ${type.lead}; font-weight: 800; letter-spacing: -0.02em; border: 2px solid ${night.line}; color: ${night.faint}; }
  b.now { border-color: ${night.accent}; color: ${night.ink}; background: ${accentA(0.14)}; }
  > div { display: flex; align-items: center; gap: ${space.sm}; padding: ${space.lg} ${space.xxl} ${space.md} ${space.md}; border-radius: ${radius.card}; background: ${deepA(0.66)}; border: 1px solid ${night.line}; }
  figure { margin: 0; width: ${px(88)}; display: flex; flex-direction: column; align-items: center; gap: ${space.sm}; color: ${night.mute}; }
  figure > svg { width: ${px(52)}; height: ${px(48)}; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  figure > svg .hot { fill: ${night.accent}; stroke: none; }
  figure > svg .soft { stroke-opacity: 0.5; }
  figure > figcaption { font-size: ${type.body}; font-weight: 700; white-space: nowrap; }
  figure.designer { color: ${night.accent}; }
  figure.designer > figcaption { font-weight: 800; }
  figure.designer > svg .fill { fill: ${accentA(0.25)}; }
`;

const Card = styled.section`
  display: flex;
  flex-direction: column;
  padding: ${space.xl};
  border-radius: ${radius.card};
  background: ${deepA(0.66)};
  border: 1px solid ${night.line};
  animation: ${rise} 0.7s ease both;
  /* the name, then a rule as wide as the words under it */
  > header { display: flex; align-items: baseline; justify-content: space-between; gap: ${space.md}; padding-bottom: ${space.md}; border-bottom: 1px solid ${night.line}; }
  > header > h2 { margin: 0; font-size: ${type.title}; font-weight: 800; letter-spacing: -0.03em; }
  > ol { list-style: none; margin: 0; padding: ${space.md} 0 0; display: flex; flex-direction: column; gap: ${space.md}; }
  /* a rule sits on the card's own inset: the same room left, right, above and below */
  > ol > li { padding: 0; }
`;

/** The map at its own proportions, as beside a scene (week/VillageMap): the pins' % are places on the picture. */
const MapCell = styled.div`
  min-height: 0;
  display: flex;
  justify-content: center;
`;

const Sheet = styled.div<{ $ratio: number }>`
  position: relative;
  height: 100%;
  aspect-ratio: ${(p) => p.$ratio};
  border-radius: ${radius.card};
  overflow: hidden;
  border: 1px solid ${night.line};
  > svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
`;

const Pin = styled.div`
  position: absolute;
  z-index: 2;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: ${space.xs};
  > i { width: ${px(16)}; height: ${px(16)}; border-radius: 50%; background: ${night.accent}; border: ${px(4)} solid ${night.white}; animation: ${glow} 1.8s ease-in-out infinite; }
  > span { ${pill('xs')} font-weight: 800; white-space: nowrap; color: ${night.white}; background: ${deepA(0.86)}; }
`;

/** A place out of the village, as an arrow off the top edge (the clinic is in town). */
const Away = styled(Pin)`
  top: ${px(32)};
  left: 50%;
  > i { width: auto; height: auto; border: 0; background: none; border-radius: 0; animation: none; box-shadow: none; font-style: normal; font-size: ${type.lead}; font-weight: 800; line-height: 1; color: ${night.accent}; }
  > span { background: ${night.accent}; }
`;

const Wires = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  pointer-events: none;
  overflow: visible;
  path { fill: none; stroke: ${night.accent}; stroke-width: ${px(2)}; stroke-linecap: round; opacity: 0.85; }
`;

interface Wire { key: string; d: string }

export default function DraftScreen({ week, art, village }: { week: Week; art: ReadonlySet<string>; village: Village }) {
  const byType = new Map<string, Rule>(week.draft.map((r) => [r.type, r]));
  const inner = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const [wires, setWires] = useState<Wire[]>([]);
  useFit(inner, clipsContent, [week, village]);

  const box = useMemo(() => (village.available ? viewOf(village) : null), [village]);

  // A line from each card's edge to its pin, in the board's own pixels: measured again whenever the board or a card changes size (the page's scale steps down to fit).
  useLayoutEffect(() => {
    const el = board.current;
    if (!el || !box) return undefined;
    const measure = () => {
      const b = el.getBoundingClientRect();
      const next: Wire[] = [];
      ROLES.forEach((r) => {
        const card = el.querySelector(`[data-card="${r.key}"]`)?.getBoundingClientRect();
        const pin = el.querySelector(`[data-pin="${r.key}"] > i`)?.getBoundingClientRect();
        if (!card || !pin) return;
        const x1 = (r.side === 'left' ? card.right : card.left) - b.left;
        const y1 = card.top + card.height / 2 - b.top;
        const x2 = pin.left + pin.width / 2 - b.left;
        const y2 = pin.top + pin.height / 2 - b.top;
        const dx = (x2 - x1) * 0.55;
        next.push({ key: r.key, d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}` });
      });
      // The same lines again are not a change: a new array would draw the page once more, and measure it once more.
      setWires((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    el.querySelectorAll('[data-card]').forEach((n) => watch.observe(n));
    // The cards rise into place: a transform is no resize, so the lines are drawn again once they have settled.
    el.addEventListener('animationend', measure);
    return () => { watch.disconnect(); el.removeEventListener('animationend', measure); };
  }, [box, week]);

  const card = (role: (typeof ROLES)[number]) => {
    const rules = role.rules.map((t) => byType.get(t)).filter((r): r is Rule => r !== undefined);
    if (rules.length === 0) return null;
    return (
      <Card key={role.key} data-card={role.key}>
        <header><h2>{role.title}</h2></header>
        <ol>{rules.map((r) => <RuleItem key={r.type} dense label={r.label} was={r.sentence} />)}</ol>
      </Card>
    );
  };

  return (
    <Film $src={art.has('INTRO.desk') ? api.artUrl('INTRO.desk') : null} aria-label="AI 조율자 초안">
      <Inner ref={inner}>
        <Board ref={board}>
          <Column $side="left">
            <Head>
              <small>서비스 디자이너의 설계 · ver1</small>
              <h1>의료 AI 조율자 초안</h1>
              <p>AI 조율자가 따를 규칙을 서비스 디자이너가 처음 정했습니다.<br />주민의 피드백을 읽고 어떤 규칙을 고칠지 판단하는 일이 이어집니다.</p>
            </Head>
            {(() => {
              const left = ROLES.filter((r) => r.side === 'left').map(card);
              return [
                <Pass key="loop" aria-label="초안은 같은 과정을 거쳐 다음 버전이 됩니다">
                  <b className="now">ver1</b>
                  <i className="to" />
                  <div>
                    <figure>
                      <svg viewBox="0 0 96 84" aria-hidden><rect x="8" y="6" width="80" height="54" rx="6" /><path d="M36 74h24M48 60v14" /><path className="soft" d="M20 44l14-12 12 8 16-14 12 10" /><circle className="hot" cx="34" cy="32" r="5" /><circle cx="62" cy="26" r="3.5" fill="currentColor" stroke="none" /></svg>
                      <figcaption>시뮬레이션</figcaption>
                    </figure>
                    <i className="to" />
                    <figure>
                      <svg viewBox="0 0 96 84" aria-hidden><path d="M10 10h42a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6H28L16 54V42h-6z" /><path className="soft" d="M44 52h28l10 10V52h4a6 6 0 0 0 6-6V32M20 22h26M20 32h16" /></svg>
                      <figcaption>주민의 피드백</figcaption>
                    </figure>
                    <i className="to" />
                    <figure className="designer">
                      <svg viewBox="0 0 96 84" aria-hidden><circle cx="38" cy="22" r="11" /><path d="M14 74c0-18 12-28 24-28s24 10 24 28" /><path className="fill" d="M62 50l22-22 6 6-22 22-9 3z" /><path d="M78 34l6 6" /></svg>
                      <figcaption>디자이너의 판단</figcaption>
                    </figure>
                  </div>
                  <i className="to" />
                  <b>ver2</b>
                </Pass>,
                ...left,
              ];
            })()}
          </Column>

          {box ? (
            <MapCell>
              <Sheet $ratio={box[2] / box[3]} aria-label="은점마을 지도">
                <svg viewBox={box.join(' ')} preserveAspectRatio="xMidYMid meet" aria-hidden>
                  {village.raster
                    ? <image href={api.villageMapUrl()} width={village.raster.width} height={village.raster.height}
                        transform={`matrix(${village.raster.matrix.join(' ')})`} opacity={0.82} />
                    : <rect x={box[0]} y={box[1]} width={box[2]} height={box[3]} fill={inkA(0.06)} />}
                  <rect x={box[0]} y={box[1]} width={box[2]} height={box[3]} fill={groundA(0.52)} />
                  {Object.entries(village.homes ?? {}).map(([id, h]) => (
                    <circle key={id} cx={h.x} cy={h.y} r={7} fill={night.white} opacity={0.5} />
                  ))}
                </svg>
                {ROLES.map((r) => {
                  const home = r.home ? village.homes?.[r.home] : null;
                  if (!home) {
                    return r.home === null ? <Away key={r.key} data-pin={r.key}><i>↑</i><span>마을 밖 · 읍내</span></Away> : null;
                  }
                  return (
                    <Pin key={r.key} data-pin={r.key} style={{ left: `${pct((home.x - box[0]) / box[2], 0.12)}%`, top: `${pct((home.y - box[1]) / box[3], 0.06)}%` }}>
                      <i /><span>{r.title}</span>
                    </Pin>
                  );
                })}
              </Sheet>
            </MapCell>
          ) : <span />}

          <Column $side="right">{ROLES.filter((r) => r.side === 'right').map(card)}</Column>
          <Wires aria-hidden>{wires.map((w) => <path key={w.key} d={w.d} />)}</Wires>
        </Board>
      </Inner>
    </Film>
  );
}
