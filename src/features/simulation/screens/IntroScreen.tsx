import { useEffect, useRef, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { api } from '../api/client';
import type { GenerationDetail } from '../api/iteration';
import { font } from '../ui/theme';

// The exhibition's opening: a film, not a screen. Nobody touches it.
//
// Six scenes run on one clock and end by opening day one (onFinish), so a
// visitor learns who this is for, what it is for, what it is not, and which
// rules MEDial starts with before the first day plays. Nothing here is a
// control. The first setting is fixed (selectors/tree openingOf), so there is
// no choice to make until the end of day one.
//
// Pictures are the exhibition's own (scripts/art.mjs INTRO.* -> local-data/art/)
// and are invented illustrations. A missing picture is a plain dark ground, not
// an error: the sentences carry the meaning, the paintings carry the mood.

const INK = '#15150f';
const PAPER = '#f6f1e8';
const ACCENT = '#e2542c';

/** Scene lengths in ms. They add up to the film. */
const SCENE_MS = [9000, 10000, 11000, 12000, 14000, 10000];
export const INTRO_TOTAL_MS = SCENE_MS.reduce((a, b) => a + b, 0);

const fade = keyframes`from { opacity: 0 } to { opacity: 1 }`;
const rise = keyframes`from { opacity: 0; transform: translateY(14px) } to { opacity: 1; transform: none }`;
const drift = keyframes`from { transform: scale(1.04) translate3d(0, 0, 0) } to { transform: scale(1.14) translate3d(-1.5%, -1%, 0) }`;
const lamp = keyframes`from { opacity: 0 } to { opacity: 1 }`;

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
  transition: visibility 0s linear ${(p) => (p.$on ? '0s' : '1.4s')};
  > * { transition: opacity 1.4s ease; }
  > :not(:first-child) { opacity: ${(p) => (p.$on ? 1 : 0)}; transition-duration: ${(p) => (p.$on ? '0.6s' : '0.35s')}; }
  > :first-child { opacity: ${(p) => (p.$on ? 1 : 0)}; }
`;

const Picture = styled.div<{ $src: string | null; $on: boolean; $focus?: string; $origin?: string }>`
  position: absolute;
  inset: 0 -3% -3% -3%;
  transform-origin: ${(p) => p.$origin ?? 'center'};
  background: ${INK} ${(p) => (p.$src ? `url(${p.$src})` : 'none')} ${(p) => p.$focus ?? 'center'} / cover no-repeat;
  ${(p) => p.$on && css`animation: ${drift} 16s ease-out forwards;`}
  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background:
      linear-gradient(180deg, rgba(21, 21, 15, 0.1) 0%, rgba(21, 21, 15, 0) 38%, rgba(21, 21, 15, 0.55) 66%, rgba(21, 21, 15, 0.82) 100%),
      radial-gradient(ellipse at 50% 40%, transparent 55%, rgba(21, 21, 15, 0.55) 100%);
  }
`;

const Caption = styled.div`
  position: absolute;
  left: clamp(32px, 7vw, 120px);
  right: clamp(32px, 7vw, 120px);
  bottom: clamp(56px, 11vh, 120px);
  max-width: 1040px;
`;

const Eyebrow = styled.div<{ $on: boolean }>`
  font-size: clamp(12px, 1.1vw, 16px);
  font-weight: 800;
  letter-spacing: 0.14em;
  color: ${ACCENT};
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 1s ease 0.5s forwards;`}
`;

const Line = styled.h1<{ $on: boolean; $delay?: number }>`
  margin: 14px 0 0;
  font-size: clamp(28px, 3.6vw, 58px);
  line-height: 1.24;
  font-weight: 800;
  letter-spacing: -0.035em;
  word-break: keep-all;
  text-wrap: balance;
  text-shadow: 0 2px 28px rgba(0, 0, 0, 0.5);
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 1.1s ease ${p.$delay ?? 0.9}s forwards;`}
`;

const Sub = styled.p<{ $on: boolean; $delay?: number }>`
  margin: 18px 0 0;
  max-width: 760px;
  font-size: clamp(15px, 1.4vw, 21px);
  line-height: 1.6;
  word-break: keep-all;
  color: rgba(246, 241, 232, 0.86);
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 1.1s ease ${p.$delay ?? 2.4}s forwards;`}
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
`;

