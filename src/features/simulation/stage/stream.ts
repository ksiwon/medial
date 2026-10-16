import { useEffect, useRef, useState } from 'react';
import { STAGE_API } from './protocol';

// One listener for both screens: a stream of events from the server that notices when it has gone quiet.
//
// A browser's EventSource retries a dropped connection by itself, but it cannot tell a connection that
// is still open from one that went half-dead (a wifi hop, an iPad that slept): nothing arrives and
// nothing fails. The server therefore sends a "ping" event every few seconds, and when none has been
// seen for STALE_MS the stream is closed and opened again. It also opens again when the page comes back
// to the front or the network returns - the moments a tablet is most likely to have lost it.

/** The server pings this often (api/stage.py PING_SECONDS); silence for about three of them is a dead stream. */
export const STALE_MS = 24_000;
const WATCH_MS = 4_000;

export type StreamStatus = 'connecting' | 'live' | 'lost' | 'refused';

type Handler = (data: unknown) => void;

export interface StreamOptions {
  /** The query (without the leading ?) that says who is listening. */
  query: string;
  /** Called with each named event's parsed data. */
  on: Record<string, Handler>;
  /** Set false to hold the stream closed (a tablet that has not said "connect" yet). */
  enabled?: boolean;
  /** A stream the server turned away: stop for good (the code is wrong, or old). */
  refusal?: () => Promise<boolean>;
}

/** Opens `${STAGE_API}/events?query` while enabled; returns how the connection is doing. */
export function useStream({ query, on, enabled = true, refusal }: StreamOptions): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>('connecting');
  // The handlers are read when an event arrives, so a re-render never reopens the stream.
  const handlers = useRef(on);
  handlers.current = on;
  const asked = useRef(refusal);
  asked.current = refusal;

  useEffect(() => {
    if (!enabled) return undefined;
    let source: EventSource | null = null;
    let seen = Date.now();
    let closed = false;
    let refused = false;

    const names = () => Object.keys(handlers.current);
    const open = () => {
      if (closed || refused) return;
      source?.close();
      seen = Date.now();
      // Trying again does not mean the line is back: what the visitor was told stays until a new one opens.
      setStatus((s) => (s === 'live' || s === 'lost' ? s : 'connecting'));
      const next = new EventSource(`${STAGE_API}/events?${query}`);
      source = next;
      next.onopen = () => { seen = Date.now(); setStatus('live'); };
      next.onerror = () => {
        setStatus('lost');
        // A refused code and a dropped connection look the same to a browser; ask which it is.
        void asked.current?.().then((no) => {
          if (no && !closed) { refused = true; next.close(); setStatus('refused'); }
        }).catch(() => {});
      };
      for (const name of names()) {
        next.addEventListener(name, (event) => {
          seen = Date.now();
          let data: unknown = null;
          try { data = JSON.parse((event as MessageEvent<string>).data); } catch { /* an event with no body */ }
          handlers.current[name]?.(data);
        });
      }
    };

    open();
    const watch = window.setInterval(() => {
      if (!closed && !refused && Date.now() - seen > STALE_MS) { setStatus('lost'); open(); }
    }, WATCH_MS);
    const wake = () => { if (document.visibilityState !== 'hidden') open(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      closed = true;
      source?.close();
      window.clearInterval(watch);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
    // The query is the stream's identity: a new one is a different listener.
  }, [query, enabled]);

  return status;
}
