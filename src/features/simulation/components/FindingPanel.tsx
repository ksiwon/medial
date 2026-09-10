import { useState } from 'react';
import styled from 'styled-components';
import type { DesignFinding } from '../api/types';

// The loop this tool exists for: compare two attempts, write down what the
// difference was and what it means, then turn that into the next revision and
// the next attempt. Without this the tool produces a pair of one-off runs and
// the reasoning between them lives only in the researcher's head.

const Box = styled.div`
  border: 1px solid #cfd6c8;
  border-radius: 8px;
  background: #ffffff;
  padding: 10px 12px;
  margin-top: 10px;
`;

const H = styled.div`
  font-size: 11px;
  letter-spacing: 0.04em;
  color: #4c6151;
  text-transform: uppercase;
  margin: 10px 0 4px;
  &:first-child {
    margin-top: 0;
  }
`;

const Text = styled.textarea`
  border: 1px solid #cfd6c8;
  border-radius: 5px;
  padding: 5px 6px;
  font-size: 11.5px;
  width: 100%;
  box-sizing: border-box;
  min-height: 42px;
  resize: vertical;
`;

const Input = styled.input`
  border: 1px solid #cfd6c8;
  border-radius: 5px;
  padding: 4px 6px;
  font-size: 11.5px;
  width: 100%;
  box-sizing: border-box;
`;

const Button = styled.button<{ $primary?: boolean }>`
  border: 1px solid ${(p) => (p.$primary ? '#2b4d3a' : '#cfd6c8')};
  background: ${(p) => (p.$primary ? '#2b4d3a' : '#ffffff')};
  color: ${(p) => (p.$primary ? '#ffffff' : '#2b3f30')};
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 11.5px;
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

const Card = styled.div<{ $closed: boolean }>`
  border: 1px solid ${(p) => (p.$closed ? '#447a5a' : '#cfd6c8')};
  background: ${(p) => (p.$closed ? '#f3f8f4' : '#fbfcf8')};
  border-radius: 7px;
  padding: 8px 10px;
  margin-top: 6px;
  font-size: 11.5px;
  color: #2b3f30;
  line-height: 1.55;
`;

const Line = styled.div`
  font-size: 10.5px;
  color: #4c6151;
`;

interface Props {
  findings: DesignFinding[];
  compareIds: string[];
  coreItem: string;
  busy: boolean;
  onCreate: (body: {
    coreItem: string;
    observation: string;
    interpretation: string;
    nextChange: string;
  }) => void;
  onApply: (finding: DesignFinding) => void;
}

export default function FindingPanel({
  findings,
  compareIds,
  coreItem,
  busy,
  onCreate,
  onApply,
}: Props) {
  const [core, setCore] = useState(coreItem);
  const [observation, setObservation] = useState('');
  const [interpretation, setInterpretation] = useState('');
  const [nextChange, setNextChange] = useState('');

  const ready =
    compareIds.length >= 2 &&
    observation.trim() &&
    interpretation.trim() &&
    nextChange.trim() &&
    !busy;

  return (
    <Box>
      <H>이 비교에서 무엇을 발견했는가</H>
      <Line style={{ marginBottom: 5 }}>
        관찰(무엇이 달랐나) · 해석(왜 그런가) · 다음 변경(그래서 무엇을 바꿀 것인가)을 나눠
        적습니다. 저장하면 다음 revision과 시도로 이어집니다.
      </Line>

      <Line>core item</Line>
      <Input value={core} onChange={(e) => setCore(e.target.value)} />

      <Line style={{ marginTop: 6 }}>관찰 — 조건 차이가 만든 결과 차이</Line>
      <Text
        value={observation}
        placeholder="예: 이장 우선은 9분 만에 확인이 끝났지만 이웃 1명의 일과를 19분 중단시켰다"
        onChange={(e) => setObservation(e.target.value)}
      />

      <Line style={{ marginTop: 6 }}>해석 — 왜 그렇게 되었는가</Line>
      <Text
        value={interpretation}
        placeholder="예: 낮에 움직일 수 있는 사람이 사실상 이장 한 명이라 대기와 부담이 같은 사람에게 몰린다"
        onChange={(e) => setInterpretation(e.target.value)}
      />

      <Line style={{ marginTop: 6 }}>다음 변경 — 아이템을 어떻게 구체화할 것인가</Line>
      <Text
        value={nextChange}
        placeholder="예: 이웃 연락 상한을 0으로 두고 기관 인계 기한을 60분으로 걸어 본다"
        onChange={(e) => setNextChange(e.target.value)}
      />

      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          $primary
          disabled={!ready}
          onClick={() =>
            onCreate({
              coreItem: core,
              observation: observation.trim(),
              interpretation: interpretation.trim(),
              nextChange: nextChange.trim(),
            })
          }
        >
          발견 기록
        </Button>
      </div>
      {compareIds.length < 2 && (
        <Line style={{ marginTop: 4 }}>비교 중인 시도가 두 개 이상이어야 기록할 수 있습니다.</Line>
      )}

      <H>기록된 발견 {findings.length}건</H>
      {findings.length === 0 && <Line>아직 없습니다.</Line>}
      {[...findings].reverse().map((finding) => (
        <Card key={finding.id} $closed={Boolean(finding.resultingAttemptId)}>
          <div>
            <strong>{finding.coreItem}</strong>
          </div>
          <div>관찰 · {finding.observation}</div>
          <div>해석 · {finding.interpretation}</div>
          <div>다음 · {finding.nextChange}</div>
          <Line style={{ marginTop: 4 }}>
            비교 {finding.comparedAttemptIds.join(' / ')} · 기준 정책 {finding.fromPolicyId}
          </Line>
          {finding.resultingAttemptId ? (
            <Line>
              → revision {finding.resultingPolicyId} · 시도 {finding.resultingAttemptId} 로
              이어졌습니다.
            </Line>
          ) : (
            <div style={{ marginTop: 5 }}>
              <Button
                disabled={busy || compareIds.length === 0}
                onClick={() => onApply(finding)}
              >
                이 발견으로 다음 revision 만들기
              </Button>
              <Line style={{ marginTop: 3 }}>
                실행 탭의 정책 편집기가 이 발견에 연결된 상태로 열립니다. 거기서 고른 조건이 새
                revision이 되고, 이 발견에 그 결과가 기록됩니다.
              </Line>
            </div>
          )}
        </Card>
      ))}
    </Box>
  );
}
