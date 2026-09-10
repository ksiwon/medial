import { useMemo, useState } from 'react';
import styled from 'styled-components';
import type { AttemptDetail, Catalog, PolicyField } from '../api/types';
import { formatClock } from '../positions';

// The policy editor replaces the single hard-coded "set helperContactCap to 0"
// button. The form is built from ``catalog.policyFields``, which the server
// derives from the same PolicyParams model the engine reads - so a condition
// cannot appear here unless the engine honours it, and an out-of-range value is
// refused by the API rather than quietly stored.
//
// It also makes the rerun/fork distinction explicit, because they answer
// different questions: rerun asks "what if the day had run under this policy
// instead", fork asks "what if we had changed our mind at 15:20".

const Backdrop = styled.div`
  position: absolute;
  inset: 0;
  background: rgba(20, 35, 22, 0.28);
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const Card = styled.div`
  background: #ffffff;
  border: 1px solid #9fb098;
  border-radius: 10px;
  width: min(560px, 100%);
  max-height: 100%;
  overflow-y: auto;
  padding: 14px 16px;
  box-shadow: 0 12px 32px rgba(20, 35, 22, 0.24);
`;

const Title = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: #16241a;
`;

const H = styled.div`
  font-size: 11px;
  letter-spacing: 0.04em;
  color: #4c6151;
  text-transform: uppercase;
  margin: 12px 0 5px;
`;

const Row = styled.label`
  display: grid;
  grid-template-columns: 1fr 96px;
  gap: 8px;
  align-items: center;
  font-size: 11.5px;
  color: #2b3f30;
  padding: 3px 0;
  border-bottom: 1px dotted #e4e8de;
`;

const Hint = styled.div`
  font-size: 10.5px;
  color: #4c6151;
  line-height: 1.5;
`;

const Changed = styled.span`
  color: #8c6120;
  font-size: 10px;
  margin-left: 5px;
`;

const Input = styled.input`
  border: 1px solid #cfd6c8;
  border-radius: 5px;
  padding: 3px 6px;
  font-size: 11.5px;
  width: 100%;
  box-sizing: border-box;
`;

const Select = styled.select`
  border: 1px solid #cfd6c8;
  border-radius: 5px;
  padding: 3px 6px;
  font-size: 11.5px;
  width: 100%;
`;

const Text = styled.textarea`
  border: 1px solid #cfd6c8;
  border-radius: 5px;
  padding: 5px 6px;
  font-size: 11.5px;
  width: 100%;
  box-sizing: border-box;
  min-height: 46px;
  resize: vertical;
`;

const Mode = styled.button<{ $active: boolean }>`
  border: 1px solid ${(p) => (p.$active ? '#447a5a' : '#cfd6c8')};
  background: ${(p) => (p.$active ? '#edf5f0' : '#ffffff')};
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 11.5px;
  cursor: pointer;
  color: #2b3f30;
  text-align: left;
  flex: 1;
`;

