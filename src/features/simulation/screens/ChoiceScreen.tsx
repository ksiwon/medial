import { useEffect, useMemo, useRef, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { api } from '../api/client';
import type { VoiceClip } from '../api/types';
import { narrationOf, playNarration } from '../scene/voice';
import type { GenerationDetail, SessionDetail } from '../api/iteration';
import { childFor, dayFacts, dayName, pathCount, pathTo } from '../selectors/tree';
import { nameList, personName, withParticle } from '../selectors/story';
import { accentA, inkA, night, px, radius, space } from '../ui/theme';
import { Inner, PageHead, Sheet } from '../ui/page';
import Portrait from '../ui/Portrait';
import { pill } from '../ui/primitives';

// Choosing the next version, in a record whose versions branch (selectors/tree).
//
// Two screens (2026-10-16): this is the wall. The cards are read here and chosen on the
// tablet, in one touch (stage/wall.ts), which opens the next day here.
//
// Two moments, as the exhibition wall had them: the revision after each day and
// the end of the third day. The first setting is not chosen - the opening film
// (IntroScreen) states it and day one starts. Every option
// on screen was run when the record was made, so choosing one opens a day that
// already happened - it starts nothing. A revision that was never run is shown
// and cannot be chosen.

/* The cards share their rows (subgrid): the kind, the request, its purpose, the
   reason, whose experience it came from, the rule and the way to take it start at
   one height across all three, however long any one card's title runs. */
const Cards = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(380px * var(--k, 1))), 1fr));
  column-gap: ${space.lg};
  row-gap: ${space.lg};
`;

const Take = styled.span`
  ${pill('lg')}
  align-self: end;
  justify-self: start;
  height: ${px(48)};
  padding: 0 ${space.lg};
  font-size: ${px(16)};
  font-weight: 800;
  color: ${night.ink};
  background: ${inkA(0.1)};
  transition: background 0.15s ease, color 0.15s ease;
  &::after { content: '→'; margin-left: ${px(8)}; }
`;

const Card = styled.article<{ $off?: boolean }>`
  position: relative;
  font: inherit;
  text-align: left;
  color: ${night.ink};
  background: ${night.panel};
  border: 1px solid ${night.line};
  border-radius: ${radius.card};
  padding: ${space.xl} ${space.xl} ${space.lg};
  display: grid;
  grid-row: span 7;
  grid-template-rows: subgrid;
  row-gap: ${space.md};
  align-content: start;
  word-break: keep-all;
  opacity: ${(p) => (p.$off ? 0.5 : 1)};

  > strong { font-size: ${px(28)}; font-weight: 800; letter-spacing: -0.03em; line-height: 1.3; }
  > p { margin: 0; font-size: ${px(16)}; line-height: 1.7; color: ${night.mute}; }
`;

/** Which of the choices this is, and what kind of rule it changes. */
const Kind = styled.div`
  display: flex;
  align-items: center;
  gap: ${space.md};
  > b {
    display: grid;
    place-items: center;
    width: ${px(36)};
    height: ${px(36)};
    border-radius: ${radius.round};
    background: ${night.accent};
    color: #fff;
    font-size: ${px(16)};
    font-weight: 800;
  }
  > small { font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.06em; color: ${night.mute}; }
`;

/** 무엇을 이루려는 요청인가. 제목이 부탁이면 이것은 그 부탁의 이유가 아니라 *목적*이다. */
const Goal = styled.p`
  margin: 0;
  /* As tall as the tallest purpose in the row (the cards share rows): the
     sentence sits in the middle of that height, not at its top. */
  display: flex;
  align-items: center;
  padding: ${space.md} ${space.lg};
  border-radius: ${radius.card};
  background: ${night.accentSoft};
  border: 1px solid ${accentA(0.4)};
  color: ${night.ink} !important;
  font-size: ${px(16)} !important;
  font-weight: 700;
  &::before { content: '목적'; margin-right: ${px(12)}; font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.08em; color: ${night.accent}; }
`;

/** 이 요청이 어느 주민이 겪은 일에서 나왔는가 - 평가가 수정에 쓰인다는 연구의 연결 고리. */
const From = styled.div`
  display: flex;
  align-items: center;
  gap: ${space.md};
  font-size: ${px(16)};
  font-weight: 700;
  color: ${night.mute};
  > b { color: ${night.ink}; }
  > span { display: flex; }
  > span > div + div { margin-left: calc(-12px * var(--k, 1)); }
