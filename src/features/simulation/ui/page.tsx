import styled from 'styled-components';
import { colour, night, px } from './theme';

// The frame of a reading page: the evaluations and the choice of what to change
// (and the end of the three days) are one kind of page, so they share one frame.
// Every size goes through the type scale (ui/theme `px`), so the page reads at
// the same proportion on a laptop and on a wall screen.

export const Sheet = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: ${px(40)} ${px(24)} ${px(48)};
`;

export const Inner = styled.div`
  max-width: calc(1240px * var(--k, 1));
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: ${px(18)};
`;

const Eyebrow = styled.div`
  font-size: ${px(12)};
  font-weight: 800;
  letter-spacing: 0.04em;
  color: ${night.accent};
`;

const Headline = styled.h1`
  margin: 4px 0 0;
  font-size: ${px(32)};
  line-height: 1.2;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: ${colour.text};
`;

const Lead = styled.p`
  margin: ${px(12)} 0 0;
  max-width: calc(660px * var(--k, 1));
  font-size: ${px(14.5)};
  line-height: 1.7;
  color: ${colour.secondary};
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
