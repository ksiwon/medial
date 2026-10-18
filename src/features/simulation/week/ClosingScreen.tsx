import { useEffect, useMemo } from 'react';
import styled, { keyframes } from 'styled-components';
import { api } from '../api/client';
import type { VoiceClip } from '../api/types';
import { narrationOf, playNarration } from '../scene/voice';
import { inkA, night, px, radius, space } from '../ui/theme';
import { dayOf, eventOf, requestOf } from './selectors';
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
  '그래서 Dially는, 갈 수 없는 현장을 대신해 초안을 미리 시험해 보는 도구입니다.',
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
  &::before { content: ''; position: absolute; inset: 0; background: rgba(21, 21, 15, 0.86); }
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
  > small { font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.09em; color: ${night.accent}; }
  > h1 { margin: 0; font-size: ${px(48)}; font-weight: 800; letter-spacing: -0.04em; line-height: 1.15; }
  > p { margin: 0; font-size: ${px(20)}; line-height: 1.6; color: ${night.mute}; word-break: keep-all; max-width: ${px(980)}; }
`;

const Rows = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(${px(360)}, 1fr));
  gap: ${space.lg};
  > li { display: flex; flex-direction: column; gap: ${space.sm}; padding: ${space.lg}; border-radius: ${radius.card};
    background: rgba(21, 21, 15, 0.66); border: 1px solid ${night.line}; animation: ${rise} 0.7s ease both; }
  > li > small { font-size: ${px(12)}; font-weight: 800; letter-spacing: 0.06em; color: ${night.accent}; }
  > li > strong { font-size: ${px(24)}; font-weight: 800; letter-spacing: -0.02em; line-height: 1.3; word-break: keep-all; }
  > li > p { margin: 0; font-size: ${px(16)}; line-height: 1.55; color: ${inkA(0.86)}; word-break: keep-all; }
  > li > p > b { color: ${night.ink}; }
  > li > em { font-style: normal; font-size: ${px(16)}; line-height: 1.5; color: ${night.mute}; word-break: keep-all; }
`;

const Close = styled.div`
  max-width: ${px(1080)};
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
  word-break: keep-all;
  > * { opacity: 0; animation: ${rise} 0.8s ease forwards; }
  > strong { font-size: ${px(48)}; font-weight: 800; letter-spacing: -0.035em; line-height: 1.25; }
  > p { margin: 0; font-size: ${px(24)}; line-height: 1.7; color: ${inkA(0.86)}; }
`;

export default function ClosingScreen({ week, chosen, seen, words, art, voices }: {
  week: Week; chosen: Record<string, string | null>; seen: string[]; words: boolean;
  art: ReadonlySet<string>; voices: Record<string, VoiceClip> | null;
}) {
  const at = useMemo(() => closingAt(voices), [voices]);
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
        {words || seen.length === 0 ? (
          <Close>
            {CLOSE_SAY.map((text, i) => (i === 0
              ? <strong key={text} style={{ animationDelay: `${at[i]}s` }}>{text}</strong>
              : <p key={text} style={{ animationDelay: `${at[i]}s` }}>{text}</p>))}
          </Close>
        ) : (
          <>
            <Head>
              <small>마무리 · 이번에 고친 것</small>
              <h1>{seen.length}개의 사건을 읽고, 이렇게 고쳤습니다</h1>
              <p>사건마다 따로 고쳤습니다. 한 사건에서 고친 규칙은 다른 사건에 이어지지 않습니다. 결과는 미리 만들어 둔 시뮬레이션이며 실제 주민의 의견이 아닙니다.</p>
            </Head>
            <Rows>
              {seen.map((id, i) => {
                const event = eventOf(week, id);
                if (!event) return null;
                const request = requestOf(event, chosen[id] ?? null);
                return (
                  <li key={id} style={{ animationDelay: `${0.3 + i * 0.25}s` }}>
                    <small>{dayOf(week, id)}요일</small>
                    <strong>{event.title}</strong>
                    {request ? (
                      <>
                        <p><b>고른 요청</b> · {request.label}</p>
                        {request.rules.map((r) => <em key={r.type}>{r.label}: {r.afterSentence}</em>)}
                      </>
                    ) : <p>응급 상황이라 고르지 않고 일어난 일을 읽었습니다.</p>}
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
