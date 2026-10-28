import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Choose, Evaluations, Telling, Watching, Week } from './pad/screens';
import { IDLE_STATE, type Command, type StageState } from './protocol';

// What the tablet offers at each point of the walk. Each screen is its state and a `press`: a test says what is on
// it and what pressing it sends.

afterEach(cleanup);

const event = { id: 'E1', title: '연락이 안 되어 찾아보기', day: '월', noChoice: false };
const state = (over: Partial<StageState> = {}): StageState => ({ ...IDLE_STATE, phase: 'telling', event, ...over });
const pressed = () => { const sent: Command[] = []; return { sent, press: (c: Command) => { sent.push(c); } }; };
const names = (container: HTMLElement) => [...container.querySelectorAll('button')].map((b) => b.textContent?.trim());

describe('the week', () => {
  const week = [
    { day: '월', events: [{ id: 'E1', title: '연락이 안 되어 찾아보기', noChoice: false, version: 2 }] },
    { day: '화', events: [] },
    { day: '금', events: [{ id: 'E5', title: '보건소장의 안내 전달', noChoice: false, version: 1 }, { id: 'E6', title: '119 구급 상황', noChoice: true, version: 1 }] },
  ];

  it('lists every day, leaves a quiet day empty, has one button per event, and one short line above and the count below', () => {
    const { press } = pressed();
    const { container } = render(<Week s={state({ phase: 'week', week, runs: 1, reads: 3 })} press={press} />);
    expect(screen.getByLabelText('조용한 날')).toBeDefined();
    expect(names(container).filter((n) => n && !n.includes('마무리'))).toHaveLength(3);
    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect(screen.getByText(/본 버전 3 · 고친 횟수 1/)).toBeDefined();
  });

  it('says in words that five or more versions read open the closing scene - and never "n of 5", as if five were all', () => {
    render(<Week s={state({ phase: 'week', week, reads: 2 })} press={pressed().press} />);
    expect(screen.getByText(/5번 이상 보면 마무리 장면으로 넘어갈 수 있어요/)).toBeDefined();
    expect(screen.queryByText(/\/ ?5/)).toBeNull();
  });

  it('opens the closing with the fifth version read, and not before', () => {
    const a = pressed();
    render(<Week s={state({ phase: 'week', week, reads: 5 })} press={a.press} />);
    fireEvent.click(screen.getByText('마무리 장면 보기 →'));
    expect(a.sent).toEqual([{ name: 'finish' }]);
    cleanup();
    const b = pressed();
    render(<Week s={state({ phase: 'week', week, reads: 4 })} press={b.press} />);
    // Always on the page, but an outline that does not answer until the fifth version.
    const closing = screen.getByText('마무리 장면 보기 →') as HTMLButtonElement;
    expect(closing.disabled).toBe(true);
    fireEvent.click(closing);
    expect(b.sent).toEqual([]);
  });

  it('shows no "read" mark: an event that has been changed says which version it is, an emergency says so', () => {
    const { press } = pressed();
    render(<Week s={state({ phase: 'week', week })} press={press} />);
    expect(screen.getByText('v2')).toBeDefined();
    expect(screen.getByText('응급')).toBeDefined();
    expect(screen.queryByText(/읽음|✓/)).toBeNull();
  });

  it('opens the event that was touched', () => {
    const { press, sent } = pressed();
    render(<Week s={state({ phase: 'week', week })} press={press} />);
    fireEvent.click(screen.getByText('119 구급 상황'));
    expect(sent).toEqual([{ name: 'openEvent', id: 'E6' }]);
  });
});

