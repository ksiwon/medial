import styled, { css } from 'styled-components';
import { accentA, font, inkA, night, px, radius, space } from './theme';

// The few shared atoms the screens use: the rounded label, a notice, and inline code.

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

export const pill = (size: keyof typeof PILL) => css`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${space.sm};
  box-sizing: border-box;
  height: ${px(PILL[size].h)};
  padding: 0 ${px(PILL[size].x)};
  font-size: ${px(PILL[size].f)};
  line-height: 1;
  white-space: nowrap;
  vertical-align: middle;
  border-radius: ${radius.pill};
`;

/** Blocking problems and honest notices (the server not answering, a week that broke a rule). Not a decorative card. */
export const Callout = styled.div<{ $tone?: 'info' | 'error' }>`
  display: flex;
  gap: ${space.md};
  align-items: flex-start;
  font-size: ${font.body};
  line-height: 1.55;
  border-radius: ${radius.panel};
  padding: ${space.md} ${space.lg};
  color: ${night.ink};
  border: 1px solid ${(p) => (p.$tone === 'error' ? night.accent : night.line)};
  background: ${(p) => (p.$tone === 'error' ? accentA(0.16) : night.panel)};
`;

export const Mono = styled.code`
  font-size: ${font.small};
  background: ${inkA(0.1)};
  border-radius: ${radius.xs};
  padding: 0 ${space.xs};
  color: ${night.mute};
  word-break: break-all;
`;
