import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { api } from '../api/client';
import type { VoiceClip } from '../api/types';
import { EUNJEOM, KAIST, KOREA, NAMHAE, NAMHAE_TOWN, NEAR } from '../intro/koreaMap';
import { narrationOf, playNarration } from '../scene/voice';
import Logo from '../ui/Logo';
import PillText from '../ui/PillText';
import { accentA, deepA, font, inkA, land, night, radius } from '../ui/theme';

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
const PAPER = night.ink;
const ACCENT = night.accent;

/**
 * The big captions, which the narrator reads (fixtures/exhibition/narration.json, spoken once ahead of time).
 * The sub-lines and the chips are not read. A test keeps these and the fixture the same.
 */
export const INTRO_SAY = [
  '시골의 낮, 병원은 읍내에 있고 주민들은 밭과 바다에 계시죠.',
  '어르신들은 병원에 가야 할 일이 잦지만, 병원은 멀어서 웬만하면 참으십니다.',
  '문제는, 어르신을 살펴 줄 사람이 마을에 없다는 겁니다. 그 일은 이장님 한 분께 이미 몰려 있습니다.',
  '이런 고충을 해결하고자, 서비스 디자이너가 어르신의 안부를 살피고 이웃과 병원을 이어 줄 조율자 AI의 초안을 제안하며, 이를 도입하고자 합니다.',
  '도입에 앞서 주민 대상 실증 연구로 이 초안을 고쳐야 하지만, 마을이 멀어 자주 찾아가기도, 오래 묻기도 어렵습니다.',
  '그래서 가기 어려운 한 시골마을을 시뮬레이션, Dially로 대신 만들었습니다. 실제 인터뷰를 바탕으로, 열두 분 모두를 스스로 판단하고 움직이는 AI 에이전트로 세웠습니다. Dially를 통해 직접 가지 못해도 어르신들의 고충을 미리 확인할 수 있게 되어, 서비스 디자이너가 도입 전 도구로 쓰게 됩니다.',
  '이제 관객 여러분이, 초안을 들고 온 서비스 디자이너가 되어 봅니다. 주민 에이전트의 평가를 읽고 AI 조율자를 개선합니다.',
] as const;

/** Scenes 4 and 5 are said in one go but shown a sentence at a time (INTRO_SAY joined). */
const SAY_FOUR = ['그래서 가기 어려운 한 시골마을을 시뮬레이션, Dially로 대신 만들었습니다.', '실제 인터뷰를 바탕으로, 열두 분 모두를 스스로 판단하고 움직이는 AI 에이전트로 세웠습니다.', 'Dially를 통해 직접 가지 못해도 어르신들의 고충을 미리 확인할 수 있게 되어,', '서비스 디자이너가 도입 전 도구로 쓰게 됩니다.'] as const;
/** Scene 2's second caption is one sentence of the narration shown in two pieces. */
const SAY_MEDIAL = [
  '이런 고충을 해결하고자, 서비스 디자이너가 어르신의 안부를 살피고 이웃과 병원을 이어 줄',
  '조율자 AI의 초안을 제안하며, 이를 도입하고자 합니다.',
] as const;
const SAY_FIVE = [
  '이제 관객 여러분이, 초안을 들고 온\n서비스 디자이너가 되어 봅니다.',
  '주민 에이전트의 평가를 읽고 AI 조율자를 개선합니다.',
] as const;

/** Scene lengths in ms with no voice: they are the least a scene runs. */
const BASE_MS = [5500, 5500, 12000, 9000, 19000, 11000];

/** A caption is spoken from just after it appears; the next one appears when the narrator is done. */
const LEAD_S = 0.5;
/** The diagram of scene 4 is drawn within this many seconds of its second sentence (the last arrow ends it), and the arrow then stays. */
const DIAGRAM_S = 2.6;
const ARROW_HOLD_S = 3;
const GAP_S = 0.7;
const TAIL_S = 1.4;

interface Layout {
  /** Each scene's length, ms. */
  ms: number[];
  total: number;
  /** Scene 2 has two captions: the first is gone at `until`, the second arrives at `next`. */
  two: { until: number; next: number };
  /** Scenes 4 and 5 show their narration a sentence at a time: the second each sentence's caption arrives. */
  said: { three: number[]; four: number[]; five: number[] };
  /** The narration of each scene: the clip and the second it starts. */
  cues: { file: string; at: number }[][];
}

