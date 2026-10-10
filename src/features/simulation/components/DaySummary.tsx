import styled from 'styled-components';
import { formatClock } from '../positions';
import type { TimelineItem } from '../selectors/dayLedger';
import { personName } from '../selectors/story';
import { inkA, night, px, radius, space } from '../ui/theme';

// The stage once the day is over: not the village's quiet state ("no open requests")
// but what happened, in the order it happened. The visitor is about to read what the
// residents said about it, and this is the day those words are about. Every line is a
// Task of the record (its time, its name, whom it was for); nothing is added.

const Box = styled.section`
  height: 100%;
  overflow-y: auto;
  padding: ${space.xl} ${space.xl} ${space.lg};
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
`;

const Kicker = styled.div`
  font-size: ${px(12)};
  font-weight: 800;
  letter-spacing: 0.1em;
  color: ${night.accent};
`;

const List = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: ${space.lg};
  &::before {
    content: '';
    position: absolute;
    left: ${px(4)};
    top: ${px(16)};
    bottom: ${px(16)};
    width: 1px;
    background: ${inkA(0.22)};
  }
  > li {
    position: relative;
    display: grid;
    grid-template-columns: ${px(76)} 1fr;
    gap: ${space.md};
    align-items: baseline;
    padding-left: ${px(28)};
  }
  > li::before {
    content: '';
    position: absolute;
    left: 0;
    top: ${px(12)};
    width: ${px(12)};
    height: ${px(12)};
    border-radius: ${radius.round};
    background: ${night.accent};
  }
  time { font-size: ${px(20)}; font-weight: 800; font-variant-numeric: tabular-nums; color: ${night.ink}; }
  strong { display: block; font-size: ${px(28)}; font-weight: 800; letter-spacing: -0.02em; line-height: 1.25; color: ${night.ink}; word-break: keep-all; }
  small { display: block; margin-top: ${space.xs}; font-size: ${px(16)}; color: ${night.mute}; }
`;

export default function DaySummary({ items }: { items: TimelineItem[] }) {
  const done = items.filter((item) => item.state !== 'planned');
  return (
    <Box aria-label="오늘 일어난 일">
      <Kicker>오늘 일어난 일</Kicker>
      <List>
        {done.map((item) => (
          <li key={`${item.requestId}-${item.startMs}`}>
            <time>{formatClock(item.startMs)}</time>
            <div>
              <strong>{item.title}</strong>
              {(item.need || item.subjectId) && (
                <small>{[item.need, item.subjectId ? personName(item.subjectId) : null].filter(Boolean).join(' · ')}</small>
              )}
            </div>
          </li>
        ))}
      </List>
    </Box>
  );
}
