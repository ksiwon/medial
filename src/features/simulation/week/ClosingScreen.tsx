import { useEffect, useMemo, useRef } from 'react';
import styled, { css, keyframes } from 'styled-components';
import { api } from '../api/client';
import type { VoiceClip } from '../api/types';
import { heardSeconds, narrationOf, NARRATION_RATE, playNarration } from '../scene/voice';
import { tallerThanParent, useFit } from '../ui/useFit';
import { deepA, inkA, night, px, radius, space, type } from '../ui/theme';
import { dayOf, eventOf, eventsRead, runsOf, versionOf, type Paths } from './selectors';
import { RuleItem } from './RuleViews';
import type { Week } from './types';

// The end of a visit, in the opening film's tone: the desk painting under a dark veil. First what the visitor
// changed this visit - each event they read and the request they chose, with the rule it changed - then the
// closing words rising a line at a time while the narrator reads them, and then the start again by itself
// (week/auto.ts). It is reached from the tablet (마치기) or when nobody has pressed anything for a while.

/** The closing words, which the narrator reads (fixtures/exhibition/narration.json `outro`). A test keeps the two the same. */
export const CLOSE_SAY = [
  '서비스 디자이너에게 중요한 것은, 초안을 여러 번 돌려 보며 더 나은 서비스로 다듬어 가는 과정입니다.',
  '어떤 수정 요청을 고르느냐에 따라, 같은 마을의 같은 일도 어르신께는 다른 경험이 됩니다.',
  '그런데 멀고 사람이 드문 곳에서는, 그 선택의 결과를 현장에서 오래 지켜볼 수 없습니다.',
  '그래서 현장에 가기 전에, 초안을 미리 여러 번 돌려 볼 수 있는 도구 Desimer를 만들었습니다.',
  '작은 공동체에 서비스를 들이려는 서비스 디자이너의 현장 연구 부담을 덜어, 더 나은 서비스를 만들도록 돕습니다.',
] as const;

/** When each closing line comes up (s): a steady pace with no voice, else when the narrator is done with the one before. */
export function closingAt(voices: Record<string, VoiceClip> | null | undefined): number[] {
  const base = [0.3, 2.4, 5.4, 8.4, 11.4];
  const at = [base[0]];
  for (let i = 1; i < base.length; i += 1) {
    const clip = narrationOf(voices, CLOSE_SAY[i - 1]);
    at.push(Math.max(base[i], at[i - 1] + (clip ? heardSeconds(clip.seconds, NARRATION_RATE) + 0.4 : 0)));
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
  /* The painting shows through on the right; the words sit on the darker left. */
  &::before { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, ${deepA(0.88)} 0%, ${deepA(0.7)} 50%, ${deepA(0.32)} 100%); }
  > * { position: relative; }
`;

const Inner = styled.div`
  width: 100%;
  box-sizing: border-box;
  padding: ${space.xl} ${px(96)};
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
`;

const Head = styled.header`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  > small { display: flex; align-items: center; gap: ${space.sm}; font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.09em; color: ${night.accent}; }
  > small::before { content: ''; width: ${px(28)}; height: 2px; background: ${night.accent}; }
  > h1 { margin: 0; font-size: ${type.hero}; font-weight: 800; letter-spacing: -0.04em; line-height: 1.2; word-break: keep-all; }
  > p { margin: 0; font-size: ${type.lead}; line-height: 1.6; color: ${night.mute}; word-break: keep-all; max-width: ${px(1100)}; }
`;

const Rows = styled.ol<{ $many: boolean }>`
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(${(p) => px(p.$many ? 280 : 340)}, 1fr));
  gap: ${space.lg};
  align-items: stretch;
  > li { display: flex; flex-direction: column; gap: ${space.md}; padding: ${(p) => (p.$many ? space.lg : space.xl)}; border-radius: ${radius.card};
    background: ${deepA(0.72)}; border: 1px solid ${night.line}; animation: ${rise} 0.7s ease both; }
  > li > header { display: flex; align-items: center; justify-content: space-between; gap: ${space.md}; }
  > li > header > span { font-size: ${type.body}; font-weight: 800; letter-spacing: 0.02em; color: ${night.mute}; }
  > li > header > small { font-size: ${type.body}; font-weight: 700; color: ${night.faint}; font-variant-numeric: tabular-nums; }
  > li > strong { font-size: ${type.title}; font-weight: 800; letter-spacing: -0.02em; line-height: 1.3; word-break: keep-all; }
  ${(p) => p.$many && css`> li > div > small { display: none; }`}
`;

/** The requests an event went through, as a rail: each made the version after it. */
const Steps = styled.ol`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${space.md};
  > li { position: relative; display: flex; flex-direction: column; gap: ${space.hair}; padding-left: ${space.xl}; }
  > li::before { content: ''; position: absolute; left: 0; top: ${space.sm}; width: ${px(8)}; height: ${px(8)}; border-radius: ${radius.round}; background: ${inkA(0.4)}; }
  > li:not(:last-child)::after { content: ''; position: absolute; left: ${px(4)}; top: calc(${space.sm} + ${px(12)}); bottom: calc(${space.xs} - ${space.md}); border-left: 1px solid ${night.line}; }
  > li > b { font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.06em; color: ${night.faint}; }
  > li > span { font-size: ${type.lead}; line-height: 1.45; font-weight: 600; color: ${inkA(0.92)}; word-break: keep-all; }
`;

/** What the requests changed in the rules: each rule once, as it was and as it ended. */
const Changes = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${space.sm};
  padding-top: ${space.md};
  border-top: 1px solid ${night.line};
  > small { font-size: ${type.caption}; font-weight: 800; letter-spacing: 0.06em; color: ${night.faint}; }
  > ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: ${space.sm}; }
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
  const inner = useRef<HTMLDivElement>(null);
  // The events the visitor changed, in the order the week tells them.
  const changed = week.days.flatMap((d) => d.events).filter((id) => (paths[id]?.length ?? 0) > 0);
  // With four or more, the page would not hold them: the requests are left to the tablet and the rules they changed stay.
  const many = changed.length > 3;
  useFit(inner, tallerThanParent, [changed.length, words, week, paths]);
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
      <Inner ref={inner}>
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
            <Rows $many={many}>
              {changed.map((id, i) => {
                const event = eventOf(week, id);
                const made = versionOf(event, paths[id] ?? []);
                if (!event || !made) return null;
                // Each rule the requests touched, once: the draft's sentence, and the sentence it ended on.
                const ended = new Map(made.chain.flatMap((request, k) => request.rules.map((rule) => [rule.type, { rule, version: k + 2 }] as const)));
                return (
                  <li key={id} style={{ animationDelay: `${0.3 + i * 0.25}s` }}>
                    <header><span>{dayOf(week, id)}요일</span><small>ver1 → ver{made.number}</small></header>
                    <strong>{event.title}</strong>
                    {!many && <Steps>
                      {made.chain.map((request, k) => (
                        <li key={request.id}><b>ver{k + 2}</b><span>{request.label}</span></li>
                      ))}
                    </Steps>}
                    <Changes>
                      <small>바뀐 규칙</small>
                      <ol>
                        {[...ended.values()].map(({ rule, version }) => (
                          <RuleItem key={rule.type} dense compact terse={many} label={rule.label}
                            was={week.draft.find((r) => r.type === rule.type)?.sentence ?? rule.beforeSentence}
                            now={{ sentence: rule.afterSentence, version }} />
                        ))}
                      </ol>
                    </Changes>
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
