import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { api } from '../api/client';
import type { GenerationDetail, SessionDetail } from '../api/iteration';
import { EUNJEOM, KAIST, KOREA, NAMHAE, NAMHAE_TOWN, NEAR } from '../intro/koreaMap';
import { dayFacts, dayName, farthestPath, openingOf, pathCount, ruleShifts } from '../selectors/tree';
import PillText from '../ui/PillText';
import { font } from '../ui/theme';

// The exhibition's opening: a film, not a screen. Nobody touches it.
//
// Six scenes run on one clock and end by opening day one (onFinish). The order
// is the one the researcher set (2026-10-07): first what a service designer can
// do with this tool, then that the village is a real place - KAIST to Namhae,
// then Namhae to Eunjeom - and that its residents come from real interviews,
// then why care is far, then how far MEDial's rules move in three days, and
// what this is not. Nothing here is a control. The first setting is fixed
// (selectors/tree openingOf), so there is no choice to make until day one ends.
//
// Pictures are the exhibition's own (scripts/art.mjs INTRO.* -> local-data/art/)
// and are invented illustrations. A missing picture is a plain dark ground, not
// an error: the sentences carry the meaning, the paintings carry the mood. The
// map is drawn from public boundaries (scripts/korea_outline.py).

const INK = '#15150f';
const PAPER = '#f6f1e8';
const ACCENT = '#e2542c';

/** Scene lengths in ms. They add up to the film. */
const SCENE_MS = [12000, 13000, 9000, 7000, 13000, 7000];
const INTRO_TOTAL_MS = SCENE_MS.reduce((a, b) => a + b, 0);

const fade = keyframes`from { opacity: 0 } to { opacity: 1 }`;
const rise = keyframes`from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none }`;
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
  transition: visibility 0s linear ${(p) => (p.$on ? '0s' : '0.8s')};
  > * { transition: opacity 0.8s ease; }
  > :not(:first-child) { opacity: ${(p) => (p.$on ? 1 : 0)}; transition-duration: ${(p) => (p.$on ? '0.6s' : '0.35s')}; }
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
      : `linear-gradient(180deg, rgba(21, 21, 15, 0.1) 0%, rgba(21, 21, 15, 0) 38%, rgba(21, 21, 15, 0.55) 66%, rgba(21, 21, 15, 0.82) 100%),
         radial-gradient(ellipse at 50% 40%, transparent 55%, rgba(21, 21, 15, 0.55) 100%)`)};
  }
`;

/** A ground with nothing painted on it, for the scenes that draw their own picture. */
const Ground = styled.div`
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 60% 40%, #22231c 0%, ${INK} 70%);
`;

const Caption = styled.div<{ $top?: boolean }>`
  position: absolute;
  left: clamp(32px, 7vw, 120px);
  right: clamp(32px, 7vw, 120px);
  max-width: 1040px;
  ${(p) => (p.$top ? 'top: clamp(56px, 9vh, 96px);' : 'bottom: clamp(56px, 11vh, 120px);')}
`;

/** Shown from `at` seconds into the scene to `until`, then gone. */
const Timed = styled.div<{ $on: boolean; $at: number; $until?: number }>`
  opacity: 0;
  ${(p) => p.$on && css`
    animation: ${rise} 0.7s ease ${p.$at}s forwards
      ${p.$until ? css`, ${keyframes`to { opacity: 0 }`} 0.6s ease ${p.$until}s forwards` : ''};
  `}
`;

const Eyebrow = styled.div<{ $on: boolean }>`
  font-size: clamp(12px, 1.1vw, 16px);
  font-weight: 800;
  letter-spacing: 0.14em;
  color: ${ACCENT};
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 0.7s ease 0.2s forwards;`}
`;

const Line = styled.h1<{ $on: boolean; $delay?: number; $size?: 'small' }>`
  margin: 14px 0 0;
  font-size: ${(p) => (p.$size === 'small' ? 'clamp(24px, 2.8vw, 44px)' : 'clamp(28px, 3.6vw, 58px)')};
  line-height: 1.24;
  font-weight: 800;
  letter-spacing: -0.035em;
  word-break: keep-all;
  text-wrap: balance;
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 0.7s ease ${p.$delay ?? 0.5}s forwards;`}
`;

const Sub = styled.p<{ $on: boolean; $delay?: number }>`
  margin: 18px 0 0;
  max-width: 760px;
  font-size: clamp(15px, 1.4vw, 21px);
  line-height: 1.6;
  word-break: keep-all;
  color: rgba(246, 241, 232, 0.86);
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 0.7s ease ${p.$delay ?? 1.4}s forwards;`}
`;

