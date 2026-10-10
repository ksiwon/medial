import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { api } from '../api/client';
import { EUNJEOM, KAIST, KOREA, NAMHAE, NAMHAE_TOWN, NEAR } from '../intro/koreaMap';
import PillText from '../ui/PillText';
import { accentA, font, inkA, night, radius } from '../ui/theme';

// The exhibition's opening: a film, not a screen. Nobody touches it.
//
// Six scenes run on one clock and end by opening day one (onFinish). The order
// is the one the researcher set (2026-10-10): what rural care is like (the
// hospital is in town, by day everyone is in the field or at sea), why it is
// hard (the road is long, help comes by a neighbour), that an AI Care
// Orchestrator is needed, why trying one in the village is hard (every visit is
// far and people are out), so the village is simulated from twelve real
// interviews, and a service designer runs, mends and reruns a service in it.
// Nothing here is a control. The first setting is fixed (selectors/tree
// openingOf), so there is no choice to make until day one ends. No statistics:
// every claim is one the interviews or the map carry.
//
// Pictures are the exhibition's own (scripts/art.mjs INTRO.* -> local-data/art/)
// and are invented illustrations. A missing picture is a plain dark ground, not
// an error: the sentences carry the meaning, the paintings carry the mood. The
// map is drawn from public boundaries (scripts/korea_outline.py).

const INK = night.deep;
const PAPER = '#f6f1e8';
const ACCENT = night.accent;

/** Scene lengths in ms. They add up to the film. */
const SCENE_MS = [5500, 5500, 5500, 11500, 9000, 9000];
const INTRO_TOTAL_MS = SCENE_MS.reduce((a, b) => a + b, 0);

const fade = keyframes`from { opacity: 0 } to { opacity: 1 }`;
const rise = keyframes`from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none }`;
const drift = keyframes`from { transform: scale(1.04) translate3d(0, 0, 0) } to { transform: scale(1.14) translate3d(-1.5%, -1%, 0) }`;
const lamp = keyframes`from { opacity: 0 } to { opacity: 1 }`;
const draw = keyframes`from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 }`;
const pulse = keyframes`0% { transform: scale(0.6); opacity: 0.9 } 100% { transform: scale(2.6); opacity: 0 }`;

const Stage = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: ${INK};
  color: ${PAPER};
  font-family: ${font.family};
  cursor: none;
  user-select: none;
`;

const Scene = styled.section<{ $on: boolean }>`
  position: absolute;
  inset: 0;
  /* The painting cross-fades slowly; what is written or drawn on it leaves
     quickly, so two scenes' sentences never share the screen. */
  visibility: ${(p) => (p.$on ? 'visible' : 'hidden')};
  transition: visibility 0s linear ${(p) => (p.$on ? '0s' : '0.5s')};
  > * { transition: opacity 0.5s ease; }
  > :not(:first-child) { opacity: ${(p) => (p.$on ? 1 : 0)}; transition-duration: ${(p) => (p.$on ? '0.4s' : '0.25s')}; }
  > :first-child { opacity: ${(p) => (p.$on ? 1 : 0)}; }
`;

const Picture = styled.div<{ $src: string | null; $on: boolean; $dim?: boolean }>`
  position: absolute;
  inset: 0 -3% -3% -3%;
  background: ${INK} ${(p) => (p.$src ? `url(${p.$src})` : 'none')} center / cover no-repeat;
  ${(p) => p.$on && css`animation: ${drift} 16s ease-out forwards;`}
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: ${(p) => (p.$dim
      ? 'rgba(21, 21, 15, 0.8)'
      : `linear-gradient(180deg, rgba(21, 21, 15, 0.1) 0%, rgba(21, 21, 15, 0) 38%, rgba(21, 21, 15, 0.55) 66%, rgba(21, 21, 15, 0.82) 100%)`)};
  }
`;

/** A ground with nothing painted on it, for the scenes that draw their own picture. */
const Ground = styled.div`
  position: absolute;
  inset: 0;
  background: ${INK};
`;

/** Under the captions of the scenes that draw their own picture: the map's shapes
 *  ran through the letters. The map's subject stays clear of it (fit's bottom). */
const Fog = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(0deg, rgba(21, 21, 15, 0.94) 0%, rgba(21, 21, 15, 0.8) 22%, rgba(21, 21, 15, 0) 44%);
`;

const Caption = styled.div`
  position: absolute;
  left: clamp(32px, 7vw, 120px);
  right: clamp(32px, 7vw, 120px);
  max-width: 72vw;
  bottom: clamp(56px, 11vh, 220px);
`;

