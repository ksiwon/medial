// src/components/phone/VirtualDoctor.tsx
import { useEffect, useRef, useState } from 'react';
import styled, { keyframes, css } from 'styled-components';
import { DoctorState } from '../../types';
import { color } from '../../styles/tokens';

/* ── ANIMATIONS ──────────────────────────────────────────────── */
const float = keyframes`
  0%, 100% { transform: translateY(0px); }
  50%       { transform: translateY(-3px); }
`;

const breathe = keyframes`
  0%, 100% { transform: scaleY(1); }
  45%       { transform: scaleY(1.022); }
`;

const blink = keyframes`
  0%, 88%, 100% { transform: scaleY(1); }
  92%            { transform: scaleY(0.05); }
`;

const doubleBlink = keyframes`
  0%, 76%, 100% { transform: scaleY(1); }
  80%           { transform: scaleY(0.05); }
  84%           { transform: scaleY(1); }
  88%           { transform: scaleY(0.05); }
  92%           { transform: scaleY(1); }
`;

const mouthOpen = keyframes`
  0%   { transform: scaleY(0.15); }
  100% { transform: scaleY(1); }
`;

const nod = keyframes`
  0%, 100% { transform: rotate(0deg) translateY(0); }
  18%       { transform: rotate(-2deg) translateY(-1.2px); }
  52%       { transform: rotate(1.5deg) translateY(1px); }
  80%       { transform: rotate(-0.8deg); }
`;

const tilt = keyframes`
  0%, 100% { transform: rotate(0deg); }
  50%       { transform: rotate(-3.5deg); }
`;

const haloExpand = keyframes`
  0%   { transform: scale(1);   opacity: 0.45; }
  100% { transform: scale(2.4); opacity: 0; }
`;

const emergencyGlow = keyframes`
  0%, 100% { opacity: 0.65; }
  50%       { opacity: 0.12; }
`;

const thinkBounce = keyframes`
  0%, 78%, 100% { transform: translateY(0); }
  40%            { transform: translateY(-4px); }
`;

/* ── STYLED COMPONENTS ───────────────────────────────────────── */
const Wrapper = styled.div<{ $size: number }>`
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size * 1.3}px;
  position: relative;
  flex-shrink: 0;
  overflow: visible;
  animation: ${float} 3.4s ease-in-out infinite;
`;

const DocSvg = styled.svg<{ $state: DoctorState }>`
  width: 100%;
  height: 100%;
  overflow: visible;
  ${({ $state }) => $state === 'speaking' && css`
    animation: ${nod} 1s ease-in-out infinite;
  `}
  ${({ $state }) => $state === 'listening' && css`
    animation: ${tilt} 2.2s ease-in-out infinite;
  `}
`;

const EyeGroup = styled.g<{ $blinkType: 'normal' | 'double' | 'wide' }>`
  transform-origin: 50px 36px;
  ${({ $blinkType }) => $blinkType === 'normal' && css`
    animation: ${blink} 4.2s ease-in-out infinite;
  `}
  ${({ $blinkType }) => $blinkType === 'double' && css`
    animation: ${doubleBlink} 5.5s ease-in-out infinite;
  `}
  ${({ $blinkType }) => $blinkType === 'wide' && css`
    transform: scaleY(1.18);
  `}
`;

const BrowGroup = styled.g<{ $offset: number }>`
  transform: translateY(${({ $offset }) => $offset}px);
  transition: transform 0.4s ease;
`;

const BodyGroup = styled.g`
  transform-origin: 50px 130px;
  animation: ${breathe} 3.8s ease-in-out infinite;
`;

const LowerLip = styled.path<{ $speaking: boolean }>`
  transform-box: fill-box;
  transform-origin: top center;
  ${({ $speaking }) => $speaking && css`
    animation: ${mouthOpen} 0.32s ease-in-out infinite alternate;
  `}
`;

const HaloRing = styled.circle<{ $delay: string }>`
  transform-box: fill-box;
  transform-origin: center;
  animation: ${haloExpand} 2.4s ease-out infinite;
  animation-delay: ${({ $delay }) => $delay};
`;

const EmergencyRing = styled.circle`
  animation: ${emergencyGlow} 0.85s ease-in-out infinite;
`;

const ThinkDot = styled.circle<{ $delay: string }>`
  animation: ${thinkBounce} 0.95s ease-in-out infinite;
  animation-delay: ${({ $delay }) => $delay};
`;