const Progress = styled.div<{ $ms: number }>`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: rgba(246, 241, 232, 0.12);
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
  top: 22px;
  right: clamp(24px, 4vw, 56px);
  font-size: 12px;
  letter-spacing: 0.02em;
  color: rgba(246, 241, 232, 0.62);
  z-index: 2;
`;

const Brand = styled.div`
  position: absolute;
  top: 20px;
  left: clamp(24px, 4vw, 56px);
  font-size: 15px;
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

// ---- Scene 1: what a service designer does with this --------------------------

const DiagramArea = styled.div`
  position: absolute;
  left: clamp(24px, 5vw, 96px);
  right: clamp(24px, 5vw, 96px);
  top: clamp(170px, 27vh, 260px);
  bottom: clamp(24px, 5vh, 56px);
  > svg { inset: 0; width: 100%; height: 100%; }
`;

const BOX = { fill: 'rgba(246, 241, 232, 0.05)', stroke: 'rgba(246, 241, 232, 0.4)' };

/** A system box of the diagram: a title, an English name, and two lines. */
function Box({ x, title, en, lines, delay }: { x: number; title: string; en: string; lines: string[]; delay: number }) {
  return (
    <g className="in" style={at(delay)}>
      <rect x={x} y={0} width={320} height={170} rx={14} {...BOX} />
      <text x={x + 24} y={44} fill={PAPER} fontSize={28} fontWeight={800}>{title}</text>
      <text x={x + 24} y={70} fill={ACCENT} fontSize={14} fontWeight={800} letterSpacing="0.08em">{en}</text>
      {lines.map((line, i) => (
        <text key={line} x={x + 24} y={110 + i * 30} fill="rgba(246,241,232,0.86)" fontSize={18}>{line}</text>
      ))}
    </g>
  );
}

/** A line that draws itself, and its head, which appears only once the line has
 *  reached it - a head drawn with the line sat at the far end before the line did. */
function Arrow({ d, colour, width, delay, accent = false }: {
  d: string; colour: string; width: number; delay: number; accent?: boolean;
}) {
  return (
    <>
      <path className="draw" d={d} pathLength={1} fill="none" stroke={colour} strokeWidth={width} style={at(delay)} />
      <path className="in" d={d} fill="none" stroke="none" markerEnd={`url(#${accent ? 'head-accent' : 'head'})`}
        style={at(delay + 0.75)} />
    </>
  );
}

/** A designer's action: a numbered line from the designer to what it acts on. */
function Act({ n, d, label, lx, ly, delay, accent = false }: {
  n: number; d: string; label: string; lx: number; ly: number; delay: number; accent?: boolean;
}) {
  const colour = accent ? ACCENT : PAPER;
  return (
    <g>
      <Arrow d={d} colour={colour} width={accent ? 3.5 : 2.5} delay={delay} accent={accent} />
      <g className="in" style={at(delay + 0.4)}>
        <PillText x={lx} y={ly} anchor="middle" size={accent ? 21 : 19} weight={800} fill={colour} plate={INK}
          text={`${'①②③④⑤'[n - 1]} ${label}`} />
      </g>
    </g>
  );
}

