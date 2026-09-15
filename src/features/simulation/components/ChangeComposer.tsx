import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import type { ChangeSet, GenerationDetail, RuleSpec, RuleParamSpec } from '../api/iteration';
import { nameList, personName } from '../selectors/story';
import {
  Body,
  Button,
  Callout,
  Disclosure,
  Field,
  Hint,
  Input,
  Mono,
  Row,
  Select,
  Sub,
  Tag,
  TextArea,
  TextLink,
} from '../ui/primitives';
import { colour, font } from '../ui/theme';

// Screen C's middle act: the change itself.
//
// One rule, edited through controls the *server's* rule catalogue generates.
// There is no free-text box for the rule sentence and no input for an engine
// binding, because both used to be editable separately from the values the run
// actually used - "재연락 2회" could be saved next to retryCount: 1 (26번 F01).
// Here the values are the only thing anyone types; the sentence under the
// controls is the server's own formatter run on those values, so what the
// screen shows and what the run does cannot come apart.
//
// Three things this component refuses to do:
//
//  - close on save. A save that fails to validate keeps every field and puts
//    the server's reason next to the form (F09);
//  - execute. Saving stores a draft; only 확정 grants execution authority, and
//    the reason box sits next to that button, not next to save;
//  - require a draft. 직접 작성 starts from the rule catalogue, so a session
//    with no usable AI draft is not a dead end (F03).

const Box = styled.div`
  border: 1px solid ${colour.border};
  border-radius: 8px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: ${colour.surface};
`;

const Choice = styled.button<{ $active: boolean }>`
  font-family: inherit;
  font-size: ${font.body};
  text-align: left;
  border: 1px solid ${(p) => (p.$active ? colour.primary : colour.border)};
  background: ${(p) => (p.$active ? colour.selected : colour.surface)};
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: ${colour.text};
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
  &:focus-visible {
    outline: 2px solid ${colour.primary};
  }
`;

const Controls = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
`;

const Preview = styled.div`
  border-left: 3px solid ${colour.primary};
  padding: 8px 12px;
  font-size: ${font.body};
  line-height: 1.6;
  color: ${colour.text};
  background: ${colour.app};
