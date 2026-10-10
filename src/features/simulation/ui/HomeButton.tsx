import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { inkA, night, px, radius, space } from './theme';

// The way back to the opening film, at the same place on every screen of the walk:
// the right end of the foot. A visitor can leave at any point (the walk waits for a
// choice and does not move on by itself), but one stray touch must not throw away
// two minutes of someone's path, so the first press asks and the second goes.

const ASK_MS = 3000;

const Button = styled.button<{ $asking: boolean }>`
  font: inherit;
  font-size: ${px(12)};
  font-weight: 800;
  height: ${px(28)};
  padding: 0 ${space.lg};
  border-radius: ${radius.pill};
  cursor: pointer;
  color: ${(p) => (p.$asking ? '#fff' : night.ink)};
  background: ${(p) => (p.$asking ? night.accent : inkA(0.12))};
  border: 1px solid ${(p) => (p.$asking ? night.accent : inkA(0.2))};
  transition: background 0.15s ease, border-color 0.15s ease;
  &:hover { background: ${(p) => (p.$asking ? night.accent : inkA(0.2))}; }
  &:focus-visible { outline: 2px solid ${night.ink}; outline-offset: 2px; }
`;

export default function HomeButton({ onHome }: { onHome: () => void }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const timer = window.setTimeout(() => setAsking(false), ASK_MS);
    return () => window.clearTimeout(timer);
  }, [asking]);
  return (
    <Button type="button" $asking={asking}
      onClick={() => { if (asking) { setAsking(false); onHome(); } else setAsking(true); }}>
      {asking ? '한 번 더 누르면 처음으로' : '↺ 처음으로'}
    </Button>
  );
}
