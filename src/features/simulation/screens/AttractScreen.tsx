import styled, { keyframes } from 'styled-components';
import IdleScreen from './IdleScreen';
import PairScreen from './PairScreen';

// The wall while no tablet is connected: the logo and the code to scan take turns, one cycle of 30 s —
// the logo 5 s, a 2.5 s cross-fade, the code 20 s, a 2.5 s cross-fade back.
const CYCLE_S = 30;
const logoOpacity = keyframes`
  0%, 16.67% { opacity: 1; }
  25%, 91.67% { opacity: 0; }
  100% { opacity: 1; }
`;
const codeOpacity = keyframes`
  0%, 16.67% { opacity: 0; }
  25%, 91.67% { opacity: 1; }
  100% { opacity: 0; }
`;

const Frame = styled.div`
  position: relative;
  flex: 1;
  min-height: 0;
`;
const Layer = styled.div<{ $of: typeof logoOpacity }>`
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  animation: ${(p) => p.$of} ${CYCLE_S}s linear infinite;
`;

export default function AttractScreen({ art }: { art: ReadonlySet<string> }) {
  return (
    <Frame>
      <Layer $of={logoOpacity}><IdleScreen art={art} /></Layer>
      <Layer $of={codeOpacity}><PairScreen /></Layer>
    </Frame>
  );
}