`;

/** The rule, as it was and as it would be: what the next day is run under. */
const Rule = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  padding-top: ${px(16)};
  border-top: 1px solid ${night.line};
  font-size: ${px(16)};
  line-height: 1.6;
  > small { font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.1em; color: ${night.faint}; }
  > s { color: ${night.faint}; text-decoration-color: ${inkA(0.35)}; }
  > i { font-style: normal; color: ${night.accent}; font-weight: 800; line-height: 1; }
  > b { font-weight: 700; color: ${night.ink}; }
`;

/** The three days, one beside the next: the wall's closing page. */
const Days = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, calc(340px * var(--k, 1))), 1fr));
  gap: ${space.lg};
`;

const Day = styled.li`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
  padding: ${space.xl} ${space.xl};
  border-radius: ${radius.card};
  border: 1px solid ${night.line};
  background: ${night.panel};
  > small { font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.08em; color: ${night.accent}; }
  > strong { font-size: ${px(28)}; font-weight: 800; letter-spacing: -0.03em; line-height: 1.3; word-break: keep-all; }
  > p { margin: 0; font-size: ${px(16)}; line-height: 1.6; color: ${night.mute}; word-break: keep-all; }
`;

/** What the residents of that day said, in their words: the page's answer to "what happened". */
const Said = styled.blockquote`
  margin: 0;
  padding-top: ${space.lg};
  border-top: 1px solid ${night.line};
  font-size: ${px(16)};
  line-height: 1.7;
  color: ${night.ink};
  word-break: keep-all;
  > cite { display: block; margin-bottom: ${space.sm}; font-style: normal; font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.08em; color: ${night.faint}; }
`;

/** The rule the visitor put in force that day. */
const Rule2 = styled.div`
  font-size: ${px(16)};
  line-height: 1.6;
  color: ${night.mute};
  > b { display: block; margin-bottom: ${space.xs}; font-size: ${px(12)}; letter-spacing: 0.08em; color: ${night.accent}; }
`;

const rise = keyframes`from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none }`;

/** The end is the film's tone again: the desk painting under a dark veil, the three days on glass panels,
 *  then the closing words rising line by line, as the opening's captions do. */
const Film = styled.div<{ $src: string | null }>`
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  background: ${night.deep} ${(p) => (p.$src ? `url(${p.$src})` : 'none')} center / cover no-repeat;
  &::before { content: ''; position: absolute; inset: 0; background: rgba(21, 21, 15, 0.88); }
  > * { position: relative; }
`;

const Glass = styled.div`
  display: contents;
  ${Day} { background: rgba(21, 21, 15, 0.66); animation: ${rise} 0.8s ease both; }
  ${Day}:nth-child(2) { animation-delay: 0.6s; }
  ${Day}:nth-child(3) { animation-delay: 1.2s; }
`;

/** The last thing said, to the visitor as a designer: what the walk was for. */
const Close = styled.div`
  max-width: ${px(1080)};
  min-height: 60vh;
  justify-content: center;
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
  word-break: keep-all;
  > * { opacity: 0; animation: ${rise} 0.8s ease forwards; }
  > strong { font-size: ${px(48)}; font-weight: 800; letter-spacing: -0.035em; line-height: 1.25; color: ${night.ink}; }
  > p { margin: 0; font-size: ${px(24)}; line-height: 1.7; color: ${inkA(0.86)}; }
`;

/** The closing words, which the narrator reads (fixtures/exhibition/narration.json). A test keeps the two the same. */
export const CLOSE_SAY = [
  '서비스 디자이너의 일은 초안을 고쳐 나가는 일입니다.',
  '어떤 수정 요청을 고르느냐에 따라, 같은 마을의 같은 하루도 어르신께는 다른 하루가 됩니다.',
  '그런데 멀고 사람이 드문 마을에서는, 그 선택의 결과를 현장에서 오래 지켜볼 수 없습니다.',
  '그래서 Resident Simulator는, 갈 수 없는 현장을 대신해 초안을 미리 시험해 보는 도구입니다.',
  '멀고 어려운 현장 연구의 부담을 덜어, 서비스 디자이너가 더 나은 서비스를 마을에 들이도록 돕습니다.',
] as const;

/** When each closing line comes up (s): as before with no voice, else when the narrator is done with the one before. */
export function closingAt(voices: Record<string, VoiceClip> | null | undefined): number[] {
  const base = [0.4, 3.4, 8.4, 12.4, 16.4];
  const at = [base[0]];
  for (let i = 1; i < base.length; i += 1) {
    const clip = narrationOf(voices, CLOSE_SAY[i - 1]);
    at.push(Math.max(base[i], at[i - 1] + (clip ? clip.seconds + 0.7 : 0)));
  }
  return at;
}

const Idle = styled.span`
  margin-left: ${px(20)};
  font-size: ${px(16)};
  color: ${night.faint};
  font-variant-numeric: tabular-nums;
