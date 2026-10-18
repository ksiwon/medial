import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Choose, Evaluations, Result, Telling, Week } from './pad/screens';
import { IDLE_STATE, type Command, type StageState } from './protocol';

// What the tablet offers at each point of the walk. Each screen is its state and a `press`: a test says what is on
// it and what pressing it sends.

afterEach(cleanup);

const event = { id: 'E1', title: '연락이 안 되어 찾아보기', day: '월', noChoice: false };
const state = (over: Partial<StageState> = {}): StageState => ({ ...IDLE_STATE, phase: 'before', event, ...over });
const pressed = () => { const sent: Command[] = []; return { sent, press: (c: Command) => { sent.push(c); } }; };
const names = (container: HTMLElement) => [...container.querySelectorAll('button')].map((b) => b.textContent?.trim());

describe('the week', () => {
  const week = [
    { day: '월', events: [{ id: 'E1', title: '연락이 안 되어 찾아보기', noChoice: false, seen: true, chosen: 2 }] },
    { day: '화', events: [] },
    { day: '금', events: [{ id: 'E5', title: '보건소장의 안내 전달', noChoice: false, seen: false, chosen: null }, { id: 'E6', title: '119 구급 상황', noChoice: true, seen: false, chosen: null }] },
  ];

  it('lists every day, leaves a quiet day empty, and has one button per event', () => {
    const { press } = pressed();
    const { container } = render(<Week s={state({ phase: 'week', week, seen: 1, total: 3 })} press={press} />);
    expect(screen.getByText('이날은 조용했습니다')).toBeDefined();
    expect(names(container).filter((n) => n && !/^[월화수목금토일]$/.test(n) && n !== '다 봤어요 · 마치기 →')).toHaveLength(3);
    expect(screen.getByText(/1 \/ 3개 봤어요/)).toBeDefined();
  });

  it('can be finished once something has been read, and not before', () => {
    const a = pressed();
    render(<Week s={state({ phase: 'week', week, seen: 1, total: 3 })} press={a.press} />);
    fireEvent.click(screen.getByText('다 봤어요 · 마치기 →'));
    expect(a.sent).toEqual([{ name: 'finish' }]);
    cleanup();
    render(<Week s={state({ phase: 'week', week, seen: 0, total: 3 })} press={pressed().press} />);
    expect(screen.queryByText('다 봤어요 · 마치기 →')).toBeNull();
  });

  it('says what is read and what is an emergency', () => {
    const { press } = pressed();
    render(<Week s={state({ phase: 'week', week })} press={press} />);
    expect(screen.getByText('읽음 · 고른 요청 2번')).toBeDefined();
    expect(screen.getByText('응급 · 읽기만')).toBeDefined();
  });

  it('opens the event that was touched', () => {
    const { press, sent } = pressed();
    render(<Week s={state({ phase: 'week', week })} press={press} />);
    fireEvent.click(screen.getByText('119 구급 상황'));
    expect(sent).toEqual([{ name: 'openEvent', id: 'E6' }]);
  });
});

