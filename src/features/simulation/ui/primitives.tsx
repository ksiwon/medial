import * as React from 'react';
import styled, { css } from 'styled-components';
import { colour, font, radius } from './theme';

// Shared atoms. Two rules run through all of them, both from doc 15 section 7:
// an ordinary row is separated by a rule and whitespace rather than wrapped in a
// card, and a state is never carried by colour alone.

export const Panel = styled.section`
  border: 1px solid ${colour.border};
  border-radius: ${radius.panel};
  background: ${colour.surface};
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
`;

export const PanelHead = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 16px;
  border-bottom: 1px solid ${colour.border};
  flex: none;
`;

export const PanelTitle = styled.h2`
  margin: 0;
  font-size: ${font.section};
  font-weight: 600;
  letter-spacing: -0.2px;
  color: ${colour.text};
`;

export const PageTitle = styled.h1`
  margin: 0;
  font-size: ${font.page};
  font-weight: 650;
  letter-spacing: -0.5px;
  color: ${colour.text};
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

export const Scroll = styled.div`
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  flex: 1;
`;

export const Row = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  min-width: 0;
`;

/** A plain list row: a rule and padding, no border box. */
export const Line = styled.div`
  padding: 10px 16px;
  border-bottom: 1px solid ${colour.border};
  min-width: 0;
  &:last-child {
    border-bottom: none;
  }
`;

const control = css`
  font-family: inherit;
  font-size: ${font.body};
  color: ${colour.text};
  background: ${colour.surface};
  border: 1px solid ${colour.border};
  border-radius: ${radius.control};
  min-height: 38px;
  padding: 8px 10px;
  box-sizing: border-box;
  &:focus-visible {
    outline: 2px solid ${colour.primary};
    outline-offset: 1px;
  }
`;

export const Input = styled.input`
  ${control}
  width: 100%;
`;

export const TextArea = styled.textarea`
  ${control}
  width: 100%;
  min-height: 68px;
  line-height: 1.55;
  resize: vertical;
`;

export const Select = styled.select`
  ${control}
  cursor: pointer;
  max-width: 100%;
  /* A narrow select cuts a long option through the middle of a character;
     Chromium honours the ellipsis here and says the name was shortened. */
  text-overflow: ellipsis;
`;

export const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: ${font.small};
  color: ${colour.secondary};
  min-width: 0;
`;

/** One primary per working area; everything else is secondary or a text link. */
export const Button = styled.button<{ $primary?: boolean; $pressed?: boolean }>`
  font-family: inherit;
  font-size: ${font.body};
  min-height: 38px;
  padding: 8px 16px;
  border-radius: ${radius.control};
  cursor: pointer;
  border: 1px solid ${(p) => (p.$primary ? colour.primary : colour.border)};
  background: ${(p) =>
    p.$primary ? colour.primary : p.$pressed ? colour.selected : colour.surface};
  color: ${(p) => (p.$primary ? '#FFFFFF' : colour.text)};
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

/** A small control (zoom, step). 6px radius per the token list. */
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
  display: inline-flex;
  align-items: center;
  flex: none;
  font-size: ${font.small};
  line-height: 1.4;
  border-radius: 999px;
  padding: 1px 9px;
  white-space: nowrap;
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
    padding: 6px 0;
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
  border-radius: 4px;
  padding: 0 4px;
  color: ${colour.secondary};
  word-break: break-all;
`;

export const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: ${font.small};
  th,
  td {
    border-bottom: 1px solid ${colour.border};
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
    line-height: 1.5;
  }
  th {
    color: ${colour.secondary};
    font-weight: 600;
  }
  td.num {
    font-variant-numeric: tabular-nums;
  }
`;

/** Wide content scrolls inside itself; the page body never scrolls sideways. */
export const HScroll = styled.div`
  overflow-x: auto;
  min-width: 0;
`;

/** Text for a numeric criterion, keeping "not measured" distinct from zero. */
export function showValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return '미수집';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function showDelta(value: number): string {
  if (value === 0) return '±0';
  return value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1);
}

/** Generation labels already start with their own "v1 · " prefix in the stored
 *  record, so prefixing the index again prints "v1 · v1 · ...". */
export function versionName(index: number, label: string): string {
  const prefix = `v${index}`;
  return label.startsWith(prefix) ? label : `${prefix} · ${label}`;
}

/** One line that must not break or spill out of its box. The full text stays
 *  reachable as the element's own title. */
export const Clip = styled.span`
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const HintButton = styled.button`
  font-family: inherit;
  font-size: 11px;
  line-height: 1;
  width: 16px;
  height: 16px;
  flex: none;
  margin-left: 4px;
  padding: 0;
  border-radius: 999px;
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
  padding: 8px 10px;
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

/** A heading or table label with its explanation folded into a hint. */
export function WithHint({
  label,
  hint,
  children,
}: {
  label: string;
  hint: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <span style={{ display: 'inline' }}>
      {children ?? label}
      <Hint label={label}>{hint}</Hint>
    </span>
  );
}