function DesignerDiagram() {
  return (
    <Drawn viewBox="0 -60 1200 640" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <defs>
        {[['head', PAPER], ['head-accent', ACCENT]].map(([id, c]) => (
          // One size for every head, whatever the line's weight (in user units, not
          // stroke widths, which made the accent line's head half again as large).
          <marker key={id} id={id} viewBox="0 0 10 10" refX={9} refY={5} markerUnits="userSpaceOnUse"
            markerWidth={15} markerHeight={15} orient="auto-start-reverse">
            <path d="M0 1 L10 5 L0 9 L2.6 5 z" fill={c} />
          </marker>
        ))}
      </defs>

      <Box x={20} title="MEDial" en="AI CARE ORCHESTRATOR" lines={['안부 확인 · 병원 동행을 잇는다', '규칙 9개로 움직인다']} delay={0.5} />
      <Box x={440} title="시뮬레이션 마을" en="SIMULATED RURAL VILLAGE" lines={['은점마을 주민 12명', '인터뷰에서 태어난 에이전트']} delay={0.8} />
      <Box x={860} title="주민 평가" en="RESIDENT EVALUATIONS" lines={['각자 겪은 일만 말한다', '근거 사건이 붙고, 점수는 없다']} delay={1.1} />

      {/* Lines leave their source 12 units clear and stop 12 short of their target:
          the same gap at both ends of every arrow in the picture. */}
      <Arrow d="M 352 85 L 428 85" colour={PAPER} width={2.5} delay={1.4} />
      <Arrow d="M 772 85 L 848 85" colour={PAPER} width={2.5} delay={1.7} />

      {/* The designer, below the systems, acting on each of them. */}
      <g className="in" style={at(2.3)}>
        <circle cx={600} cy={430} r={46} fill="rgba(226,84,44,0.14)" stroke={ACCENT} strokeWidth={2.5} />
        <circle cx={600} cy={415} r={13} fill={PAPER} />
        <path d="M 576 452 Q 600 424 624 452 Z" fill={PAPER} />
        <text x={600} y={505} textAnchor="middle" fill={PAPER} fontSize={24} fontWeight={800}>서비스 디자이너</text>
        <text x={600} y={532} textAnchor="middle" fill="rgba(246,241,232,0.7)" fontSize={16}>전시에서는 관람객</text>
      </g>

      {/* Each label sits on its own line, at the line's midpoint; ② and ③ mirror
          each other about the designer. */}
      <Act n={1} d="M 600 374 L 600 182" label="마을의 하루를 본다" lx={600} ly={285} delay={3} />
      <Act n={2} d="M 647.5 400.3 C 800 360 960 300 1000 182" label="주민의 평가를 읽는다" lx={866} ly={327} delay={4} />
      <Act n={3} d="M 552.5 400.3 C 400 360 240 300 200 182" label="요청 하나를 골라 규칙을 고친다" lx={334} ly={327} delay={5} accent />
      <g>
        {/* From the top of MEDial's box to the top of the village's, centre to centre. */}
        <Arrow d="M 180 -12 C 260 -64 520 -64 600 -12" colour={PAPER} width={2.5} delay={6} />
        <g className="in" style={at(6.4)}>
          <PillText x={390} y={-44} anchor="middle" size={19} weight={800} fill={PAPER} plate={INK}
            text="④ 다음 날을 다시 돌려 비교한다" />
        </g>
      </g>

      {/* What leaves the tool, and what the designer does not touch. */}
      <g className="in" style={at(7)}>
        <path d="M 654 446 L 854 504" stroke={PAPER} strokeWidth={2.5} strokeDasharray="6 7" markerEnd="url(#head)" fill="none" />
        <rect x={866} y={460} width={314} height={96} rx={14} fill="none" stroke={PAPER} strokeWidth={2} strokeDasharray="8 8" />
        <text x={890} y={500} fill={PAPER} fontSize={21} fontWeight={800}>⑤ 실제 주민에게 확인한다</text>
        <text x={890} y={530} fill="rgba(246,241,232,0.75)" fontSize={16}>다음 현장 방문에서 · 도구 밖의 일</text>
      </g>
      <g className="in" style={at(7.8)}>
        <rect x={20} y={460} width={330} height={96} rx={14} fill="rgba(246,241,232,0.04)" stroke="rgba(246,241,232,0.25)" />
        <text x={44} y={500} fill="rgba(246,241,232,0.9)" fontSize={20} fontWeight={800}>디자이너가 고치지 않는 것</text>
        <text x={44} y={530} fill="rgba(246,241,232,0.7)" fontSize={16}>주민 · 마을 · 일어나는 사건 · 평가 기준</text>
      </g>
    </Drawn>
  );
}