/**
 * The film is paced by its narrator: a scene lasts as long as the voice reading it, and a second caption waits for
 * the first to be said. With no recordings the clip lengths are 0 and this is the film at its base lengths.
 */
export function layoutOf(voices: Record<string, VoiceClip> | null | undefined): Layout {
  const clip = (i: number) => narrationOf(voices, INTRO_SAY[i]);
  const sec = (i: number) => clip(i)?.seconds ?? 0;
  const cue = (i: number, at: number) => { const c = clip(i); return c ? [{ file: c.file, at }] : []; };
  const end = (at: number, i: number) => at + sec(i) + TAIL_S;

  /** Where each sentence of a clip begins, by its share of the characters (the clip is one recording). */
  const starts = (i: number, sentences: readonly string[]) => {
    const all = sentences.reduce((n, t) => n + t.length, 0);
    const span = sec(i) || 9;
    let used = 0;
    return sentences.map((t) => { const at = LEAD_S + (span * used) / all; used += t.length; return at; });
  };
  const four = starts(5, SAY_FOUR);
  const until = Math.max(5.2, LEAD_S + sec(2) + 0.4);
  const next = until + GAP_S;
  const medial = starts(3, SAY_MEDIAL).map((at) => next + 0.3 + (at - LEAD_S)); // the clip starts 0.3 s after the caption
  const ms = [
    Math.max(BASE_MS[0], end(LEAD_S, 0) * 1000),
    Math.max(BASE_MS[1], end(LEAD_S, 1) * 1000),
    Math.max(BASE_MS[2], end(next + 0.3, 3) * 1000),
    Math.max(BASE_MS[3], end(LEAD_S, 4) * 1000),
    // The diagram's last arrow is drawn at the end of its timeline and then stays a while before the scene is left.
    Math.max(BASE_MS[4], end(LEAD_S, 5) * 1000, (four[1] + DIAGRAM_S + ARROW_HOLD_S) * 1000),
    Math.max(BASE_MS[5], end(LEAD_S, 6) * 1000),
  ];
  return {
    ms,
    total: ms.reduce((x, y) => x + y, 0),
    two: { until, next },
    said: { three: medial, four, five: starts(6, SAY_FIVE) },
    cues: [cue(0, LEAD_S), cue(1, LEAD_S), [...cue(2, LEAD_S), ...cue(3, next + 0.3)], cue(4, LEAD_S), cue(5, LEAD_S), cue(6, LEAD_S)],
  };
}

const fade = keyframes`from { opacity: 0 } to { opacity: 1 }`;
const rise = keyframes`from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none }`;
const drift = keyframes`from { transform: scale(1.04) translate3d(0, 0, 0) } to { transform: scale(1.14) translate3d(-1.5%, -1%, 0) }`;
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
  /* A picture that is leaving stays whole until the arriving one has faded in over it (then visibility takes the scene away),
     so two scenes cross-fade instead of both dipping to the dark ground in between. */
  > :first-child { opacity: ${(p) => (p.$on ? 1 : 0)}; transition: opacity ${(p) => (p.$on ? '0.5s ease' : '0s linear 0.5s')}; }
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
      ? deepA(0.8)
      : `linear-gradient(180deg, ${deepA(0.1)} 0%, ${deepA(0)} 38%, ${deepA(0.55)} 66%, ${deepA(0.82)} 100%)`)};
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
  background: linear-gradient(0deg, ${deepA(0.94)} 0%, ${deepA(0.8)} 22%, ${deepA(0)} 44%);
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
  background: ${deepA(0.62)};
  font-size: clamp(12px, 1.1vw, 56px);
  font-weight: 800;
  letter-spacing: 0.14em;
  color: ${ACCENT};
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 0.5s ease 0.1s forwards;`}
`;

const Line = styled.h1<{ $on: boolean; $delay?: number }>`
  margin: 16px 0 0;
  /* One size for every caption: the longest (the two-line ones of scenes 3 and 4) is what it is picked by. */
  font-size: clamp(24px, 3.1vw, 160px);
  line-height: 1.24;
  font-weight: 800;
  letter-spacing: -0.035em;
  word-break: keep-all;
  text-wrap: balance;
  /* A 
 in the text is a line break the writer chose, where balance alone would leave a sentence's last word on the next line. */
  white-space: pre-line;
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

/** The film's top right: what the pictures are. */
const Corner = styled.div`
  position: absolute;
  top: clamp(24px, 1.6vw, 64px);
  right: clamp(24px, 4vw, 120px);
  z-index: 2;
  display: flex;
  align-items: center;
  gap: clamp(12px, 1vw, 40px);