/** Shown from `at` seconds into the scene to `until`, then gone. */
const Timed = styled.div<{ $on: boolean; $at: number; $until?: number }>`
  opacity: 0;
  ${(p) => p.$on && css`
    animation: ${rise} 0.5s ease ${p.$at}s forwards
      ${p.$until ? css`, ${keyframes`to { opacity: 0 }`} 0.6s ease ${p.$until}s forwards` : ''};
  `}
`;

const Eyebrow = styled.div<{ $on: boolean }>`
  display: inline-block;
  margin-left: -0.9em;
  padding: 0.4em 0.9em;
  border-radius: ${radius.pill};
  background: rgba(21, 21, 15, 0.62);
  font-size: clamp(12px, 1.1vw, 56px);
  font-weight: 800;
  letter-spacing: 0.14em;
  color: ${ACCENT};
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 0.5s ease 0.1s forwards;`}
`;

const Line = styled.h1<{ $on: boolean; $delay?: number }>`
  margin: 16px 0 0;
  font-size: clamp(28px, 3.6vw, 192px);
  line-height: 1.24;
  font-weight: 800;
  letter-spacing: -0.035em;
  word-break: keep-all;
  text-wrap: balance;
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 0.5s ease ${p.$delay ?? 0.3}s forwards;`}
`;

/** The word the scene is about, inside its sentence. */
const Em = styled.span`
  color: ${ACCENT};
`;

const Sub = styled.p<{ $on: boolean; $delay?: number }>`
  margin: 20px 0 0;
  max-width: 53vw;
  font-size: clamp(16px, 1.4vw, 76px);
  line-height: 1.6;
  word-break: keep-all;
  color: ${inkA(0.86)};
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 0.5s ease ${p.$delay ?? 0.9}s forwards;`}
`;

const Progress = styled.div<{ $ms: number }>`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: clamp(4px, 0.25vw, 12px);
  background: ${inkA(0.12)};
  &::after {
    content: '';
    display: block;
    height: 100%;
    width: 100%;
    background: ${ACCENT};
    transform-origin: left;
    transform: scaleX(0);
    animation: ${keyframes`to { transform: scaleX(1) }`} ${(p) => p.$ms}ms linear forwards;
  }
`;

const Disclaimer = styled.div`
  position: absolute;
  top: clamp(24px, 1.6vw, 64px);
  right: clamp(24px, 4vw, 120px);
  padding: 0.4em 1em;
  border-radius: ${radius.pill};
  background: rgba(21, 21, 15, 0.55);
  font-size: clamp(12px, 0.85vw, 44px);
  letter-spacing: 0.02em;
  color: ${inkA(0.82)};
  z-index: 2;
`;

const Brand = styled.div`
  position: absolute;
  top: clamp(20px, 1.5vw, 60px);
  left: clamp(24px, 4vw, 120px);
  font-size: clamp(16px, 1.05vw, 52px);
  font-weight: 800;
  letter-spacing: 0.04em;
  color: ${PAPER};
  z-index: 2;
`;

/** Everything drawn with SVG appears on the same few rules: `.in` fades in at
 *  its own delay, `.draw` draws its line, `.ring` pulses where something is. */
const Drawn = styled.svg`
  position: absolute;
  overflow: visible;
  font-family: ${font.family};
  .in { opacity: 0; animation: ${fade} 0.5s ease forwards; }
  .draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: ${draw} 0.8s ease forwards; }
  .gone { animation: ${keyframes`to { opacity: 0 }`} 0.6s ease forwards; }
  .ring { transform-box: fill-box; transform-origin: center; animation: ${pulse} 1.8s ease-out infinite; }
