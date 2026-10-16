import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STALE_MS, useStream, type StreamStatus } from './stream';

// The stream both screens listen on: does it notice a line that went quiet, open itself again, and stop for
// good when the server turns it away? A fake EventSource stands in for the browser's.

class FakeSource {
  static all: FakeSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>();
  constructor(readonly url: string) { FakeSource.all.push(this); }
  addEventListener(type: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close() { this.closed = true; }
  open() { this.onopen?.(); }
  emit(type: string, data: unknown = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
  fail() { this.onerror?.(); }
}

const live = () => FakeSource.all.filter((s) => !s.closed);
const last = () => FakeSource.all[FakeSource.all.length - 1];

beforeEach(() => {
  FakeSource.all = [];
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeSource);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

function mount(options: Partial<Parameters<typeof useStream>[0]> = {}) {
  const seen: unknown[] = [];
  const view = renderHook((props: { enabled: boolean }) => useStream({
    query: 'role=pad&token=t', enabled: props.enabled, on: { state: (d) => seen.push(d), ping: () => {} }, ...options,
  }), { initialProps: { enabled: true } });
  return { view, seen, status: (): StreamStatus => view.result.current };
}

describe('the stream', () => {
  it('is connecting until the server answers, then live, and hands each event to its handler', () => {
    const { status, seen } = mount();
    expect(status()).toBe('connecting');
    act(() => last().open());
    expect(status()).toBe('live');
    act(() => last().emit('state', { phase: 'day' }));
    expect(seen).toEqual([{ phase: 'day' }]);
  });

  it('says it is lost when the connection fails, and is live again when it comes back', () => {
    const { status } = mount();
    act(() => last().open());
    act(() => last().fail());
    expect(status()).toBe('lost');
    act(() => last().open());
    expect(status()).toBe('live');
  });

  it('notices a line that is open but has gone quiet, and opens a new one', () => {
    const { status } = mount();
    act(() => last().open());
    expect(live()).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(STALE_MS + 5_000); });
    expect(status()).toBe('lost');
    expect(FakeSource.all.length).toBeGreaterThan(1);   // it did not wait for the browser to give up
    expect(FakeSource.all[0].closed).toBe(true);
    expect(live()).toHaveLength(1);                      // and never two at once
  });

  it('counts a ping as the server being there, so a quiet but healthy line is never taken for a dead one', () => {
    const { status } = mount();
    act(() => last().open());
    for (let i = 0; i < 6; i += 1) {
      act(() => { vi.advanceTimersByTime(8_000); last().emit('ping'); });
    }
    expect(status()).toBe('live');
    expect(FakeSource.all).toHaveLength(1);
  });

  it('opens again when the page comes back to the front, which is when a sleeping tablet has lost it', () => {
    mount();
    act(() => last().open());
    const before = FakeSource.all.length;
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(FakeSource.all.length).toBe(before + 1);
    expect(live()).toHaveLength(1);
  });

  it('stops for good when the server says the code is refused, and does not keep asking', async () => {
    const refusal = vi.fn(async () => true);
    const { status } = mount({ refusal });
    act(() => last().fail());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(status()).toBe('refused');
    const opened = FakeSource.all.length;
    act(() => { vi.advanceTimersByTime(STALE_MS * 3); });
    expect(FakeSource.all.length).toBe(opened);
    expect(live()).toHaveLength(0);
  });

  it('does not take a dropped connection for a refusal', async () => {
    const { status } = mount({ refusal: async () => false });
    act(() => last().fail());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(status()).toBe('lost');
  });

  it('opens nothing until it is enabled, and closes everything when unmounted', () => {
    const { view } = mount();
    view.rerender({ enabled: false });
    expect(live()).toHaveLength(0);
    view.rerender({ enabled: true });
    expect(live()).toHaveLength(1);
    view.unmount();
    expect(live()).toHaveLength(0);
  });
});
