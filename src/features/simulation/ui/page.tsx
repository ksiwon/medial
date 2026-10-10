import styled from 'styled-components';
import { night, px, space } from './theme';

// The frame of a reading page: the evaluations and the choice of what to change
// (and the end of the three days) are one kind of page, so they share one frame.
// It is the film's and the observe screen's night ground, so the walk is one piece
// from the first frame to the last. Every size goes through the type scale
// (ui/theme `px`), so the page reads at the same proportion on a laptop and on a
// wall screen.

export const Sheet = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: ${space.huge} ${space.xl} ${space.huge};
  background: ${night.ground};
  color: ${night.ink};
  scrollbar-color: ${night.raised} transparent;
`;

export const Inner = styled.div`
  max-width: calc(1320px * var(--k, 1));
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: ${space.xl};
`;

const Eyebrow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: ${space.sm};
  font-size: ${px(12)};
  font-weight: 800;
  letter-spacing: 0.08em;
  color: ${night.accent};
  &::before {
    content: '';
    width: ${px(28)};
    height: 2px;
    background: ${night.accent};
  }
`;

const Headline = styled.h1`
  margin: ${space.md} 0 0;
  font-size: ${px(48)};
  line-height: 1.12;
  font-weight: 800;
  letter-spacing: -0.04em;
  color: ${night.ink};
  word-break: keep-all;
`;

const Lead = styled.p`
  margin: ${space.lg} 0 0;
  max-width: calc(760px * var(--k, 1));
  font-size: ${px(16)};
  line-height: 1.7;
  letter-spacing: -0.01em;
  color: ${night.mute};
  word-break: keep-all;
`;

/** The small line above, the title, and the sentence that says how to read what follows. */
export function PageHead({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <header>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Headline>{title}</Headline>
      {children && <Lead>{children}</Lead>}
    </header>
  );
}