describe('a telling', () => {
  it('has three things to press while it plays, and nothing else', () => {
    const { press, sent } = pressed();
    const { container } = render(<Telling s={state({ line: 1, lines: 8, scene: { time: '09:40', index: 0, of: 2 } })} press={press} />);
    expect(names(container)).toEqual(['← 이전', '다음 →', '넘기기 ⇥']);
    expect(screen.getByText('ver1 · 09:40 · 장면 1 / 2')).toBeDefined();
    fireEvent.click(screen.getByText('다음 →'));
    fireEvent.click(screen.getByText('← 이전'));
    fireEvent.click(screen.getByText('넘기기 ⇥'));
    expect(sent).toEqual([{ name: 'line', value: 1 }, { name: 'line', value: -1 }, { name: 'skipScene' }]);
  });

  it('says which version is being told', () => {
    render(<Telling s={state({ version: 2, line: 0, lines: 6, scene: { time: '09:50', index: 0, of: 1 } })} press={pressed().press} />);
    expect(screen.getByText('ver2 · 09:50 · 장면 1 / 1')).toBeDefined();
  });

  it('cannot go back from the first line', () => {
    const { press } = pressed();
    render(<Telling s={state({ line: 0, lines: 8 })} press={press} />);
    expect((screen.getByText('← 이전') as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers only the way on to the evaluations once it has been told', () => {
    const { press, sent } = pressed();
    const { container } = render(<Telling s={state({ toldAll: true, line: 7, lines: 8 })} press={press} />);
    expect(names(container)).toEqual(['주민의 피드백 →']);
    fireEvent.click(screen.getByText('주민의 피드백 →'));
    expect(sent).toEqual([{ name: 'toEvaluations' }]);
  });
});

describe('the evaluations', () => {
  it('has two big buttons: back to the telling, and on to choosing what to change', () => {
    const a = pressed();
    const { container } = render(<Evaluations s={state({ phase: 'evaluations' })} press={a.press} />);
    expect(names(container)).toEqual(['← 대화로 돌아가기', '수정 요청 고르기 →']);
    fireEvent.click(screen.getByText('← 대화로 돌아가기'));
    fireEvent.click(screen.getByText('수정 요청 고르기 →'));
    expect(a.sent).toEqual([{ name: 'toTelling' }, { name: 'toChoose' }]);
  });

  it('on a version with nothing to choose, the second button goes back to the week', () => {
    const { press, sent } = pressed();
    render(<Evaluations s={state({ phase: 'evaluations', leaf: true })} press={press} />);
    expect(screen.queryByText('수정 요청 고르기 →')).toBeNull();
    fireEvent.click(screen.getByText('이번 주로 →'));
    expect(sent).toEqual([{ name: 'week' }]);
  });
});

describe('choosing', () => {
  const requests = [{ id: 'A', label: '본인에게 먼저 기회를 주세요' }, { id: 'C', label: '간격을 두세요' }];

  it('shows each request as its number and its sentence - what it hopes and costs is read on the wall', () => {
    const { press } = pressed();
    const { container } = render(<Choose s={state({ phase: 'choose', requests })} press={press} />);
    expect(names(container)).toEqual(['1본인에게 먼저 기회를 주세요', '2간격을 두세요', '← 주민의 피드백']);
  });

  it('a touch only picks and asks; the choice is made by "돌리기", and from then on nothing else answers', () => {
    const a = pressed();
    render(<Choose s={state({ phase: 'choose', requests })} press={a.press} />);
    expect(screen.queryByText('돌리기')).toBeNull();
    fireEvent.click(screen.getByText('1'));
    expect(a.sent).toEqual([{ name: 'consider', id: 'A' }]);
    cleanup();
    // The wall says which card is picked; the question comes up, and "돌리기" sends the choice, once.
    const b = pressed();
    render(<Choose s={state({ phase: 'choose', requests, considering: 'A' })} press={b.press} />);
    fireEvent.click(screen.getByText('돌리기'));
    expect(screen.queryByText('돌리기')).toBeNull();
    expect(b.sent).toEqual([{ name: 'choose', id: 'A' }]);
    cleanup();
    // "다시 고르기" puts the pick down.
    const c = pressed();
    render(<Choose s={state({ phase: 'choose', requests, considering: 'A' })} press={c.press} />);
    fireEvent.click(screen.getByText('다시 고르기'));
    expect(c.sent).toEqual([{ name: 'consider', id: null }]);
  });

  it('while the wall makes the new simulation there is nothing to press', () => {
    const { container } = render(<Choose s={state({ phase: 'choose', requests, generating: true })} press={pressed().press} />);
    expect(names(container)).toEqual([]);
    expect(screen.getByText('새로운 시뮬레이션을 만들고 있어요')).toBeDefined();
  });
});

describe('the opening film', () => {
  it("has its own controls in the middle - previous, pause, next - and the way out below them", () => {
    const { press, sent } = pressed();
    const { container } = render(<Watching s={state({ phase: 'intro' })} press={press} />);
    expect(names(container)).toEqual(['← 이전', '❚❚ 일시정지', '다음 →', '건너뛰기 →']);
    fireEvent.click(screen.getByText('← 이전'));
    fireEvent.click(screen.getByText('❚❚ 일시정지'));
    fireEvent.click(screen.getByText('다음 →'));
    fireEvent.click(screen.getByText('건너뛰기 →'));
    expect(sent).toEqual([{ name: 'introPrev' }, { name: 'introToggle' }, { name: 'introNext' }, { name: 'skipIntro' }]);
  });

  it('offers to play again while the film is held', () => {
    render(<Watching s={state({ phase: 'intro', introPaused: true })} press={pressed().press} />);
    expect(screen.getByText('▶ 재생')).toBeDefined();
    expect(screen.queryByText('❚❚ 일시정지')).toBeNull();
  });
});
