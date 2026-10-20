import { useEffect, useMemo } from 'react';
import styled, { keyframes } from 'styled-components';
import { api } from '../api/client';
import type { VoiceClip } from '../api/types';
import { narrationOf, playNarration } from '../scene/voice';
import { deepA, inkA, night, px, radius, space, type } from '../ui/theme';
import { dayOf, eventOf, eventsRead, runsOf, versionOf, type Paths } from './selectors';
import type { Week } from './types';

// The end of a visit, in the opening film's tone: the desk painting under a dark veil. First what the visitor
// changed this visit - each event they read and the request they chose, with the rule it changed - then the
// closing words rising a line at a time while the narrator reads them, and then the start again by itself
// (week/auto.ts). It is reached from the tablet (마치기) or when nobody has pressed anything for a while.

/** The closing words, which the narrator reads (fixtures/exhibition/narration.json `outro`). A test keeps the two the same. */
export const CLOSE_SAY = [
  '서비스 디자이너의 일은 초안을 고쳐 나가는 일입니다.',
  '어떤 수정 요청을 고르느냐에 따라, 같은 마을의 같은 일도 어르신께는 다른 경험이 됩니다.',
  '그런데 멀고 사람이 드문 마을에서는, 그 선택의 결과를 현장에서 오래 지켜볼 수 없습니다.',
  '그래서 Dially는, 갈 수 없는 현장을 대신해 초안을 미리 시험해 보는 도구가 됩니다.',
  '멀고 어려운 현장 연구의 부담을 덜어, 서비스 디자이너가 더 나은 서비스를 마을에 들이도록 돕습니다.',
] as const;

/** When each closing line comes up (s): a steady pace with no voice, else when the narrator is done with the one before. */
export function closingAt(voices: Record<string, VoiceClip> | null | undefined): number[] {
  const base = [0.4, 3.4, 8.4, 12.4, 16.4];
  const at = [base[0]];
  for (let i = 1; i < base.length; i += 1) {
    const clip = narrationOf(voices, CLOSE_SAY[i - 1]);
    at.push(Math.max(base[i], at[i - 1] + (clip ? clip.seconds + 0.7 : 0)));
  }
  return at;
}

const rise = keyframes`from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; }`;

const Film = styled.div<{ $src: string | null }>`
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  background: ${night.deep} ${(p) => (p.$src ? `url(${p.$src})` : 'none')} center / cover no-repeat;
  &::before { content: ''; position: absolute; inset: 0; background: ${deepA(0.86)}; }
  > * { position: relative; }
`;

const Inner = styled.div`
  width: 100%;
  box-sizing: border-box;
  padding: ${space.xxl} ${px(96)};
  display: flex;
  flex-direction: column;
  gap: ${space.xl};
`;

const Head = styled.header`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  > small { font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.09em; color: ${night.accent}; }
  > h1 { margin: 0; font-size: ${type.hero}; font-weight: 800; letter-spacing: -0.04em; line-height: 1.15; }
  > p { margin: 0; font-size: ${type.lead}; line-height: 1.6; color: ${night.mute}; word-break: keep-all; max-width: ${px(980)}; }
`;

const Rows = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(${px(360)}, 1fr));
  gap: ${space.lg};
  > li { display: flex; flex-direction: column; gap: ${space.sm}; padding: ${space.lg}; border-radius: ${radius.card};
    background: ${deepA(0.66)}; border: 1px solid ${night.line}; animation: ${rise} 0.7s ease both; }
  > li > small { font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.06em; color: ${night.accent}; }
  > li > strong { font-size: ${type.title}; font-weight: 800; letter-spacing: -0.02em; line-height: 1.3; word-break: keep-all; }
  > li > p { margin: 0; font-size: ${type.body}; line-height: 1.55; color: ${inkA(0.86)}; word-break: keep-all; }
  > li > p > b { color: ${night.ink}; }
  > li > em { font-style: normal; font-size: ${type.body}; line-height: 1.5; color: ${night.mute}; word-break: keep-all; }
`;

const Close = styled.div`
  max-width: ${px(1080)};
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
  word-break: keep-all;
  > * { opacity: 0; animation: ${rise} 0.8s ease forwards; }
  > strong { font-size: ${type.hero}; font-weight: 800; letter-spacing: -0.035em; line-height: 1.25; }
  > p { margin: 0; font-size: ${type.title}; line-height: 1.7; color: ${inkA(0.86)}; }
`;

export default function ClosingScreen({ week, paths, read, words, art, voices }: {
  week: Week; paths: Paths; read: readonly string[]; words: boolean;
  art: ReadonlySet<string>; voices: Record<string, VoiceClip> | null;
}) {
  const at = useMemo(() => closingAt(voices), [voices]);
  // The events the visitor changed, in the order the week tells them.
  const changed = week.days.flatMap((d) => d.events).filter((id) => (paths[id]?.length ?? 0) > 0);
  // The narrator reads the closing words as they come up; leaving the page stops it.
  useEffect(() => {
    if (!words) return undefined;
    const stops: (() => void)[] = [];
    const timers = CLOSE_SAY.flatMap((text, i) => {
      const clip = narrationOf(voices, text);
      return clip ? [window.setTimeout(() => stops.push(playNarration(clip.file)), (at[i] + 0.2) * 1000)] : [];
    });
    return () => { timers.forEach(window.clearTimeout); stops.forEach((stop) => stop()); };
  }, [words, voices, at]);

  return (
    <Film $src={art.has('INTRO.desk') ? api.artUrl('INTRO.desk') : null} aria-label="마무리">
      <Inner>
        {words || changed.length === 0 ? (
          <Close>
            {CLOSE_SAY.map((text, i) => (i === 0
              ? <strong key={text} style={{ animationDelay: `${at[i]}s` }}>{text}</strong>
              : <p key={text} style={{ animationDelay: `${at[i]}s` }}>{text}</p>))}
          </Close>
        ) : (
          <>
            <Head>
              <small>마무리 · 이번에 고친 것</small>
              <h1>{eventsRead(read)}개의 사건, {read.length}개의 버전을 보고 {runsOf(paths)}번 고쳤습니다</h1>
              <p>사건마다 따로 고쳤습니다. 한 사건에서 고친 규칙은 다른 사건에 이어지지 않습니다. 결과는 미리 만들어 둔 시뮬레이션이며 실제 주민의 의견이 아닙니다.</p>
            </Head>
            <Rows>
              {changed.map((id, i) => {
                const event = eventOf(week, id);
                const made = versionOf(event, paths[id] ?? []);
                if (!event || !made) return null;
                return (
                  <li key={id} style={{ animationDelay: `${0.3 + i * 0.25}s` }}>
                    <small>{dayOf(week, id)}요일 · ver1 → ver{made.number}</small>
                    <strong>{event.title}</strong>
                    {made.chain.map((request, k) => (
                      <p key={request.id}><b>ver{k + 2}</b> · {request.label}</p>
                    ))}
                    {[...new Map(made.chain.flatMap((request) => request.rules).map((rule) => [rule.type, rule])).values()].map((rule) => <em key={rule.type}>{rule.label}: {rule.afterSentence}</em>)}
                  </li>
                );
              })}
            </Rows>
          </>
        )}
      </Inner>
    </Film>
  );
}
