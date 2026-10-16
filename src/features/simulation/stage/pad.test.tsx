import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Day, Ending, Evaluations } from './pad/screens';
import { IDLE_STATE, type Command, type StageState } from './protocol';

// What the tablet offers at the points the visitor asked to keep simple. Each screen is its state and a
// `press`: a test says what is on it and what pressing it sends.

afterEach(cleanup);

const state = (over: Partial<StageState> = {}): StageState => ({ ...IDLE_STATE, phase: 'day', day: '1일차', dayIndex: 0, dayCount: 3, ...over });
const pressed = () => { const sent: Command[] = []; return { sent, press: (c: Command) => { sent.push(c); } }; };
const names = (container: HTMLElement) => [...container.querySelectorAll('button')].map((b) => b.textContent?.trim());

describe('the day', () => {
  it('has two things to press while it plays, and nothing else', () => {
    const { press, sent } = pressed();
    const { container } = render(<Day s={state({ scene: '본인에게 연락' })} press={press} />);
    expect(names(container)).toEqual(['이 대화 건너뛰기', '다음 장면으로 →']);
    expect(container.querySelector('input')).toBeNull();
    fireEvent.click(screen.getByText('이 대화 건너뛰기'));
    fireEvent.click(screen.getByText('다음 장면으로 →'));
    expect(sent).toEqual([{ name: 'skipLine' }, { name: 'skipScene' }]);
  });

  it('cannot skip a line when nobody is speaking (the map between scenes)', () => {
    const { press } = pressed();
    render(<Day s={state({ scene: null })} press={press} />);
    expect((screen.getByText('이 대화 건너뛰기') as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers only the way on to the evaluations once the day is over', () => {
    const { press, sent } = pressed();
    const { container } = render(<Day s={state({ dayOver: true })} press={press} />);
    expect(names(container)).toEqual(['주민 에이전트 평가 보기 →']);
    fireEvent.click(screen.getByText('주민 에이전트 평가 보기 →'));
    expect(sent).toEqual([{ name: 'readEvaluations' }]);
  });
});

describe("a resident's interview, on the tablet", () => {
  const open = state({
    phase: 'evaluations', openActor: 'P1',
    residents: [{ id: 'P1', name: 'P1 한상덕', said: '말' }],
    went: [{ id: 'e1', time: '09:30', title: '본인에게 연락' }, { id: 'e2', time: '09:40', title: '이장에게 확인을 부탁' }],
  });

  it('shows that person day as a timeline and a way back to the list, and nothing else to press', () => {
    const { press } = pressed();
    const { container } = render(<Evaluations s={open} press={press} />);
    expect(names(container)).toEqual(['← 목록으로']);
    expect(screen.getByText('09:30')).toBeDefined();
    expect(screen.getByText('본인에게 연락')).toBeDefined();
    expect(screen.getByText('이장에게 확인을 부탁')).toBeDefined();
  });

  it('pressing an event does nothing: there is no way from an event back into the scene', () => {
    const { press, sent } = pressed();
    render(<Evaluations s={open} press={press} />);
    fireEvent.click(screen.getByText('본인에게 연락'));
    fireEvent.click(screen.getByText('09:40'));
    expect(sent).toEqual([]);
    expect(screen.queryByText(/장면 보기|그 장면/)).toBeNull();
  });

  it('goes back to the list with the one button', () => {
    const { press, sent } = pressed();
    render(<Evaluations s={open} press={press} />);
    fireEvent.click(screen.getByText('← 목록으로'));
    expect(sent).toEqual([{ name: 'evalClose' }]);
  });
});

describe('the end', () => {
  it('has a button for the closing page, which brings it before the wait is over', () => {
    const { press, sent } = pressed();
    render(<Ending s={state({ phase: 'ending' })} press={press} />);
    fireEvent.click(screen.getByText('마무리 화면 보기 →'));
    expect(sent).toEqual([{ name: 'closing' }]);
  });

  it('after the closing words the one thing left is the way back to the start', () => {
    const { press, sent } = pressed();
    const { container } = render(<Ending s={state({ phase: 'ending', closing: true })} press={press} />);
    expect(names(container)).toEqual(['처음으로']);
    fireEvent.click(screen.getByText('처음으로'));
    expect(sent).toEqual([{ name: 'home' }]);
  });
});
