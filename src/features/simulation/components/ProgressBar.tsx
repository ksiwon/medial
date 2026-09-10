import styled from 'styled-components';
import { RUNNING_STATUSES, STATUS_LABELS, type SessionDetail } from '../api/iteration';
import { Button, Select, Sub, Tag, versionName } from '../ui/primitives';
import { colour, font } from '../ui/theme';

// The 44 px strip under the header: where the loop is, which version is being
// read, and the one control that applies to the current state.
//
// It used to be a row of buttons - start, pause, resume, cancel, plus one chip
// per generation. Two changes, both from doc 15 section 3. The four loop stages
// are now *read-only progress*: they say where the server is, and pressing them
// does nothing because they were never actions. And the versions are one
// select, so adding a fifth generation does not add a fifth button.

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
`;

const Steps = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
`;

const Step = styled.span<{ $state: 'done' | 'current' | 'future' }>`
  white-space: nowrap;
  color: ${(p) =>
    p.$state === 'current' ? colour.text : p.$state === 'done' ? colour.primary : colour.unknown};
  font-weight: ${(p) => (p.$state === 'current' ? 600 : 400)};
`;

const Arrow = styled.span`
  color: ${colour.border};
`;

const Spacer = styled.span`
  flex: 1;
`;

/** The loop's four stages, in the order the engine runs them. Read-only. */
const STEPS: { label: string; statuses: string[] }[] = [
  { label: '하루 실행', statuses: ['running_cycle', 'evaluating_candidates'] },
  { label: '주민 리뷰', statuses: ['collecting_reviews'] },
  { label: '개선안', statuses: ['synthesizing', 'proposing_changes', 'validating_changes'] },
  { label: '다음 실행', statuses: ['selecting_next'] },
];

interface Props {
  detail: SessionDetail;
  /** The version the screens are reading, which may not be the one the loop is
   *  processing. */
  viewGenerationId: string | null;
  busy: boolean;
  onSelectGeneration: (id: string) => void;
  onCommand: (name: string) => void;
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

  const activeStep = STEPS.findIndex((step) => step.statuses.includes(session.status));

  return (
    <Bar>
      <Select
        aria-label="관찰 중인 버전"
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

      {behind && (
        <Sub as="span" style={{ whiteSpace: 'nowrap' }}>
          읽는 중 v{viewing!.index} · 처리 중 v{processing!.index}
        </Sub>
      )}

      <Steps aria-label="반복 진행 상태">
        {STEPS.map((step, index) => (
          <span key={step.label} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {index > 0 && <Arrow>→</Arrow>}
            <Step
              $state={
                activeStep < 0
                  ? 'future'
                  : index < activeStep
                    ? 'done'
                    : index === activeStep
                      ? 'current'
                      : 'future'
              }
            >
              {step.label}
            </Step>
          </span>
        ))}
      </Steps>

      <Spacer />

      <Tag $kind={adapterMode === 'rule' ? 'unknown' : 'neutral'}>
        {adapterMode === 'rule'
          ? '규칙 어댑터 · 모델 호출 없음'
          : `${adapterMode} · 모델 호출 ${budget.callsUsed}${
              budget.callBudget ? `/${budget.callBudget}` : ' (상한 없음)'
            }`}
      </Tag>

      <Tag
        $kind={
          running
            ? 'neutral'
            : session.status === 'needs_decision'
              ? 'warn'
              : session.status === 'failed'
                ? 'error'
                : 'unknown'
        }
      >
        {running ? '실행 중' : STATUS_LABELS[session.status]}
      </Tag>

      {stopReasonText && !running && (
        <Sub as="span" style={{ whiteSpace: 'nowrap' }}>
          {stopReasonText}
        </Sub>
      )}

      {/* One control, chosen by the state. Playback of the recording is a
          different thing with a different control, down on the map. */}
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
    </Bar>
  );
}
