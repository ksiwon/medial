import styled from 'styled-components';
import type { Comparison } from '../api/types';
import { formatClock } from '../positions';
import { pathWord } from '../selectors/story';

// Condition difference → decision difference → outcome difference, in that order
// and never collapsed into a score.
//
// The banner at the top is the important part: the server checks whether the two
// runs actually shared their deck, resources, personas, baseline and engine, and
// says so. A pair that differs in more than the policy is still worth looking at,
// but calling it a controlled comparison would be a false claim about the
// experiment.

const Wrap = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 14px 14px;
`;

const Banner = styled.div<{ $ok: boolean }>`
  border: 1px solid ${(p) => (p.$ok ? '#447a5a' : '#b5853e')};
  background: ${(p) => (p.$ok ? '#edf5f0' : '#fdf3d6')};
  color: ${(p) => (p.$ok ? '#2b4d3a' : '#8c6120')};
  border-radius: 8px;
  padding: 8px 11px;
  font-size: 11.5px;
  line-height: 1.6;
  margin-bottom: 10px;
`;

const Section = styled.section`
  border: 1px solid #cfd6c8;
  border-radius: 8px;
  background: #ffffff;
  padding: 10px 12px;
  margin-bottom: 10px;
`;

const H = styled.div`
  font-size: 11px;
  letter-spacing: 0.04em;
  color: #4c6151;
  text-transform: uppercase;
  margin-bottom: 6px;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 11.5px;
  color: #2b3f30;
  th,
  td {
    text-align: left;
    padding: 3px 6px;
    border-bottom: 1px dotted #e4e8de;
    vertical-align: top;
  }
  th {
    color: #4c6151;
    font-weight: 500;
  }
  td.num {
    font-variant-numeric: tabular-nums;
  }
`;

const Note = styled.div`
  font-size: 10.5px;
  color: #4c6151;
  margin-top: 6px;
  line-height: 1.55;
`;

const Pill = styled.span<{ $tone?: string }>`
  display: inline-block;
  border: 1px solid ${(p) => p.$tone ?? '#cfd6c8'};
  color: ${(p) => p.$tone ?? '#4c6151'};
  border-radius: 999px;
  padding: 0 7px;
  font-size: 10px;
  margin-right: 4px;