const Brand = styled.div`
  position: absolute;
  top: 20px;
  left: clamp(24px, 4vw, 56px);
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: ${PAPER};
`;

// ---- Scene 2: a dotted line that runs out before it reaches the town ----

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
    stroke-dasharray: 1 16;
    clip-path: inset(0 0 0 0);
    animation: ${keyframes`from { stroke-dashoffset: 0; opacity: 0 } 8% { opacity: 1 } to { stroke-dashoffset: -520; opacity: 1 }`} 6s linear 1.4s forwards;
  }
  circle { fill: ${ACCENT}; opacity: 0; animation: ${fade} 0.8s ease 1.2s forwards; }
  circle.far { fill: none; stroke: ${PAPER}; stroke-width: 4; opacity: 0; animation: ${fade} 0.8s ease 7.4s forwards; }
  text { fill: ${PAPER}; font-size: 34px; font-weight: 800; opacity: 0; animation: ${fade} 0.8s ease 7.6s forwards; paint-order: stroke; stroke: rgba(21,21,15,0.7); stroke-width: 6px; }
`;

// ---- Scene 5: the first version's rules, one line each ----

const Rules = styled.ol`
  list-style: none;
  margin: 28px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 28px;
  max-width: 1040px;
  @media (max-width: 900px) { grid-template-columns: 1fr; }
`;

const RuleRow = styled.li<{ $on: boolean; $i: number }>`
  padding: 14px 0 0;
  border-top: 1px solid rgba(246, 241, 232, 0.28);
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 0.9s ease ${1.6 + p.$i * 1.5}s forwards;`}
  > small {
    display: block;
    font-size: clamp(11px, 1vw, 14px);
    font-weight: 800;
    letter-spacing: 0.1em;
    color: ${ACCENT};
  }
  > p {
    margin: 6px 0 0;
    font-size: clamp(15px, 1.6vw, 24px);
    line-height: 1.45;
    font-weight: 600;
  }
`;

const Chain = styled.div<{ $on: boolean }>`
  margin-top: 30px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  font-size: clamp(14px, 1.4vw, 21px);
  font-weight: 700;
  opacity: 0;
  ${(p) => p.$on && css`animation: ${rise} 1s ease 2.6s forwards;`}
  > span { padding: 7px 16px; border: 1px solid rgba(246, 241, 232, 0.5); border-radius: 999px; }
  > i { font-style: normal; color: ${ACCENT}; }
  > span.out { border-style: dashed; color: rgba(246, 241, 232, 0.8); }
`;

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

/** Twelve windows, lit one by one over the first scene: the village's twelve. */
const WINDOWS: [number, number][] = [
  [27, 56], [31, 60], [35, 52], [41, 58], [47, 55], [52, 62],
  [58, 57], [63, 64], [69, 60], [74, 66], [38, 66], [56, 70],
];

interface Props {
  /** Fixed first setting; its rule sentences are the four lines of scene 5. */
  opening: GenerationDetail | null;
  onFinish: () => void;
}

/** The first setting's rules, said as four answers a designer would ask. */
export function openingLines(opening: GenerationDetail | null): { head: string; text: string }[] {
  const said = new Map((opening?.ruleCatalog ?? []).map((r) => [r.ruleType, r.currentRule ?? '']));
  const pick = (type: string) => said.get(type) || '';
  return [
    { head: '누구에게 먼저', text: pick('contact_order') },
    { head: '얼마나 기다리나', text: pick('retry_before_help') },
    { head: '무엇을 알리나', text: pick('disclosure_scope') },
    { head: '언제 기관에 넘기나', text: pick('institution_deadline') },
  ].filter((l) => l.text);
}