describe('a telling', () => {
  const told = { time: '09:40', place: '밭', index: 0, of: 2 };

  it('has three things to press while it plays, and nothing else', () => {
    const { press, sent } = pressed();
    const { container } = render(<Telling s={state({ scene: told, line: 1, lines: 8 })} press={press} after={false} />);
    expect(names(container)).toEqual(['← 이전 줄', '다음 줄 →', '장면 넘기기 ⇥']);
    fireEvent.click(screen.getByText('다음 줄 →'));
    fireEvent.click(screen.getByText('← 이전 줄'));
    fireEvent.click(screen.getByText('장면 넘기기 ⇥'));
    expect(sent).toEqual([{ name: 'line', value: 1 }, { name: 'line', value: -1 }, { name: 'skipScene' }]);
  });

  it('cannot go back from the first line', () => {
    const { press } = pressed();
    render(<Telling s={state({ scene: told, line: 0, lines: 8 })} press={press} after={false} />);
    expect((screen.getByText('← 이전 줄') as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers only the way on to the evaluations once it has been told', () => {
    const { press, sent } = pressed();
    const { container } = render(<Telling s={state({ toldAll: true, line: 7, lines: 8 })} press={press} after={false} />);
    expect(names(container)).toEqual(['주민 평가 보기 →']);
    fireEvent.click(screen.getByText('주민 평가 보기 →'));
    expect(sent).toEqual([{ name: 'toEvaluations' }]);
  });

  it('after a chosen request, the way on is to what the residents made of it', () => {
    const { press, sent } = pressed();
    render(<Telling s={state({ phase: 'after', toldAll: true })} press={press} after />);
    fireEvent.click(screen.getByText('반영된 평가 보기 →'));
    expect(sent).toEqual([{ name: 'toResult' }]);
  });
});

describe('the evaluations', () => {
  const residents = [{ id: 'P1', name: '한상덕', said: '밭일하느라 못 들었다' }, { id: 'P6', name: '남기웅', said: '걱정이 됐다' }];

  it('lists who was in the event; a touch opens that resident on the wall', () => {
    const { press, sent } = pressed();
    render(<Evaluations s={state({ phase: 'evaluations', residents })} press={press} />);
    fireEvent.click(screen.getByText('한상덕'));
    expect(sent).toEqual([{ name: 'openResident', id: 'P1' }]);
  });

  it('shows one open resident with the one way back to the list', () => {
    const { press, sent } = pressed();
    const { container } = render(<Evaluations s={state({ phase: 'evaluations', residents, openActor: 'P1' })} press={press} />);
    expect(names(container)).toEqual(['← 목록으로']);
    fireEvent.click(screen.getByText('← 목록으로'));
    expect(sent).toEqual([{ name: 'closeResident' }]);
  });

  it('goes on to the choice of what to change, or - for an emergency - simply ends', () => {
    const a = pressed();
    render(<Evaluations s={state({ phase: 'evaluations', residents })} press={a.press} />);
    fireEvent.click(screen.getByText('무엇을 고칠지 고르기 →'));
    expect(a.sent).toEqual([{ name: 'toChoose' }]);
    cleanup();
    const b = pressed();
    render(<Evaluations s={state({ phase: 'evaluations', residents, event: { ...event, noChoice: true } })} press={b.press} />);
    expect(screen.queryByText('무엇을 고칠지 고르기 →')).toBeNull();
    fireEvent.click(screen.getByText('다 읽었어요 →'));
    expect(b.sent).toEqual([{ name: 'toChoose' }]);
  });

  it('the way back to the week is always there', () => {
    const { press, sent } = pressed();
    render(<Evaluations s={state({ phase: 'evaluations', residents })} press={press} />);
    fireEvent.click(screen.getByText('← 이번 주로'));
    expect(sent).toEqual([{ name: 'week' }]);
  });
});

describe('choosing', () => {
  const requests = [
    { id: 'A', label: '본인에게 먼저 기회를 주세요', expect: '불려 다니지 않는다', cost: '위급하면 늦는다', basis: 'direct' as const, from: '한상덕' },
    { id: 'C', label: '간격을 두세요', expect: '피로가 준다', cost: '진짜 무응답이 묻힌다', basis: 'weak' as const, from: '남기웅' },
  ];

  it('shows each request with what is hoped and what it costs, and marks a weakly supported one', () => {
    const { press } = pressed();
    render(<Choose s={state({ phase: 'choose', requests })} press={press} />);
    expect(screen.getByText(/불려 다니지 않는다/)).toBeDefined();
    expect(screen.getByText(/진짜 무응답이 묻힌다/)).toBeDefined();
    expect(screen.getByText('한상덕의 평가에서')).toBeDefined();
    expect(screen.getByText('근거가 약한 요청')).toBeDefined();
  });

  it('a touch only picks; the choice is made by the confirm button, and from then on nothing else answers', () => {
    const a = pressed();
    render(<Choose s={state({ phase: 'choose', requests })} press={a.press} />);
    expect((screen.getByText('요청을 먼저 골라 주세요').closest('button') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('본인에게 먼저 기회를 주세요'));
    expect(a.sent).toEqual([{ name: 'consider', id: 'A' }]);
    cleanup();
    // The wall says which card is picked; then the confirm sends the choice, once.
    const b = pressed();
    render(<Choose s={state({ phase: 'choose', requests, considering: 'A' })} press={b.press} />);
    fireEvent.click(screen.getByText(/1번 요청으로 다시 보기/));
    fireEvent.click(screen.getByText('간격을 두세요'));
    fireEvent.click(screen.getByText(/1번 요청으로 다시 보기/));
    expect(b.sent).toEqual([{ name: 'choose', id: 'A' }]);
  });
});

describe('the result', () => {
  it('is the residents of the scene that followed, and the way back to the week', () => {
    const { press, sent } = pressed();
    render(<Result s={state({ phase: 'result', residents: [{ id: 'P1', name: '한상덕', said: '말' }] })} press={press} />);
    expect(screen.queryByText('무엇을 고칠지 고르기 →')).toBeNull();
    fireEvent.click(screen.getByText('← 이번 주로'));
    expect(sent).toEqual([{ name: 'week' }]);
  });
});