`;

const Disclaimer = styled.div`
  padding: 0.4em 1em;
  border-radius: ${radius.pill};
  background: ${deepA(0.55)};
  font-size: clamp(12px, 0.85vw, 44px);
  letter-spacing: 0.02em;
  color: ${inkA(0.82)};
`;

const Brand = styled.div`
  position: absolute;
  top: clamp(20px, 1.5vw, 60px);
  left: clamp(24px, 4vw, 120px);
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

/** How much faster the map film runs than it was first drawn (13 s). */
const MAP_K = 0.72;

const Camera = styled.g`
  transform-origin: 0 0;
  animation: ${keyframes`
    0%, 40% { transform: var(--wide); }
    57%, 100% { transform: var(--close); }
  `} ${13 * MAP_K}s cubic-bezier(0.6, 0, 0.3, 1) forwards;
`;

/** Straight-line kilometres between two points of the outline. */
const km = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const PLATE = deepA(0.86);

function PlaceFilm() {
  /** Every time of the map film, scaled together (the narration ends well before the film did). */
  const t = (sec: number) => at(sec * MAP_K);
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
    <Drawn ref={ref} style={{ inset: 0, width: '100%', height: '100%', transitionDuration: '0.5s' }} aria-hidden>
      {wide && close && (
        <Camera style={{ '--wide': wide.transform, '--close': close.transform } as React.CSSProperties}>
          {/* The provinces are simplified for a glance; up close they would draw a
              coast that is not there, so they leave as the camera arrives. */}
          <path className="gone" style={t(6.2)} d={KOREA} fill={land.far} stroke={inkA(0.35)} strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
          {/* The close-up's coast fades in as the camera arrives; at a glance it is
              the same land the provinces already draw. */}
          <g className="in" style={t(5.6)}>
            <path d={NEAR} fill={land.far} stroke={inkA(0.3)} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
            <path d={NAMHAE} fill={land.near} stroke={inkA(0.7)} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
          </g>

          {/* The wide frame: where the study comes from, and the line south.
              Lines run under the points they join and end at their centres. */}
          <g className="gone" style={t(4.8)}>
            <path className="draw" d={`M ${kx} ${ky} C ${kx + 70} ${ky + 50} ${nx - 40} ${ny - 90} ${nx} ${ny}`}
              pathLength={1} fill="none" stroke={ACCENT} strokeWidth={w(5)} strokeLinecap="round"
              style={{ ...t(1.1), animationDuration: `${2.2 * MAP_K}s` }} />
            <g className="in" style={t(0.5)}>
              <circle className="ring" cx={kx} cy={ky} r={w(9)} fill="none" stroke={PAPER} strokeWidth={w(2)} />
              <circle cx={kx} cy={ky} r={w(8)} fill={PAPER} />
            </g>
            <g className="in" style={t(3.3)}>
              {/* An end of the line: accent, ringed, so it reads as a point and not the line's tip. */}
              <circle cx={nx} cy={ny} r={w(9)} fill={ACCENT} stroke={PAPER} strokeWidth={w(2.5)} />
            </g>
          </g>

          {/* The close frame: from the county town south-east to the village. */}
          <path className="draw" d={`M ${nx} ${ny} Q ${(nx + ex) / 2 + 1} ${ny - 1} ${ex} ${ey}`}
            pathLength={1} fill="none" stroke={ACCENT} strokeWidth={c(5)} strokeLinecap="round"
            style={{ ...t(7.8), animationDuration: `${MAP_K}s` }} />
          <g className="in" style={t(7.5)}>
            <circle cx={nx} cy={ny} r={c(8)} fill={PAPER} />
          </g>
          <g className="in" style={t(8.6)}>
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
            <g className="gone" style={t(4.8)}>
              <g className="in" style={t(0.5)}>
                <PillText x={kX - clear(9, 24)} y={kY + 8 * u} anchor="end" size={24 * u} weight={800} fill={PAPER} plate={PLATE} text="KAIST · 대전" />
              </g>
              <g className="in" style={t(3.3)}>
                <PillText x={nX + clear(11, 24)} y={nY + 8 * u} size={24 * u} weight={800} fill={PAPER} plate={PLATE} text="남해" />
                <PillText x={(kX + nX) / 2 + 46 * u} y={(kY + nY) / 2} size={18 * u} weight={700} fill={inkA(0.85)}
                  plate={PLATE} text={`직선 약 ${Math.round(km(KAIST, EUNJEOM) / 10) * 10}km`} />
              </g>
            </g>
            <g className="in" style={t(7.6)}>
              <PillText x={tX - clear(9, 20)} y={tY + 7 * u} anchor="end" size={20 * u} weight={800} fill={PAPER} plate={PLATE} text="남해읍" />
            </g>
            <g className="in" style={t(8.6)}>
              {/* The name centred on the marker; the place under it, plates aligned on their left edges. */}
              <PillText x={eX + clear(14, 30)} y={eY + 10 * u} size={30 * u} weight={800} fill={night.white} plate={ACCENT} text="은점마을" />
              <PillText x={eX + clear(14, 30) - 30 * 0.82 * u + 16 * 0.82 * u} y={eY + 55 * u} size={16 * u} weight={700} fill={PAPER}
                plate={PLATE} text="남해군 삼동면 · 바닷가" />
            </g>
          </>
        );
      })()}
    </Drawn>
  );
}

