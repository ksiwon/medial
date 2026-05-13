// src/components/phone/AvatarFace.tsx
import styled, { keyframes, css } from 'styled-components';
import { color } from '../../styles/tokens';

const breathe = keyframes`
  0%, 100% { transform: scale(1); }
  50%       { transform: scale(1.018); }
`;

const speakBob = keyframes`
  0%, 100% { transform: translateY(0); }
  25%       { transform: translateY(-1px); }
  75%       { transform: translateY(1px); }
`;

const Wrapper = styled.div<{ $speaking: boolean }>`
  width: 100%;
  display: flex;
  justify-content: center;
  padding: 10px 0 6px;
  ${({ $speaking }) => $speaking
    ? css`animation: ${speakBob} 0.5s ease-in-out infinite;`
    : css`animation: ${breathe} 3s ease-in-out infinite;`
  }
`;

interface Props {
  speaking: boolean;
}

export default function AvatarFace({ speaking }: Props) {
  // 진료 아바타 — 더 clean하고 친근한 의료진 느낌
  return (
    <Wrapper $speaking={speaking}>
      <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* 배경 원 */}
        <circle cx="40" cy="40" r="40" fill={color.sage[50]} />
        <circle cx="40" cy="40" r="35" fill="#EDF0EC" />

        {/* 흰 가운 — 어깨 */}
        <path d="M14 80 Q20 62 40 58 Q60 62 66 80Z" fill="white" />
        <path d="M30 58 L38 72 L42 72 L50 58" fill={color.sage[50]} />

        {/* 청진기 실마리 */}
        <path d="M32 68 Q40 72 48 68" stroke={color.sage[400]} strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <circle cx="40" cy="72" r="2.5" fill={color.sage[400]} />

        {/* 얼굴 */}
        <ellipse cx="40" cy="40" rx="19" ry="21" fill="#F7DEB8" />

        {/* 머리카락 */}
        <path d="M21 34 Q21 18 40 18 Q59 18 59 34 Q56 25 40 25 Q24 25 21 34Z" fill="#4A3728" />
        <path d="M21 34 Q19 40 21 44 Q21 38 24 36Z" fill="#4A3728" />
        <path d="M59 34 Q61 40 59 44 Q59 38 56 36Z" fill="#4A3728" />

        {/* 눈 */}
        <ellipse cx="33" cy="39" rx="2.5" ry="2.8" fill="#2A1A10" />
        <ellipse cx="47" cy="39" rx="2.5" ry="2.8" fill="#2A1A10" />
        {/* 눈 하이라이트 */}
        <circle cx="34.2" cy="37.8" r="0.9" fill="white" />
        <circle cx="48.2" cy="37.8" r="0.9" fill="white" />

        {/* 눈썹 */}
        <path d="M29 35 Q33 33 37 35" stroke="#4A3728" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        <path d="M43 35 Q47 33 51 35" stroke="#4A3728" strokeWidth="1.5" strokeLinecap="round" fill="none" />

        {/* 코 */}
        <path d="M39 43 Q37.5 47 40 48 Q42.5 47 41 43" stroke="#C8956C" strokeWidth="0.9" fill="none" strokeLinecap="round" />

        {/* 입 — 말할 때 / 안 말할 때 */}
        {!speaking ? (
          <path d="M35 52 Q40 56 45 52" stroke="#A06040" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        ) : (
          <>
            <ellipse cx="40" cy="53" rx="5" ry="3.5" fill="#9B5030" />
            <path d="M35 53 Q40 50 45 53" fill="#C08060" />
          </>
        )}

        {/* 볼 홍조 */}
        <circle cx="27" cy="47" r="5" fill="rgba(210,100,70,0.12)" />
        <circle cx="53" cy="47" r="5" fill="rgba(210,100,70,0.12)" />
      </svg>
    </Wrapper>
  );
}