export default function IntroScreen({ opening, onFinish }: Props) {
  const [at, setAt] = useState(0);
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
    if (at >= SCENE_MS.length) { finish.current(); return; }
    const timer = window.setTimeout(() => setAt((n) => n + 1), SCENE_MS[at]);
    return () => window.clearTimeout(timer);
  }, [at]);

  const src = (name: string) => (pictures.has(name) ? api.artUrl(name) : null);
  const on = (i: number) => at === i;
  const rules = openingLines(opening);

  return (
    <Stage aria-label="MEDial 소개">
      <Brand>MEDial</Brand>
      <Disclaimer>그림과 대화는 모두 시뮬레이션입니다 · 이름은 가명입니다</Disclaimer>

      <Scene $on={on(0)}>
        <Picture $src={src('INTRO.village')} $on={on(0)} />
        <Houses $on={on(0)}>
          {WINDOWS.map(([x, y], i) => (
            <i key={i} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${1.2 + i * 0.5}s` }} />
          ))}
        </Houses>
        <Caption>
          <Eyebrow $on={on(0)}>은점마을 · 12명</Eyebrow>
          <Line $on={on(0)}>열두 명이 사는 마을이 있습니다.</Line>
          <Sub $on={on(0)}>서로의 일과를 알고, 서로를 거쳐 도움을 받는 마을입니다.</Sub>
        </Caption>
      </Scene>

      <Scene $on={on(1)}>
        <Picture $src={src('INTRO.road')} $on={on(1)} />
        <Route viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <path className="reach" pathLength="1000"
            d="M 1330 1020 C 1160 900 980 780 800 660 C 740 620 705 585 735 545 C 760 515 700 480 650 440 C 700 425 780 440 850 425 C 910 412 950 395 990 385 C 1040 372 1080 345 1130 318" />
          <circle cx="1330" cy="1020" r="12" />
          <circle className="far" cx="1215" cy="296" r="30" />
          <text x="1135" y="256">병원</text>
        </Route>
        <Caption>
          <Eyebrow $on={on(1)}>의료는 멀다</Eyebrow>
          <Line $on={on(1)}>병원은 멀고, 도움은 이웃을 거쳐 옵니다.</Line>
          <Sub $on={on(1)}>누가 누구에게 얼마나 기대는지는 마을 안에서만 보입니다.</Sub>
        </Caption>
      </Scene>

      <Scene $on={on(2)}>
        <Picture $src={src('INTRO.desk')} $on={on(2)} $focus="50% 0%" $origin="50% 0%" />
        <Caption>
          <Eyebrow $on={on(2)}>서비스 디자이너를 위한 도구</Eyebrow>
          <Line $on={on(2)}>긴 인터뷰를 여러 번 하기 어려운 곳에서, 서비스를 어떻게 고쳐야 할까요?</Line>
          <Sub $on={on(2)} $delay={3}>현장에는 몇 번밖에 갈 수 없습니다. 그 사이를 이 도구가 채웁니다.</Sub>
        </Caption>
      </Scene>

      <Scene $on={on(3)}>
        <Picture $src={src('HOME')} $on={on(3)} />
        <Caption>
          <Eyebrow $on={on(3)}>무엇을 하나</Eyebrow>
          <Line $on={on(3)}>인터뷰에서 태어난 주민이 마을에서 서비스를 겪고, 직접 평가합니다.</Line>
          <Sub $on={on(3)} $delay={3.2}>
            평가에는 점수가 없습니다. 본인이 겪은 일과 인터뷰 근거가 붙은 말이고, 근거가 없으면 모른다고 적습니다.
          </Sub>
        </Caption>
      </Scene>

      <Scene $on={on(4)}>
        <Picture $src={src('HALL')} $on={on(4)} />
        <Caption>
          <Eyebrow $on={on(4)}>첫 번째 MEDial</Eyebrow>
          <Line $on={on(4)} $delay={0.7}>처음 켜는 MEDial은 이렇게 움직입니다.</Line>
          <Rules>
            {rules.map((rule, i) => (
              <RuleRow key={rule.head} $on={on(4)} $i={i}>
                <small>{rule.head}</small>
                <p>{rule.text}</p>
              </RuleRow>
            ))}
          </Rules>
        </Caption>
      </Scene>

      <Scene $on={on(5)}>
        <Picture $src={src('INTRO.return')} $on={on(5)} />
        <Caption>
          <Eyebrow $on={on(5)}>사람을 대신하지 않습니다</Eyebrow>
          <Line $on={on(5)}>이 평가는 현장에 다시 가서 물을 질문을 만듭니다.</Line>
          <Chain $on={on(5)}>
            <span>하루를 겪는다</span><i>→</i>
            <span>주민이 평가한다</span><i>→</i>
            <span>규칙 하나를 고친다</span><i>→</i>
            <span className="out">실제 주민에게 확인한다</span>
          </Chain>
          <Sub $on={on(5)} $delay={4.2}>지금부터 1일차를 시작합니다.</Sub>
        </Caption>
      </Scene>

      <Progress $ms={INTRO_TOTAL_MS} />
    </Stage>
  );
}
