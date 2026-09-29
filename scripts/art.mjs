// 장면 그림 — 장소마다 배경 한 장, 사람마다 자세별 인물 레이어 한 장.
//
//   node scripts/art.mjs --plan              그리지 않고, 무엇이 있고 무엇을 다시 그려야 하는지만
//   node scripts/art.mjs                     설명이 바뀐 그림만 다시 그린다
//   node scripts/art.mjs --add P2.stand,P6.phone   새 그림을 더한다
//
// 앱의 관찰 화면(`src/features/simulation/scene/art.ts`)이 이 그림을 쓴다. 그림은 저장소 밖
// `local-data/art/` 에 두고(MEDIAL_ART_DIR 로 바꿀 수 있다), real 서버와 sim 서버가
// `GET /api/sim/village/art` 로 내준다. 합성 마을에는 주지 않는다.
//
// 이름 규칙은 앱과 같다: 배경은 장소 키(FARM·HOME·SHOP…), 사람은 `<id>.<자세>`, 그 자리에서
// 하던 일은 `<id>.work.<장소>`. 무엇을 그릴지는 이름으로 준다 — 이미 그린 것은 `index.json` 에
// 있고, 새로 필요한 것은 `--add` 로 더한다. 앱은 그림이 없는 사람·자세를 도식으로 그리므로,
// 빠진 그림은 오류가 아니다.
//
// 그림은 입력으로 캐시한다(index.json 에 모델+프롬프트+크기의 해시). 설명 한 줄을 고치면
// 그 그림만 다시 그린다. 해시 규칙은 2026-09-28 에 그린 35장과 같다 — 옮기면서 다시 그리지 않게.
//
// 이 그림은 **지어낸 인물**이다. 실제 주민의 사진도 모습도 아니다. 얼굴은 붓 몇 번으로만 두어
// 특정인처럼 보이지 않게 하고, 한 사람임은 옷차림 한 줄로 알아보게 한다.
//
// 키는 `server/.env` 의 OPENAI_API_KEY 에서만 읽는다. 그림 모델은 gpt-image-2.5-flare 다 —
// sunburst 와 같은 배경·인물로 비교해 붓 자국이 남는 쪽을 골랐다(D108).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART_DIR = process.env.MEDIAL_ART_DIR || path.join(ROOT, 'local-data', 'art');
const INDEX = path.join(ART_DIR, 'index.json');
const IMAGE_MODEL = process.env.MEDIAL_IMAGE_MODEL || 'gpt-image-2.5-flare';
const hash = (o) => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12);

const STYLE = [
  'Semi-realistic painted illustration, like a frame from a quiet, grounded graphic novel.',
  'Natural, slightly muted colors; soft late-September daylight in a small fishing-and-farming village on the southern coast of Korea.',
  'Eye-level camera, as if the viewer is standing a few steps away.',
  'Not photographic, not 3D render, not anime, not cartoonish. No text, letters, numbers, signs with writing, logos, watermark, or UI.',
].join(' ');
const FACE = 'The face is painted loosely, like a figure in an impressionist painting seen from a few metres away: eyes, nose and mouth are only suggested with a few soft brush strokes, no crisp eyes, no fine wrinkles, no individual likeness. Everything else (clothes, hands, shoes, props) stays detailed and sharp.';
const LAYER = 'On a fully transparent background: no floor, no ground shadow, no furniture or objects unless named.';

