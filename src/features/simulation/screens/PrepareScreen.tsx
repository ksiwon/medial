import { useMemo, useState } from 'react';
import styled from 'styled-components';
import type { Capabilities } from '../api/iteration';
import type { Catalog, PolicyRevision } from '../api/types';
import type { StartPhase, StartRequest } from '../iterationStore';
import { strategyName } from '../selectors/words';
import {
  Body,
  Button,
  Callout,
  Disclosure,
  Field,
  Input,
  Mono,
  PageTitle,
  Row,
  Select,
  Sub,
  TextLink,
} from '../ui/primitives';
import { colour, font } from '../ui/theme';

// Screen A. Everything fixed before the loop starts, and nothing else.
//
// The visible surface is five things: the question, the starting policy, one
// folded settings block, whatever is actually blocking a start, and one button.
// The unimplemented list, the provider name, the editable field paths and the
// snapshot hashes have not been deleted - they are one disclosure away, which
// is where doc 15 section 4 puts them.

const Sheet = styled.div`
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 24px 48px;
  display: flex;
  flex-direction: column;
  gap: 24px;
`;

const Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Folded = styled.details`
  border-top: 1px solid ${colour.border};
  border-bottom: 1px solid ${colour.border};
  padding: 4px 0;
  > summary {
    cursor: pointer;
    list-style: none;
    padding: 12px 0;
    font-size: ${font.body};
    color: ${colour.text};
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  > summary::-webkit-details-marker {
    display: none;
  }
  > summary::before {
    content: '▸';
    color: ${colour.primary};
  }
  &[open] > summary::before {
    content: '▾';
  }
  > :not(summary) {
    padding-bottom: 24px;
  }
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
`;

const SubHead = styled.h3`
  margin: 24px 0 0;
  font-size: ${font.body};
  font-weight: 600;
  color: ${colour.text};
`;

const PathList = styled.ul`
  margin: 4px 0 0;
  padding-left: 18px;
  line-height: 1.8;
`;

/**
 * The policies that make sense as a *starting* plan.
 *
 * The catalogue also holds every revision earlier experiments derived - ids
 * carry a `-r<hash>` suffix, and three of them are labelled "A · 이장 우선 확인
 * (수정)" identically. Listing those turned the one decision on this screen
 * into a dozen near-duplicate options. A revision is still reachable: pick the
 * version in 결과 비교 and start a new experiment from it.
 */
function startingPolicies(catalog: Catalog): PolicyRevision[] {
  const roots = catalog.policies.filter((p) => !/-r[0-9a-f]{6,}/.test(p.id));
  return roots.length > 0 ? roots : catalog.policies;
}

/**
 * Two or three lines of plain language for what a starting policy actually
 * does. Built from the engine's own parameters, so it cannot describe a rule
 * the run will not follow.
 */
function describePolicy(policy: PolicyRevision | undefined): string[] {
  if (!policy) return [];
  const p = policy.params;
  const lines: string[] = [];

  const first =
    policy.contactStrategy === 'subject_first'
      ? '먼저 본인에게 직접 연락합니다.'
      : policy.contactStrategy === 'head_first'
        ? '먼저 이장에게 물어봅니다.'
        : policy.contactStrategy === 'neighbour_first'
          ? `본인 대신 가까운 이웃에게 먼저 부탁합니다. 거절하면 다음 사람에게, 최대 ${
              typeof p.neighbourAskLimit === 'number' ? p.neighbourAskLimit : '?'
            }명까지.`
          : `연락 순서: ${strategyName(policy.contactStrategy)}.`;
  const retries =
    typeof p.retryCount === 'number' && p.retryCount > 0
      ? ` 응답이 없으면 ${p.retryIntervalMin}분 뒤에 최대 ${p.retryCount}번까지 다시 겁니다.`
      : ' 응답이 없어도 다시 걸지 않습니다.';
  lines.push(first + retries);

  if (typeof p.helperContactCap === 'number') {
    lines.push(
      p.allowHeadContact
        ? `그래도 안 되면 이웃에게 최대 ${p.helperContactCap}명까지 부탁하고, 이장에게도 물을 수 있습니다.`
        : `그래도 안 되면 이웃에게 최대 ${p.helperContactCap}명까지 부탁합니다. 이장에게는 묻지 않습니다.`,
    );
  }
  lines.push(
    p.escalateToInstitutionAfterMin
      ? `${p.escalateToInstitutionAfterMin}분 안에 풀리지 않으면 보건소로 넘깁니다. 상대에게 알리는 정보는 ${p.disclosure === 'named' ? '이름까지' : '최소한만'} 입니다.`
      : `보건소로 넘기는 기한은 정해져 있지 않습니다. 상대에게 알리는 정보는 ${p.disclosure === 'named' ? '이름까지' : '최소한만'} 입니다.`,
  );
  return lines;
}

