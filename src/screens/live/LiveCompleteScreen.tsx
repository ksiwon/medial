// src/screens/live/LiveCompleteScreen.tsx — SCREEN 06 (Complete + auto-reset)
import { useEffect, useState } from 'react';
import styled, { keyframes } from 'styled-components';
import { color, font } from '../../styles/tokens';
import { useAppStore } from '../../store/useAppStore';
import { useWebSocket } from '../../hooks/useWebSocket';

const RESET_SECONDS = 10;

const checkDraw = keyframes`
  from { stroke-dashoffset: 40; }
  to   { stroke-dashoffset: 0; }
`;

const circleIn = keyframes`
  from { transform: scale(0.5); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
`;

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const Screen = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: ${color.cream.light};
  padding: 24px 20px;
  gap: 18px;
`;

const CheckCircle = styled.div`
  width: 80px; height: 80px;
  border-radius: 50%;
  background: ${color.sage[600]};
  display: flex; align-items: center; justify-content: center;
  animation: ${circleIn} 0.45s cubic-bezier(0.34,1.56,0.64,1) both;
  box-shadow: 0 4px 20px rgba(54,99,72,0.3);
`;

const Check = styled.path`
  stroke-dasharray: 40;
  stroke-dashoffset: 0;
  animation: ${checkDraw} 0.4s ease 0.35s both;
`;

const Heading = styled.div`
  font-size: 20px;
  font-weight: ${font.weight.bold};
  color: ${color.sage[800]};
  text-align: center;
  line-height: 1.3;
  animation: ${fadeUp} 0.4s ease 0.4s both;
`;

const Sub = styled.div`
  font-size: 13px;
  color: ${color.ink[500]};
  text-align: center;
  line-height: 1.65;
  animation: ${fadeUp} 0.4s ease 0.5s both;
`;

const CountDown = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  animation: ${fadeUp} 0.4s ease 0.6s both;
`;

const CountNum = styled.div`
  font-size: 32px;
  font-weight: ${font.weight.bold};
  color: ${color.sage[600]};
  font-family: ${font.mono};
  line-height: 1;
`;

const CountLabel = styled.div`
  font-size: 11px;
  color: ${color.ink[300]};
  letter-spacing: 0.06em;
  text-transform: uppercase;
`;

const ProgressRing = styled.svg`
  position: absolute;
  top: 0; left: 0;
  transform: rotate(-90deg);
`;

const CountWrap = styled.div`
  position: relative;
  width: 72px; height: 72px;
  display: flex; align-items: center; justify-content: center;
`;

const QrLabel = styled.div`
  font-size: 10.5px;
  color: ${color.ink[300]};
  text-align: center;
  line-height: 1.5;
  padding: 10px 16px;
  background: ${color.cream.base};
  border-radius: 8px;
  border: 1px solid ${color.cream.dark};
  animation: ${fadeUp} 0.4s ease 0.7s both;
`;

const ResetBtn = styled.button`
  font-size: 11.5px;
  color: ${color.sage[500]};
  text-decoration: underline;
  text-underline-offset: 2px;
  animation: ${fadeUp} 0.4s ease 0.8s both;
`;

export default function LiveCompleteScreen() {
  const [remaining, setRemaining] = useState(RESET_SECONDS);
  const { resetLiveSession } = useAppStore();
  const { reset } = useWebSocket();

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(interval);
          handleReset();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReset = () => {
    reset();
    resetLiveSession();
    useAppStore.getState().setLiveScreen('live-idle');
  };

  const pct = (remaining / RESET_SECONDS) * 100;
  const r = 32;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct / 100);

  return (
    <Screen>
      <CheckCircle>
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <Check
            d="M 8 20 L 17 29 L 32 12"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </CheckCircle>

      <Heading>전달 완료</Heading>

      <Sub>
        문진 내용이 보건소로 전송됐어요.<br />
        보건소에서 연락이 올 거예요.<br />
        <strong style={{ color: color.sage[700] }}>불편하시면 061-860-8000으로 전화하세요.</strong>
      </Sub>

      <CountDown>
        <CountWrap>
          <ProgressRing width="72" height="72" viewBox="0 0 72 72">
            <circle cx="36" cy="36" r={r} fill="none" stroke={color.cream.dark} strokeWidth="3" />
            <circle
              cx="36" cy="36" r={r} fill="none"
              stroke={color.sage[400]} strokeWidth="3"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1s linear' }}
            />
          </ProgressRing>
          <CountNum>{remaining}</CountNum>
        </CountWrap>
        <CountLabel>초 후 초기화</CountLabel>
      </CountDown>

      <QrLabel>
        <strong style={{ color: color.sage[700] }}>개인정보 보호</strong><br />
        말씀하신 음성은 저장되지 않았어요.<br />
        문진 내용은 보건소 의사만 보실 수 있어요.<br />
        <span style={{ fontSize: '9.5px' }}>
          연구 웹사이트: kaist.ac.kr/medial · KAISTIRB-2026-56
        </span>
      </QrLabel>

      <ResetBtn onClick={handleReset}>지금 바로 초기화</ResetBtn>
    </Screen>
  );
}