`;

type Values = Record<string, unknown>;

export interface ComposerState {
  ruleType: string;
  values: Values;
  label: string;
  mechanism: string;
  expectedEffects: string;
  possibleRegressions: string;
  watchNext: string;
  sourceChangeSetId: string | null;
  reviewItemRefs: string[];
  issueRefs: string[];
}

const lines = (value: string): string[] =>
  value.split('\n').map((line) => line.trim()).filter(Boolean);

function startFrom(spec: RuleSpec, source?: ChangeSet): ComposerState {
  const change = source?.changes.find((c) => c.semantic?.ruleType === spec.ruleType);
  return {
    ruleType: spec.ruleType,
    values: { ...(change?.semantic?.after ?? spec.current ?? {}) },
    label: source?.label ?? '',
    mechanism: source?.mechanism ?? '',
    expectedEffects: (source?.expectedEffects ?? []).join('\n'),
    possibleRegressions: (source?.possibleRegressions ?? []).join('\n'),
    watchNext: (source?.watchNext ?? []).join('\n'),
    sourceChangeSetId: source?.id ?? null,
    reviewItemRefs: source?.reviewItemRefs ?? [],
    issueRefs: source?.issueRefs ?? [],
  };
}

/** The sentence, as close to the server's as a client can get without the run.
 *  It is a preview: the stored sentence is always the server's own, and the
 *  validator refuses anything that disagrees with it. */
function preview(spec: RuleSpec, values: Values): string {
  const part = (p: RuleParamSpec) => {
    const value = values[p.key];
    if (value === null || value === undefined) return p.nullLabel || '없음';
    if (p.kind === 'bool') return value ? '예' : '아니오';
    if (p.kind === 'enum') {
      return p.options.find((o) => o.value === value)?.label ?? String(value);
    }
    return `${value}${p.unit}`;
  };
  return spec.params.map((p) => `${p.label} ${part(p)}`).join(' · ');
}

function changed(spec: RuleSpec, values: Values): boolean {
  const current = spec.current ?? {};
  return spec.params.some((p) => (values[p.key] ?? null) !== (current[p.key] ?? null));
}

interface Props {
  generation: GenerationDetail;
  drafts: ChangeSet[];
  busy: boolean;
  canAuthor: boolean;
  /** Resolves to the server's error text when the save was refused, so the
   *  form can keep its input and show it in place. */
  onSave: (body: Record<string, unknown>) => Promise<string | null>;
  onConfirm: (changeSetId: string, reason: string) => void;
  onDecline: (reason: string) => void;
  onOpenScene: (attemptId: string, eventId: string) => void;
}

export default function ChangeComposer({
  generation,
  drafts,
  busy,
  canAuthor,
  onSave,
  onConfirm,
  onDecline,
  onOpenScene,
}: Props) {
  const catalog = generation.ruleCatalog ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(drafts[0]?.id ?? null);
  const [editor, setEditor] = useState<ComposerState | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  // After a save the new draft is what the researcher just wrote, so it - not
  // whichever draft happened to be first - is the one selected and the one the
  // confirm button would run. Without this the screen offered the AI draft for
  // execution right after somebody wrote their own (seen in a browser).
  const awaitingSaved = useRef(false);
  useEffect(() => {
    if (!awaitingSaved.current) return;
    const mine = [...drafts].reverse().find((d) => d.author === 'researcher_hypothesis');
    if (mine) {
      setSelectedId(mine.id);
      setReason('');
      awaitingSaved.current = false;
    }
  }, [drafts]);

  const selected = drafts.find((d) => d.id === selectedId) ?? drafts[0] ?? null;
  const spec = editor ? catalog.find((r) => r.ruleType === editor.ruleType) ?? null : null;

  const evidence = useMemo(() => {
    if (!selected) return [] as { actorId: string; attemptId: string; eventId: string; text: string }[];
    const wanted = new Set(selected.reviewItemRefs);
    const out: { actorId: string; attemptId: string; eventId: string; text: string }[] = [];
    for (const review of generation.reviews) {
      review.items.forEach((item, index) => {
        if (!wanted.has(`${review.id}#${index}`)) return;
        if (item.eventRefs.length === 0) return;
        out.push({
          actorId: review.actorId,
          attemptId: review.attemptId,
          eventId: item.eventRefs[0],
          text: item.reason,
        });
      });
    }
    return out.slice(0, 4);
  }, [selected, generation.reviews]);

  const save = async () => {
    if (!editor || !spec) return;
    // Set before awaiting: the save resolves only after the caller has
    // refreshed, so a flag set afterwards would arrive when the new draft had
    // already been delivered and the effect would never see it change.
    awaitingSaved.current = true;
    const error = await onSave({
      sourceChangeSetId: editor.sourceChangeSetId,
      label: editor.label.trim(),
      mechanism: editor.mechanism.trim(),
      rules: [{ ruleType: editor.ruleType, after: editor.values }],
      expectedEffects: lines(editor.expectedEffects),
      possibleRegressions: lines(editor.possibleRegressions),
      watchNext: lines(editor.watchNext),
      reviewItemRefs: editor.reviewItemRefs,
      issueRefs: editor.issueRefs,
    });
    if (error) {
      // Input stays exactly where it was; the reason goes next to the form.
      awaitingSaved.current = false;
      setSaveError(error);
      return;
    }
    setSaveError(null);
    setEditor(null);
  };

  return (
    <Box>
      <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Row style={{ gap: 2 }}>
          <strong style={{ fontSize: font.section }}>바꿀 운영 규칙</strong>
          <Hint label="바꿀 운영 규칙">
            저장은 실행하지 않습니다. 수정안으로 저장한 뒤 이유와 함께 확정해야 다음 버전이
            실행됩니다.
          </Hint>
        </Row>
      </Row>

      {drafts.length === 0 && !editor && (
        <Callout>
          <div>
            <strong>이번 평가에서 만들어진 초안이 없습니다.</strong>
            <Hint label="초안 없음">
              지원하는 규칙에서 직접 작성하거나, 이번에는 수정하지 않고 현장 질문만 남길 수
              있습니다.
            </Hint>
          </div>
        </Callout>
      )}

      {drafts.length > 0 && !editor && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {drafts.map((draft) => (
            <Choice
              key={draft.id}
              $active={selected?.id === draft.id}
              aria-pressed={selected?.id === draft.id}
              onClick={() => {
                // A reason written for one candidate is not a reason for
                // another; switching wipes it rather than carrying it over.
                setSelectedId(draft.id);
                setReason('');
              }}
            >
              <Row style={{ gap: 6 }}>
                <Tag $kind={draft.author === 'researcher_hypothesis' ? 'human' : 'neutral'}>
                  {draft.author === 'researcher_hypothesis'
                    ? '연구자 작성'
                    : draft.author === 'ai_draft'
                      ? 'AI 초안'
                      : '규칙 초안'}
                </Tag>
                <strong>{draft.label}</strong>
              </Row>
              {draft.changes.map((change, index) => (
                <span key={index} style={{ fontSize: font.small, color: colour.secondary }}>
                  {change.beforeRule} → <strong style={{ color: colour.text }}>{change.afterRule}</strong>
                </span>
              ))}
            </Choice>
          ))}
        </div>
      )}

      {/* Only the selected draft is opened out. Showing every draft's effects,
          burdens and affected people at once is what made this screen unreadable. */}
      {selected && !editor && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Body>{selected.mechanism}</Body>
          {evidence.length > 0 && (
            <div>
              <Sub>이 변경이 출발한 주민 평가</Sub>
              {evidence.map((row) => (
                <div key={`${row.actorId}-${row.eventId}`} style={{ fontSize: font.small }}>
                  <strong>{personName(row.actorId)}</strong>: {row.text}{' '}
                  <TextLink onClick={() => onOpenScene(row.attemptId, row.eventId)}>
                    그 장면 보기
                  </TextLink>
                </div>
              ))}
            </div>
          )}
          {selected.expectedEffects.length > 0 && (
            <Sub>기대: {selected.expectedEffects.join(' · ')}</Sub>
          )}
          {selected.possibleRegressions.length > 0 && (
            <Sub style={{ color: colour.warn }}>
              가능한 부담: {selected.possibleRegressions.join(' · ')}
            </Sub>
          )}
          {selected.affectedActors.length > 0 && (
            <Sub>영향받는 사람: {nameList(selected.affectedActors)}</Sub>
          )}
          {selected.watchNext.length > 0 && (
            <Sub>다음 실행에서 볼 것: {selected.watchNext.join(' · ')}</Sub>
          )}
          <Disclosure>
            <summary>기술 세부사항 · 내부 실행값</summary>
            <div>
              {selected.changes.flatMap((change) =>
                change.executionBindings.map((binding) => (
                  <div key={`${change.field}-${binding.key}`}>
                    <Mono>{binding.key}</Mono>: {String(binding.before)} → {String(binding.after)}
                  </div>
                )),
              )}
              <Sub>서버가 위 규칙에서 만든 값입니다. 따로 편집할 수 없습니다.</Sub>
            </div>
          </Disclosure>
        </div>
      )}

      {/* --- the editor ------------------------------------------------ */}
      {editor && spec && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field>
            어떤 규칙을 바꾸나요
            <Select
              aria-label="바꿀 규칙"
              value={editor.ruleType}
              onChange={(e) => {
                const next = catalog.find((r) => r.ruleType === e.target.value);
                if (!next) return;
                setEditor({ ...editor, ruleType: next.ruleType, values: { ...(next.current ?? {}) } });
                setSaveError(null);
              }}
            >
              {catalog.map((row) => (
                <option key={row.ruleType} value={row.ruleType} disabled={!row.applicable}>
                  {row.label}
                  {row.applicable ? '' : ' (이 사례에서는 적용되는 상황이 없음)'}
                </option>
              ))}
            </Select>
            <Sub>{spec.description}</Sub>
          </Field>

          <Controls>
            {spec.params.map((param) => (
              <Field key={param.key}>
                {param.label}
                {param.kind === 'bool' ? (
                  <Select
                    aria-label={param.label}
                    value={editor.values[param.key] ? 'true' : 'false'}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        values: { ...editor.values, [param.key]: e.target.value === 'true' },
                      })
                    }
                  >
                    <option value="true">예</option>
                    <option value="false">아니오</option>
                  </Select>
                ) : param.kind === 'enum' ? (
                  <Select
                    aria-label={param.label}
                    value={String(editor.values[param.key] ?? '')}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        values: { ...editor.values, [param.key]: e.target.value },
                      })
                    }
                  >
                    {param.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Row style={{ gap: 8 }}>
                    <Input
                      aria-label={param.label}
                      type="number"
                      min={param.minimum ?? undefined}
                      max={param.maximum ?? undefined}
                      disabled={param.nullable && editor.values[param.key] === null}
                      value={
                        editor.values[param.key] === null || editor.values[param.key] === undefined
                          ? ''
                          : String(editor.values[param.key])
                      }
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          values: {
                            ...editor.values,
                            [param.key]: e.target.value === '' ? null : Number(e.target.value),
                          },
                        })
                      }
                    />
                    {param.nullable && (
                      <label style={{ fontSize: font.small, whiteSpace: 'nowrap' }}>
                        <input
                          type="checkbox"
                          checked={editor.values[param.key] === null}
                          onChange={(e) =>
                            setEditor({
                              ...editor,
                              values: {
                                ...editor.values,
                                [param.key]: e.target.checked ? null : (param.minimum ?? 0),
                              },
                            })
                          }
                        />{' '}
                        {param.nullLabel}
                      </label>
                    )}
                  </Row>
                )}
                {param.kind === 'int' && (
                  <Sub>
                    {param.minimum ?? 0}–{param.maximum ?? '?'}
                    {param.unit}
                  </Sub>
                )}
              </Field>
            ))}
          </Controls>

          <Preview>
            <Sub style={{ marginBottom: 2 }}>바뀌기 전</Sub>
            {spec.currentRule}
            <Sub style={{ marginTop: 6, marginBottom: 2 }}>바뀐 뒤 (미리보기)</Sub>
            {preview(spec, editor.values)}
            {!changed(spec, editor.values) && (
              <Sub style={{ color: colour.warn, marginTop: 4 }}>
                아직 현재 값과 같습니다. 실행되는 것이 바뀌지 않으면 저장할 수 없습니다.
              </Sub>
            )}
          </Preview>

          <Field>
            이 수정안의 이름
            <Input
              aria-label="수정안 이름"
              value={editor.label}
              onChange={(e) => setEditor({ ...editor, label: e.target.value })}
            />
          </Field>
          <Field>
            <span>
              이 변경을 시도하는 이유
              <Hint label="이유">
                자유 서술은 이유로만 저장됩니다. 실행되는 규칙은 위 값이며, 글로 적은 내용이
                실행을 바꾸지 않습니다.
              </Hint>
            </span>
            <TextArea
              aria-label="변경을 시도하는 이유"
              value={editor.mechanism}
              onChange={(e) => setEditor({ ...editor, mechanism: e.target.value })}
            />
          </Field>

          {/* Three optional boxes. Open at once they made the form four empty
              textareas deep before the save button, and two of them are things
              a researcher fills in after the run, not before it. */}
          <Disclosure>
            <summary>기대 효과 · 가능한 부담 · 다음에 볼 것 (선택)</summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Field>
                기대 효과 (한 줄에 하나)
                <TextArea
                  value={editor.expectedEffects}
                  onChange={(e) => setEditor({ ...editor, expectedEffects: e.target.value })}
                />
              </Field>
              <Field>
                가능한 부담 (한 줄에 하나)
                <TextArea
                  value={editor.possibleRegressions}
                  onChange={(e) => setEditor({ ...editor, possibleRegressions: e.target.value })}
                />
              </Field>
              <Field>
                다음 실행에서 볼 것 (한 줄에 하나)
                <TextArea
                  value={editor.watchNext}
                  onChange={(e) => setEditor({ ...editor, watchNext: e.target.value })}
                />
              </Field>
            </div>
          </Disclosure>

          {saveError && (
            <Callout $tone="error">
              <div>
                <strong>저장하지 못했습니다. 입력은 그대로 두었습니다.</strong>
                <div style={{ marginTop: 4 }}>{saveError}</div>
              </div>
            </Callout>
          )}

          <Row>
            <Button
              $primary
              disabled={busy || !editor.label.trim() || !editor.mechanism.trim()}
              onClick={() => void save()}
            >
              수정안으로 저장 (실행하지 않음)
            </Button>
            <Button
              onClick={() => {
                setEditor(null);
                setSaveError(null);
              }}
            >
              취소
            </Button>
          </Row>
        </div>
      )}

      {/* --- actions --------------------------------------------------- */}
      {!editor && canAuthor && (
        <Row style={{ flexWrap: 'wrap', gap: 8 }}>
          {selected && selected.changes.some((c) => c.semantic) && (
            <Button
              onClick={() => {
                const rule = selected.changes.find((c) => c.semantic)?.semantic?.ruleType;
                const target = catalog.find((r) => r.ruleType === rule) ?? catalog[0];
                if (target) setEditor(startFrom(target, selected));
                setSaveError(null);
              }}
            >
              이 초안 고쳐 쓰기
            </Button>
          )}
          <Button
            onClick={() => {
              const first = catalog.find((r) => r.applicable) ?? catalog[0];
              if (first) {
                setEditor({ ...startFrom(first), label: '', mechanism: '' });
              }
              setSaveError(null);
            }}
          >
            지원 규칙에서 직접 작성
          </Button>
          <span style={{ flex: 1 }} />
          <TextLink onClick={() => setDeclining((v) => !v)}>이번에는 수정하지 않음</TextLink>
        </Row>
      )}

      {declining && (
        <Callout $tone="warn">
          <div style={{ width: '100%' }}>
            <strong>이번 반복에서는 운영 규칙을 바꾸지 않습니다.</strong>
            <Hint label="수정하지 않음">
              초안은 기록으로 남고 아무것도 실행되지 않습니다. 현장에서 물어볼 질문은 계속 만들
              수 있습니다.
            </Hint>
            <Field style={{ marginTop: 8 }}>
              왜 바꾸지 않는지 (기록에 남습니다)
              <TextArea
                aria-label="수정하지 않는 이유"
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
              />
            </Field>
            <Row style={{ marginTop: 8 }}>
              <Button
                disabled={busy || declineReason.trim().length === 0}
                onClick={() => onDecline(declineReason.trim())}
              >
                수정하지 않기로 기록
              </Button>
              <Button onClick={() => setDeclining(false)}>취소</Button>
            </Row>
          </div>
        </Callout>
      )}

      {/* Execution authority: one button, its reason beside it, and nothing
          else on this screen can create a revision. */}
      {selected && !editor && canAuthor && (
        <div style={{ borderTop: `1px solid ${colour.border}`, paddingTop: 12 }}>
          <Field>
            <span>
              왜 이 변경을 실행하는지 (기록에 남습니다)
              <Hint label="확정 이유">
                이 문장이 실행 권한입니다. 확정하면 이 수정안으로 자식 실행이 하나 생깁니다.
              </Hint>
            </span>
            <TextArea
              aria-label="확정 이유"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Row style={{ marginTop: 8 }}>
            <Button
              $primary
              disabled={busy || reason.trim().length === 0}
              title={reason.trim().length === 0 ? '확정 이유를 적어야 실행할 수 있습니다' : undefined}
              onClick={() => onConfirm(selected.id, reason.trim())}
            >
              이유를 기록하고 수정안 실행
            </Button>
            <Sub>
              고른 안: <strong style={{ color: colour.text }}>{selected.label}</strong>
            </Sub>
          </Row>
        </div>
      )}
    </Box>
  );
}
