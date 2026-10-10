import * as React from 'react';
import styled, { css, keyframes } from 'styled-components';
import { accentA, colour, font, px, radius } from './theme';

// Shared atoms. Two rules run through all of them, both from doc 15 section 7:
// an ordinary row is separated by a rule and whitespace rather than wrapped in a
// card, and a state is never carried by colour alone.

/**
 * Every rounded-end label in the app, in one of four sizes (2026-10-07). The
 * height is fixed and the text is centred in it by flex, so the space above and
 * below the letters is always equal and the space at the sides follows from the
 * height (about 0.44 of it) instead of being picked per label.
 *
 *   xs 20 - a status tag inside a line       sm 28 - a chip, a badge, a choice
 *   md 32 - a control                        lg 40 - the one thing to press next
 */
const PILL = {
  xs: { h: 20, x: 8, f: 12 },
  sm: { h: 28, x: 12, f: 12 },
  md: { h: 32, x: 16, f: 16 },
  lg: { h: 40, x: 20, f: 16 },
} as const;

const ping = keyframes`
  0% { transform: scale(1); opacity: 0.85; }
  70%, 100% { transform: scale(1.16, 1.5); opacity: 0; }
`;

/**
 * "Press this next": the one button that carries the walk forward (the day's end,
 * the end of the evaluations) sends a ring out from itself, again and again, until
 * it is pressed. Drawn on ::before, so it does not move the button or change its
 * shadow; a person who asks their system for less motion gets a steady glow instead.
 */
export const beckon = css`
  position: relative;
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    border: 2px solid ${accentA(0.9)};
    pointer-events: none;
    animation: ${ping} 1.6s ease-out infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    &::before { animation: none; opacity: 1; inset: -4px; border-color: ${accentA(0.5)}; }
  }
`;

export const pill = (size: keyof typeof PILL) => css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-sizing: border-box;
  height: ${px(PILL[size].h)};
  padding: 0 ${px(PILL[size].x)};
  font-size: ${px(PILL[size].f)};
  line-height: 1;
  white-space: nowrap;
  vertical-align: middle;
  border-radius: ${radius.pill};
`;

export const Body = styled.p`
  margin: 0;
  font-size: ${font.body};
  line-height: 1.55;
  color: ${colour.text};
`;

export const Sub = styled.p`
  margin: 0;
  font-size: ${font.small};
  line-height: 1.55;
  color: ${colour.secondary};
`;

export const Row = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
`;

const control = css`
  font-family: inherit;
  font-size: ${font.body};
  color: ${colour.text};
  background: ${colour.surface};
  border: 1px solid ${colour.border};
  border-radius: ${radius.control};
  min-height: 40px;
  padding: 8px 12px;
  box-sizing: border-box;
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: 1px;
  }
`;

export const Select = styled.select`
  ${control}
  cursor: pointer;
  max-width: 100%;
  /* A narrow select cuts a long option through the middle of a character;
     Chromium honours the ellipsis here and says the name was shortened. */
  text-overflow: ellipsis;
`;

export const TextLink = styled.button`
  font-family: inherit;
  font-size: ${font.small};
  color: ${colour.primary};
  background: none;
  border: none;
  padding: 2px 0;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: 2px;
  }
`;

/** A small control (zoom, step). 8px radius per the token list. */
export const IconButton = styled.button`
  font-family: inherit;
  font-size: ${font.small};
  white-space: nowrap;
  flex: none;
  min-width: 32px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid ${colour.border};
  background: ${colour.surface};
  color: ${colour.text};
  border-radius: ${radius.control};
  cursor: pointer;
  &:hover:not(:disabled) {
    border-color: ${colour.primary};
  }
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: 1px;
  }
  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
`;

export type TagKind =
  | 'neutral'
  | 'positive'
  | 'mixed'
  | 'negative'
  | 'unknown'
  | 'warn'
  | 'error'
  | 'human';

function tagColour(kind: TagKind = 'neutral') {
  switch (kind) {
    case 'positive':
      return { fg: colour.primary, bg: colour.selected, br: '#AFCFC6' };
    case 'mixed':
    case 'warn':
      return { fg: colour.warn, bg: colour.warnSurface, br: '#DDC49A' };
    case 'negative':
    case 'error':
      return { fg: colour.error, bg: colour.errorSurface, br: '#E2B4B1' };
    case 'unknown':
      return { fg: colour.unknown, bg: '#F2F4F6', br: colour.border };
    case 'human':
      return { fg: '#4A2F7D', bg: '#F1EDF9', br: '#C9BCE4' };
    default:
      return { fg: colour.secondary, bg: '#F2F4F6', br: colour.border };
  }
}

export const Tag = styled.span<{ $kind?: TagKind }>`
  ${pill('sm')}
  flex: none;
  color: ${(p) => tagColour(p.$kind).fg};
  background: ${(p) => tagColour(p.$kind).bg};
  border: 1px solid ${(p) => tagColour(p.$kind).br};
`;

