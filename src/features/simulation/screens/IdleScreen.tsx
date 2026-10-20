import styled, { keyframes } from 'styled-components';
import { api } from '../api/client';
import Logo from '../ui/Logo';
import { deepA, night } from '../ui/theme';

// What the wall shows while nobody is at the tablet: the village, the name, and where
// to start. It is also where the walk comes back to after the end, so the next visitor
// walks up to a screen that is asking, not to the end of someone else's story.

const breathe = keyframes`0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); }`;
const fade = keyframes`0%, 100% { opacity: 0.45; } 50% { opacity: 1; }`;

const Stage = styled.div<{ $src: string | null }>`
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: ${night.deep};
  > i {
    position: absolute;
    inset: 0;
    background: ${(p) => (p.$src ? `url(${p.$src})` : 'none')} center / cover no-repeat;
    animation: ${breathe} 40s ease-in-out infinite;
  }
  &::before { content: ''; position: absolute; inset: 0; z-index: 1; background: ${deepA(0.62)}; }
  > div { position: relative; z-index: 2; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 2.4vh; }
  p { margin: 0; font-size: clamp(20px, 1.9vw, 72px); line-height: 1.5; color: ${night.mute}; word-break: keep-all; }
  small { font-size: clamp(16px, 1.3vw, 52px); font-weight: 700; color: ${night.accent}; animation: ${fade} 2.4s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { > i, small { animation: none; } }
`;

export default function IdleScreen({ art }: { art: ReadonlySet<string> }) {
  const picture = ['INTRO.village', 'FARM'].find((name) => art.has(name));
  return (
    <Stage $src={picture ? api.artUrl(picture) : null} aria-label="AI 대기 화면">
      <i />
      <div>
        <Logo height="clamp(96px, 12vw, 440px)" />
        <p>소규모 그룹을 위한 서비스 디자인 시뮬레이션 도구입니다.<br />서비스 디자이너가 되어, 시골 마을 어르신을 살펴 주는 AI 조율자를 고쳐 보세요.</p>
        <small>옆의 태블릿에서 시작하기를 눌러 주세요</small>
      </div>
    </Stage>
  );
}
