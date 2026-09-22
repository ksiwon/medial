// 동시성 풀과 인자 파싱.
//
// mas-parity 저장소의 `runner/lib/util.mjs` 에서 이 두 함수만 가져다 썼다. 전시 데모가
// 그 저장소에 기대지 않도록 여기로 옮긴다. 원본과 동작이 같아야 할 이유는 없다 —
// 사전등록된 난수(fnv1a·mulberry32)는 이 데모가 쓰지 않으므로 가져오지 않았다.

/** 동시성 제한 풀. 워커가 던지면 결과 자리에 {error}를 넣고 계속한다. */
export async function pool(items, limit, worker, onProgress) {
  const results = new Array(items.length);
  let i = 0, done = 0;
  async function lane() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (e) {
        results[idx] = { error: String(e?.stack || e) };
      }
      onProgress?.(++done, items.length, items[idx], results[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, limit) }, lane));
  return results;
}

/** `--k v` · `--k=v` · `--flag` 만 받는다. 나머지는 _ 배열로. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out[k] = true;
  }
  return out;
}
