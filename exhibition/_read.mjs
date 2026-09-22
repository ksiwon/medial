// 생성된 대화록을 사람이 읽기 좋게 찍는다.  node exhibition/_read.mjs [노드id]
import fs from 'node:fs';
import path from 'node:path';
import { OUT } from './gemini.mjs';

const b = JSON.parse(fs.readFileSync(path.join(OUT, 'bundle.json'), 'utf8'));
const name = Object.fromEntries([...b.people.map((p) => [p.id, p.name]), ...Object.entries(b.roles)]);
const want = process.argv[2];

for (const n of b.nodes) {
  const sc = b.scenes[n.key];
  if (!sc) continue;
  if (want && n.id !== want) continue;
  console.log(`\n${'='.repeat(78)}\n노드 ${n.id} · ${n.day}일차 · ${n.title}`);
  console.log(`선택: ${n.choice.kind === 'initial' ? n.choice.title : n.choice.title}`);
  for (const t of n.tasks) {
    const tr = sc.transcripts[t.id];
    console.log(`\n── ${t.start}–${t.end} [${t.type}] ${t.title} (${t.outcome}) · ${t.channel}`);
    console.log(`   ${t.scene}`);
    if (tr?.flags?.length) console.log(`   [플래그 ${tr.flags.join(' ')}]`);
    for (const l of tr?.lines ?? []) console.log(`   ${name[l.speaker] ?? l.speaker}: ${l.text}`);
  }
  console.log('\n── 하루가 끝나고');
  for (const r of sc.reviews ?? []) console.log(`   ${name[r.speaker] ?? r.speaker}: ${r.text}`);
  if (n.options.length) {
    console.log('\n── 디자이너에게 주어지는 선택');
    n.options.forEach((o, i) => console.log(`   ${i + 1}) ${o.title}\n      왜: ${o.because}\n      ${o.beforeSentence} → ${o.afterSentence}`));
  }
}