`;

const LINEAGE: Record<string, string> = {
  root: '최초 실행',
  rerun: '재실행(같은 초기 상태)',
  fork: '시점 분기',
};

function fmt(value: unknown): string {
  if (value === null || value === undefined) return '없음';
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  return String(value);
}

export default function ComparePanel({ comparison }: { comparison: Comparison }) {
  const ids = comparison.conditionDifference.map((c) => c.attemptId);
  const label = (id: string) =>
    comparison.conditionDifference.find((c) => c.attemptId === id)?.label ?? id;

  return (
    <Wrap>
      <Banner $ok={comparison.controlled}>
        {comparison.controlled ? (
          <>
            <strong>통제 비교</strong> — {comparison.claim}
          </>
        ) : (
          <>
            <strong>통제 비교가 아닙니다</strong> — 정책 말고도 다음 입력이 다릅니다:{' '}
            {comparison.differingInputs.join(', ')}. 결과 차이를 정책 탓으로만 읽으면 안 됩니다.
          </>
        )}
        <div>{comparison.note}</div>
      </Banner>

      <Section>
        <H>1. 조건 차이</H>
        <Table>
          <thead>
            <tr>
              <th>필드</th>
              {ids.map((id) => (
                <th key={id}>{label(id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>계보</td>
              {comparison.conditionDifference.map((c) => (
                <td key={c.attemptId}>
                  {LINEAGE[c.lineage] ?? c.lineage}
                  {c.lineage === 'fork' && c.parentSeq != null && (
                    <div style={{ color: '#4c6151' }}>
                      부모 {c.parentId} 의 사건 {c.parentSeq} 에서 분기
                    </div>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <td>정책 revision</td>
              {comparison.conditionDifference.map((c) => (
                <td key={c.attemptId}>
                  {c.policyLabel}
                  <div style={{ color: '#4c6151' }}>{c.policyId}</div>
                </td>
              ))}
            </tr>
            {/* Computed field by field from the real policy objects, not from the
                free-text change list somebody typed. */}
            {comparison.policyDifference.map((row) => (
              <tr key={row.field}>
                <td>
                  <Pill $tone="#8c6120">다름</Pill>
                  {row.field}
                </td>
                {ids.map((id) => (
                  <td key={id} className="num">
                    {fmt(row.values[id])}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td>deck / 자원</td>
              {comparison.conditionDifference.map((c) => (
                <td key={c.attemptId} style={{ color: '#4c6151' }}>
                  {c.deckId}
                  <br />
                  {c.resourceRevisionId}
                </td>
              ))}
            </tr>
            <tr>
              <td>페르소나 / baseline / 엔진</td>
              {comparison.conditionDifference.map((c) => (
                <td key={c.attemptId} style={{ color: '#4c6151' }}>
                  {c.personaRevisionId}
                  <br />
                  {c.baselineRevisionId}
                  <br />
                  {c.engineVersion} · seed {c.seed} · {c.adapter}
                </td>
              ))}
            </tr>
          </tbody>
        </Table>
        {comparison.policyDifference.length === 0 && (
          <Note>두 시도의 정책 필드가 완전히 같습니다. 조건 차이가 없는 비교입니다.</Note>
        )}
        <Note>
          바꾼 이유(자유 서술)는 각 revision에 따로 저장됩니다. 위 표의 &lsquo;다름&rsquo; 행은
          실제 정책 값을 필드 단위로 비교해 계산한 것입니다.
        </Note>
      </Section>

      <Section>
        <H>2. 결정 차이</H>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${ids.length}, 1fr)`, gap: 10 }}>
          {comparison.decisionDifference.map((run) => (
            <div key={run.attemptId}>
              <div style={{ fontSize: 11, color: '#4c6151', marginBottom: 3 }}>
                {label(run.attemptId)}
              </div>
              {run.steps.length === 0 && <Note>결정 없음</Note>}
              {run.steps.map((step) => (
                <div
                  key={step.decisionId}
                  style={{
                    fontSize: 11.5,
                    padding: '3px 0 3px 8px',
                    borderLeft: '3px solid #447a5a',
                    marginBottom: 4,
                  }}
                >
                  <strong>{formatClock(step.atMs)}</strong> · {step.chosen ?? '선택 없음'}
                  <div style={{ color: '#4c6151' }}>{step.question}</div>
                  <div style={{ color: '#4c6151', fontSize: 10 }}>{step.policyId}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section>
        <H>3. 결과 차이</H>
        <Table>
          <thead>
            <tr>
              <th>지표</th>
              {ids.map((id) => (
                <th key={id}>{label(id)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row
              label="확인 종료 / 미해결"
              ids={ids}
              value={(row) => `${row.resolved} / ${row.unresolved}`}
              comparison={comparison}
            />
            <Row
              label="해결 경로"
              ids={ids}
              value={(row) => row.resolutionPaths.map(pathWord).join(', ') || '없음'}
              comparison={comparison}
            />
            <Row
              label="평균 대기(분, 해결 건만)"
              ids={ids}
              value={(row) => (row.meanWaitMinutesResolvedOnly ?? '—').toString()}
              comparison={comparison}
            />
            <Row
              label="연락 시도"
              ids={ids}
              value={(row) => String(row.contactAttempts)}
              comparison={comparison}
            />
            <Row
              label="이웃이 쓴 시간(분)"
              ids={ids}
              value={(row) => String(row.neighbourMinutes)}
              comparison={comparison}
            />
            <Row
              label="기관 담당자 시간(분)"
              ids={ids}
              value={(row) =>
                `${row.institutionStaffMinutes} (대기 ${row.institutionQueueWaitMinutes})`
              }
              comparison={comparison}
            />
            <Row
              label="정보 공개"
              ids={ids}
              value={(row) =>
                Object.entries(row.disclosure)
                  .map(([cls, v]) => `${cls} ${v.recipientCount}명/${v.fieldCount}항목`)
                  .join(', ') || '없음'
              }
              comparison={comparison}
            />
            <Row
              label="사람별 부담"
              ids={ids}
              value={(row) =>
                Object.entries(row.residentBurden)
                  .map(([who, b]) => `${who} ${b.addedTaskMinutes}분`)
                  .join(', ') || '없음'
              }
              comparison={comparison}
            />
            <Row
              label="이동 지원 (필요→요청→예약→실제)"
              ids={ids}
              value={(row) =>
                `${row.transport.needsRaised}→${row.transport.peopleAsked}→${row.transport.reservationsHeld}→${row.transport.ridesCompleted}` +
                (row.transport.conflictsDetected
                  ? ` · 충돌 ${row.transport.conflictsDetected}`
                  : '')
              }
              comparison={comparison}
            />
            <Row
              label="응급 분류"
              ids={ids}
              value={(row) => String(row.emergencyClassifications)}
              comparison={comparison}
            />
          </tbody>
        </Table>
        <Note>
          이동 지원은 &lsquo;이동이 필요했던 횟수&rsquo;를 분모로 두고 요청·예약·실제 이용을 따로
          셉니다. 도착은 이동 필요의 해결이며 진료 결과가 아닙니다.
        </Note>
        <Note>
          응급 분류 0건은 &lsquo;응급이 아니라고 판정했다&rsquo;는 뜻이 아니라 응급을 시사하는
          관측이 없었다는 뜻입니다. 평균 점수로 우승자를 고르지 않습니다.
        </Note>
      </Section>
    </Wrap>
  );
}

function Row({
  label,
  ids,
  value,
  comparison,
}: {
  label: string;
  ids: string[];
  value: (row: Comparison['outcomeDifference'][number]) => string;
  comparison: Comparison;
}) {
  const cells = ids.map((id) => {
    const row = comparison.outcomeDifference.find((o) => o.attemptId === id);
    return row ? value(row) : '—';
  });
  const differs = new Set(cells).size > 1;
  return (
    <tr>
      <td>
        {differs && <Pill $tone="#8c6120">다름</Pill>}
        {label}
      </td>
      {cells.map((cell, i) => (
        <td key={ids[i]} className="num">
          {cell}
        </td>
      ))}
    </tr>
  );
}