`;

const at = (s: number) => ({ animationDelay: `${s}s` });

// ---- Scene 4: KAIST to Namhae, then Namhae to Eunjeom -------------------------

/**
 * The two things each frame must show whole, in the outline's kilometres: the
 * country with the KAIST label left of Daejeon, and Namhae island with the town's
 * and the village's labels. The frame is fitted to the stage as it is - a 16:9
 * wall and a 4:3 monitor both - instead of cropping a fixed 16:9 view, which cut
 * the village's label off on narrower screens (2026-10-07).
 */
const WIDE_BOX = { x: 96, y: 0, w: 380, h: 620 };
const CLOSE_BOX = { x: 295, y: 413, w: 41, h: 35 };

/** Where a subject may sit on a W x H stage: clear of the edges, and for the
 *  close-up clear of the caption along the bottom. Spare width goes to the left,
 *  where the caption is. */
function fit(box: typeof WIDE_BOX, W: number, H: number, top: number, bottom: number) {
  const ax = W * 0.06;
  const aw = W * 0.88;
  const ay = H * top;
  const ah = H * (bottom - top);
  const s = Math.min(aw / box.w, ah / box.h);
  const tx = ax + (aw - box.w * s) * 0.8 - box.x * s;
  const ty = ay + (ah - box.h * s) / 2 - box.y * s;
  return { s, tx, ty, transform: `translate(${tx}px, ${ty}px) scale(${s})` };
}

const Camera = styled.g`
  transform-origin: 0 0;
  animation: ${keyframes`
    0%, 40% { transform: var(--wide); }
    57%, 100% { transform: var(--close); }
  `} 13s cubic-bezier(0.6, 0, 0.3, 1) forwards;
