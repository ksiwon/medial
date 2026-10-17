import styled, { css, keyframes } from 'styled-components';
import { accentA, font, inkA, night, radius } from '../../ui/theme';

// The tablet's parts. An iPad Air held landscape (1180 x 820), touched with a finger, at arm's length:
// everything pressable is at least TOUCH tall, there is no hover anywhere, and a press answers at once
// (it sinks and dims) before the wall has even moved. Sizes sit on the 4px grid like the rest of the
// look (ui/theme); the tablet does not scale with the window the way the wall does - it is one device.

export const TOUCH = 56;
export const GAP = 16;

const rise = keyframes`from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; }`;
const pulse = keyframes`0%, 100% { box-shadow: 0 0 0 0 ${accentA(0.5)}; } 50% { box-shadow: 0 0 0 12px ${accentA(0)}; }`;

/** What a pressed thing does: it sinks. `:active` is the finger being down, which is the answer the visitor needs. */
const pressable = css`
  appearance: none;
  font: inherit;
  cursor: default;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: transform 0.12s ease, filter 0.12s ease, background 0.2s ease, border-color 0.2s ease;
  &:active:not(:disabled) { transform: scale(0.97); filter: brightness(1.18); }
  &:disabled { opacity: 0.32; }
  &:focus-visible { outline: 2px solid ${night.ink}; outline-offset: 4px; }
`;

export const Screen = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: ${GAP}px;
  padding: max(24px, env(safe-area-inset-top)) max(32px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(32px, env(safe-area-inset-left));
  background: ${night.ground};
  color: ${night.ink};
  font-family: ${font.family};
  font-size: 20px;
  overflow: hidden;
  overscroll-behavior: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
`;

/** The one thing this screen is for: a title, a sentence, and what to press. Centred, with room. */
export const Stage = styled.main`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 32px;
  text-align: center;
  animation: ${rise} 0.4s ease both;
  > h1 { margin: 0; font-size: 48px; font-weight: 800; letter-spacing: -0.04em; line-height: 1.2; word-break: keep-all; }
  > p { margin: 0; max-width: 720px; font-size: 24px; line-height: 1.6; color: ${night.mute}; word-break: keep-all; }
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;

export const Page = styled.main`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: ${GAP}px;
  animation: ${rise} 0.3s ease both;
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;

type Tone = 'primary' | 'plain' | 'quiet';

export const Button = styled.button<{ $tone?: Tone; $big?: boolean }>`
  ${pressable}
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  box-sizing: border-box;
  min-height: ${(p) => (p.$big ? 96 : TOUCH)}px;
  min-width: ${TOUCH}px;
  padding: 0 ${(p) => (p.$big ? 56 : 28)}px;
  border-radius: ${radius.pill};
  font-size: ${(p) => (p.$big ? 32 : 20)}px;
  font-weight: 800;
  letter-spacing: -0.01em;
  white-space: nowrap;
  color: ${(p) => (p.$tone === 'primary' ? '#fff' : night.ink)};
  background: ${(p) => (p.$tone === 'primary' ? night.accent : p.$tone === 'quiet' ? 'transparent' : inkA(0.1))};
  border: 1px solid ${(p) => (p.$tone === 'primary' ? night.accent : p.$tone === 'quiet' ? inkA(0.24) : inkA(0.3))};
`;

/** The press that carries the walk forward: it breathes until pressed, as the wall's "beckon" does. */
export const Next = styled(Button).attrs({ $tone: 'primary' })`
  animation: ${pulse} 2.2s ease-in-out infinite;
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;

/** A thing in a list: a resident, a scene, a request. The whole card is the target. */
export const Card = styled.button<{ $on?: boolean }>`
  ${pressable}
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  min-height: ${TOUCH + 16}px;
  padding: 20px 24px;
  text-align: left;
  color: ${night.ink};
  border-radius: ${radius.card};
  border: 1px solid ${(p) => (p.$on ? night.accent : night.line)};
  background: ${(p) => (p.$on ? night.accentSoft : night.panel)};
  > b { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; line-height: 1.3; word-break: keep-all; }
  > span { font-size: 20px; line-height: 1.5; color: ${night.mute}; word-break: keep-all;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  > small { font-size: 16px; font-weight: 800; letter-spacing: 0.04em; color: ${night.accent}; }
`;

export const Grid = styled.div<{ $cols: number }>`
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(${(p) => p.$cols}, minmax(0, 1fr));
  gap: 12px;
  align-content: start;
  overflow: hidden;
`;

export const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`;

export const Spacer = styled.span`flex: 1;`;

export const Hint = styled.p`
  margin: 0;
  font-size: 20px;
  line-height: 1.5;
  color: ${night.mute};
  word-break: keep-all;
`;

/** The top bar: where the visitor is in the three days, and the way back. One quiet line. */
const BarBox = styled.header`
  flex: none;
  display: flex;
  align-items: center;
  gap: 24px;
  min-height: ${TOUCH}px;
  > b { font-size: 24px; font-weight: 800; letter-spacing: -0.03em; }
  > em { font-style: normal; font-size: 20px; font-weight: 800; color: ${night.accent}; }
  > span { flex: 1; min-width: 0; font-size: 20px; color: ${night.mute}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

const Dots = styled.ol`
  display: flex;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
  > li { width: 32px; height: 8px; border-radius: ${radius.pill}; background: ${inkA(0.16)}; transition: background 0.3s ease; }
  > li[data-state='now'] { background: ${night.accent}; }
  > li[data-state='done'] { background: ${inkA(0.7)}; }
`;

export function TopBar({ day, index, count, line, home }: {
  day: string | null; index: number; count: number; line: string; home: React.ReactNode;
}) {
  return (
    <BarBox>
      <b>AI 조율자</b>
      {day && (
        <>
          <Dots aria-label={`${count}일 가운데 ${index + 1}일째`}>
            {Array.from({ length: count }, (_, i) => (
              <li key={i} data-state={i < index ? 'done' : i === index ? 'now' : 'todo'} />
            ))}
          </Dots>
          <em>{day}</em>
        </>
      )}
      <span>{line}</span>
      {home}
    </BarBox>
  );
}

/** Said over everything when the line to the wall is not what it should be. It never hides what the visitor does. */
export const Notice = styled.div<{ $tone?: 'warn' | 'quiet' }>`
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-radius: ${radius.card};
  font-size: 20px;
  font-weight: 700;
  background: ${(p) => (p.$tone === 'quiet' ? inkA(0.08) : accentA(0.2))};
  border: 1px solid ${(p) => (p.$tone === 'quiet' ? night.line : night.accent)};
  &::before { content: ''; width: 12px; height: 12px; border-radius: ${radius.round}; background: ${(p) => (p.$tone === 'quiet' ? night.faint : night.accent)}; }
`;
