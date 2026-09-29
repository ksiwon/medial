import styled from 'styled-components';
import { RUNNING_STATUSES, STATUS_LABELS, type SessionDetail } from '../api/iteration';
import { Button, Hint, Select, Sub, Tag, versionName } from '../ui/primitives';
import { colour, font } from '../ui/theme';

// The 44 px strip under the header: which version is being read, where the
// loop is, and the one control that applies to the current state.
//
// The loop's own stages used to be printed here a second time, as 하루 실행 →
// 주민 리뷰 → 개선안 → 다음 실행, directly under the three screens that are the
// same loop - two progress lines with different names for the same steps
// (2026-09-29). The screens are the steps; this strip says only the state,
// in one tag. How the record was made (adapter, calls) is audit detail and sits
// behind the tag's "?" unless a run is live and spending calls right now.

const Bar = styled.div`
  height: 44px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px;
  border-bottom: 1px solid ${colour.border};
  background: ${colour.surface};
  font-size: ${font.small};
  color: ${colour.secondary};
  overflow: hidden;

  > * {
    flex: none;
  }
`;

const Spacer = styled.span`
  flex: 1;
`;

interface Props {
  detail: SessionDetail;
  /** The version the screens are reading, which may not be the one the loop is
   *  processing. */
  viewGenerationId: string | null;
  busy: boolean;
  onSelectGeneration: (id: string) => void;
  /** Start, pause, resume, cancel. Absent in the sim version, which runs
   *  nothing: the bar then only says where the recording got to. */
  onCommand?: (name: string) => void;
}

export default function ProgressBar({
  detail,
  viewGenerationId,
  busy,
  onSelectGeneration,
  onCommand,
}: Props) {
  const { session, running, stopReasonText, adapterMode, budget } = detail;
  const generations = [...detail.generations].sort((a, b) => a.index - b.index);
  const viewing = generations.find((g) => g.id === viewGenerationId) ?? null;
  const processing = generations.find((g) => g.index === session.currentGenerationIndex) ?? null;
  const behind = viewing && processing && viewing.id !== processing.id;

  const calls = adapterMode === 'rule'
    ? '규칙으로 계산 · 모델 호출 없음'
    : `${adapterMode} · 모델 호출 ${budget.callsUsed}${
        budget.callBudget ? `/${budget.callBudget}` : ' (상한 없음)'
      }회`;

  return (
    <Bar>
      <Select
        aria-label="읽는 버전"
        title="읽는 버전 — 사례와 서비스 경험과 주민 평가가 이 버전을 보여 줍니다"
        style={{ minHeight: 30, fontSize: font.small, padding: '3px 8px', maxWidth: 220 }}
        value={viewGenerationId ?? ''}
        onChange={(e) => onSelectGeneration(e.target.value)}
      >
        {generations.map((generation) => (
          <option key={generation.id} value={generation.id}>
            {versionName(generation.index, generation.label)}
            {generation.outcome === 'blocked' ? ' (분기)' : ''}
          </option>
        ))}
      </Select>

      {/* Only while the loop is moving is "processing" a fact worth saying;
          a finished record that is being read at v0 is just the select. */}
      {behind && running && (
        <Sub as="span" style={{ whiteSpace: 'nowrap' }}>
          읽는 중 v{viewing!.index} · 처리 중 v{processing!.index}
        </Sub>
      )}

      <Spacer />

      {running && <Tag $kind="neutral">{calls}</Tag>}

      <Tag
        $kind={
          running ? 'neutral' : session.status === 'failed' ? 'error' : 'unknown'
        }
      >
        {running ? '실행 중' : STATUS_LABELS[session.status]}
      </Tag>

      {!running && (
        <Hint label="이 기록">
          {calls}.{stopReasonText ? ` ${stopReasonText}` : ''}
        </Hint>
      )}

      {/* One control, chosen by the state. Playback of the recording is a
          different thing with a different control, down on the map. */}
      {onCommand && (
        <>
          {session.status === 'created' && (
            <Button
              $primary
              style={{ minHeight: 30, padding: '2px 12px', fontSize: font.small }}
              disabled={busy}
              onClick={() => onCommand('start')}
            >
              실행 시작
            </Button>
          )}
          {RUNNING_STATUSES.includes(session.status) && running && (
            <Button
              style={{ minHeight: 30, padding: '2px 12px', fontSize: font.small }}
              disabled={busy}
              onClick={() => onCommand('pause')}
            >
              실행 일시정지
            </Button>
          )}
          {session.status === 'paused' && (
            <Button
              $primary
              style={{ minHeight: 30, padding: '2px 12px', fontSize: font.small }}
              disabled={busy}
              onClick={() => onCommand('resume')}
            >
              실행 재개
            </Button>
          )}
          {(running || session.status === 'paused') && (
            <Button
              style={{ minHeight: 30, padding: '2px 12px', fontSize: font.small }}
              disabled={busy}
              onClick={() => onCommand('cancel')}
            >
              실행 중지
            </Button>
          )}
        </>
      )}
    </Bar>
  );
}