// ---------------------------------------------------------------------------
// 장소. 사람이 설 앞자리는 비워 둔다.
// ---------------------------------------------------------------------------
const PLACES = {
  FARM: 'A small hillside vegetable field: rows of napa cabbage and chili plants, a low stone wall, two persimmon trees, a dirt path along the edge, village roofs and the sea far below in the distance. The lower foreground is open soil between rows.',
  HOME: 'Inside a modest rural Korean house: a living room with a warm-toned vinyl floor, a low wooden cabinet, a small television, a folded blanket, a sliding glass door onto a small yard. Plain walls without any writing. Wide open floor in the foreground.',
  SHOP: 'Inside a small family-run village restaurant: a few low tables with floor cushions and two ordinary tables with stools, a stainless kettle, a rice cooker on the counter, a doorway to the kitchen. No menus or signs with writing. Open floor in the foreground.',
  FOOD: 'Inside a small village seafood-processing workshop: stainless steel work tables, blue plastic crates of dried anchovies and seaweed, rubber hoses, drying racks, a roller door open to daylight. Open concrete floor in the foreground.',
  HALL: 'Inside a village community hall: a large room with a heated floor, stacked floor cushions, a long low table, a wall fan, a notice board with blank papers pinned to it. Open floor in the foreground.',
  PATROL: 'A narrow concrete lane in the village between low stone walls and houses with blue and orange roofs, potted plants, a small parked scooter, the harbour glimpsed down the slope. Open lane in the foreground.',
  PORT: 'The village harbour: a concrete quay and a short breakwater, three or four small white-and-blue Korean fishing boats moored, stacked plastic fish crates, coiled ropes, orange buoys, a few low houses and green hills behind. Calm sea, mid-morning. The lower-middle foreground is an open stretch of quay.',
  SEA: 'On the deck of a small Korean fishing boat out at sea: the gunwale, a net-hauling winch, coiled nets and floats, open sea with islands in the distance. Camera at standing eye level on the deck; open deck in the foreground.',
  TOWN: 'A street in a small Korean county town: two- and three-storey buildings with a clinic and a pharmacy at street level (their signs are plain coloured panels with no readable writing), parked cars, a bus shelter. Open pavement in the foreground.',
  CAR: 'Inside a small Korean car, seen from the middle of the dashboard looking back at the two empty front seats, the back seat and the rear window showing a coastal road. Daylight. The seats fill the lower half of the frame.',
  CLINIC: 'Inside a rural public health sub-centre office: a desk with a phone and a monitor turned away, a blood-pressure monitor, cabinets with blank folders, a window with daylight, a plain office chair pushed aside. Open floor in the foreground.',
};