`;

/** Straight-line kilometres between two points of the outline. */
const km = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const PLATE = 'rgba(21, 21, 15, 0.86)';

function PlaceFilm() {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => setSize({ w: node.clientWidth, h: node.clientHeight });
    read();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(read);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, []);

  const [kx, ky] = KAIST;
  const [nx, ny] = NAMHAE_TOWN;
  const [ex, ey] = EUNJEOM;
  const wide = size ? fit(WIDE_BOX, size.w, size.h, 0.03, 0.97) : null;
  const close = size ? fit(CLOSE_BOX, size.w, size.h, 0.08, 0.72) : null;
  // Screen pixels, in each frame's own units: labels, dots and lines keep one
  // size on screen whatever the zoom.
  // `u` grows past a laptop's width, so a wall screen reads from across the room.
  const u = size ? Math.min(2.6, Math.max(1, size.w / 1440)) : 1;
  const w = (n: number) => (n * u) / (wide?.s ?? 1);
  const c = (n: number) => (n * u) / (close?.s ?? 1);
  // A label's text starts clear of its dot: the dot, a gap, then the plate's own
  // side padding (ui/PillText: 0.82 of the font size), so a plate never covers its dot.
  const clear = (dot: number, font: number) => u * (dot + 6 + font * 0.82);

  return (
    <Drawn ref={ref} style={{ inset: 0, width: '100%', height: '100%' }} aria-hidden>
      {wide && close && (
        <Camera style={{ '--wide': wide.transform, '--close': close.transform } as React.CSSProperties}>
          {/* The provinces are simplified for a glance; up close they would draw a
              coast that is not there, so they leave as the camera arrives. */}
          <path className="gone" style={at(6.2)} d={KOREA} fill="#3a3b33" stroke="rgba(246,241,232,0.35)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
          {/* The close-up's coast fades in as the camera arrives; at a glance it is
              the same land the provinces already draw. */}
          <g className="in" style={at(5.6)}>
            <path d={NEAR} fill="#3a3b33" stroke="rgba(246,241,232,0.3)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
            <path d={NAMHAE} fill="#55574b" stroke="rgba(246,241,232,0.7)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
          </g>

          {/* The wide frame: where the study comes from, and the line south.
              Lines run under the points they join and end at their centres. */}
          <g className="gone" style={at(4.8)}>
            <path className="draw" d={`M ${kx} ${ky} C ${kx + 70} ${ky + 50} ${nx - 40} ${ny - 90} ${nx} ${ny}`}
              pathLength={1} fill="none" stroke={ACCENT} strokeWidth={w(5)} strokeLinecap="round"
              style={{ ...at(1.1), animationDuration: '2.2s' }} />
            <g className="in" style={at(0.5)}>
              <circle className="ring" cx={kx} cy={ky} r={w(9)} fill="none" stroke={PAPER} strokeWidth={w(2)} />
              <circle cx={kx} cy={ky} r={w(8)} fill={PAPER} />
            </g>
            <g className="in" style={at(3.3)}>
              {/* An end of the line: accent, ringed, so it reads as a point and not the line's tip. */}
              <circle cx={nx} cy={ny} r={w(9)} fill={ACCENT} stroke={PAPER} strokeWidth={w(2.5)} />
            </g>
          </g>

          {/* The close frame: from the county town south-east to the village. */}
          <path className="draw" d={`M ${nx} ${ny} Q ${(nx + ex) / 2 + 1} ${ny - 1} ${ex} ${ey}`}
            pathLength={1} fill="none" stroke={ACCENT} strokeWidth={c(5)} strokeLinecap="round"
            style={{ ...at(7.8), animationDuration: '1s' }} />
          <g className="in" style={at(7.5)}>
            <circle cx={nx} cy={ny} r={c(8)} fill={PAPER} />
          </g>
          <g className="in" style={at(8.6)}>
            <circle className="ring" cx={ex} cy={ey} r={c(13)} fill="none" stroke={ACCENT} strokeWidth={c(3)} />
            <circle cx={ex} cy={ey} r={c(10)} fill={ACCENT} stroke={PAPER} strokeWidth={c(3)} />
          </g>
        </Camera>
      )}

      {/* The labels, in screen pixels at each frame's resting place. Drawn inside
          the camera they were 1-2 unit fonts scaled up, which the browser measures
          and lays out badly - plates came out off-centre and over their dots. Each
          set shows only while its frame is still: the wide one leaves before the
          camera moves, the close one arrives after it stops. */}
      {wide && close && (() => {
        const onScreen = (f: { s: number; tx: number; ty: number }, x: number, y: number) => [f.tx + f.s * x, f.ty + f.s * y] as const;
        const [kX, kY] = onScreen(wide, kx, ky);
        const [nX, nY] = onScreen(wide, nx, ny);
        const [tX, tY] = onScreen(close, nx, ny);
        const [eX, eY] = onScreen(close, ex, ey);
        return (
          <>
            <g className="gone" style={at(4.8)}>
              <g className="in" style={at(0.5)}>
                <PillText x={kX - clear(9, 24)} y={kY + 8 * u} anchor="end" size={24 * u} weight={800} fill={PAPER} plate={PLATE} text="KAIST · 대전" />
              </g>
              <g className="in" style={at(3.3)}>
                <PillText x={nX + clear(11, 24)} y={nY + 8 * u} size={24 * u} weight={800} fill={PAPER} plate={PLATE} text="남해" />
                <PillText x={(kX + nX) / 2 + 46 * u} y={(kY + nY) / 2} size={18 * u} weight={700} fill="rgba(246,241,232,0.85)"
                  plate={PLATE} text={`직선 약 ${Math.round(km(KAIST, EUNJEOM) / 10) * 10}km`} />
              </g>
            </g>
            <g className="in" style={at(7.6)}>
              <PillText x={tX - clear(9, 20)} y={tY + 7 * u} anchor="end" size={20 * u} weight={800} fill={PAPER} plate={PLATE} text="남해읍" />
            </g>
            <g className="in" style={at(8.6)}>
              {/* The name centred on the marker; the place under it, plates aligned on their left edges. */}
              <PillText x={eX + clear(14, 30)} y={eY + 10 * u} size={30 * u} weight={800} fill="#fff" plate={ACCENT} text="은점마을" />
              <PillText x={eX + clear(14, 30) - 30 * 0.82 * u + 16 * 0.82 * u} y={eY + 55 * u} size={16 * u} weight={700} fill={PAPER}
                plate={PLATE} text="남해군 삼동면 · 바닷가" />
            </g>
          </>
        );
      })()}
    </Drawn>
  );
}

// ---- Scene 5: twelve people, all interviewed ----------------------------------

const Houses = styled.div<{ $on: boolean }>`
  position: absolute;
  inset: 0;
  pointer-events: none;
  > i {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: ${radius.round};
    background: #ffd98a;
    box-shadow: 0 0 20px 8px rgba(255, 200, 100, 0.55);
    opacity: 0;
    ${(p) => p.$on && css`animation: ${lamp} 1.2s ease forwards;`}
  }
`;

/** Twelve windows, lit one by one: the village's twelve. */
const WINDOWS: [number, number][] = [
  [27, 56], [31, 60], [35, 52], [41, 58], [47, 55], [52, 62],
  [58, 57], [63, 64], [69, 60], [74, 66], [38, 66], [56, 70],
];

const Chain = styled.div<{ $on: boolean; $delay: number }>`
  margin-top: 28px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
  font-size: clamp(16px, 1.4vw, 76px);
  font-weight: 700;
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 0.6s ease ${p.$delay}s forwards;`}
  /* Sized in em so the chain scales with the screen; the height is fixed and the
     text centred in it, like every other pill (ui/primitives pill). */
  > span { display: inline-flex; align-items: center; box-sizing: border-box; height: 2.2em; padding: 0 0.95em;
           line-height: 1; white-space: nowrap; border: 1px solid ${inkA(0.5)}; border-radius: ${radius.pill}; }
  > span.real { border-color: ${ACCENT}; background: ${accentA(0.18)}; }
  > i { font-style: normal; color: ${ACCENT}; }
`;