interface Props {
  catalog: Catalog;
  capabilities: Capabilities;
  startPolicyId: string;
  phase: StartPhase;
  busy: boolean;
  onStart: (body: StartRequest) => void;
  onRetryStart: () => void;
}

export default function PrepareScreen({
  catalog,
  capabilities,
  startPolicyId,
  phase,
  busy,
  onStart,
  onRetryStart,
}: Props) {
  const policies = useMemo(() => startingPolicies(catalog), [catalog]);
  const [question, setQuestion] = useState(
    '응답이 없거나 이동이 필요할 때 누구의 시간으로 해결할 것인가',
  );
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState('');
  const [basePolicyId, setBasePolicyId] = useState(
    policies.some((p) => p.id === startPolicyId) ? startPolicyId : (policies[0]?.id ?? ''),
  );
  const [decks, setDecks] = useState<string[]>(catalog.decks.map((d) => d.id));
  const [resourceId, setResourceId] = useState(
    catalog.resourceSets.find((r) => r.id.includes('transport'))?.id ??
      catalog.resourceSets[0]?.id ??
      '',
  );
  const [maxGenerations, setMaxGenerations] = useState(3);
  const [maxCandidates, setMaxCandidates] = useState(2);
  const [behaviourAdapter, setBehaviourAdapter] = useState('rule');
  const [reviewAdapter, setReviewAdapter] = useState('rule');
  const [improvementAdapter, setImprovementAdapter] = useState('rule');
  // The server contract is callBudget=0 == no ceiling, and that contract is not
  // being changed here. For a rule-only run there are no calls to bound, so 0
  // is honest; the moment a model adapter is picked the screen asks for a real
  // number rather than recording an invented one as the researcher's choice.
  const [callBudget, setCallBudget] = useState(0);

  const online = capabilities.model.configured;
  const villageOnline = Boolean(capabilities.villageModel?.configured);
  const usesModel =
    behaviourAdapter === 'llm' || reviewAdapter === 'llm' || improvementAdapter === 'llm';
  const policy = policies.find((p) => p.id === basePolicyId);
  const effectiveLabel = label.trim() || question.trim().slice(0, 40) || '이름 없는 실험';

  // Blocking problems live on the default screen, never inside the fold.
  const blockers: string[] = [];
  if (question.trim().length === 0) blockers.push('탐색할 질문을 적어 주세요.');
  if (!basePolicyId) blockers.push('실행 가능한 초기 운영안이 없습니다.');
  if (decks.length === 0) blockers.push('실험 설정에서 시나리오를 하나 이상 골라 주세요.');
  if (!resourceId) blockers.push('실험 설정에서 자원 가정을 골라 주세요.');
  if (usesModel && !online) blockers.push('모델이 설정되지 않아 LLM 어댑터를 쓸 수 없습니다.');
  if (usesModel && callBudget <= 0)
    blockers.push('LLM 어댑터를 켰습니다. 모델 호출 상한을 1 이상으로 정해 주세요 (0은 무제한).');

  const summary = [
    `초기안 포함 최대 ${maxGenerations}개 버전`,
    `시나리오 ${decks.length}개`,
    behaviourAdapter === 'rule' ? '규칙 기반 마을' : 'LLM 마을',
    reviewAdapter === 'rule' ? '규칙 기반 리뷰' : 'LLM 리뷰',
    improvementAdapter === 'rule' ? '규칙 기반 개선' : 'LLM 개선',
    usesModel ? (callBudget > 0 ? `모델 호출 ${callBudget}회 상한` : '모델 호출 무제한') : '모델 호출 없음',
  ].join(' · ');

  const toggleDeck = (id: string) =>
    setDecks((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  return (
    <Sheet>
      <Group>
        <PageTitle>어떤 서비스를 탐색할까요?</PageTitle>
        <Body style={{ color: colour.secondary }}>
          마을의 하루를 돌려 보고, 주민 에이전트가 남긴 리뷰를 근거로 운영안을 고쳐 가며 무엇이
          달라지는지 비교합니다.
        </Body>
      </Group>

      <Field>
        탐색할 질문
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="예: 응답이 없을 때 누구의 시간으로 해결할 것인가"
        />
        <Sub>
          이 문장은 실험을 부르는 이름이자 비교의 기준입니다. 실행 명령으로 해석되지 않으며, 여기
          적은 말이 자동으로 운영 규칙이 되지도 않습니다. 규칙은 아래 초기 운영안이 정합니다.
        </Sub>
      </Field>

      <Field>
        초기 운영안
        <Select value={basePolicyId} onChange={(e) => setBasePolicyId(e.target.value)}>
          {policies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
        <div style={{ marginTop: 4 }}>
          {describePolicy(policy).map((line) => (
            <Body key={line} style={{ marginBottom: 4 }}>
              {line}
            </Body>
          ))}
        </div>
      </Field>

      <Row>
        <Sub>
          실험 이름: <strong style={{ color: colour.text }}>{effectiveLabel}</strong>
        </Sub>
        {renaming ? (
          <Input
            autoFocus
            style={{ maxWidth: 320 }}
            value={label}
            placeholder={effectiveLabel}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => setRenaming(false)}
          />
        ) : (
          <TextLink onClick={() => setRenaming(true)}>이름 바꾸기</TextLink>
        )}
      </Row>

      <Folded>
        <summary>
          <span>실험 설정</span>
          <Sub as="span">{summary}</Sub>
        </summary>
        <div>
          <Grid>
            <Field>
              자원 가정
              <Select value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
                {catalog.resourceSets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              버전 수 (초기안 포함)
              <Input
                type="number"
                min={1}
                max={10}
                value={maxGenerations}
                onChange={(e) => setMaxGenerations(Number(e.target.value))}
              />
            </Field>
            <Field>
              버전당 Change Set 초안 수
              <Input
                type="number"
                min={1}
                max={4}
                value={maxCandidates}
                onChange={(e) => setMaxCandidates(Number(e.target.value))}
              />
            </Field>
          </Grid>

          <SubHead>시나리오</SubHead>
          <Sub>이 하루들의 초기 상태·자원·외생 사건을 모든 버전에 똑같이 고정합니다.</Sub>
          <Row style={{ marginTop: 8 }}>
            {catalog.decks.map((deck) => (
              <label
                key={deck.id}
                style={{ fontSize: font.body, display: 'flex', gap: 6, alignItems: 'center' }}
              >
                <input
                  type="checkbox"
                  checked={decks.includes(deck.id)}
                  onChange={() => toggleDeck(deck.id)}
                />
                {deck.label}
              </label>
            ))}
          </Row>

          <SubHead>무엇을 모델이 하는가</SubHead>
          <Sub>
            마을을 모델로 돌리면 MEDial 머리와 주민 전원이 모델입니다
            {capabilities.villageModel
              ? ` (머리 ${capabilities.villageModel.headModel} · 주민 ${capabilities.villageModel.residentModel})`
              : ''}
            . 리뷰와 개선만 모델을 쓰면 hybrid로 표시합니다. 모델 호출이 실패하면 규칙 결과로
            갈아치우지 않고 그대로 실패로 남깁니다. 호출은 전부 기록되고 재실행은 기록을 재생합니다.
          </Sub>
          <Grid style={{ marginTop: 12 }}>
            <Field>
              마을의 행동 (MEDial 머리 + 주민)
              <Select
                value={behaviourAdapter}
                onChange={(e) => setBehaviourAdapter(e.target.value)}
              >
                <option value="rule">규칙 기반 (모델 호출 없음)</option>
                <option value="llm" disabled={!villageOnline}>
                  LLM (실제 모델 호출)
                </option>
              </Select>
            </Field>
            <Field>
              주민 리뷰
              <Select value={reviewAdapter} onChange={(e) => setReviewAdapter(e.target.value)}>
                <option value="rule">규칙 기반 (모델 호출 없음)</option>
                <option value="llm" disabled={!online}>
                  LLM (실제 모델 호출)
                </option>
              </Select>
            </Field>
            <Field>
              종합·개선안
              <Select
                value={improvementAdapter}
                onChange={(e) => setImprovementAdapter(e.target.value)}
              >
                <option value="rule">규칙 기반 (모델 호출 없음)</option>
                <option value="llm" disabled={!online}>
                  LLM (실제 모델 호출)
                </option>
              </Select>
            </Field>
            <Field>
              모델 호출 상한 {usesModel ? '(0 = 무제한)' : '(이 설정에서는 호출 없음)'}
              <Input
                type="number"
                min={0}
                disabled={!usesModel}
                value={callBudget}
                onChange={(e) => setCallBudget(Number(e.target.value))}
              />
            </Field>
          </Grid>
          {!online && (
            <Sub style={{ marginTop: 8 }}>
              모델이 설정되어 있지 않습니다 ({capabilities.model.note}). 규칙 어댑터만 고를 수
              있습니다.
            </Sub>
          )}

          <SubHead>Change Set이 다룰 수 있는 범위</SubHead>
          <Body>
            주민 평가와 연결된 <strong>Quest 완료·인계, Task 흐름·배정·거절, 시간·부담,
            설명·정보 공개</strong> 규칙만 다룹니다. 페르소나, 인터뷰 근거, 초기 기억, 시나리오,
            외생 사건, 평가 기준, 세계 사실, 인력·차량 증원은 바꾸지 않습니다.
          </Body>
          <Disclosure>
            <summary>지원하는 Quest·Task·규칙 범위</summary>
            <PathList>
              <li>Quest: {capabilities.supportedQuestIds.join(', ')}</li>
              <li>Task: {capabilities.supportedTaskIds.join(', ')}</li>
              <li>규칙: {capabilities.supportedRuleFields.join(', ')}</li>
            </PathList>
          </Disclosure>

          <Disclosure>
            <summary>이 빌드가 하지 않는 것 {capabilities.notImplemented.length}가지</summary>
            <PathList>
              {capabilities.notImplemented.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </PathList>
          </Disclosure>
        </div>
      </Folded>

      {blockers.length > 0 && (
        <Callout $tone="warn">
          <div>
            <strong>시작하기 전에 정리할 것</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
              {blockers.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </Callout>
      )}

      {phase.kind === 'create_failed' && (
        <Callout $tone="error">
          <div>
            <strong>실험을 만들지 못했습니다.</strong>
            <div style={{ marginTop: 4 }}>{phase.message}</div>
            <Sub style={{ marginTop: 4 }}>
              아무것도 만들어지지 않았습니다. 설정을 고친 뒤 다시 시작하세요.
            </Sub>
          </div>
        </Callout>
      )}

      {phase.kind === 'start_failed' && (
        <Callout $tone="error">
          <div>
            <strong>실험은 만들어졌지만 실행이 시작되지 않았습니다.</strong>
            <div style={{ marginTop: 4 }}>{phase.message}</div>
            <Sub style={{ marginTop: 4 }}>
              세션 <Mono>{phase.sessionId}</Mono> 은 그대로 있습니다. 다시 시작해도 새 실험을 만들지
              않고 이 실험만 실행합니다.
            </Sub>
            <div style={{ marginTop: 12 }}>
              <Button $primary disabled={busy} onClick={onRetryStart}>
                이 실험 실행 다시 시도
              </Button>
            </div>
          </div>
        </Callout>
      )}

      {phase.kind !== 'start_failed' && (
        <Row>
          <Button
            $primary
            disabled={busy || blockers.length > 0 || phase.kind === 'creating' || phase.kind === 'starting'}
            onClick={() =>
              onStart({
                label: effectiveLabel,
                coreItem: question.trim(),
                basePolicyId,
                developmentDeckRefs: decks,
                resourceRevisionId: resourceId,
                maxGenerations,
                maxChangeSetsPerGeneration: maxCandidates,
                callBudget,
                behaviourAdapter,
                reviewAdapter,
                improvementAdapter,
              })
            }
          >
            {phase.kind === 'creating'
              ? '실험을 만드는 중…'
              : phase.kind === 'starting'
                ? '실행을 시작하는 중…'
                : '실험 시작'}
          </Button>
          <Sub>
            시작하면 마을 관찰로 넘어가고, 정한 버전 수와 상한 안에서 매번 묻지 않고 진행합니다.
          </Sub>
        </Row>
      )}
    </Sheet>
  );
}