// ---------------------------------------------------------------------------
// 사람. 한 사람을 여러 자세에서 알아보게 하는 것은 옷차림 한 줄이다.
// 성별은 익명 페르소나에 없어 **참여자 인적사항(저장소 밖)에서 P번호별 성별만** 옮겼다(연구자 허락,
// 2026-09-28). 이름·생년·주소는 옮기지 않는다. 이름으로 짐작하지 않는다 — 조기범(P11)은 여성이다.
// 나이·직업·몸 상태는 익명 페르소나에서 온다. 보건소 담당과 구급대원은 실제 인물이 아니다.
// 설명이 없는 사람은 --plan 이 알려 주고, 그 사람의 그림은 만들지 않는다.
// ---------------------------------------------------------------------------
const man = (look) => ({ sex: 'm', look }), woman = (look) => ({ sex: 'f', look });
const PEOPLE = {
  P1: man('a lean, wiry Korean man in his early 70s, a lifelong farmer who is still healthy and upright for his age: close-cropped white hair under a wide-brimmed beige cotton sun hat, a faded long-sleeved khaki work shirt with cloth arm sleeves, grey work trousers, short rubber boots'),
  P2: man('a Korean man in his mid 60s who spent years in construction sales, a little thinner and more worn than he used to be: neatly combed grey hair, a beige windbreaker over a collared polo shirt, dark slacks, walking shoes'),
  P3: man('a Korean man in his mid 60s, once an office worker, holding himself a little stiffly from an old injury: thinning grey hair, rimless glasses, a navy quilted vest over a light-blue button-down shirt, beige chinos, a small crossbody bag'),
  P4: man('a broad-shouldered Korean man in his mid 50s who runs the village seafood workshop after years at sea: short black hair, a white rubber apron over a dark grey sweatshirt with rolled-up sleeves, white rubber boots'),
  P5: man('a compact, deeply tanned Korean man in his late 60s who both fishes and farms: short grey hair under a dark green cap, an unzipped faded orange waterproof jacket over a brown t-shirt, dark work trousers, rubber boots'),
  P6: man('an energetic Korean man in his mid 50s, the village head, always busy with village errands: short black hair, a sporty dark-blue windbreaker over a white polo shirt, black trousers, sneakers, a small notebook in the chest pocket'),
  // 형 고성진(58)과 동생 고성재(57) — 같은 배를 타는 어부.
  P7: man('a Korean man in his late 50s who has fished his whole life: sturdy build, sun-weathered skin, short greying hair under a faded grey-blue cap, a worn navy work jacket over a grey t-shirt, dark work trousers, black rubber boots'),
  P8: man('a Korean man in his late 50s, a fisherman with a heavier, tired-looking build: short black-and-grey hair, no cap, an olive-green fleece vest over a faded red-checked flannel shirt, grey work trousers, dark rubber boots'),
  P9: man('a fit, neatly groomed Korean man in his late 50s who runs a guesthouse: short salt-and-pepper hair, a light grey zip-up hoodie over a dark t-shirt, jeans, clean white sneakers'),
  // 익명 페르소나: 70대, P11과 부부로 마을 식당을 함께 한다. 그 밖의 모습은 지어낸 것이다.
  P10: man('a Korean man in his mid 70s who runs the village restaurant with his wife, still steady and quietly capable: short thinning grey hair, a dark brown padded vest over a blue-and-white checked flannel shirt, grey trousers, black slip-on shoes'),
  P11: woman('a small Korean woman close to 80 who runs the village restaurant with her husband, slightly stooped and aching in several places: short permed grey hair, a floral blouse under a dark knit cardigan, a patterned kitchen apron, loose trousers, rubber slip-on shoes'),
  P12: man('a quiet, reserved Korean man in his early 60s who runs a small business of his own: short grey hair, a charcoal fleece jacket over a plain beige shirt, grey trousers, brown leather work shoes'),
  CLINIC: woman('a Korean woman in her mid 40s, the community health practitioner of the sub-centre: black hair tied back, a white clinic gown over a navy knit top, an ID lanyard with no readable writing'),
  MEDIC: man('a Korean paramedic in his 30s: a navy emergency-services uniform with reflective stripes and no readable lettering, blue nitrile gloves'),
};

/** 자세 설명은 남성 대명사로 적어 두고 여성이면 바꾼다 — 남성의 요청 문장이 그대로라 캐시가 산다. */
const pronoun = (text, sex) => (sex === 'm' ? text
  : text.replace(/\bhimself\b/g, 'herself').replace(/\bhim\b/g, 'her').replace(/\bhis\b/g, 'her').replace(/\bhe\b/g, 'she'));

const TALL = '1024x1536', WIDE = '1536x1024', SQUARE = '1024x1024';

/** 자세마다: 크기와 몸의 설명. `work` 는 그 자리에서 하던 일이라 장소가 붙는다. */
const POSE = {
  stand: { size: TALL, body: 'Full body, standing relaxed, body turned three-quarters, as if in conversation with someone just beside him.' },
  phone: { size: TALL, body: 'Full body, standing, holding a mobile phone to his ear, head slightly lowered as he listens.' },
  desk: { size: TALL, body: 'Full body, seated on a plain office chair (draw the chair), holding a desk-phone receiver to the ear, a pen in the other hand.' },
  drive: { size: SQUARE, body: 'Seen from the waist up in the driver\'s seat, the frame cropping at the waist: both arms reaching forward and down out of frame as if holding a steering wheel (do not draw the wheel), a seatbelt across the chest, eyes on the road ahead.' },
  seated: { size: SQUARE, body: 'Seen from the waist up in a car passenger seat, the frame cropping at the waist: a seatbelt across the chest, turned slightly toward the driver as if talking.' },
  lying: { size: WIDE, body: 'Lying unconscious on his back on a floor, eyes closed, arms loose at his sides, seen from the eye level of someone kneeling nearby. Calm and non-graphic: no injury, no blood.' },
  'work.FARM': { size: TALL, body: 'Full body, crouching over a vegetable row, weeding with a short Korean hand hoe (homi) in one hand, work gloves, absorbed in the work and not looking up.' },
  'work.SEA': { size: TALL, body: 'Full body, standing with feet apart, pulling a wet fishing net hand over hand with rubber gloves, absorbed in the work and not looking up.' },
};

