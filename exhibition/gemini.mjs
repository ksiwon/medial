// gemini-3.8-flash 어댑터.
//
// 서버(`server/app/simulation/iteration/llm*.py`)와 같은 제공자를 쓰지만 이 데모는 파이썬
// 서버를 거치지 않는다. 대신 규약은 같게 지킨다:
//   · 키는 `server/.env` 에서만 읽는다. 키가 없으면 부르지 않고 멈춘다
//   · 응답을 받은 호출은 받은 즉시 원장에 한 줄 남긴다 (exhibition/out/spend.jsonl)
//   · 재시도는 지수 백오프, 429·5xx·네트워크만. 실패를 규칙 결과로 대체하지 않는다
//
// Gemini는 OpenAI 호환 엔드포인트를 쓴다. 생각 토큰이 출력 한도에 포함되므로 max_tokens 를
// 넉넉히 주고 reasoning_effort 를 낮춘다 — 한도일 뿐이라 안 쓰면 청구되지 않는다.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
export const MODEL = process.env.EUNJEOM_MODEL || 'gemini-3.8-flash';
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export const OUT = path.join(HERE, 'out');
const LEDGER = path.join(OUT, 'spend.jsonl');

/**
 * 키는 `server/.env` 에서만 읽는다 (저장소 규칙: "키는 server/.env 에만 둔다").
 * dotenv 에 기대지 않고 직접 읽는다 — 이 저장소의 node 쪽에는 그 의존성이 없고,
 * server/.env 가 Windows CRLF 인 경우도 있다.
 */
function keyFromServerEnv() {
  const envPath = process.env.MEDIAL_ENV || path.resolve(HERE, '..', 'server', '.env');
  if (!fs.existsSync(envPath)) return null;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    if (k !== 'GOOGLE_API_KEY' && k !== 'GEMINI_API_KEY') continue;
    return line.slice(i + 1).trim().replace(/^["']|["']$/g, '') || null;
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const retryable = (status, msg) =>
  status === 429 || (status >= 500 && status < 600) ||
  /rate|overload|timeout|econnreset|socket|fetch failed|unavailable|resource_exhausted/i.test(msg);

function ledger(row) {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    fs.appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n', 'utf8');
  } catch { /* 원장 실패로 호출을 다시 부르지 않는다 */ }
}

/**
 * chat({ system, user, maxTokens, tag }) → { text, usage, latencyMs, attempt }
 * 실패하면 마지막 오류를 던진다. 규칙 결과로 대신하지 않는다.
 */
export async function chat({ system, user, maxTokens = 2048, tag = null, maxAttempts = 5 }) {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || keyFromServerEnv();
  if (!key) throw new Error('키가 없다. server/.env 에 GOOGLE_API_KEY 를 두거나 환경변수로 준다 (양식은 server/.env.example).');

  let last;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const callId = randomUUID();
    const t0 = Date.now();
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          max_tokens: maxTokens,
          reasoning_effort: 'low',
        }),
      });
      const latencyMs = Date.now() - t0;
      const body = await res.text();
      if (!res.ok) {
        ledger({ callId, attempt, latencyMs, outcome: 'error', status: res.status, tag, error: body.slice(0, 300) });
        const e = new Error(`gemini ${res.status}: ${body.slice(0, 200)}`);
        e.status = res.status;
        throw e;
      }
      const json = JSON.parse(body);
      const text = json.choices?.[0]?.message?.content ?? '';
      ledger({ callId, attempt, latencyMs, outcome: 'ok', model: json.model, tag,
        usage: json.usage, finishReason: json.choices?.[0]?.finish_reason });
      return { text, usage: json.usage, latencyMs, attempt, callId,
        finishReason: json.choices?.[0]?.finish_reason };
    } catch (e) {
      last = e;
      const status = e.status ?? 0;
      if (!retryable(status, String(e?.message || e)) || attempt === maxAttempts) throw e;
      await sleep(Math.min(30000, 800 * 2 ** attempt) + Math.random() * 400);
    }
  }
  throw last;
}

/** 지금까지 이 데모가 쓴 토큰. */
export function spend() {
  if (!fs.existsSync(LEDGER)) return { calls: 0, input: 0, output: 0 };
  let calls = 0, input = 0, output = 0;
  for (const line of fs.readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.outcome !== 'ok') continue;
    calls++;
    input += r.usage?.prompt_tokens || 0;
    output += r.usage?.completion_tokens || 0;
  }
  return { calls, input, output };
}