`;

interface Props {
  detail: SessionDetail;
  /** The version whose day was just read. */
  current: GenerationDetail;
  /** The closing words have taken the page (the tablet asked, or the days' wait ran out). */
  closing: boolean;
  onClosing: () => void;
  onRestart: () => void;
  /** Which pictures were drawn, for the faces on the cards. */
  art?: ReadonlySet<string>;
  /** The recordings, by 'speaker|text': the narrator's closing words are read from here. */
  voices?: Record<string, VoiceClip> | null;
}

const NO_ART: ReadonlySet<string> = new Set();

/**
 * How long the three days' summary stays when nobody touches it, in seconds. In a hall the
 * next visitor does not press "again" for the last one: the screen goes back to the opening
 * film by itself. Long enough to read a three-row table, short enough that a visitor who
 * walks up to a screen that has been left does not find the end of someone else's story.
 */
export const SUMMARY_IDLE_S = 90;

/** How long the three days stay on the page before the closing words take it, in seconds. */
export const RESULT_S = 15;

/** The end of the walk: the days taken, and the way back - by itself, if nobody takes it. */
function Ending({ detail, current, closing, onClosing, onRestart, art, voices }: {
  detail: SessionDetail; current: GenerationDetail; closing: boolean; onClosing: () => void; onRestart: () => void;
  art: ReadonlySet<string>; voices: Record<string, VoiceClip> | null;
}) {
  const closeAt = useMemo(() => closingAt(voices), [voices]);
  const [left, setLeft] = useState(SUMMARY_IDLE_S);
  // The three days stay up RESULT_S seconds, said out loud on the page, and then the closing words follow by
  // themselves. A press on the tablet that brings them sooner ends this wait early (`closing` turns true).
  const [until, setUntil] = useState(RESULT_S);
  const closeNow = useRef(onClosing);
  closeNow.current = onClosing;
  useEffect(() => {
    if (closing) return undefined;
    const tick = window.setInterval(() => setUntil((n) => n - 1), 1000);
    return () => window.clearInterval(tick);
  }, [closing]);
  useEffect(() => { if (!closing && until <= 0) closeNow.current(); }, [closing, until]);
  // The narrator reads the closing words as they come up; leaving the page stops it.
  useEffect(() => {
    if (!closing) return undefined;
    const stops: (() => void)[] = [];
    const timers = CLOSE_SAY.flatMap((text, i) => {
      const clip = narrationOf(voices, text);
      return clip ? [window.setTimeout(() => stops.push(playNarration(clip.file)), (closeAt[i] + 0.2) * 1000)] : [];
    });
    return () => { timers.forEach(window.clearTimeout); stops.forEach((stop) => stop()); };
  }, [closing, voices, closeAt]);
  useEffect(() => {
    const tick = window.setInterval(() => setLeft((n) => n - 1), 1000);
    return () => window.clearInterval(tick);
  }, []);
  // A press on the tablet (closing words, or any press the wall is handed) starts the wait over:
  // someone is still there.
  useEffect(() => { setLeft(SUMMARY_IDLE_S); }, [closing]);
  useEffect(() => { if (left <= 0) onRestart(); }, [left, onRestart]);
  return (
    <Film $src={art.has('INTRO.desk') ? api.artUrl('INTRO.desk') : null}>
    <Sheet style={{ background: 'transparent' }}>
      <Inner>
        {closing ? (
          <Close>
            <strong style={{ animationDelay: `${closeAt[0]}s` }}>{CLOSE_SAY[0]}</strong>
            <p style={{ animationDelay: `${closeAt[1]}s` }}>{CLOSE_SAY[1]}</p>
            <p style={{ animationDelay: `${closeAt[2]}s` }}>{CLOSE_SAY[2]}</p>
            <p style={{ animationDelay: `${closeAt[3]}s` }}>{CLOSE_SAY[3]}</p>
            <p style={{ animationDelay: `${closeAt[4]}s` }}>{CLOSE_SAY[4]}</p>
          </Close>
        ) : (
          <>
        <PageHead eyebrow="사흘이 끝났습니다" title="고른 것과, 마을이 어떻게 됐는지">
          첫 설정에서 갈라지는 {pathCount(detail, pathTo(detail, current.id)[0]?.id ?? '')}가지 경로 가운데 하나입니다. 날마다 마을에서 일어난 일이 다르니 숫자로 견주지 말고, 그날 주민의 말과 여러분이 바꾼 규칙을 읽어 주세요. 이 결과는 미리 계산해 둔 것이고, 실시간 모델 호출은 없습니다.
        </PageHead>
        <Glass><Days>
          {pathTo(detail, current.id).map((g) => {
            const facts = dayFacts(g);
            const parent = detail.generations.find((x) => x.id === g.parentGenerationId);
            const rule = parent?.changeSets.find((c) => c.id === g.appliedChangeSetId)?.changes[0];
            const voice = [...g.reviews]
              .filter((r) => r.usageStatus !== 'no_experience')
              .sort((x, y) => x.actorId.localeCompare(y.actorId, undefined, { numeric: true }))[0];
            return (
              <Day key={g.id}>
                <small>{dayName(g)}</small>
                <strong>{g.label}</strong>
                {facts && <p>{facts.dayTitle}</p>}
                {rule && (
                  <Rule2><b>이날 바뀐 규칙</b>{rule.afterRule}</Rule2>
                )}
                {voice && (
                  <Said><cite>{personName(voice.actorId)}의 말</cite>{voice.overallNarrative}</Said>
                )}
              </Day>
            );
          })}
        </Days></Glass>
          </>
        )}
        <div>
          {closing
            ? <Idle aria-live="off">{left}초 뒤 처음으로 돌아갑니다</Idle>
            : <Idle aria-live="off">{Math.max(until, 0)}초 뒤 자동으로 넘어갑니다</Idle>}
        </div>
      </Inner>
    </Sheet>
    </Film>
  );
}

export default function ChoiceScreen({ detail, current, closing, onClosing, onRestart, art = NO_ART, voices = null }: Props) {
  if (current.changeSets.length === 0) {
    return <Ending detail={detail} current={current} closing={closing} onClosing={onClosing} onRestart={onRestart} art={art} voices={voices} />;
  }

  const labels = new Map(current.ruleCatalog.map((r) => [r.ruleType, r.label]));
  return (
    <Sheet>
      <Inner>
        <PageHead eyebrow={`${dayName(current)} → ${current.index + 2}일차 · 수정 요청 고르기`} title="무엇을 고칠 것인가">
          오늘 주민들이 겪은 일에서 나온 세 가지입니다. 하나만 고를 수 있고, 고른 것이 내일의 규칙이
          되어 내일의 시뮬레이션이 여러분의 선택대로 달라집니다. 나머지 조건은 그대로 둡니다.
        </PageHead>
        <Cards>
          {current.changeSets.map((changeSet, index) => {
            const child = childFor(detail, changeSet.id);
            const rule = changeSet.changes[0];
            return (
              <Card key={changeSet.id} $off={!child}
                title={child ? undefined : '이 기록에서는 실행하지 않은 안입니다'}>
                <Kind>
                  <b>{index + 1}</b>
                  <small>{(rule?.semantic && labels.get(rule.semantic.ruleType)) ?? rule?.field ?? '수정 요청'}</small>
                </Kind>
                <strong>{changeSet.label}</strong>
                {/* Every card keeps all seven rows, empty or not, so the rows line up. */}
                {changeSet.expectedEffects[0] ? <Goal>{changeSet.expectedEffects[0]}</Goal> : <span />}
                <p>{changeSet.mechanism}</p>
                {changeSet.affectedActors.length > 0 ? (
                  <From>
                    <span>
                      {changeSet.affectedActors.slice(0, 3).map((id) => (
                        <Portrait key={id} actorId={id} art={art} size={36} />
                      ))}
                    </span>
                    <div><b>{withParticle(nameList(changeSet.affectedActors), 'subject')}</b> 겪은 일에서 나온 수정 요청</div>
                  </From>
                ) : <span />}
                {rule ? (
                  <Rule>
                    <small>지금</small>
                    <s>{rule.beforeRule}</s>
                    <i>↓</i>
                    <small>고치면</small>
                    <b>{rule.afterRule}</b>
                  </Rule>
                ) : <span />}
                <Take as="span">{child ? '태블릿에서 고릅니다' : '이 기록에서는 돌리지 않은 안'}</Take>
              </Card>
            );
          })}
        </Cards>
      </Inner>
    </Sheet>
  );
}