// ---- Scene 2: KAIST to Namhae, then Namhae to Eunjeom -------------------------

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
  const w = (n: number) => n / (wide?.s ?? 1);
  const c = (n: number) => n / (close?.s ?? 1);
  // A label's text starts clear of its dot: the dot, a gap, then the plate's own
  // side padding (ui/PillText: 0.82 of the font size), so a plate never covers its dot.
  const clear = (dot: number, font: number) => dot + 6 + font * 0.82;

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
                <PillText x={kX - clear(9, 24)} y={kY + 8} anchor="end" size={24} weight={800} fill={PAPER} plate={PLATE} text="KAIST · 대전" />
              </g>
              <g className="in" style={at(3.3)}>
                <PillText x={nX + clear(11, 24)} y={nY + 8} size={24} weight={800} fill={PAPER} plate={PLATE} text="남해" />
                <PillText x={(kX + nX) / 2 + 46} y={(kY + nY) / 2} size={18} weight={700} fill="rgba(246,241,232,0.85)"
                  plate={PLATE} text={`직선 약 ${Math.round(km(KAIST, EUNJEOM) / 10) * 10}km`} />
              </g>
            </g>
            <g className="in" style={at(7.6)}>
              <PillText x={tX - clear(9, 20)} y={tY + 7} anchor="end" size={20} weight={800} fill={PAPER} plate={PLATE} text="남해읍" />
            </g>
            <g className="in" style={at(8.6)}>
              {/* The name centred on the marker; the place under it, plates aligned on their left edges. */}
              <PillText x={eX + clear(14, 30)} y={eY + 10} size={30} weight={800} fill="#fff" plate={ACCENT} text="은점마을" />
              <PillText x={eX + clear(14, 30) - 30 * 0.82 + 16 * 0.82} y={eY + 55} size={16} weight={700} fill={PAPER}
                plate={PLATE} text="남해군 삼동면 · 바닷가" />
            </g>
          </>
        );
      })()}
    </Drawn>
  );
}

// ---- Scene 3: twelve people, all interviewed ----------------------------------

const Houses = styled.div<{ $on: boolean }>`
  position: absolute;
  inset: 0;
  pointer-events: none;
  > i {
    position: absolute;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #ffd98a;
    box-shadow: 0 0 18px 6px rgba(255, 200, 100, 0.55);
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
  margin-top: 26px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  font-size: clamp(14px, 1.4vw, 21px);
  font-weight: 700;
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 1s ease ${p.$delay}s forwards;`}
  /* Sized in em so the chain scales with the screen; the height is fixed and the
     text centred in it, like every other pill (ui/primitives pill). */
  > span { display: inline-flex; align-items: center; box-sizing: border-box; height: 2.2em; padding: 0 0.95em;
           line-height: 1; white-space: nowrap; border: 1px solid rgba(246, 241, 232, 0.5); border-radius: 999px; }
  > span.real { border-color: ${ACCENT}; background: rgba(226, 84, 44, 0.18); }
  > i { font-style: normal; color: ${ACCENT}; }
  > span.out { border-style: dashed; color: rgba(246, 241, 232, 0.8); }
`;

// ---- Scene 4: a dotted line that runs out before it reaches the town ---------

const Route = styled.svg`
  position: absolute;
  inset: -3%;
  width: 106%;
  height: 106%;
  overflow: visible;
  path {
    fill: none;
    stroke: ${ACCENT};
    stroke-width: 6;
    stroke-linecap: round;
    stroke-dasharray: 1 16;
    filter: drop-shadow(0 0 6px rgba(226, 84, 44, 0.7));
  }
  .reach {
    animation: ${keyframes`from { stroke-dashoffset: 0; opacity: 0 } 8% { opacity: 1 } to { stroke-dashoffset: -520; opacity: 1 }`} 3.6s linear 0.5s forwards;
  }
  circle { fill: ${ACCENT}; opacity: 0; animation: ${fade} 0.5s ease 0.4s forwards; }
  circle.far { fill: none; stroke: ${PAPER}; stroke-width: 4; opacity: 0; animation: ${fade} 0.5s ease 4.1s forwards; }
  .far-label { opacity: 0; animation: ${fade} 0.5s ease 4.2s forwards; }
`;

// ---- Scene 5: the first MEDial beside the one three days later ----------------

const Versions = styled.div`
  margin-top: 26px;
  max-width: 1160px;
`;

/** One row of the comparison, its own grid, so the label, the first MEDial's
 *  rule and the later one sit on one baseline whatever their font sizes. The
 *  heading row sits on its rule lines instead. */
const VRow = styled.div<{ $head?: boolean }>`
  display: grid;
  grid-template-columns: minmax(120px, 0.7fr) minmax(0, 1fr) minmax(0, 1fr);
  gap: 0 26px;
  align-items: ${(p) => (p.$head ? 'end' : 'baseline')};
  padding: ${(p) => (p.$head ? '0' : '14px 0')};
  border-bottom: ${(p) => (p.$head ? 'none' : '1px solid rgba(246, 241, 232, 0.18)')};