// ---- Scene 4: the Dially, as the people around it ---------------------

/**
 * Drawn while the narrator says the Dially was built (scene 4), in the order of the work it stands for:
 * the designer conceives the AI orchestrator, the simulated village is built to apply it to, the real interviews raise its twelve
 * residents (from `after`, when that sentence begins), and last the residents' evaluation travels back to the
 * designer. Every arrow is drawn after the thing it leaves and before the thing it reaches.
 */
function Diagram({ after }: { after: number }) {
  const label = (x: number, y: number, size: number, fill: string, text: string, weight = 800) => (
    <text x={x} y={y} fontSize={size} fontWeight={weight} fill={fill} textAnchor="middle">{text}</text>
  );
  /** A line that draws itself, its head appearing only when it arrives (a marker would show before the line is drawn). */
  const arrow = (d: string, delay: number, color: string, head: [number, number, number], dur = 0.7) => (
    <>
      <path className="draw" d={d} pathLength={1} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round"
        style={{ ...at(delay), animationDuration: `${dur}s` }} />
      <path className="in" d="M 0 0 L -22 -12 L -22 12 z" fill={color} transform={`translate(${head[0]} ${head[1]}) rotate(${head[2]})`}
        style={at(delay + dur * 0.85)} />
    </>
  );
  return (
    <Drawn viewBox="0 0 1200 540" aria-hidden style={{ left: '7vw', top: '8vh', width: '66vw', height: 'auto' }}>

      {/* 1. The designer conceives the AI orchestrator. */}
      <g className="in" style={at(0.4)}>
        <rect x={10} y={185} width={210} height={120} rx={30} fill={PAPER} />
        {label(115, 240, 28, INK, '서비스 디자이너', 800)}
        {label(115, 278, 21, land.near, '관객 여러분', 700)}
      </g>
      {arrow('M 228 245 L 292 245', 1.1, PAPER, [296, 245, 0], 0.5)}
      <g className="in" style={at(1.3)}>{label(260, 222, 20, PAPER, '초안', 700)}</g>
      <g className="in" style={at(1.6)}>
        <rect x={300} y={185} width={210} height={120} rx={30} fill={accentA(0.22)} stroke={ACCENT} strokeWidth={3} />
        {label(405, 240, 34, PAPER, 'AI 조율자', 800)}
        {label(405, 278, 21, inkA(0.8), '안부 확인 · 초안', 700)}
      </g>

      {/* 2. The village it will be applied to is built. */}
      {arrow('M 518 245 L 632 245', 2.3, PAPER, [636, 245, 0], 0.6)}
      <g className="in" style={at(2.6)}>{label(575, 222, 20, PAPER, '시험', 700)}</g>
      <g className="in" style={at(2.9)}>
        <rect x={640} y={10} width={550} height={390} rx={36} fill={deepA(0.62)} stroke={inkA(0.55)}
          strokeWidth={2} strokeDasharray="10 10" />
        {label(915, 64, 32, PAPER, '시뮬레이션 마을', 800)}
        {label(915, 98, 20, ACCENT, 'Dially · 주민 AI 에이전트 12', 700)}
      </g>

      {/* 3. The interviews it stands on, and the residents raised from them. */}
      <g className="in" style={at(after + 0.1)}>
        <rect x={700} y={450} width={430} height={66} rx={33} fill="none" stroke={ACCENT} strokeWidth={2.5} />
        {label(915, 492, 24, PAPER, '실제 인터뷰 12 · 근거', 700)}
      </g>
      {arrow('M 915 444 L 915 416', after + 0.4, ACCENT, [915, 412, -90], 0.25)}
      {Array.from({ length: 12 }, (_, i) => (
        <g key={i} className="in" style={at(after + 0.7 + i * 0.06)}>
          <circle cx={705 + (i % 6) * 84} cy={160 + Math.floor(i / 6) * 76} r={30} fill={inkA(0.14)}
            stroke={PAPER} strokeWidth={2} />
          {label(705 + (i % 6) * 84, 169 + Math.floor(i / 6) * 76, 22, PAPER, String(i + 1), 700)}
        </g>
      ))}
      {['119 구급대원', '보건소'].map((who, i) => (
        <g key={who} className="in" style={at(after + 1.5 + i * 0.15)}>
          <rect x={680 + i * 240} y={300} width={220} height={60} rx={30} fill={inkA(0.12)}
            stroke={inkA(0.5)} strokeWidth={1.5} />
          {label(790 + i * 240, 340, 26, PAPER, who, 700)}
        </g>
      ))}

      {/* 4. The residents' evaluation travels back to the designer. */}
      {arrow('M 640 340 C 520 500, 249 513, 124 326', after + 1.9, ACCENT, [115, 313, -124], 0.7)}
      <g className="in" style={at(after + 2.4)}>{label(380, 518, 22, PAPER, '주민 에이전트가 AI를 평가', 700)}</g>
    </Drawn>
  );
}

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
    stroke: ${night.white};
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
  /** The recordings of the narrator's lines, by 'NARRATOR|text'. Absent: the film runs silent at its base lengths. */
  voices?: Record<string, VoiceClip> | null;
}