/* ── COMPONENT ───────────────────────────────────────────────── */
interface VirtualDoctorProps {
  state: DoctorState;
  size?: number;
  showHalo?: boolean;
}

function SvgDoctor({ state, size = 64, showHalo = true }: VirtualDoctorProps) {
  const [blinkType, setBlinkType] = useState<'normal' | 'double' | 'wide'>('normal');
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (state === 'emergency') { setBlinkType('wide');   return; }
    if (state === 'thinking')  { setBlinkType('double'); return; }
    setBlinkType('normal');
  }, [state]);

  useEffect(() => {
    const randomize = () => {
      if (state === 'idle' || state === 'speaking') {
        setBlinkType(Math.random() < 0.28 ? 'double' : 'normal');
      }
      timerRef.current = setTimeout(randomize, 2800 + Math.random() * 4000);
    };
    timerRef.current = setTimeout(randomize, 2200);
    return () => clearTimeout(timerRef.current);
  }, [state]);

  const browOffset  = (state === 'speaking' || state === 'emergency') ? -1.8 : 0;
  const blushOpacity = (state === 'idle' || state === 'speaking') ? 0.28 : 0.06;

  const haloColor =
    state === 'emergency' ? color.emergency :
    state === 'listening'  ? color.amber.base :
    color.sage[400];

  return (
    <Wrapper $size={size}>
      <DocSvg viewBox="0 0 100 130" $state={state}>
        <defs>
          {/* Skin — warm peach with depth */}
          <radialGradient id="vd-skin" cx="44%" cy="38%" r="62%">
            <stop offset="0%"   stopColor="#FDDDC8" />
            <stop offset="52%"  stopColor="#F6C6A8" />
            <stop offset="100%" stopColor="#E8A885" />
          </radialGradient>

          {/* Iris — dark brown with inner highlight */}
          <radialGradient id="vd-iris" cx="36%" cy="32%" r="66%">
            <stop offset="0%"   stopColor="#7A5030" />
            <stop offset="100%" stopColor="#261006" />
          </radialGradient>

          {/* Hair — dark with slight sheen */}
          <linearGradient id="vd-hair" x1="25%" y1="0%" x2="75%" y2="100%">
            <stop offset="0%"   stopColor="#3C2212" />
            <stop offset="60%"  stopColor="#1C0C02" />
            <stop offset="100%" stopColor="#100600" />
          </linearGradient>

          {/* White coat — subtle warm gradient */}
          <radialGradient id="vd-coat" cx="50%" cy="10%" r="90%">
            <stop offset="0%"   stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#E8EBE8" />
          </radialGradient>

          {/* Ear shadow */}
          <radialGradient id="vd-ear" cx="60%" cy="50%" r="65%">
            <stop offset="0%"   stopColor="#F2C4A4" />
            <stop offset="100%" stopColor="#E0A888" />
          </radialGradient>
        </defs>

        {/* ── HALOS (SVG-native, scale from face center) ── */}
        {showHalo && state !== 'emergency' && state !== 'thinking' && (
          <>
            <HaloRing cx="50" cy="36" r="16" fill="none" stroke={haloColor} strokeWidth="1.4" $delay="0s" />
            <HaloRing cx="50" cy="36" r="16" fill="none" stroke={haloColor} strokeWidth="1.4" $delay="0.85s" />
          </>
        )}
        {state === 'emergency' && (
          <EmergencyRing cx="50" cy="36" r="28" fill="none" stroke={color.emergency} strokeWidth="2.5" />
        )}

        {/* ── HAIR (behind face) ── */}
        {/* Main hair volume */}
        <ellipse cx="50" cy="19" rx="24" ry="18" fill="url(#vd-hair)" />
        {/* Hair silhouette covering head top */}
        <path d="M 29 35 C 27 24 30 10 50 8 C 70 10 73 24 71 35 C 68 24 64 14 50 13 C 36 14 32 24 29 35 Z"
          fill="url(#vd-hair)" />
        {/* Side hair behind ears */}
        <path d="M 28.5 37 C 22 40 20 50 23 59 L 27 55 C 25 49 26 42 28.5 37 Z"
          fill="url(#vd-hair)" />
        <path d="M 71.5 37 C 78 40 80 50 77 59 L 73 55 C 75 49 74 42 71.5 37 Z"
          fill="url(#vd-hair)" />

        {/* ── FACE ── */}
        <ellipse cx="50" cy="39" rx="22" ry="26" fill="url(#vd-skin)" />

        {/* ── EARS ── */}
        <ellipse cx="28.5" cy="41" rx="3.8" ry="5.5" fill="url(#vd-ear)" />
        <ellipse cx="71.5" cy="41" rx="3.8" ry="5.5" fill="url(#vd-ear)" />
        {/* Ear inner fold */}
        <path d="M 28 37.5 C 26 40 26.5 44 28.5 46.5" fill="none" stroke="#D4987A" strokeWidth="0.8" strokeLinecap="round" />
        <path d="M 72 37.5 C 74 40 73.5 44 71.5 46.5" fill="none" stroke="#D4987A" strokeWidth="0.8" strokeLinecap="round" />

        {/* ── CHEEK BLUSH ── */}
        <ellipse cx="36" cy="45" rx="7.5" ry="4" fill="#E89080" opacity={blushOpacity} />
        <ellipse cx="64" cy="45" rx="7.5" ry="4" fill="#E89080" opacity={blushOpacity} />

        {/* ── EYEBROWS ── */}
        <BrowGroup $offset={browOffset}>
          {/* Left brow — slightly arched */}
          <path d="M 33.5 31.5 Q 39.5 28.5 45.5 30.5"
            stroke="#362010" strokeWidth="2.3" fill="none" strokeLinecap="round" />
          {/* Right brow */}
          <path d="M 54.5 30.5 Q 60.5 28.5 66.5 31.5"
            stroke="#362010" strokeWidth="2.3" fill="none" strokeLinecap="round" />
        </BrowGroup>

        {/* ── EYES ── */}
        <EyeGroup $blinkType={blinkType}>
          {/* Left eye */}
          <ellipse cx="40" cy="36" rx="7.2" ry="5.5" fill="white" />
          <circle  cx="40" cy="36.5" r="4"   fill="url(#vd-iris)" />
          <circle  cx="40" cy="36.5" r="2.5" fill="#140608" />
          {/* Catchlight */}
          <ellipse cx="41.8" cy="34.8" rx="1.4" ry="1.1" fill="white" opacity="0.88" />
          <ellipse cx="40.4" cy="38.2" rx="0.7" ry="0.5" fill="white" opacity="0.35" />
          {/* Upper eyelid crease */}
          <path d="M 33 34 Q 40 31 47 34"
            stroke="#4A2C1A" strokeWidth="1.1" fill="none" strokeLinecap="round" />
          {/* Lower lid */}
          <path d="M 33.5 37.8 Q 40 39.2 46.5 37.8"
            stroke="#D4A088" strokeWidth="0.7" fill="none" strokeLinecap="round" />

          {/* Right eye */}
          <ellipse cx="60" cy="36" rx="7.2" ry="5.5" fill="white" />
          <circle  cx="60" cy="36.5" r="4"   fill="url(#vd-iris)" />
          <circle  cx="60" cy="36.5" r="2.5" fill="#140608" />
          <ellipse cx="61.8" cy="34.8" rx="1.4" ry="1.1" fill="white" opacity="0.88" />
          <ellipse cx="60.4" cy="38.2" rx="0.7" ry="0.5" fill="white" opacity="0.35" />
          <path d="M 53 34 Q 60 31 67 34"
            stroke="#4A2C1A" strokeWidth="1.1" fill="none" strokeLinecap="round" />
          <path d="M 53.5 37.8 Q 60 39.2 66.5 37.8"
            stroke="#D4A088" strokeWidth="0.7" fill="none" strokeLinecap="round" />
        </EyeGroup>

        {/* ── GLASSES ── */}
        <circle cx="40" cy="36" r="8.8" fill="rgba(100,160,220,0.06)" stroke="#241A0C" strokeWidth="1.6" />
        <circle cx="60" cy="36" r="8.8" fill="rgba(100,160,220,0.06)" stroke="#241A0C" strokeWidth="1.6" />
        <line x1="48.8" y1="36" x2="51.2" y2="36" stroke="#241A0C" strokeWidth="1.6" />
        <line x1="31.2" y1="33.8" x2="23.5" y2="31.2" stroke="#241A0C" strokeWidth="1.6" />
        <line x1="68.8" y1="33.8" x2="76.5" y2="31.2" stroke="#241A0C" strokeWidth="1.6" />

        {/* ── NOSE ── */}
        <path d="M 49 43 C 47.2 46 46.5 49 48.5 50.5 Q 50 51.5 51.5 50.5 C 53.5 49 52.8 46 51 43"
          fill="none" stroke="#C89070" strokeWidth="1.2" strokeLinecap="round" />
        <ellipse cx="48.2" cy="50.5" rx="1.7" ry="1.1" fill="#C07862" opacity="0.42" />
        <ellipse cx="51.8" cy="50.5" rx="1.7" ry="1.1" fill="#C07862" opacity="0.42" />

        {/* ── NASOLABIAL FOLD (subtle) ── */}
        <path d="M 44 50 C 42 53 42 57 43.5 59" fill="none" stroke="#D4A080" strokeWidth="0.6" strokeLinecap="round" opacity="0.4" />
        <path d="M 56 50 C 58 53 58 57 56.5 59" fill="none" stroke="#D4A080" strokeWidth="0.6" strokeLinecap="round" opacity="0.4" />

        {/* ── MOUTH ── */}
        {state === 'thinking' ? (
          <path d="M 44 57 Q 50 56.5 56 57"
            stroke="#C07860" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        ) : (
          <g>
            {/* Upper lip — cupid's bow */}
            <path d="M 44.5 55.5 Q 47 53.5 50 55 Q 53 53.5 55.5 55.5"
              stroke="#B06848" strokeWidth="1.3" fill="#C88070" fillOpacity="0.25" strokeLinecap="round" />
            {/* Lower lip — opens when speaking */}
            <LowerLip
              $speaking={state === 'speaking'}
              d="M 44.5 55.5 Q 50 61 55.5 55.5"
              stroke="#C07858"
              strokeWidth="1.6"
              fill="#EDA882"
              fillOpacity="0.38"
              strokeLinecap="round"
            />
            {/* Mouth corner shadows */}
            <circle cx="44.5" cy="55.5" r="1" fill="#B07060" opacity="0.3" />
            <circle cx="55.5" cy="55.5" r="1" fill="#B07060" opacity="0.3" />
          </g>
        )}

        {/* ── NECK ── */}
        <path d="M 44.5 63 L 43 73 L 57 73 L 55.5 63 Z" fill="#F0BFA0" />
        {/* Neck shadow */}
        <path d="M 44.5 63 L 43 73 L 46 73 L 46.5 63 Z" fill="#E0A888" opacity="0.3" />
        <path d="M 53.5 63 L 53 73 L 57 73 L 55.5 63 Z" fill="#E0A888" opacity="0.3" />

        {/* ── COAT & BODY ── */}
        <BodyGroup>
          {/* Main coat body */}
          <path d="M 11 130 L 16 84 Q 31 73 44 72 L 50 80 L 56 72 Q 69 73 84 84 L 89 130 Z"
            fill="url(#vd-coat)" />
          {/* Coat body side shadows */}
          <path d="M 11 130 L 16 84 Q 28 75 38 73" fill="none" stroke="#D8DCD8" strokeWidth="1.2" />
          <path d="M 62 73 Q 72 75 84 84 L 89 130"  fill="none" stroke="#D8DCD8" strokeWidth="1.2" />

          {/* Left lapel */}
          <path d="M 44 72 L 38 86 L 50 98 Z" fill="#F4F4F4" stroke="#E0E0DC" strokeWidth="0.9" />
          {/* Right lapel */}
          <path d="M 56 72 L 62 86 L 50 98 Z" fill="#F4F4F4" stroke="#E0E0DC" strokeWidth="0.9" />
          {/* Lapel fold line */}
          <line x1="50" y1="80" x2="44" y2="72" stroke="#DCDCDC" strokeWidth="0.6" />
          <line x1="50" y1="80" x2="56" y2="72" stroke="#DCDCDC" strokeWidth="0.6" />

          {/* Center seam */}
          <line x1="50" y1="98" x2="50" y2="130" stroke="#E2E5E2" strokeWidth="1" strokeDasharray="3,3" />

          {/* Left sleeve */}
          <path d="M 16 84 L 8 98 L 10 116 L 22 116 L 24 98 L 30 84 Z"
            fill="#F8F8F6" stroke="#E0E0DC" strokeWidth="0.9" />
          {/* Right sleeve */}
          <path d="M 84 84 L 92 98 L 90 116 L 78 116 L 76 98 L 70 84 Z"
            fill="#F8F8F6" stroke="#E0E0DC" strokeWidth="0.9" />
          {/* Sleeve cuffs */}
          <rect x="10" y="112" width="12" height="4" fill="#EDEDEA" rx="1" />
          <rect x="78" y="112" width="12" height="4" fill="#EDEDEA" rx="1" />

          {/* Cross badge */}
          <rect x="22" y="95" width="15" height="15" fill={color.terra.mid} rx="3.5" />
          <rect x="27.5" y="97.5" width="4" height="10" fill="white" rx="1" />
          <rect x="23.5" y="101" width="12" height="4" fill="white" rx="1" />

          {/* Pocket */}
          <rect x="68" y="108" width="13" height="11" fill="#F0F0EE" rx="2" stroke="#DCDCDA" strokeWidth="0.8" />

          {/* Stethoscope */}
          <path d="M 46.5 79 C 44 87 40 93 38 100 A 5 5 0 0 0 38 107"
            fill="none" stroke="#828A7A" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M 53.5 79 C 56 87 60 93 62 100 A 5 5 0 0 1 62 107"
            fill="none" stroke="#828A7A" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="38" y1="107" x2="62" y2="107" stroke="#828A7A" strokeWidth="1.8" />
          <circle cx="50" cy="111" r="3.5" fill="#5E6858" />
          <circle cx="50" cy="111" r="1.5" fill="#7A8270" />
        </BodyGroup>

        {/* ── THINKING DOTS ── */}
        {state === 'thinking' && (
          <g>
            <ThinkDot cx="40" cy="68" r="2.2" fill={color.sage[400]} $delay="0s" />
            <ThinkDot cx="50" cy="68" r="2.2" fill={color.sage[400]} $delay="0.16s" />
            <ThinkDot cx="60" cy="68" r="2.2" fill={color.sage[400]} $delay="0.32s" />
          </g>
        )}
      </DocSvg>
    </Wrapper>
  );
}

