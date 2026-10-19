import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import styled, { keyframes } from 'styled-components';
import { STAGE_API, padAddress } from '../stage/protocol';
import { night, radius } from '../ui/theme';

// The wall before a tablet is paired: a code to scan. The visitor (or whoever opens the
// exhibition) points the iPad's camera at it, the page that opens is the tablet's, and the
// wall goes on to its waiting screen by itself the moment the tablet says it is there.
// The code carries a token that is new every run (api/stage.py), so only the tablet that
// scanned it can drive the exhibition.

const fade = keyframes`0%, 100% { opacity: 0.5; } 50% { opacity: 1; }`;

const Stage = styled.div`
  flex: 1;
  min-height: 0;
  display: grid;
  place-items: center;
  background: ${night.deep};
  color: ${night.ink};
  > div { display: flex; flex-direction: column; align-items: center; gap: 3vh; text-align: center; }
  strong { font-size: clamp(40px, 4.4vw, 160px); font-weight: 800; letter-spacing: -0.04em; line-height: 1.1; }
  p { margin: 0; font-size: clamp(20px, 1.8vw, 68px); line-height: 1.5; color: ${night.mute}; word-break: keep-all; }
  code { font-family: inherit; font-size: clamp(16px, 1.3vw, 52px); font-weight: 700; color: ${night.faint}; word-break: break-all; }
  small { font-size: clamp(16px, 1.3vw, 52px); font-weight: 700; color: ${night.accent}; animation: ${fade} 2.4s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { small { animation: none; } }
`;

/** White, quiet-zone and all: a code on a dark screen is not read by a camera that expects dark on light. */
const Code = styled.div`
  padding: clamp(16px, 1.6vw, 56px);
  border-radius: ${radius.card};
  background: ${night.white};
  line-height: 0;
  > img { width: clamp(240px, 22vw, 840px); height: auto; image-rendering: pixelated; }
`;

interface Pairing { token: string; addresses: string[] }

export default function PairScreen() {
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picture, setPicture] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${STAGE_API}/pairing`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((p: Pairing) => { if (live) setPairing(p); })
      .catch((e: Error) => { if (live) setProblem(e.message); });
    return () => { live = false; };
  }, []);

  // The address the tablet is sent to: this machine as the network knows it, on the page's own port.
  const address = pairing && pairing.addresses.length > 0
    ? padAddress(`http://${pairing.addresses[0]}:${window.location.port || 80}`, pairing.token)
    : null;

  useEffect(() => {
    if (!address) { setPicture(null); return; }
    let live = true;
    QRCode.toDataURL(address, { margin: 0, errorCorrectionLevel: 'M', scale: 12 })
      .then((url) => { if (live) setPicture(url); })
      .catch(() => { if (live) setProblem('QR 코드를 그리지 못했습니다'); });
    return () => { live = false; };
  }, [address]);

  return (
    <Stage aria-label="태블릿 연결">
      <div>
        <strong>태블릿을 연결해 주세요</strong>
        {address && picture ? (
          <>
            <Code><img src={picture} alt="태블릿 연결 QR 코드" /></Code>
            <p>iPad 카메라로 이 코드를 비춰 열린 페이지에서 <b>연결하기</b>를 눌러 주세요.</p>
            <code>{address.replace(/&t=.*$/, '')}</code>
            <small>연결되면 이 화면이 바뀝니다</small>
          </>
        ) : pairing && pairing.addresses.length === 0 ? (
          <p>이 기계의 네트워크 주소를 찾지 못했습니다.<br />와이파이나 랜선이 연결됐는지 확인해 주세요.</p>
        ) : problem ? (
          <p>연결 정보를 가져오지 못했습니다 ({problem}).<br />서버가 떠 있는지 확인해 주세요.</p>
        ) : (
          <p>연결 정보를 만드는 중…</p>
        )}
      </div>
    </Stage>
  );
}