/** 그림 하나의 요청. 모르는 장소·사람·자세면 그 이유. */
function jobOf(name) {
  if (PLACES[name]) return { job: { size: WIDE, transparent: false, prompt: `${STYLE}\nScene: ${PLACES[name]} No people.` } };
  const [id, ...rest] = name.split('.');
  const pose = rest.join('.');
  if (!PEOPLE[id]) return { why: `${id} 의 모습이 정해지지 않았다 (PEOPLE)` };
  if (!POSE[pose]) return { why: `자세 ${pose} 를 모른다 (POSE)` };
  const P = POSE[pose], who = PEOPLE[id];
  return { job: { size: P.size, transparent: true, prompt: `${STYLE}\n${LAYER} A single figure: ${who.look}. ${pronoun(P.body, who.sex)} ${FACE}` } };
}

// ---------------------------------------------------------------------------

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJSON = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n', 'utf8'); };
const keyOf = (job) => hash([IMAGE_MODEL, job.prompt, job.size, job.transparent]);

function args(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return out;
}

function keyFromServerEnv() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const envPath = path.join(ROOT, 'server', '.env');
  if (!fs.existsSync(envPath)) return null;
  for (const raw of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    const i = line.indexOf('=');
    if (line.startsWith('#') || i < 0 || line.slice(0, i).trim() !== 'OPENAI_API_KEY') continue;
    return line.slice(i + 1).trim().replace(/^["']|["']$/g, '') || null;
  }
  return null;
}

/** 한 장. webp 로 받는다 — 투명을 지키면서 png 의 몇 분의 일 크기다. 429·5xx·네트워크만 다시. */
async function draw({ prompt, size, transparent }) {
  const key = keyFromServerEnv();
  if (!key) throw new Error('키가 없다. server/.env 에 OPENAI_API_KEY 를 둔다.');
  for (let attempt = 1; ; attempt++) {
    let status = 0;
    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: IMAGE_MODEL, prompt, size, quality: 'high', n: 1,
          output_format: 'webp', output_compression: 85, ...(transparent ? { background: 'transparent' } : {}) }),
      });
      status = res.status;
      const text = await res.text();
      if (!res.ok) throw new Error(`openai ${res.status}: ${text.slice(0, 200)}`);
      return Buffer.from(JSON.parse(text).data[0].b64_json, 'base64');
    } catch (e) {
      const again = status === 429 || status >= 500 || (status === 0 && attempt < 5);
      if (!again || attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, Math.min(30000, 800 * 2 ** attempt)));
    }
  }
}

async function main() {
  const a = args();
  const index = fs.existsSync(INDEX) ? readJSON(INDEX) : {};
  const added = a.add ? String(a.add).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const names = [...new Set([...Object.keys(index), ...added])].sort();

  const todo = [];
  for (const name of names) {
    const { job, why } = jobOf(name);
    if (!job) { console.log(`  ${name}: 그리지 않음 — ${why}`); continue; }
    const key = keyOf(job);
    const have = index[name]?.key === key && fs.existsSync(path.join(ART_DIR, index[name].file));
    if (!have) todo.push({ name, job, key });
  }
  console.log(`그림 ${names.length}장 · 그릴 것 ${todo.length}장 · 모델 ${IMAGE_MODEL} · ${ART_DIR}`);
  if (a.plan || !todo.length) return;

  // 한 장씩, 한 장마다 index 를 남긴다 — 끊겨도 그린 것은 다시 그리지 않는다.
  for (const [i, { name, job, key }] of todo.entries()) {
    const file = `${name}.webp`;
    fs.mkdirSync(ART_DIR, { recursive: true });
    fs.writeFileSync(path.join(ART_DIR, file), await draw(job));
    index[name] = { key, file, size: job.size, model: IMAGE_MODEL };
    writeJSON(INDEX, index);
    console.log(`  [${i + 1}/${todo.length}] ${name}`);
  }
}

await main();
