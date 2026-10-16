import { describe, expect, it } from 'vitest';
import { createBus, postTo, type PressResult } from './bus';
import type { Command } from './protocol';
import { forgetPadToken, hasJoined, padAddress, padToken, rememberJoined, type PadKeep } from './protocol';

// What keeps two screens from tripping over each other, with no browser and no server: the order of
// presses, what the tablet is told came of each, and how a tablet remembers which code it joined.

const memory = (): PadKeep & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
};

/** A post that can be held: the test says when each one is answered. */
function held() {
  const sent: Command[] = [];
  const waiting: ((r: PressResult) => void)[] = [];
  const post = (command: Command) => new Promise<PressResult>((resolve) => { sent.push(command); waiting.push(resolve); });
  const answer = async (result: PressResult = { kind: 'ok' }) => { waiting.shift()!(result); await Promise.resolve(); await Promise.resolve(); };
  return { post, sent, answer };
}

describe('the press bus', () => {
  it('keeps one press in flight and sends the rest in the order they were pressed', async () => {
    const h = held();
    const bus = createBus(h.post, () => {});
    bus.send({ name: 'togglePlay' });
    bus.send({ name: 'skipScene' });
    bus.send({ name: 'readEvaluations' });
    expect(h.sent.map((c) => c.name)).toEqual(['togglePlay']);
    await h.answer();
    expect(h.sent.map((c) => c.name)).toEqual(['togglePlay', 'skipScene']);
    await h.answer();
    await h.answer();
    expect(h.sent.map((c) => c.name)).toEqual(['togglePlay', 'skipScene', 'readEvaluations']);
  });

  it('replaces a seek that has not been sent with the newer one, and never reorders around it', async () => {
    const h = held();
    const bus = createBus(h.post, () => {});
    bus.send({ name: 'togglePlay' });            // in flight
    bus.send({ name: 'seek', value: 100 });
    bus.send({ name: 'commit' });
    bus.send({ name: 'seek', value: 300 });      // the finger moved on: the old seek is stale
    expect(bus.pending()).toBe(2);
    await h.answer(); await h.answer(); await h.answer();
    expect(h.sent).toEqual([{ name: 'togglePlay' }, { name: 'commit' }, { name: 'seek', value: 300 }]);
  });

  it('says what came of each press, and a failed post does not stop the ones behind it', async () => {
    const results: [string, string][] = [];
    const calls: string[] = [];
    const bus = createBus(async (c) => {
      calls.push(c.name);
      if (c.name === 'skipScene') throw new Error('network down');
      return c.name === 'goImprove' ? { kind: 'no-wall' } : { kind: 'ok' };
    }, (c, r) => results.push([c.name, r.kind]));
    bus.send({ name: 'togglePlay' });
    bus.send({ name: 'skipScene' });
    bus.send({ name: 'goImprove' });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(['togglePlay', 'skipScene', 'goImprove']);
    expect(results).toEqual([['togglePlay', 'ok'], ['skipScene', 'failed'], ['goImprove', 'no-wall']]);
  });
});

describe('what the server answers to a press', () => {
  const reply = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('reads a refused code, a press nobody heard, a failure, and a press that was done', async () => {
    const press: Command = { name: 'togglePlay' };
    expect(await postTo('t', reply(403))(press)).toEqual({ kind: 'refused' });
    expect(await postTo('t', reply(200, { delivered: 0 }))(press)).toEqual({ kind: 'no-wall' });
    expect(await postTo('t', reply(500))(press)).toEqual({ kind: 'failed', reason: 'HTTP 500' });
    expect(await postTo('t', reply(200, { delivered: 1 }))(press)).toEqual({ kind: 'ok' });
  });

  it('sends the code with the press, and a missing code as an empty one the server will refuse', async () => {
    const urls: string[] = [];
    const spy = (async (url: string) => { urls.push(url); return new Response('{"delivered":1}'); }) as unknown as typeof fetch;
    await postTo('a b&c', spy)({ name: 'start' });
    await postTo(null, spy)({ name: 'start' });
    expect(urls[0]).toBe('/api/sim/stage/command?token=a%20b%26c');
    expect(urls[1]).toBe('/api/sim/stage/command?token=');
  });
});

describe('how a tablet remembers the code it joined with', () => {
  it('takes the code from the address and keeps it for a reload that has none', () => {
    const keep = memory();
    expect(padToken('?role=pad&t=abc', keep)).toBe('abc');
    expect(padToken('?role=pad', keep)).toBe('abc');
    expect(padToken('?role=pad', memory())).toBeNull();
  });

  it('asks to connect again for a new code, and not again for the same one', () => {
    const keep = memory();
    padToken('?t=one', keep);
    expect(hasJoined('one', keep)).toBe(false);
    rememberJoined('one', keep);
    expect(hasJoined('one', keep)).toBe(true);
    padToken('?t=one', keep);                    // the same code, opened again
    expect(hasJoined('one', keep)).toBe(true);
    padToken('?t=two', keep);                    // the server restarted: a new code is a new pairing
    expect(hasJoined('two', keep)).toBe(false);
    expect(hasJoined('one', keep)).toBe(false);
  });

  it('forgets everything when the code is refused, and survives storage that throws', () => {
    const keep = memory();
    padToken('?t=one', keep); rememberJoined('one', keep);
    forgetPadToken(keep);
    expect(padToken('', keep)).toBeNull();
    expect(hasJoined('one', keep)).toBe(false);
    const blocked: PadKeep = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    expect(padToken('?t=x', blocked)).toBe('x');   // the address still works for this load
    expect(hasJoined('x', blocked)).toBe(false);
    expect(() => forgetPadToken(blocked)).not.toThrow();
  });

  it('builds the address a code sends a tablet to, with the token escaped', () => {
    expect(padAddress('http://192.168.0.5:5180', 'a/b+c')).toBe('http://192.168.0.5:5180/?role=pad&t=a%2Fb%2Bc');
  });
});