export default function IntroScreen({ onFinish, voices = null }: Props) {
  const layout = useMemo(() => layoutOf(voices), [voices]);
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
    if (scene >= layout.ms.length) { finish.current(); return; }
    const timer = window.setTimeout(() => setScene((n) => n + 1), layout.ms[scene]);
    return () => window.clearTimeout(timer);
  }, [scene, layout]);

  // The narrator: each caption is read as it comes up, and everything stops when the scene or the film does.
  useEffect(() => {
    const stops: (() => void)[] = [];
    const timers = (layout.cues[scene] ?? []).map((cue) => window.setTimeout(() => stops.push(playNarration(cue.file)), cue.at * 1000));
    return () => { timers.forEach(window.clearTimeout); stops.forEach((stop) => stop()); };
  }, [scene, layout]);

  const src = (name: string) => (pictures.has(name) ? api.artUrl(name) : null);
  const on = (i: number) => scene === i;

  return (
    <Stage aria-label="소개">
      <Brand><Logo height="clamp(36px, 3.2vw, 128px)" /></Brand>
      <Corner>
        <Disclaimer>그림과 대화는 모두 시뮬레이션입니다 · 이름은 가명입니다</Disclaimer>
      </Corner>

      <Scene $on={on(0)}>
        <Picture $src={src('FARM')} $on={scene >= 0} />
        <Caption>
          <Eyebrow $on={on(0)}>시골의 풍경</Eyebrow>
          <Line $on={on(0)}>{'시골의 낮, 병원은 읍내에 있고\n주민들은 밭과 바다에 계시죠.'}</Line>
        </Caption>
      </Scene>

      <Scene $on={on(1)}>
        <Picture $src={src('INTRO.road')} $on={scene >= 1} />
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
                  <PillText x={-54} y={-57} anchor="end" size={30} weight={800} fill={PAPER} plate={deepA(0.82)} text="남해읍 병원" />
                </g>
              </g>
            </>
          )}
        </Route>
        <Caption>
          <Eyebrow $on={on(1)}>의료는 멀다</Eyebrow>
          <Line $on={on(1)}>어르신들은 병원에 가야 할 일이 잦지만, 병원은 멀어서 웬만하면 참으십니다.</Line>
        </Caption>
      </Scene>

      <Scene $on={on(2)}>
        <Picture $src={src('HOME')} $on={scene >= 2} />
        <Caption>
          <Timed $on={on(2)} $at={0.2} $until={layout.two.until}>
            <Eyebrow $on={on(2)}>살펴 줄 사람이 없다</Eyebrow>
            <Line $on={on(2)} $delay={0.3}>{'문제는, 어르신을 살펴 줄 사람이 마을에 없다는 겁니다.\n그 일은 이장님 한 분께 이미 몰려 있습니다.'}</Line>
          </Timed>
        </Caption>
        {SAY_MEDIAL.map((text, k) => (
          <Caption key={k}>
            <Timed $on={on(2)} $at={(k === 0 ? layout.two.next : layout.said.three[1]) - 0.1} $until={k === 0 ? layout.said.three[1] - 0.2 : undefined}>
              <Eyebrow $on={on(2)}>AI CARE ORCHESTRATOR</Eyebrow>
              <Line $on={on(2)} $delay={k === 0 ? layout.two.next : layout.said.three[1]}>{text}</Line>
              {k === 1 && (
                <Chain $on={on(2)} $delay={layout.said.three[1] + 0.6}>
                  <span>안부 확인</span><i>→</i>
                  <span>이웃 연결</span><i>→</i>
                  <span>병원 동행</span>
                </Chain>
              )}
            </Timed>
          </Caption>
        ))}
      </Scene>

      <Scene $on={on(3)}>
        <Ground />
        {/* Stays mounted through the next scene's arrival so the map fades out under the village picture instead of vanishing at once. */}
        {(scene === 3 || scene === 4) && <PlaceFilm />}
        <Fog />
        <Caption>
          <Eyebrow $on={on(3)}>서비스 디자이너의 고충</Eyebrow>
          <Line $on={on(3)}>도입에 앞서 주민 대상 실증 연구로 이 초안을 고쳐야 하지만, 마을이 멀어 자주 찾아가기도, 오래 묻기도 어렵습니다.</Line>
        </Caption>
      </Scene>

      <Scene $on={on(4)}>
        <Picture $src={src('INTRO.village')} $on={scene >= 4} $dim />
        {on(4) && <Diagram after={layout.said.four[1]} />}
        {SAY_FOUR.map((text, k) => (
          <Caption key={k}>
            <Timed $on={on(4)} $at={k === 0 ? 0.2 : layout.said.four[k] - 0.1} $until={layout.said.four[k + 1] === undefined ? undefined : layout.said.four[k + 1] - 0.2}>
              <Eyebrow $on={on(4)}>Dially</Eyebrow>
              <Line $on={on(4)} $delay={k === 0 ? 0.3 : layout.said.four[k]}>{text}</Line>
            </Timed>
          </Caption>
        ))}
      </Scene>

      <Scene $on={on(5)}>
        <Picture $src={src('INTRO.desk')} $on={scene >= 5} />
        {SAY_FIVE.map((text, k) => {
          const at = layout.said.five[k];
          const next = layout.said.five[k + 1];
          return (
            <Caption key={k}>
              <Timed $on={on(5)} $at={k === 0 ? 0.2 : at - 0.1} $until={next === undefined ? undefined : next - 0.2}>
                <Eyebrow $on={on(5)}>서비스 디자이너가 되어 보기</Eyebrow>
                <Line $on={on(5)} $delay={k === 0 ? 0.3 : at}>{text}</Line>
                {k === 1 && (
                  <Chain $on={on(5)} $delay={at + 0.9}>
                    <span>사건을 본다</span><i>→</i>
                    <span>주민 에이전트가 AI를 평가한다</span><i>→</i>
                    <span>요청 하나로 고친다</span><i>→</i>
                    <span>바뀐 모습을 본다</span>
                  </Chain>
                )}
              </Timed>
            </Caption>
          );
        })}
      </Scene>

      <Progress $ms={layout.total} />
    </Stage>
  );
}