/** Blocking problems and honest notices. Not a decorative card. */
export const Callout = styled.div<{ $tone?: 'info' | 'warn' | 'error' }>`
  display: flex;
  gap: 12px;
  align-items: flex-start;
  font-size: ${font.body};
  line-height: 1.55;
  border-radius: ${radius.panel};
  padding: 12px 16px;
  border: 1px solid
    ${(p) =>
      p.$tone === 'error' ? colour.error : p.$tone === 'warn' ? colour.warn : colour.border};
  background: ${(p) =>
    p.$tone === 'error'
      ? colour.errorSurface
      : p.$tone === 'warn'
        ? colour.warnSurface
        : colour.surface};
  color: ${(p) =>
    p.$tone === 'error' ? colour.error : p.$tone === 'warn' ? colour.warn : colour.text};
`;

/** Detail that must stay reachable but must not occupy the default screen:
 *  field paths, hashes, JSON diffs, unimplemented lists. */
export const Disclosure = styled.details`
  font-size: ${font.small};
  color: ${colour.secondary};
  > summary {
    cursor: pointer;
    padding: 8px 0;
    color: ${colour.primary};
    list-style: none;
  }
  > summary::-webkit-details-marker {
    display: none;
  }
  > summary::before {
    content: '▸ ';
  }
  &[open] > summary::before {
    content: '▾ ';
  }
  > :not(summary) {
    margin-top: 4px;
  }
`;

export const Mono = styled.code`
  font-size: ${font.small};
  background: #f2f4f6;
  border-radius: ${radius.xs};
  padding: 0 4px;
  color: ${colour.secondary};
  word-break: break-all;
`;

const HintButton = styled.button`
  font-family: inherit;
  font-size: calc(12px * var(--k, 1));
  line-height: 1;
  width: 16px;
  height: 16px;
  flex: none;
  margin-left: 4px;
  padding: 0;
  border-radius: ${radius.pill};
  border: 1px solid ${colour.border};
  background: ${colour.surface};
  color: ${colour.secondary};
  cursor: help;
  vertical-align: middle;
  &:hover,
  &[aria-expanded='true'] {
    border-color: ${colour.primary};
    color: ${colour.primary};
  }
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: 1px;
  }
`;

const Bubble = styled.div`
  position: fixed;
  z-index: 60;
  max-width: min(320px, 90vw);
  padding: 8px 12px;
  border-radius: ${radius.control};
  border: 1px solid ${colour.border};
  background: ${colour.surface};
  box-shadow: 0 4px 16px rgba(29, 41, 53, 0.18);
  font-size: ${font.small};
  line-height: 1.55;
  color: ${colour.text};
  white-space: normal;
  overflow-wrap: anywhere;
`;

/**
 * Secondary explanation, one keystroke or one hover away.
 *
 * Every screen here has a reason it is careful - what a number is and is not,
 * which two things must not be added together, why an empty cell is not a zero.
 * Printed in full next to each row, that careful text is what a reader has to
 * wade through before finding the number (2026-09-15). It is still one click
 * away, and it is still the same sentence; it is simply not the first thing on
 * the screen.
 *
 * The bubble is positioned fixed against the trigger's own rectangle, so it is
 * readable inside bars and tables that clip their overflow.
 */
export function Hint({ label, children }: { label: string; children: React.ReactNode }) {
  const trigger = React.useRef<HTMLButtonElement>(null);
  const [at, setAt] = React.useState<{ top: number; left: number } | null>(null);
  // Hover reads it; a click keeps it open, which is the only way to reach it
  // from a keyboard or a touch screen without holding the pointer still.
  const [pinned, setPinned] = React.useState(false);

  const show = () => {
    const box = trigger.current?.getBoundingClientRect();
    if (!box) return setAt({ top: 0, left: 0 });
    const width = typeof window === 'undefined' ? 1024 : window.innerWidth;
    setAt({ top: box.bottom + 6, left: Math.max(8, Math.min(box.left - 8, width - 336)) });
  };
  const close = () => {
    setPinned(false);
    setAt(null);
  };

  React.useEffect(() => {
    if (!pinned) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    // A pinned bubble must not sit on top of the next thing the reader clicks.
    const onDown = (event: MouseEvent) => {
      if (!trigger.current?.contains(event.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [pinned]);

  return (
    <>
      <HintButton
        ref={trigger}
        type="button"
        aria-label={`${label} 설명`}
        aria-expanded={at !== null}
        onClick={() => {
          if (pinned) return close();
          setPinned(true);
          show();
        }}
        onMouseEnter={() => !pinned && show()}
        onMouseLeave={() => !pinned && setAt(null)}
        onFocus={() => !pinned && show()}
        onBlur={() => !pinned && setAt(null)}
      >
        ?
      </HintButton>
      {at && (
        <Bubble role="tooltip" style={{ top: at.top, left: at.left }}>
          {children}
        </Bubble>
      )}
    </>
  );
}