const Actions = styled.div`
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
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

interface Props {
  detail: AttemptDetail;
  catalog: Catalog;
  cursorSeq: number;
  /** Clock the cursor sits on, used only to label the fork point. */
  cursorClockMs: number;
  busy: boolean;
  onRerun: (edit: { reason: string; contactStrategy?: string; params: Record<string, unknown> }) => void;
  onFork: (
    atSeq: number,
    edit: { reason: string; contactStrategy?: string; params: Record<string, unknown> },
  ) => void;
  onClose: () => void;
}

export default function PolicyEditor({
  detail,
  catalog,
  cursorSeq,
  cursorClockMs,
  busy,
  onRerun,
  onFork,
  onClose,
}: Props) {
  const fields = catalog.policyFields.fields;
  const [mode, setMode] = useState<'rerun' | 'fork'>('rerun');
  const [strategy, setStrategy] = useState(detail.policy.contactStrategy);
  const [reason, setReason] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, detail.policy.params[f.name] ?? f.default])),
  );

  const changed = useMemo(() => {
    const rows: string[] = [];
    if (strategy !== detail.policy.contactStrategy) {
      rows.push(`contactStrategy ${detail.policy.contactStrategy} → ${strategy}`);
    }
    for (const field of fields) {
      const before = detail.policy.params[field.name] ?? field.default;
      if (String(values[field.name]) !== String(before)) {
        rows.push(`${field.name} ${format(before)} → ${format(values[field.name])}`);
      }
    }
    return rows;
  }, [values, strategy, fields, detail.policy]);

  const params = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      const before = detail.policy.params[field.name] ?? field.default;
      if (String(values[field.name]) !== String(before)) out[field.name] = values[field.name];
    }
    return out;
  }, [values, fields, detail.policy]);

  const canSubmit = reason.trim().length > 0 && changed.length > 0 && !busy;
  const forkable = cursorSeq >= 1;

  const submit = () => {
    const edit = {
      reason: reason.trim(),
      ...(strategy === detail.policy.contactStrategy ? {} : { contactStrategy: strategy }),
      params,
    };
    if (mode === 'fork') onFork(cursorSeq, edit);
    else onRerun(edit);
  };

  return (
    <Backdrop onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()}>
        <Title>정책 조건 편집</Title>
        <Hint style={{ marginTop: 3 }}>
          기준 revision: {detail.policy.label} ({detail.policy.id})
        </Hint>

        <H>무엇을 만들 것인가</H>
        <div style={{ display: 'flex', gap: 8 }}>
          <Mode $active={mode === 'rerun'} onClick={() => setMode('rerun')} type="button">
            <strong>재실행 (rerun)</strong>
            <div style={{ color: '#4c6151', marginTop: 2 }}>
              같은 초기 상태에서 하루를 처음부터 다시 돌립니다. 시점 분기가 아닙니다.
            </div>
          </Mode>
          <Mode
            $active={mode === 'fork'}
            onClick={() => forkable && setMode('fork')}
            type="button"
            disabled={!forkable}
            style={forkable ? undefined : { opacity: 0.5, cursor: 'default' }}
          >
            <strong>시점 분기 (fork)</strong>
            <div style={{ color: '#4c6151', marginTop: 2 }}>
              {forkable
                ? `현재 커서(사건 ${cursorSeq})까지의 상태·기억·예약·로그를 그대로 두고 그 지점부터 바꿉니다.`
                : '분기하려면 먼저 재생 커서를 사건 1 이상으로 옮기세요.'}
            </div>
          </Mode>
        </div>

        <H>연락 전략</H>
        <Select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
          {catalog.policyFields.strategies.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>

        <H>조건 ({fields.length}개 · 전부 엔진이 읽는 값)</H>
        {fields.map((field) => (
          <Row key={field.name}>
            <span>
              {field.name}
              {String(values[field.name]) !==
                String(detail.policy.params[field.name] ?? field.default) && (
                <Changed>변경됨</Changed>
              )}
              <Hint>
                {field.description}
                {field.minimum !== null && field.maximum !== null && (
                  <> ({field.minimum}–{field.maximum})</>
                )}
              </Hint>
            </span>
            <FieldInput
              field={field}
              value={values[field.name]}
              onChange={(v) => setValues((prev) => ({ ...prev, [field.name]: v }))}
            />
          </Row>
        ))}

        <H>바꾸는 이유 (필수)</H>
        <Text
          value={reason}
          placeholder="예: 이웃 한 사람에게 부담이 몰리는지 보려고 이웃 연락 상한을 0으로 낮춘다"
          onChange={(e) => setReason(e.target.value)}
        />

        <H>변경 요약</H>
        {changed.length === 0 ? (
          <Hint>아직 바뀐 조건이 없습니다.</Hint>
        ) : (
          changed.map((line) => (
            <Hint key={line}>
              · {line}
            </Hint>
          ))
        )}
        <Hint style={{ marginTop: 4 }}>
          변경 전후 값과 이유는 새 policy revision에 저장되고, 부모 revision은 바뀌지 않습니다.
          {mode === 'fork' &&
            ` 분기 시각 ${formatClock(cursorClockMs)} 이전의 로그는 부모와 동일해야 하며, 다르면 서버가 거부합니다.`}
        </Hint>

        <Actions>
          <Button onClick={onClose} type="button">
            취소
          </Button>
          <Button $primary disabled={!canSubmit} onClick={submit} type="button">
            {mode === 'fork' ? `사건 ${cursorSeq}에서 분기` : '새로 실행'}
          </Button>
        </Actions>
      </Card>
    </Backdrop>
  );
}

function format(value: unknown): string {
  if (value === null || value === undefined) return '없음';
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  return String(value);
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: PolicyField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.type === 'boolean') {
    return (
      <Select
        value={value ? 'true' : 'false'}
        onChange={(e) => onChange(e.target.value === 'true')}
      >
        <option value="true">예</option>
        <option value="false">아니오</option>
      </Select>
    );
  }
  if (field.enum) {
    return (
      <Select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
        {field.enum.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <Input
      type="number"
      value={value === null || value === undefined ? '' : String(value)}
      min={field.minimum ?? undefined}
      max={field.maximum ?? undefined}
      // Only a nullable field may be left empty; the others are refused by the
      // API rather than being silently turned into null here.
      placeholder={field.nullable ? '없음(끄기)' : String(field.default ?? '')}
      onChange={(e) =>
        onChange(e.target.value === '' ? (field.nullable ? null : field.default) : Number(e.target.value))
      }
    />
  );
}