// ---- Scene 2: a dotted line that runs out before it reaches the town ---------

/** The road of INTRO.road, from the viewer's lane up round the headland to the
 *  town (traced on a 1536x1024 grid of the picture). A smooth curve through these
 *  points keeps to the asphalt instead of cutting across the rocks. */
const ROAD: [number, number][] = [
  [1130, 1040], [1030, 890], [880, 790], [740, 705], [640, 650], [602, 612], [650, 578], [708, 548],
  [716, 508], [676, 468], [672, 448], [722, 446], [792, 438], [862, 424], [946, 398], [1002, 384],
  [1062, 368], [1132, 346], [1192, 322], [1238, 302],
];
const HOSPITAL = ROAD[ROAD.length - 1];

/** Catmull-Rom through the points, as cubic segments. */
function smooth(points: [number, number][]): string {
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}
const ROAD_PATH = smooth(ROAD);

/** Laid over the picture in the picture's own box and moved with it (drift), so
 *  the dots stay on the road however the painting is scaled. */
const Route = styled.svg<{ $on: boolean }>`
  position: absolute;
  inset: 0 -3% -3% -3%;
  width: 106%;
  height: 103%;
  overflow: visible;
  ${(p) => p.$on && css`animation: ${drift} 16s ease-out forwards;`}
  .dots {
    fill: none;
    stroke: ${ACCENT};
    stroke-width: 6;
    stroke-linecap: round;
    stroke-dasharray: 1 13;
    filter: drop-shadow(0 0 8px ${accentA(0.7)});
  }
  /* The mask the dots appear through: a fat line that draws itself along the road. */
  .sweep {
    fill: none;
    stroke: #fff;
    stroke-width: 40;
    stroke-linecap: round;
    stroke-dasharray: 1;
    stroke-dashoffset: 1;
    animation: ${draw} 2.6s ease-in-out 0.3s forwards;
  }
  .hospital { opacity: 0; animation: ${keyframes`from { opacity: 0; transform: translateY(-20px) } to { opacity: 1; transform: none }`} 0.5s ease 2.7s forwards; }
  .pulse { fill: none; stroke: ${PAPER}; stroke-width: 3; opacity: 0; animation: ${pulse} 1.8s ease-out 3.2s infinite; transform-box: fill-box; transform-origin: center; }
`;

interface Props {
  onFinish: () => void;
}