/* ── 사실적 사진 포트레이트 아바타 (드롭인) ──────────────────────
 * public/avatar/medi.png 가 있으면 원형 사진으로 렌더하고, 없으면(404)
 * 위 SVG 아바타로 자동 폴백한다. 모든 기존 호출부가 그대로 동작한다.
 * 상태별 링/글로우: speaking·listening 펄스, emergency 빨강, idle 은은.
 */
const PORTRAIT_SRC = '/avatar/medi.png';

const ringPulse = keyframes`
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.35; }
`;

const Frame = styled.div<{ $size: number }>`
  position: relative;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  flex-shrink: 0;
  animation: ${float} 3.4s ease-in-out infinite;
`;

const Img = styled.img`
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  object-position: center top;
  display: block;
  /* 투명 PNG 뒤로 비치는 원형 배경 — 은은한 세이지 그라디언트로 입체감 */
  background: radial-gradient(circle at 50% 38%, ${color.sage[50]} 0%, ${color.sage[100]} 55%, ${color.sage[200]} 100%);
  position: relative;
  z-index: 1;
`;

function ringColor(state: DoctorState): string {
  if (state === 'emergency') return color.emergency;
  if (state === 'listening') return color.amber.base;
  if (state === 'speaking') return color.sage[500];
  return color.sage[300];
}

const Ring = styled.div<{ $state: DoctorState }>`
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  pointer-events: none;
  z-index: 2;
  border: 3px solid ${({ $state }) => ringColor($state)};
  box-shadow: 0 0 16px 1px ${({ $state }) => ringColor($state)}88;
  opacity: ${({ $state }) => ($state === 'idle' || $state === 'thinking' ? 0.5 : 1)};
  ${({ $state }) =>
    ($state === 'speaking' || $state === 'listening') &&
    css`animation: ${ringPulse} 1.1s ease-in-out infinite;`}
  ${({ $state }) =>
    $state === 'emergency' &&
    css`animation: ${ringPulse} 0.7s ease-in-out infinite;`}
`;

export default function VirtualDoctor(props: VirtualDoctorProps) {
  const [photoOk, setPhotoOk] = useState(true);
  const size = props.size ?? 64;

  // 사진이 없으면 SVG 아바타로 폴백.
  if (!photoOk) return <SvgDoctor {...props} />;

  return (
    <Frame $size={size}>
      <Img
        src={PORTRAIT_SRC}
        alt="AI 의료 도우미 메디"
        draggable={false}
        onError={() => setPhotoOk(false)}
      />
      <Ring $state={props.state} aria-hidden />
    </Frame>
  );
}