`;

const VersionHead = styled.div<{ $on: boolean; $after?: boolean }>`
  padding-bottom: 10px;
  border-bottom: 2px solid ${(p) => (p.$after ? ACCENT : 'rgba(246, 241, 232, 0.4)')};
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 0.6s ease ${p.$after ? 1.3 : 0.9}s forwards;`}
  > b { display: block; font-size: clamp(17px, 1.7vw, 26px); font-weight: 800; color: ${(p) => (p.$after ? ACCENT : PAPER)}; }
  > small { font-size: clamp(11px, 1vw, 14px); color: rgba(246, 241, 232, 0.65); }
`;

const Cell = styled.div<{ $on: boolean; $delay: number }>`
  font-size: clamp(14px, 1.35vw, 20px);
  line-height: 1.45;
  word-break: keep-all;
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 0.6s ease ${p.$delay}s forwards;`}
  &.label { font-size: clamp(12px, 1.1vw, 16px); font-weight: 800; color: rgba(246, 241, 232, 0.75); }
  &.label > small { display: block; margin-top: 6px; font-weight: 600; color: ${ACCENT}; }
  &.before { color: rgba(246, 241, 232, 0.6); }
  &.after { font-weight: 700; }
  &.fact { font-size: clamp(15px, 1.45vw, 22px); font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
`;

/** A day's outcome in three numbers, the three-day table's own (ChoiceScreen). */
function factLine(day: GenerationDetail): string {
  const f = dayFacts(day);
  if (!f) return '—';
  return [f.resolveMinutes != null ? `확인까지 ${f.resolveMinutes}분` : null, `이장 부탁 ${f.headAsks}번`, `거절 ${f.refusals}번`]
    .filter(Boolean).join(' · ');
}

interface Props {
  /** The exhibition record: its fixed first setting, and the walks under it. */
  detail: SessionDetail;
  onFinish: () => void;
}

export default function IntroScreen({ detail, onFinish }: Props) {
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

  const opening = openingOf(detail);
  const walk = opening ? farthestPath(detail, opening.id) : [];
  const shifts = ruleShifts(walk);
  const last = walk[walk.length - 1] ?? null;

  return (
    <Stage aria-label="MEDial 소개">
      <Brand>MEDial</Brand>
      <Disclaimer>그림과 대화는 모두 시뮬레이션입니다 · 이름은 가명입니다</Disclaimer>

      <Scene $on={on(0)}>
        <Ground />
        <Caption $top>
          <Eyebrow $on={on(0)}>서비스 디자이너를 위한 도구</Eyebrow>
          <Line $on={on(0)} $delay={0.2} $size="small">현장에 다시 가기 전, 디자이너는 이 마을에서 MEDial을 고쳐 봅니다.</Line>
        </Caption>
        <DiagramArea>{on(0) && <DesignerDiagram />}</DiagramArea>
      </Scene>

      <Scene $on={on(1)}>
        <Ground />
        {on(1) && <PlaceFilm />}
        <Caption>
          <Timed $on={on(1)} $at={0.3} $until={4.8}>
            <Eyebrow $on={on(1)}>실제로 있는 마을</Eyebrow>
            <Line $on={on(1)} $delay={0.4}>대전에서 남쪽 끝, 바다 건너 남해로.</Line>
          </Timed>
        </Caption>
        <Caption>
          <Timed $on={on(1)} $at={8.4}>
            <Eyebrow $on={on(1)}>경상남도 남해군 삼동면</Eyebrow>
            <Line $on={on(1)} $delay={8.5}>남해읍에서 남동쪽, 바닷가의 은점마을입니다.</Line>
          </Timed>
        </Caption>
      </Scene>

      <Scene $on={on(2)}>
        <Picture $src={src('INTRO.village')} $on={on(2)} />
        <Houses $on={on(2)}>
          {WINDOWS.map(([x, y], i) => (
            <i key={i} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${0.3 + i * 0.15}s` }} />
          ))}
        </Houses>
        <Caption>
          <Eyebrow $on={on(2)}>실제 인터뷰에서</Eyebrow>
          <Line $on={on(2)}>열두 명 모두를 직접 만나 인터뷰했습니다.</Line>
          <Chain $on={on(2)} $delay={1.5}>
            <span className="real">실제 주민 12명 인터뷰</span><i>→</i>
            <span>익명 페르소나 12</span><i>→</i>
            <span>주민 에이전트 12</span>
          </Chain>
          <Sub $on={on(2)} $delay={2.5}>
            일과와 관계, 누구에게 기대는지는 인터뷰에 적힌 만큼만 따릅니다. 화면 속 이름은 가명입니다.
          </Sub>
        </Caption>
      </Scene>

      <Scene $on={on(3)}>
        <Picture $src={src('INTRO.road')} $on={on(3)} />
        <Route viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice" aria-hidden>
          {on(3) && (
            <>
              <path className="reach" pathLength="1000"
                d="M 1330 1020 C 1160 900 980 780 800 660 C 740 620 705 585 735 545 C 760 515 700 480 650 440 C 700 425 780 440 850 425 C 910 412 950 395 990 385 C 1040 372 1080 345 1130 318" />
              <circle cx="1330" cy="1020" r="12" />
              <circle className="far" cx="1215" cy="296" r="30" />
              <g className="far-label">
                <PillText x={1135} y={256} size={32} weight={800} fill={PAPER} plate="rgba(21, 21, 15, 0.82)" text="병원" />
              </g>
            </>
          )}
        </Route>
        <Caption>
          <Eyebrow $on={on(3)}>의료는 멀다</Eyebrow>
          <Line $on={on(3)}>병원은 멀고, 도움은 이웃을 거쳐 옵니다.</Line>
          <Sub $on={on(3)}>누가 누구에게 얼마나 기대는지는 마을 안에서만 보입니다.</Sub>
        </Caption>
      </Scene>

      <Scene $on={on(4)}>
        <Picture $src={src('HALL')} $on={on(4)} $dim />
        <Caption $top>
          <Eyebrow $on={on(4)}>처음 MEDial과 사흘 뒤 MEDial</Eyebrow>
          <Line $on={on(4)} $delay={0.3} $size="small">하루가 끝날 때마다 고른 요청 하나가 다음 날의 규칙이 됩니다.</Line>
          {opening && last && (
            <Versions>
              <VRow $head>
                <div />
                <VersionHead $on={on(4)}><b>처음 MEDial</b><small>{dayName(opening)} 규칙</small></VersionHead>
                <VersionHead $on={on(4)} $after><b>사흘 뒤 MEDial</b><small>{dayName(last)} 규칙 · 요청 {shifts.length > 0 ? walk.length - 1 : 0}번 뒤</small></VersionHead>
              </VRow>
              {shifts.map((shift, i) => (
                <VRow key={shift.ruleType}>
                  <Cell className="label" $on={on(4)} $delay={2 + i * 1.6}>
                    {shift.label}<small>{shift.day} 뒤 · {shift.request}</small>
                  </Cell>
                  <Cell className="before" $on={on(4)} $delay={2 + i * 1.6}>{shift.before}</Cell>
                  <Cell className="after" $on={on(4)} $delay={2.5 + i * 1.6}>{shift.after}</Cell>
                </VRow>
              ))}
              <VRow>
                <Cell className="label" $on={on(4)} $delay={2 + shifts.length * 1.6}>그날의 마을</Cell>
                <Cell className="fact" $on={on(4)} $delay={2 + shifts.length * 1.6}>{factLine(opening)}</Cell>
                <Cell className="fact" $on={on(4)} $delay={2.5 + shifts.length * 1.6} style={{ color: ACCENT }}>{factLine(last)}</Cell>
              </VRow>
            </Versions>
          )}
          <Sub $on={on(4)} $delay={3.2 + shifts.length * 1.6}>
            기록된 {opening ? pathCount(detail, opening.id) : 0}가지 길 가운데 결과가 가장 달라진 하나입니다. 어느 요청을 고를지는 여러분이 정합니다.
          </Sub>
        </Caption>
      </Scene>

      <Scene $on={on(5)}>
        <Picture $src={src('INTRO.return')} $on={on(5)} />
        <Caption>
          <Eyebrow $on={on(5)}>사람을 대신하지 않습니다</Eyebrow>
          <Line $on={on(5)}>이 평가는 현장에 다시 가서 물을 질문을 만듭니다.</Line>
          <Chain $on={on(5)} $delay={1.3}>
            <span>하루를 겪는다</span><i>→</i>
            <span>주민이 평가한다</span><i>→</i>
            <span>요청 하나를 고른다</span><i>→</i>
            <span className="out">실제 주민에게 확인한다</span>
          </Chain>
          <Sub $on={on(5)} $delay={2.5}>지금부터 1일차를 시작합니다.</Sub>
        </Caption>
      </Scene>

      <Progress $ms={INTRO_TOTAL_MS} />
    </Stage>
  );
}