export default function IntroScreen({ onFinish }: Props) {
  const [scene, setScene] = useState(0);
  const [pictures, setPictures] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    api.art().then((a) => { if (live) setPictures(new Set(a.names)); }).catch(() => {});
    return () => { live = false; };
  }, []);

  // The parent re-renders while the film runs; the clock must not restart with it.
  const finish = useRef(onFinish);
  finish.current = onFinish;
  useEffect(() => {
    if (scene >= SCENE_MS.length) { finish.current(); return; }
    const timer = window.setTimeout(() => setScene((n) => n + 1), SCENE_MS[scene]);
    return () => window.clearTimeout(timer);
  }, [scene]);

  const src = (name: string) => (pictures.has(name) ? api.artUrl(name) : null);
  const on = (i: number) => scene === i;

  return (
    <Stage aria-label="MEDial 소개">
      <Brand>MEDial</Brand>
      <Disclaimer>그림과 대화는 모두 시뮬레이션입니다 · 이름은 가명입니다</Disclaimer>

      <Scene $on={on(0)}>
        <Picture $src={src('FARM')} $on={on(0)} />
        <Caption>
          <Eyebrow $on={on(0)}>시골의 낮</Eyebrow>
          <Line $on={on(0)}>병원은 읍내에, 주민은 낮이면 밭과 바다에 있습니다.</Line>
        </Caption>
      </Scene>

      <Scene $on={on(1)}>
        <Picture $src={src('INTRO.road')} $on={on(1)} />
        <Route $on={on(1)} viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice" aria-hidden>
          {on(1) && (
            <>
              <defs>
                <mask id="road-reveal" maskUnits="userSpaceOnUse" x="-200" y="-200" width="2000" height="1600">
                  <path className="sweep" pathLength={1} d={ROAD_PATH} />
                </mask>
              </defs>
              <path className="dots" pathLength={1000} d={ROAD_PATH} mask="url(#road-reveal)" />
              {/* The hospital: a pin set on the town's cross sign, its tip on the road's end. */}
              <g transform={`translate(${HOSPITAL[0]} ${HOSPITAL[1] - 4})`}>
                <ellipse className="pulse" rx={22} ry={8} />
                <g className="hospital">
                  <path d="M 0 0 C -14 -22 -36 -40 -36 -68 a 36 36 0 1 1 72 0 C 36 -40 14 -22 0 0 Z" fill={PAPER} />
                  <rect x={-6.5} y={-90} width={13} height={44} rx={3.5} fill={ACCENT} />
                  <rect x={-22} y={-74.5} width={44} height={13} rx={3.5} fill={ACCENT} />
                  <PillText x={-54} y={-57} anchor="end" size={30} weight={800} fill={PAPER} plate="rgba(21, 21, 15, 0.82)" text="남해읍 병원" />
                </g>
              </g>
            </>
          )}
        </Route>
        <Caption>
          <Eyebrow $on={on(1)}>의료는 멀다</Eyebrow>
          <Line $on={on(1)}>병원은 멀고, 아파도 참습니다.</Line>
        </Caption>
      </Scene>

      <Scene $on={on(2)}>
        <Picture $src={src('HOME')} $on={on(2)} />
        <Caption>
          <Eyebrow $on={on(2)}>AI CARE ORCHESTRATOR</Eyebrow>
          <Line $on={on(2)}>안부를 살피고 사람을 이어 줄 AI, MEDial이 필요합니다.</Line>
          <Chain $on={on(2)} $delay={1}>
            <span>안부 확인</span><i>→</i>
            <span>이웃 연결</span><i>→</i>
            <span>병원 동행</span>
          </Chain>
        </Caption>
      </Scene>

      <Scene $on={on(3)}>
        <Ground />
        {on(3) && <PlaceFilm />}
        <Fog />
        <Caption>
          <Timed $on={on(3)} $at={0.2} $until={4.8}>
            <Eyebrow $on={on(3)}>실증 연구가 먼저</Eyebrow>
            <Line $on={on(3)} $delay={0.3}>이런 서비스를 들이려면 주민 대상 실증 연구가 중요합니다.</Line>
          </Timed>
        </Caption>
        <Caption>
          <Timed $on={on(3)} $at={7.6}>
            <Eyebrow $on={on(3)}>하지만</Eyebrow>
            <Line $on={on(3)} $delay={7.7}>멀어서 자주 가기 어렵고, 어르신께 오래 묻기도 어렵습니다.</Line>
          </Timed>
        </Caption>
      </Scene>

      <Scene $on={on(4)}>
        <Picture $src={src('INTRO.village')} $on={on(4)} />
        <Houses $on={on(4)}>
          {WINDOWS.map(([x, y], i) => (
            <i key={i} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${0.2 + i * 0.12}s` }} />
          ))}
        </Houses>
        <Caption>
          <Eyebrow $on={on(4)}>그래서 제안합니다</Eyebrow>
          <Line $on={on(4)}><Em>시뮬레이션</Em>으로 은점마을을 먼저 만들었습니다. 실제 인터뷰로 서로 다른 주민 12명을 세웠습니다.</Line>
          <Chain $on={on(4)} $delay={1}>
            <span className="real">실제 인터뷰 12</span><i>→</i>
            <span>서로 다른 페르소나 12</span><i>→</i>
            <span>움직이는 에이전트 12</span>
          </Chain>
          <Sub $on={on(4)} $delay={2}>일과도 관계도 제각각인 이분들이 시뮬레이션 속에서 직접 움직입니다.</Sub>
        </Caption>
      </Scene>

      <Scene $on={on(5)}>
        <Picture $src={src('INTRO.desk')} $on={on(5)} />
        <Caption>
          <Line $on={on(5)}>여러분은 이 마을의 서비스 디자이너입니다.</Line>
          <Chain $on={on(5)} $delay={1}>
            <span>하루를 겪는다</span><i>→</i>
            <span>주민이 평가한다</span><i>→</i>
            <span>요청 하나로 고친다</span><i>→</i>
            <span>다시 돌린다</span>
          </Chain>
          <Sub $on={on(5)} $delay={2.2}>하루를 지켜보고, 주민의 평가를 읽고, 요청 하나로 MEDial의 규칙을 고칩니다. 주민과 마을은 바꿀 수 없습니다.</Sub>
        </Caption>
      </Scene>

      <Progress $ms={INTRO_TOTAL_MS} />
    </Stage>
  );
}
