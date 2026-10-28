import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { api } from '../api/client';
import type { Village } from '../api/types';
import { pill } from '../ui/primitives';
import { accentA, deepA, groundA, inkA, night, px, radius, space, type } from '../ui/theme';
import { clipsContent, useFit } from '../ui/useFit';
import { RuleItem } from './RuleViews';
import { viewOf } from './VillageMap';
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
`;

const Head = styled.header`
  display: flex;
  flex-direction: column;
  gap: ${space.md};
  margin-bottom: ${space.sm};
  > small { display: flex; align-items: center; gap: ${space.sm}; font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.09em; color: ${night.accent}; }
  > small::before { content: ''; width: ${px(28)}; height: 2px; background: ${night.accent}; }
  > h1 { margin: 0; font-size: ${type.display}; font-weight: 800; letter-spacing: -0.04em; line-height: 1.2; word-break: keep-all; }
  > h1 > em { font-style: normal; color: ${night.accent}; }
  > p { margin: 0; font-size: ${type.body}; line-height: 1.6; color: ${night.mute}; word-break: keep-all; }
`;

const Card = styled.section`
  display: flex;
  flex-direction: column;
  gap: ${space.xs};
  padding: ${space.md} ${space.sm};
  border-radius: ${radius.card};
  background: ${deepA(0.66)};
  border: 1px solid ${night.line};
  animation: ${rise} 0.7s ease both;
  > header { display: flex; align-items: baseline; justify-content: space-between; gap: ${space.md}; padding: 0 ${space.lg}; }
  > header > h2 { margin: 0; font-size: ${type.title}; font-weight: 800; letter-spacing: -0.03em; }
  > header > span { font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.06em; color: ${night.faint}; }
  > ol { list-style: none; margin: 0; padding: ${space.sm} 0 0; border-top: 1px solid ${night.line}; display: flex; flex-direction: column; gap: ${space.xs}; }
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

/** A pin's place in %, kept `margin` inside the map (as VillageMap). */
const pct = (f: number, margin: number) => Math.min(Math.max(f, margin), 1 - margin) * 100;

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
    return () => watch.disconnect();
  }, [box, week]);

  const card = (role: (typeof ROLES)[number]) => {
    const rules = role.rules.map((t) => byType.get(t)).filter((r): r is Rule => r !== undefined);
    if (rules.length === 0) return null;
    return (
      <Card key={role.key} data-card={role.key}>
        <header><h2>{role.title}</h2><span>규칙 {rules.length}개</span></header>
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
              <small>ver1 · 처음 정해 둔 규칙</small>
              <h1>서비스 디자이너가 들고 온 <em>‘의료 AI 조율자’</em> 초안</h1>
              <p>한 주의 모든 사건이 이 규칙으로 처음 돌았습니다. 주민의 피드백을 읽고, 사건마다 규칙을 하나씩 고쳐 봅니다.</p>
            </Head>
            {ROLES.filter((r) => r.side === 'left').map(card)}
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
