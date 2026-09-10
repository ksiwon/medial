import styled from 'styled-components';
import type { GenerationComparison } from '../api/iteration';
import { personName } from '../selectors/story';
import {
  Card,
  Note,
  Panel,
  PanelTitle,
  Row,
  Scroll,
  Table,
  Tag,
  showDelta,
  showValue,
} from './iterationUi';

// v0 / v1 / v2 side by side, including the branches that lost.
//
// The comparison is computed, not narrated: the banner reports the server's
// `controlled` flag, which is false whenever anything other than the policy
// differs. A screen that said "same day, policy changed" without checking would
// be the single most misleading thing this tool could show.

const Warn = styled.div<{ $ok: boolean }>`
  border: 1px solid ${(p) => (p.$ok ? '#9fb098' : '#b5853e')};
  background: ${(p) => (p.$ok ? '#edf5f0' : '#fdf3d6')};
  color: ${(p) => (p.$ok ? '#2b4d3a' : '#6b4c14')};
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 11px;
  line-height: 1.6;
`;

interface Props {
  comparison: GenerationComparison;
  viewGenerationId: string | null;
  onSelect: (id: string) => void;
}

export default function GenerationPanel({ comparison, viewGenerationId, onSelect }: Props) {
  const generations = [...comparison.generations].sort(
    (a, b) => a.index - b.index || a.id.localeCompare(b.id),
  );
  const criteria = comparison.criteria.criteria;
  const controlled = generations
    .filter((g) => g.comparedToParent)
    .every((g) => g.comparedToParent?.controlled);

  return (
    <Panel style={{ flex: 1, minHeight: 0 }}>
      <PanelTitle>
        5 · 세대 비교
        <Tag $kind="unknown">기준 revision · {comparison.criteria.label}</Tag>
      </PanelTitle>

      <Warn $ok={controlled}>
        {controlled
          ? '모든 세대가 같은 초기 하루·주민 기억·자원·외생 사건에서 실행됐고 정책만 다릅니다. 초기 snapshot 해시: '
          : '정책 외의 입력도 달라졌습니다. 통제 비교가 아닙니다: '}
        <code>{comparison.initialSnapshotHash.slice(0, 12)}</code>
        {!controlled &&
          ` (${generations
            .flatMap((g) => g.comparedToParent?.differingInputs ?? [])
            .join(', ')})`}
      </Warn>
      <Note>{comparison.note}</Note>

      <Scroll>
        <Table>
          <thead>
            <tr>
              <th>세대</th>
              <th>계보</th>
              {criteria.map((criterion) => (
                <th key={criterion.key} style={{ textAlign: 'right' }}>
                  {criterion.label}
                  <div style={{ fontWeight: 400, color: '#8b9789' }}>
                    {criterion.direction === 'lower_better' ? '낮을수록' : '높을수록'}
                  </div>
                </th>
              ))}
              <th style={{ textAlign: 'right' }}>모의 리뷰</th>
            </tr>
          </thead>
          <tbody>
            {generations.map((generation) => (
              <tr
                key={generation.id}
                onClick={() => onSelect(generation.id)}
                style={{
                  cursor: 'pointer',
                  background: generation.id === viewGenerationId ? '#edf5f0' : undefined,
                  opacity: generation.outcome === 'blocked' ? 0.72 : 1,
                }}
              >
                <td>
                  <strong>v{generation.index}</strong> {generation.label}
                  {generation.selectedBy === 'auto' && <Tag> 자동 선택</Tag>}
                  {generation.selectedBy === 'designer' && <Tag $kind="minority"> 디자이너 선택</Tag>}
                  {generation.outcome === 'blocked' && <Tag $kind="unknown"> 분기(보존)</Tag>}
                  {generation.requiredViolations.length > 0 && (
                    <Note style={{ color: '#8b3a2c' }}>
                      필수 조건 위반: {generation.requiredViolations.join('; ')}
                    </Note>
                  )}
                  {generation.selectionReason && <Note>{generation.selectionReason}</Note>}
                </td>
                <td>{generation.parentGenerationId ? '← 상위 세대' : '최초'}</td>
                {criteria.map((criterion) => (
                  <td className="num" key={criterion.key}>
                    {showValue(generation.vector[criterion.key])}
                  </td>
                ))}
                <td className="num">
                  <span title="긍정 / 혼합 / 부정 / 미경험">
                    {generation.reviewCounts.positive ?? 0} / {generation.reviewCounts.mixed ?? 0} /{' '}
                    {generation.reviewCounts.negative ?? 0} /{' '}
                    {generation.reviewCounts.noExperience ?? 0}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <Note>
          <code>unknown</code> 은 0이 아니라 &quot;이 실행이 그 값을 확정하지 못했다&quot;는
          뜻입니다. unknown이 있는 차원은 우열의 근거로 쓰지 않습니다. 모의 리뷰 수는 합산 점수가
          아니며 실제 주민 만족도가 아닙니다.
        </Note>

        {generations
          .filter((g) => g.comparedToParent)
          .map((generation) => {
            const compared = generation.comparedToParent!;
            const changed = compared.perActor.filter(
              (row) => row.deltaMinutes !== 0 || row.deltaContacts !== 0,
            );
            return (
              <Card key={`${generation.id}-diff`}>
                <Row>
                  <strong style={{ fontSize: 11.5 }}>
                    v{generation.index} · {generation.label}
                  </strong>
                  <Tag $kind={compared.controlled ? 'positive' : 'warn'}>
                    {compared.controlled ? '통제 비교' : '통제 비교 아님'}
                  </Tag>
                </Row>
                <Note>{compared.claim}</Note>
                {compared.policyDifference.length > 0 && (
                  <Table>
                    <thead>
                      <tr>
                        <th>바뀐 조건</th>
                        <th colSpan={2}>값</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compared.policyDifference.map((row) => (
                        <tr key={row.field}>
                          <td>
                            <code>{row.field}</code>
                          </td>
                          {Object.entries(row.values).map(([attemptId, value]) => (
                            <td className="num" key={attemptId}>
                              {String(value)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
                <Note>
                  <strong>사람별 득실</strong> — 전체 합계는 한 사람이 크게 손해 본 경우를 감춥니다.
                </Note>
                {changed.length === 0 ? (
                  <Note>이 후보에서 개인별로 달라진 시간·연락 기록이 없습니다.</Note>
                ) : (
                  <Table>
                    <thead>
                      <tr>
                        <th>사람</th>
                        <th style={{ textAlign: 'right' }}>추가 시간(분)</th>
                        <th style={{ textAlign: 'right' }}>변화</th>
                        <th style={{ textAlign: 'right' }}>받은 연락</th>
                      </tr>
                    </thead>
                    <tbody>
                      {changed.map((row) => (
                        <tr key={row.actorId}>
                          <td>{personName(row.actorId)}</td>
                          <td className="num">
                            {row.beforeMinutes.toFixed(1)} → {row.afterMinutes.toFixed(1)}
                          </td>
                          <td
                            className="num"
                            style={{ color: row.deltaMinutes > 0 ? '#8b3a2c' : '#2b5d3a' }}
                          >
                            {showDelta(row.deltaMinutes)}
                          </td>
                          <td className="num">
                            {row.beforeContacts} → {row.afterContacts}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
            );
          })}
      </Scroll>
    </Panel>
  );
}
