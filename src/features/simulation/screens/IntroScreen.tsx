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
// Nine scenes run on one clock and end by opening day one (onFinish). The order
// is the one the researcher set (2026-10-20): what a service designer does (the
// job, as a journey map on a desk), why it is hard in a small community (a draft
// has to be asked of the few who will use it, who are far and busy, and mending
// it cannot be checked), Desimer (interviews of a small group, one agent each,
// the service run among them first - not standing in for the people), and then
// one case: rural care (the hospital is in town, by day everyone is in the field
// or at sea), the road, the AI Care Orchestrator's draft, why this village cannot
// be visited, so its twelve are raised from real interviews, and the visitor is
// the service designer who runs, mends and reruns the service among them.
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
 * Three clips open the film (the service designer's job and trouble, then Desimer), then the case: the road, the
 * missing carer and the AI's draft, why this village cannot be visited, the twelve built from interviews, and the
 * visitor's part.
 */
export const INTRO_SAY = [
  '서비스 디자이너라는 직업을 아시나요? 서비스 디자이너는 사람들이 서비스를 만나고 쓰고 마치는 전 과정의 경험을 설계하고, 쓸 사람들의 이야기를 들어 초안을 여러 번 돌려 보고 다듬어 가는 사람입니다.',
  '초안만 봐서는 서비스가 좋은지 알 수 없고, 써 볼 사람들에게 물어야 알 수 있습니다. 특히 작은 공동체는 사람이 적어, 한 분 한 분의 반응이 성패를 가르기도 합니다. 그런데 그런 곳은 현장이 멀고 바빠서, 자주 찾아가 묻기가 어렵습니다. 그러면 고칠 때마다 나아졌는지 확인하기도 어렵습니다.',
  '그래서 Designer를 위한 Simulator, Desimer를 만들었습니다. 실제 사람들을 인터뷰하고, 그 이야기로 구성원 한 분 한 분을 스스로 판단하고 움직이는 AI 에이전트로 세우고, 그 안에서 서비스를 미리 돌려 보는 시뮬레이션 도구입니다. 실제 사람을 대신하는 것이 아니라, 현장에 가기 전에 초안을 미리 살펴보게 돕습니다. 이번에는 한 사례, 시골마을에 들일 의료 AI 조율자를 다뤄 봅니다.',
  '어르신들은 병원에 가야 할 일이 잦지만, 병원은 멀어서 웬만하면 참으십니다.',
  '문제는, 어르신을 살펴 줄 사람이 마을에 없다는 겁니다. 그 일은 이장님 한 분께 이미 몰려 있습니다.',
  '그래서 서비스 디자이너가 어르신의 안부를 살피고 이웃과 병원을 이어 줄 조율자 AI의 초안을 제안합니다.',
  '이 마을도 멀어서, 초안을 들고 자주 찾아가 물을 수는 없습니다.',
  '그래서 이 마을 열두 분의 실제 인터뷰를 바탕으로, 한 분 한 분을 AI 에이전트로 세웠습니다. 서비스 디자이너는 도입 전에 이 열두 분으로 초안을 여러 번 돌려 보고 고칠 수 있습니다.',
  '이제 관객 여러분이, 초안을 들고 온 서비스 디자이너가 되어 봅니다. 주민 에이전트의 평가를 읽고, 초안을 고쳐 다시 돌려 보며 AI 조율자를 개선합니다.',
] as const;

/** A clip of several sentences is shown a sentence at a time, each from where the voice reaches it (INTRO_SAY joined). */
const SAY_JOB = ['서비스 디자이너라는 직업을 아시나요?', '서비스 디자이너는 사람들이 서비스를 만나고 쓰고 마치는 전 과정의 경험을 설계하고,', '쓸 사람들의 이야기를 들어 초안을 여러 번 돌려 보고 다듬어 가는 사람입니다.'] as const;
const SAY_TROUBLE = ['초안만 봐서는 서비스가 좋은지 알 수 없고, 써 볼 사람들에게 물어야 알 수 있습니다.', '특히 작은 공동체는 사람이 적어, 한 분 한 분의 반응이 성패를 가르기도 합니다.', '그런데 그런 곳은 현장이 멀고 바빠서, 자주 찾아가 묻기가 어렵습니다.', '그러면 고칠 때마다 나아졌는지 확인하기도 어렵습니다.'] as const;
const SAY_TOOL = ['그래서 Designer를 위한 Simulator, Desimer를 만들었습니다.', '실제 사람들을 인터뷰하고, 그 이야기로 구성원 한 분 한 분을 스스로 판단하고 움직이는 AI 에이전트로 세우고,', '그 안에서 서비스를 미리 돌려 보는 시뮬레이션 도구입니다.', '실제 사람을 대신하는 것이 아니라, 현장에 가기 전에 초안을 미리 살펴보게 돕습니다.', '이번에는 한 사례, 시골마을에 들일 의료 AI 조율자를 다뤄 봅니다.'] as const;
/** The twelve are built from interviews: shown in three pieces (the diagram's interviews and residents follow the first). */
const SAY_BUILT = ['그래서 이 마을 열두 분의 실제 인터뷰를 바탕으로, 한 분 한 분을 AI 에이전트로 세웠습니다.', '서비스 디자이너는 도입 전에 이 열두 분으로 초안을 여러 번 돌려 보고 고칠 수 있습니다.'] as const;
/** The AI's draft is one sentence of the narration shown in two pieces. */
const SAY_MEDIAL = [
  '그래서 서비스 디자이너가 어르신의 안부를 살피고 이웃과 병원을 이어 줄',
  '조율자 AI의 초안을 제안합니다.',
] as const;
const SAY_FIVE = [
  '이제 관객 여러분이, 초안을 들고 온\n서비스 디자이너가 되어 봅니다.',
  '주민 에이전트의 평가를 읽고, 초안을 고쳐 다시 돌려 보며 AI 조율자를 개선합니다.',
] as const;

/** Scene lengths in ms with no voice: they are the least a scene runs. */
const BASE_MS = [9000, 15000, 17000, 5500, 12000, 6000, 12500, 8000];

/** A caption is spoken from just after it appears; the next one appears when the narrator is done. */
const LEAD_S = 0.5;
/** The camera pulling back onto the model takes this long; the second scene's first sentence waits for it. */
const PULL_S = 0.8;
/** A scene the camera dives out of keeps this long after its last word, for the dive. */
const DIVE_S = 0.8;
const GAP_S = 0.7;
const TAIL_S = 1.0;

interface Layout {
  /** Each scene's length, ms. */
  ms: number[];
  total: number;
  /** The AI scene has two captions: the first is gone at `until`, the second arrives at `next`. */
  two: { until: number; next: number };
  /** Scenes that show their narration a sentence at a time: the second each sentence's caption arrives. */
  said: { job: number[]; trouble: number[]; tool: number[]; medial: number[]; built: number[]; five: number[] };
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
  const trouble = starts(1, SAY_TROUBLE).map((x) => x + PULL_S);
  const built = starts(7, SAY_BUILT);
  const until = Math.max(5.2, LEAD_S + sec(4) + 0.4);
  const next = until + GAP_S;
  const medial = starts(5, SAY_MEDIAL).map((at) => next + 0.3 + (at - LEAD_S)); // the clip starts 0.3 s after the caption
  const ms = [
    Math.max(BASE_MS[0], (end(LEAD_S, 0) + DIVE_S) * 1000),
    Math.max(BASE_MS[1], end(LEAD_S + PULL_S, 1) * 1000),
    Math.max(BASE_MS[2], (end(LEAD_S, 2) + DIVE_S) * 1000),
    Math.max(BASE_MS[3], end(LEAD_S, 3) * 1000),
    Math.max(BASE_MS[4], end(next + 0.3, 5) * 1000),
    Math.max(BASE_MS[5], end(LEAD_S, 6) * 1000),
    Math.max(BASE_MS[6], end(LEAD_S, 7) * 1000),
    Math.max(BASE_MS[7], end(LEAD_S, 8) * 1000),
  ];
  return {
    ms,
    total: ms.reduce((x, y) => x + y, 0),
    two: { until, next },
    said: { job: starts(0, SAY_JOB), trouble, tool: starts(2, SAY_TOOL), medial, built, five: starts(8, SAY_FIVE) },
    cues: [cue(0, LEAD_S), cue(1, LEAD_S + PULL_S), cue(2, LEAD_S), cue(3, LEAD_S), [...cue(4, LEAD_S), ...cue(5, next + 0.3)], cue(6, LEAD_S), cue(7, LEAD_S), cue(8, LEAD_S)],
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
  /* Narrower than the screen: the recorded film lays the tablet over the lower right, and a long line ran under it. */
  max-width: 68vw;
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
  [880, 790], [740, 705], [640, 650], [602, 612], [650, 578], [708, 548],
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

// ---- One desk: the opening's pictures change by cross-fading (Scene), with no camera move between them ----------

/** Holds a picture and what is drawn on it, so they stay together. */
const Dolly = styled.div`
  position: absolute;
  inset: 0;
`;

/** A second picture laid over the first, which fades in at `$at` seconds (the board turns from a community into the village). */
const Dissolve = styled.div<{ $on: boolean; $at: number }>`
  position: absolute;
  inset: 0;
  opacity: 0;
  ${(p) => p.$on && css`animation: ${fade} 1.8s ease ${p.$at}s forwards;`}
`;

/** Dust in the lamp light, and a soft dark edge: what makes the stills read as a room, not a slide. */
const floatUp = keyframes`
  0% { transform: translate3d(0, 4vh, 0); opacity: 0; }
  15% { opacity: var(--a, 0.5); }
  85% { opacity: var(--a, 0.5); }
  100% { transform: translate3d(var(--dx, 2vw), -16vh, 0); opacity: 0; }
`;
const Motes = styled.div`
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  overflow: hidden;
  mix-blend-mode: screen;
  > i {
    position: absolute;
    border-radius: 50%;
    background: ${inkA(0.9)};
    width: var(--s, 4px);
    height: var(--s, 4px);
    left: var(--x);
    top: var(--y);
    opacity: 0;
    animation: ${floatUp} var(--d, 18s) ease-in-out var(--l, 0s) infinite;
  }
`;
const Vignette = styled.div`
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: radial-gradient(ellipse at 50% 46%, ${deepA(0)} 52%, ${deepA(0.5)} 100%);
`;
const MOTES = Array.from({ length: 26 }, (_, i) => ({
  x: `${(i * 37) % 100}%`, y: `${(i * 53) % 100}%`, s: `${3 + (i % 4) * 1.5}px`, d: `${14 + (i % 7) * 2.5}s`,
  l: `${-(i % 9) * 2}s`, a: 0.25 + (i % 5) * 0.1, dx: `${(i % 2 ? 1 : -1) * (1 + (i % 3))}vw`,
}));
function Atmosphere() {
  return (
    <>
      <Vignette />
      <Motes aria-hidden>
        {MOTES.map((m, i) => <i key={i} style={{ '--x': m.x, '--y': m.y, '--s': m.s, '--d': m.d, '--l': m.l, '--a': m.a, '--dx': m.dx } as React.CSSProperties} />)}
      </Motes>
    </>
  );
}

// ---- What is drawn on the pictures: in each picture's own 1536x1024 box -----------

const ripple = keyframes`0% { transform: scale(0.9); opacity: 0.85; } 100% { transform: scale(1.7); opacity: 0; }`;
const bob = keyframes`0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); }`;
const stick = keyframes`from { transform: translateY(-16px) scale(1.14); opacity: 0; } 60% { opacity: 1; } to { transform: none; opacity: 1; }`;
const lift = keyframes`from { transform: translateY(16px); opacity: 0; } to { transform: none; opacity: 1; }`;
const slide = keyframes`from { transform: translate(-72px, 32px) rotate(-5deg); opacity: 0; } to { transform: none; opacity: 1; }`;
const flutter = keyframes`0%, 100% { transform: scaleX(1) skewY(0deg); } 50% { transform: scaleX(0.94) skewY(3deg); }`;
const flicker = keyframes`0%, 100% { opacity: 0.92; } 40% { opacity: 0.7; } 60% { opacity: 1; }`;
const fold = keyframes`from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: scale(1); }`;

/** Over a picture, in the picture's own box and moved with it: what the scene says. */
const Over = styled(Route)`
  .in { opacity: 0; animation: ${fade} 0.6s ease forwards; }
  .out { animation: ${keyframes`to { opacity: 0 }`} 0.8s ease forwards; }
  .ring { fill: none; stroke: ${ACCENT}; stroke-width: 3; transform-box: fill-box; transform-origin: center; animation: ${ripple} 2.6s ease-out infinite; }
  .bob { animation: ${bob} 3.4s ease-in-out infinite; }
  .slide { animation: ${slide} 0.9s cubic-bezier(0.2, 0.8, 0.3, 1) both; }
  .lift { animation: ${lift} 0.7s cubic-bezier(0.2, 0.8, 0.3, 1) both; }
  .flutter { transform-box: fill-box; transform-origin: left center; animation: ${flutter} 3.4s ease-in-out infinite; }
  .flicker { animation: ${flicker} 3s ease-in-out infinite; }
  .stick { animation: ${stick} 0.55s cubic-bezier(0.2, 0.8, 0.3, 1) both; }
  .mark { transform-box: fill-box; transform-origin: center; animation: ${fold} 0.5s cubic-bezier(0.2, 0.8, 0.3, 1) both; }
  /* A line of light: a soft glow under a thin bright core, both drawn along the path, and a spark that runs ahead of them. */
  .trail-glow { fill: none; stroke: ${accentA(0.55)}; stroke-width: 14; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; filter: blur(8px); animation: ${draw} 2.4s ease-in-out forwards; }
  .trail-core { fill: none; stroke: ${inkA(0.8)}; stroke-width: 3; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; animation: ${draw} 2.4s ease-in-out forwards; }
  /* A pencil line: wobbled a little by the filter, drawn along its length. */
  .pencil { fill: none; stroke: ${PAPER}; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1; filter: url(#pencil); animation: ${draw} 0.9s ease forwards; }
  .thread { fill: none; stroke: ${inkA(0.34)}; stroke-width: 1.6; stroke-linecap: round; stroke-dasharray: 1; stroke-dashoffset: 1; animation: ${draw} 1.1s ease forwards; }
`;

const cardFall = keyframes`
  from { transform: translate(var(--fx, -60px), -460px) rotate(calc(var(--r, 0deg) - 26deg)); opacity: 0; }
  55% { opacity: 1; }
  to { transform: translate(0, 0) rotate(var(--r, 0deg)); opacity: 1; }
`;
const cardGone = keyframes`to { transform: translate(0, 8px) rotate(var(--r, 0deg)) scale(0.2); opacity: 0; }`;
const CardLayer = styled.g`
  .card { animation: ${cardFall} 1.1s cubic-bezier(0.2, 0.7, 0.3, 1) both, ${cardGone} 0.5s ease forwards; }
`;

/** What every overlay draws with: the soft shadow under paper, the pencil's wobble, the notes' paper, the lights. */
const SHARED = (
  <>
    <filter id="pencil" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="4" result="noise" />
      <feDisplacementMap in="SourceGraphic" in2="noise" scale="5" xChannelSelector="R" yChannelSelector="G" />
    </filter>
    <radialGradient id="orb">
      <stop offset="0" stopColor={night.noteLight} stopOpacity="0.7" />
      <stop offset="0.3" stopColor={night.warn} stopOpacity="0.4" />
      <stop offset="0.65" stopColor={ACCENT} stopOpacity="0.16" />
      <stop offset="1" stopColor={ACCENT} stopOpacity="0" />
    </radialGradient>
  </>
);

/**
 * The little things of the model: painted pictures of handmade miniatures with their words already painted on
 * (INTRO.prop.*, scripts/art.mjs), laid on the board in the lamp's light. A piece is placed by the point of it that
 * touches the board.
 */
const PROP_SIZE = 1024;
const ground = (x: number, y: number, rx: number) => (
  <ellipse cx={x} cy={y} rx={rx} ry={rx * 0.28} fill={INK} opacity={0.42} style={{ filter: 'blur(8px)' }} />
);

/** The picture of a piece at scale `k`, its point `(ax, ay)` on the board at `(x, y)`; `clip` keeps only a band of its height. */
function Prop({ name, ax, ay, x, y, k, clip }: { name: string; ax: number; ay: number; x: number; y: number; k: number; clip?: [number, number] }) {
  const id = `clip-${name}`;
  return (
    <g transform={`translate(${x - ax * k} ${y - ay * k}) scale(${k})`}>
      {clip && <clipPath id={id}><rect x={0} y={clip[0]} width={PROP_SIZE} height={clip[1] - clip[0]} /></clipPath>}
      <image href={api.artUrl(name)} width={PROP_SIZE} height={PROP_SIZE} clipPath={clip ? `url(#${id})` : undefined} style={{ filter: 'brightness(0.84) sepia(0.22) saturate(1.05) contrast(1.04)' }} />
    </g>
  );
}

/** A piece set down at second `s`: it settles from a little above, with its shadow under it. */
function Piece({ name, x, y, ax, ay, k, s, shadow, clip, motion = 'lift' }: {
  name: string; x: number; y: number; ax: number; ay: number; k: number; s: number; shadow: number; clip?: [number, number]; motion?: 'lift' | 'slide';
}) {
  return (
    <g className="in" style={at(s)}>
      <g className={motion} style={at(s)}>
        {ground(x, y, shadow)}
        <Prop name={name} ax={ax} ay={ay} x={x} y={y} k={k} clip={clip} />
      </g>
    </g>
  );
}

/** A placard on a stand (INTRO.prop.field / case / villagers): `(x, y)` is where its feet stand. */
const Plaque = ({ name, x, y, s }: { name: string; x: number; y: number; s: number }) => (
  <Piece name={name} x={x} y={y} ax={520} ay={830} k={0.36} s={s} shadow={120} />
);
/** A pennant on a pin (INTRO.prop.reaction): `(x, y)` is where the pin's point stands; the pin is shown short. */
const Flag = ({ name, x, y, s, k = 0.34 }: { name: string; x: number; y: number; s: number; k?: number }) => (
  <Piece name={name} x={x} y={y} ax={310} ay={560} k={k} s={s} shadow={24} clip={[70, 560]} />
);
/** The signpost of the road's end (INTRO.prop.far): the cross on its disc, the words on its board. */
const Signpost = ({ x, y, s }: { x: number; y: number; s: number }) => (
  <Piece name="INTRO.prop.far" x={x} y={y} ax={510} ay={700} k={0.27} s={s} shadow={22} clip={[40, 700]} />
);
/** A sticky note, a picture with its word handwritten on it (INTRO.prop.note.*): `(x, y)` is its middle, and it sticks on at second `s`. */
const Note3 = ({ name, x, y, s }: { name: string; x: number; y: number; s: number }) => (
  <Piece name={name} x={x} y={y} ax={512} ay={512} k={0.22} s={s} shadow={0} />
);
/** A version of the proposal, a sheet of paper (INTRO.prop.doc1 / doc2 / draft). */
const Sheet = ({ name, x, y, k = 0.26, s, motion }: { name: string; x: number; y: number; k?: number; s: number; motion?: 'lift' | 'slide' }) => (
  <Piece name={name} x={x} y={y} ax={520} ay={560} k={k} s={s} shadow={120} motion={motion} />
);

/** A line of light drawn along `d` from second `s`, a spark running ahead of it. */
function Trail({ d, s, dur = 2.4 }: { d: string; s: number; dur?: number }) {
  const style = { animationDelay: `${s}s`, animationDuration: `${dur}s` };
  return (
    <g>
      <path className="trail-glow" pathLength={1} d={d} style={style} />
      <path className="trail-core" pathLength={1} d={d} style={style} />
      <circle r={7} fill={night.noteLight} opacity={0}>
        <animate attributeName="opacity" values="0;0.85;0.85;0" keyTimes="0;0.04;0.92;1" dur={`${dur + 0.2}s`} begin={`${s}s`} fill="freeze" />
        <animateMotion dur={`${dur}s`} begin={`${s}s`} path={d} fill="freeze" calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines="0.45 0 0.25 1" />
      </circle>
    </g>
  );
}

/** An interview note that falls to where a person stands: a picture of a ruled card. */
function Note({ x, y, s, rot = 0 }: { x: number; y: number; s: number; rot?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="card" style={{ animationDelay: `${s}s, ${s + 1.3}s`, '--r': `${rot}deg`, '--fx': `${-30 - (rot * 6)}px` } as React.CSSProperties}>
        <Prop name="INTRO.prop.card" ax={520} ay={520} x={0} y={0} k={0.09} />
      </g>
    </g>
  );
}

/** A person as an agent: a light that hangs a little above them and drifts, joined to where they stand by a thread of it. */
function Agent({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g className="in" style={at(s)}>
      <ellipse cx={x} cy={y} rx={14} ry={5} fill="none" stroke={accentA(0.9)} strokeWidth={1.8} />
      <ellipse className="ring" cx={x} cy={y} rx={14} ry={5} style={at(s)} />
      <path d={`M ${x} ${y - 48} L ${x} ${y - 6}`} stroke={accentA(0.5)} strokeWidth={2} />
      <g className="bob" style={{ animationDelay: `${(x % 7) * 0.31}s` }}>
        <circle cx={x} cy={y - 56} r={42} fill="url(#orb)" />
        <circle cx={x} cy={y - 56} r={5} fill={night.noteLight} opacity={0.85} />
      </g>
    </g>
  );
}

/** Threads of light between each agent and its two nearest, each with a spark that runs along it. */
function Wires({ points, s, lift = 58 }: { points: readonly (readonly [number, number])[]; s: number; lift?: number }) {
  const pairs = new Set<string>();
  points.forEach((p, i) => {
    points.map((q, j) => [j, Math.hypot(p[0] - q[0], p[1] - q[1])] as const).filter(([j]) => j !== i)
      .sort((a, b) => a[1] - b[1]).slice(0, 2).forEach(([j]) => pairs.add(i < j ? `${i}-${j}` : `${j}-${i}`));
  });
  return (
    <>
      {[...pairs].map((key, n) => {
        const [i, j] = key.split('-').map(Number);
        const a = [points[i][0], points[i][1] - lift];
        const b = [points[j][0], points[j][1] - lift];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const bend = (n % 2 ? 1 : -1) * 0.16;
        const d = `M ${a[0]} ${a[1]} Q ${(a[0] + b[0]) / 2 - dy * bend} ${(a[1] + b[1]) / 2 + dx * bend} ${b[0]} ${b[1]}`;
        return (
          <g key={key}>
            <path className="thread" pathLength={1} d={d} style={at(s + n * 0.08)} />
            <circle r={3} fill={night.noteLight} opacity={0}>
              <animate attributeName="opacity" values="0;0.7;0.7;0" keyTimes="0;0.1;0.9;1" dur="3.4s" begin={`${s + 1 + n * 0.3}s`} repeatCount="indefinite" />
              <animateMotion dur="3.4s" begin={`${s + 1 + n * 0.3}s`} path={d} repeatCount="indefinite" />
            </circle>
          </g>
        );
      })}
    </>
  );
}

/** The twelve people of the model board (the community) and of the village's board, where they stand in each picture. */
const COMMUNITY: readonly (readonly [number, number])[] = [
  [871, 342], [846, 374], [795, 452], [874, 444], [902, 469], [1063, 477], [1035, 508], [999, 535], [1139, 488], [1157, 369], [1203, 429], [1018, 640],
];
/** The twelve houses of the village's model, where a window of each is (on the picture of INTRO.model.village). */
const HOUSES: readonly (readonly [number, number])[] = [
  [604, 269], [690, 211], [799, 194], [747, 291], [604, 349], [701, 366], [844, 360], [616, 446], [741, 446], [896, 434], [821, 589], [770, 514],
];
/** The road that leaves the community's board across the desk, as far as the point where it stops: the way to the people, which does not go through. */
const FAR_ROAD: [number, number][] = [[1172, 412], [1200, 465], [1235, 520], [1275, 560], [1320, 615], [1355, 660], [1385, 705], [1410, 750], [1450, 795]];

// ---- The job: a journey map on a desk, and the loop of mending it ----------------

/** Over INTRO.studio: the four boxes of the journey map (centres) and the loop that runs back from the last to the first. */
const JOURNEY: [number, number][] = [[491, 358], [667, 350], [844, 347], [1022, 343]];
const LOOP_PATH = 'M 1028 386 C 1000 472, 560 492, 503 402';
const JOURNEY_PATH = smooth(JOURNEY);

function JourneyMap({ on, job }: { on: boolean; job: number[] }) {
  const stops = ['meet', 'write', 'finish'];
  return (
    <Over $on={on} viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {on && (
        <>
          <defs>{SHARED}</defs>
          <Trail d={JOURNEY_PATH} s={job[1] + 0.8} dur={2.6} />
          {stops.map((word, i) => (
            <g key={word}>
              <g className="in" style={at(job[1] + 0.6 + i * 0.9)}>
                <ellipse className="ring" cx={JOURNEY[i][0]} cy={JOURNEY[i][1]} rx={70} ry={44} style={at(job[1] + 0.6 + i * 0.9)} />
              </g>
              <Note3 name={`INTRO.prop.note.${word}`} x={JOURNEY[i][0] - 6 + i * 4} y={JOURNEY[i][1] - 104 - i * 3} s={job[1] + 0.6 + i * 0.9} />
            </g>
          ))}
          <Trail d={LOOP_PATH} s={job[2] + 0.4} dur={2.8} />
          <Note3 name="INTRO.prop.note.fix" x={770} y={608} s={job[2] + 2.4} />
        </>
      )}
    </Over>
  );
}

// ---- Each sentence shows one thing: it comes in as the voice reaches it and leaves as the next begins ----

const fadeOut = keyframes`to { opacity: 0; }`;
/** What is shown between two seconds of a scene: it comes in at `from`, and is gone by `to` (open-ended: it stays). */
const PhaseG = styled.g<{ $from: number; $to?: number }>`
  opacity: 0;
  animation: ${fade} 0.5s ease ${(p) => p.$from}s forwards${(p) => (p.$to === undefined ? '' : css`, ${fadeOut} 0.6s ease ${p.$to}s forwards`)};
`;
function Phase({ from, to, children }: { from: number; to?: number; children: React.ReactNode }) {
  return <PhaseG $from={from} $to={to}>{children}</PhaseG>;
}

// ---- The trouble: a draft, the few who will use it, the road that does not go through ----

function Trouble({ on, t }: { on: boolean; t: number[] }) {
  const far = smooth(FAR_ROAD);
  const one = COMMUNITY[1];
  const end = (k: number) => (t[k + 1] === undefined ? undefined : t[k + 1] - 0.3);
  return (
    <Over $on={on} viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {on && (
        <>
          <defs>
            {SHARED}
            <radialGradient id="spot" cx={one[0]} cy={one[1]} r={430} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor={INK} stopOpacity="0" />
              <stop offset="0.45" stopColor={INK} stopOpacity="0.15" />
              <stop offset="1" stopColor={INK} stopOpacity="0.72" />
            </radialGradient>
          </defs>

          {/* 1. The draft is carried to the people who will use it: a sheet with a folded corner lands, and they are marked. */}
          <Phase from={t[0]} to={end(1)}>
            {COMMUNITY.map(([x, y], i) => (
              <g key={i} className="in" style={at(t[0] + 1.4 + i * 0.1)}>
                <ellipse cx={x} cy={y} rx={14} ry={5} fill="none" stroke={inkA(0.8)} strokeWidth={1.6} />
              </g>
            ))}
          </Phase>
          <Phase from={t[0]} to={t[0] + 4.2}>
            <CardLayer>
              <g transform="translate(880 440)">
                <g className="card" style={{ animationDelay: `${t[0] + 0.1}s, ${t[0] + 3.4}s`, '--r': '-4deg', '--fx': '-200px' } as React.CSSProperties}>
                  {ground(0, 50, 100)}
                  <Prop name="INTRO.prop.draft" ax={520} ay={560} x={0} y={0} k={0.28} />
                </g>
              </g>
            </CardLayer>
          </Phase>

          {/* 2. Few of them: one person is lit, the rest fall away, and a flag says whose. */}
          <Phase from={t[1]} to={end(2)}>
            <rect x={-100} y={-100} width={1740} height={1240} fill="url(#spot)" />
            <ellipse cx={one[0]} cy={one[1]} rx={16} ry={6} fill="none" stroke={accentA(0.95)} strokeWidth={2} />
            <ellipse className="ring" cx={one[0]} cy={one[1]} rx={16} ry={6} />
            <g className="bob">
              <circle cx={one[0]} cy={one[1] - 56} r={50} fill="url(#orb)" />
              <circle cx={one[0]} cy={one[1] - 56} r={6} fill={night.noteLight} opacity={0.9} />
            </g>
            <path d={`M ${one[0]} ${one[1] - 48} L ${one[0]} ${one[1] - 6}`} stroke={accentA(0.6)} strokeWidth={2} />
            <Flag name="INTRO.prop.reaction" x={one[0]} y={one[1] - 44} k={0.26} s={t[1] + 0.6} />
          </Phase>

          {/* 3. Far and busy: a light sets out along the road and stops at a sign. */}
          <Phase from={t[2]} to={end(3)}>
            <Trail d={far} s={t[2] + 0.2} dur={2.4} />
            <Signpost x={1172} y={414} s={t[2] + 0.2} />
          </Phase>

          {/* 4. Mended, run again, and nothing says whether it got better: the old version, the new, and a lit question. */}
          <Phase from={t[3]}>
            <Sheet name="INTRO.prop.doc1" x={318} y={430} k={0.19} s={t[3] + 0.2} />
            <Sheet name="INTRO.prop.doc2" x={300} y={505} k={0.19} s={t[3] + 1} motion="slide" />
            <g className="in" style={at(t[3] + 1.8)}>
              <g className="bob">
                <Prop name="INTRO.prop.question" ax={510} ay={905} x={432} y={412} k={0.14} />
              </g>
            </g>
          </Phase>
        </>
      )}
    </Over>
  );
}

// ---- The tool: interviews become agents, and the service is run among them ----------

/** `t`: where each of the five sentences begins (the name; the interviews; the service among them; not standing in; this case). */
function Making({ on, t }: { on: boolean; t: number[] }) {
  return (
    <Over $on={on} viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {on && (
        <>
          <defs>{SHARED}</defs>
          {/* 2. A note of the interview falls to each person, who is taken in as an agent. */}
          <Phase from={t[1]} to={t[4] - 0.2}>
            <CardLayer>
              {COMMUNITY.map(([x, y], i) => <Note key={i} x={x} y={y - 30} s={t[1] + 0.2 + i * 0.2} rot={(i % 5) * 4 - 8} />)}
            </CardLayer>
            {COMMUNITY.map(([x, y], i) => <Agent key={i} x={x} y={y} s={t[1] + 1 + i * 0.2} />)}
          </Phase>
          {/* 3. ... the threads of them, and the service set down among them. */}
          <Phase from={t[2]} to={t[4] - 0.2}>
            <Wires points={COMMUNITY} s={t[2] + 0.1} />
            <Sheet name="INTRO.prop.draft" x={940} y={500} k={0.2} s={t[2] + 1.2} />
          </Phase>
          {/* 4. Not standing in for anyone; 5. this time, one case. */}
          <Phase from={t[3]} to={t[4] - 0.2}>
            <Plaque name="INTRO.prop.field" x={340} y={540} s={t[3] + 0.2} />
          </Phase>
          <Phase from={t[4]}>
            <Plaque name="INTRO.prop.case" x={340} y={540} s={t[4] + 0.6} />
          </Phase>
        </>
      )}
    </Over>
  );
}

// ---- The case's twelve: raised from interviews, on the village's board -------------

/** `t`: where each of the three sentences begins (built from interviews; before going to the field; the designer's tool). */
function Built({ on, t }: { on: boolean; t: number[] }) {
  return (
    <Over $on={on} viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {on && (
        <>
          <defs>{SHARED}</defs>
          {/* An interview falls on each house, and the house is lit: the twelve were raised from twelve interviews. */}
          <Phase from={t[0]}>
            <CardLayer>
              {HOUSES.map(([x, y], i) => <Note key={i} x={x} y={y - 30} s={t[0] + 0.2 + i * 0.2} rot={(i % 5) * 4 - 8} />)}
            </CardLayer>
            {HOUSES.map(([x, y], i) => (
              <g key={i} className="in" style={at(t[0] + 1 + i * 0.2)}>
                <circle cx={x} cy={y} r={46} fill="url(#orb)" />
                <circle cx={x} cy={y} r={6} fill={night.noteLight} opacity={0.9} />
              </g>
            ))}
          </Phase>
          {/* The houses are joined: the village that the service will run in. */}
          <Phase from={t[1]}>
            <Wires points={HOUSES} s={t[1] + 0.1} lift={0} />
            <Plaque name="INTRO.prop.villagers" x={340} y={540} s={t[1] + 0.4} />
          </Phase>
        </>
      )}
    </Over>
  );
}

/** One caption of a scene that shows its sentences one at a time: arrives at `at`, gone when the next arrives. */
function Said({ on, at: from, next, first, eyebrow, children }: { on: boolean; at: number; next?: number; first: boolean; eyebrow: string; children: string }) {
  return (
    <Caption>
      <Timed $on={on} $at={first ? 0.2 : from - 0.1} $until={next === undefined ? undefined : next - 0.2}>
        <Eyebrow $on={on}>{eyebrow}</Eyebrow>
        <Line $on={on} $delay={first ? 0.3 : from}>{children}</Line>
      </Timed>
    </Caption>
  );
}

interface Props {
  onFinish: () => void;
  /** The recordings of the narrator's lines, by 'NARRATOR|text'. Absent: the film runs silent at its base lengths. */
  voices?: Record<string, VoiceClip> | null;
  /** The tablet skipped: the film goes to its last scene. */
  skipped?: boolean;
}

export default function IntroScreen({ onFinish, voices = null, skipped = false }: Props) {
  const layout = useMemo(() => layoutOf(voices), [voices]);
  const [scene, setScene] = useState(0);
  const [pictures, setPictures] = useState<Set<string>>(new Set());
  // Every picture and narration is already held when the film starts: "시작하기" is not taken before (assets.ts).

  useEffect(() => {
    let live = true;
    api.art().then((a) => { if (live) setPictures(new Set(a.names)); }).catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (skipped) setScene((n) => Math.max(n, layout.ms.length - 1));
  }, [skipped, layout]);

  // The parent re-renders while the film runs; the clock must not restart with it.
  const finish = useRef(onFinish);
  finish.current = onFinish;
  useEffect(() => {
    if (scene >= layout.ms.length) { finish.current(); return undefined; }
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
      <Atmosphere />
      <Brand><Logo height="clamp(36px, 3.2vw, 128px)" /></Brand>
      <Corner>
        <Disclaimer>그림과 대화는 모두 시뮬레이션입니다 · 이름은 가명입니다</Disclaimer>
      </Corner>

      {/* The job, its trouble, the tool: one camera over one desk. The journey map is dived into; the model on the desk is what
          arrives; the model turns into the village, and the village is dived into. Each shows its sentences one at a time. */}
      <Scene $on={on(0)}>
        <Dolly>
          <Picture $src={src('INTRO.studio')} $on />
          <JourneyMap on={on(0)} job={layout.said.job} />
        </Dolly>
        {SAY_JOB.map((text, k) => (
          <Said key={k} on={on(0)} at={layout.said.job[k]} next={layout.said.job[k + 1]} first={k === 0} eyebrow="서비스 디자이너라는 직업">{text}</Said>
        ))}
      </Scene>

      <Scene $on={on(1)}>
        <Dolly>
          <Picture $src={src('INTRO.model')} $on={scene >= 1} />
          <Trouble on={on(1)} t={layout.said.trouble} />
        </Dolly>
        {SAY_TROUBLE.map((text, k) => (
          <Said key={k} on={on(1)} at={layout.said.trouble[k]} next={layout.said.trouble[k + 1]} first={k === 0} eyebrow="서비스 디자이너의 고민">{text}</Said>
        ))}
      </Scene>

      <Scene $on={on(2)}>
        <Dolly>
          <Picture $src={src('INTRO.model')} $on={scene >= 2} />
          <Dissolve $on={scene >= 2} $at={layout.said.tool[4] - 0.2}>
            <Picture $src={src('INTRO.model.village')} $on={scene >= 2} />
          </Dissolve>
          <Making on={on(2)} t={layout.said.tool} />
        </Dolly>
        {SAY_TOOL.map((text, k) => (
          <Said key={k} on={on(2)} at={layout.said.tool[k]} next={layout.said.tool[k + 1]} first={k === 0} eyebrow="Desimer">{text}</Said>
        ))}
      </Scene>

      <Scene $on={on(3)}>
        <Picture $src={src('INTRO.road')} $on={scene >= 3} />
        <Route $on={on(3)} viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice" aria-hidden>
          {on(3) && (
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
          <Eyebrow $on={on(3)}>의료는 멀다</Eyebrow>
          <Line $on={on(3)}>어르신들은 병원에 가야 할 일이 잦지만, 병원은 멀어서 웬만하면 참으십니다.</Line>
        </Caption>
      </Scene>

      <Scene $on={on(4)}>
        <Picture $src={src('HOME')} $on={scene >= 4} />
        <Caption>
          <Timed $on={on(4)} $at={0.2} $until={layout.two.until}>
            <Eyebrow $on={on(4)}>살펴 줄 사람이 없다</Eyebrow>
            <Line $on={on(4)} $delay={0.3}>{'문제는, 어르신을 살펴 줄 사람이 마을에 없다는 겁니다.\n그 일은 이장님 한 분께 이미 몰려 있습니다.'}</Line>
          </Timed>
        </Caption>
        {SAY_MEDIAL.map((text, k) => (
          <Caption key={k}>
            <Timed $on={on(4)} $at={(k === 0 ? layout.two.next : layout.said.medial[1]) - 0.1} $until={k === 0 ? layout.said.medial[1] - 0.2 : undefined}>
              <Eyebrow $on={on(4)}>AI CARE ORCHESTRATOR</Eyebrow>
              <Line $on={on(4)} $delay={k === 0 ? layout.two.next : layout.said.medial[1]}>{text}</Line>
              {k === 1 && (
                <Chain $on={on(4)} $delay={layout.said.medial[1] + 0.6}>
                  <span>안부 확인</span><i>→</i>
                  <span>이웃 연결</span><i>→</i>
                  <span>병원 동행</span>
                </Chain>
              )}
            </Timed>
          </Caption>
        ))}
      </Scene>

      <Scene $on={on(5)}>
        <Ground />
        {/* Stays mounted through the next scene's arrival so the map fades out under the village picture instead of vanishing at once. */}
        {(scene === 5 || scene === 6) && <PlaceFilm />}
        <Fog />
        <Caption>
          <Eyebrow $on={on(5)}>이 사례의 어려움</Eyebrow>
          <Line $on={on(5)}>이 마을도 멀어서, 초안을 들고 자주 찾아가 물을 수는 없습니다.</Line>
        </Caption>
      </Scene>

      <Scene $on={on(6)}>
        <Dolly>
          <Picture $src={src('INTRO.model.village')} $on={scene >= 6} />
          <Built on={on(6)} t={layout.said.built} />
        </Dolly>
        {SAY_BUILT.map((text, k) => (
          <Caption key={k}>
            <Timed $on={on(6)} $at={k === 0 ? 0.2 : layout.said.built[k] - 0.1} $until={layout.said.built[k + 1] === undefined ? undefined : layout.said.built[k + 1] - 0.2}>
              <Eyebrow $on={on(6)}>Desimer</Eyebrow>
              <Line $on={on(6)} $delay={k === 0 ? 0.3 : layout.said.built[k]}>{text}</Line>
              {k === SAY_BUILT.length - 1 && (
                <Chain $on={on(6)} $delay={layout.said.built[k] + 0.6}>
                  <span>AI 조율자 초안</span><i>→</i>
                  <span>열두 분이 겪고</span><i>→</i>
                  <span>평가하고</span><i>→</i>
                  <span>초안을 고친다</span>
                </Chain>
              )}
            </Timed>
          </Caption>
        ))}
      </Scene>

      <Scene $on={on(7)}>
        <Picture $src={src('INTRO.desk')} $on={scene >= 7} />
        {SAY_FIVE.map((text, k) => {
          const at = layout.said.five[k];
          const next = layout.said.five[k + 1];
          return (
            <Caption key={k}>
              <Timed $on={on(7)} $at={k === 0 ? 0.2 : at - 0.1} $until={next === undefined ? undefined : next - 0.2}>
                <Eyebrow $on={on(7)}>서비스 디자이너가 되어 보기</Eyebrow>
                <Line $on={on(7)} $delay={k === 0 ? 0.3 : at}>{text}</Line>
                {k === 1 && (
                  <Chain $on={on(7)} $delay={at + 0.9}>
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
