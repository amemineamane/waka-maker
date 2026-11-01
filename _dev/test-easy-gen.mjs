// js/easy-gen.js の単体テスト（Node）。使い方: node _dev/test-easy-gen.mjs
// 全題材 × 全気持ち × 全季節（＋おまかせ）で 3 首作れて例外が出ないこと、
// 5/7/5/7/7 が守られること、同じ key が 1 首に 2 回出ないこと などを確かめる。
// 「ことば」(DESIGN 13.2): data/easy-modern.js があれば読み込み、無ければ modern の句を合成して
// classic に modern の句が混ざらないこと・modern の結果の大半が modern の句であること を確かめる。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// data/easy.js は window.WAKA に代入する形なので、window を模して読む
const fake = { WAKA: {} };
new Function('window', fs.readFileSync(path.join(root, 'data/easy.js'), 'utf8'))(fake);
const E = fake.WAKA.easy;
// classic の結果が modern の句の有無で変わらないことを見るため、追加前の句を残しておく
const classicOnly = JSON.parse(JSON.stringify(E));
const modernFile = path.join(root, 'data/easy-modern.js');
const hasModernFile = fs.existsSync(modernFile);
if (hasModernFile) new Function('window', fs.readFileSync(modernFile, 'utf8'))(fake);
else synthModern(E);
// data/easy-modern.js が無いときの代わり: 各 role に modern: true の句を合成する（音数だけ正しいダミー）
function synthModern(D) {
  const K5 = 'あいうえお', K7 = 'かきくけこさし';
  let n = 0;
  const add = (role, o) => { n++; D.phrases.push(Object.assign({ role, text: `現${role}${n}`, kana: role.endsWith('5') ? K5 : K7, key: `modern-${n}`, subject: null, mood: null, season: [], m: `現代の句${n}`, modern: true }, o)); };
  D.subjects.forEach(s => {
    for (let i = 0; i < 3; i++) add('S5', { subject: s.id, season: s.season.slice(), pos3Ok: i < 2 ? true : undefined });
    for (let i = 0; i < 3; i++) add('S7', { subject: s.id, season: s.season.slice() });
  });
  D.moods.forEach(m => {
    for (let i = 0; i < 5; i++) add('M7', { mood: m.id });
    for (let i = 0; i < 3; i++) add('C7', { mood: m.id });
  });
  for (let i = 0; i < 25; i++) add('J5', {});
  for (let i = 0; i < 20; i++) add('C7', {});
}
const modernCount = E.phrases.filter(p => p.modern === true).length;
const mora = require(path.join(root, 'js/mora.js'));
const gen = require(path.join(root, 'js/easy-gen.js'));

// 再現できる乱数
function seeded(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const TARGET = [5, 7, 5, 7, 7];
// 既存の検査は classic の結果を見るので、古風の句だけで引く（modern に同じ本文・読みの句があるため）
const byText = new Map(classicOnly.phrases.map(p => [p.text + '|' + p.kana, p]));
const fails = [];
let poems = 0, combos = 0, relaxed = 0, overlap = 0, withMeaning = 0;
const fail = (m) => { if (fails.length < 30) fails.push(m); };

const seasons = [null, '春', '夏', '秋', '冬'];
const subjects = [null, ...E.subjects.map(s => s.id)];
const moods = [null, ...E.moods.map(m => m.id)];
let seed = 1;
for (const season of seasons) for (const subject of subjects) for (const mood of moods) {
  combos++;
  const tag = `${season || '問わない'}×${subject || 'おまかせ'}×${mood || 'おまかせ'}`;
  let res;
  try { res = gen.make({ season, subject, mood, count: 3, rng: seeded(seed++), data: E }); }
  catch (e) { fail(`${tag}: 例外 ${e.message}`); continue; }
  if (!Array.isArray(res) || res.length !== 3) { fail(`${tag}: ${res && res.length} 首しか作れない`); continue; }
  res.forEach((p, n) => {
    poems++;
    if (p.relax > 0) relaxed++;
    const keys = new Set();
    for (let i = 0; i < 5; i++) {
      const c = mora.count(p.kana[i]);
      if (c !== TARGET[i]) fail(`${tag} #${n}: ${i + 1} 句目「${p.ku[i]}」(${p.kana[i]}) が ${c} 音`);
      const ph = byText.get(p.ku[i] + '|' + p.kana[i]);
      if (!ph) { fail(`${tag} #${n}: phrases に無い句「${p.ku[i]}」`); continue; }
      if (ph.role !== p.roles[i]) fail(`${tag} #${n}: role 不一致 ${ph.role} / ${p.roles[i]}`);
      if (p.slots[i].endsWith('!') && !ph.pos3Ok) fail(`${tag} #${n}: S5! に pos3Ok でない句「${ph.text}」`);
      if (ph.modern === true) fail(`${tag} #${n}: classic に modern の句「${ph.text}」`);
      if (keys.has(ph.key)) fail(`${tag} #${n}: key「${ph.key}」が 2 回`);
      keys.add(ph.key);
      // 題材を選んだら S5/S7 はその題材の句（条件を外していない限り）
      if (subject && ph.subject && ph.subject !== subject && p.relax === 0) fail(`${tag} #${n}: 題材違いの句「${ph.text}」`);
      if (p.mood && ph.mood && ph.mood !== p.mood && p.relax === 0) fail(`${tag} #${n}: 気持ち違いの句「${ph.text}」`);
    }
    // 大意: 句の m を「、」でつないで「。」。m の無い句は「…」（全部無ければ ''）
    const ms = p.ku.map((t, i) => (byText.get(t + '|' + p.kana[i]) || {}).m);
    if (typeof p.meaning !== 'string') fail(`${tag} #${n}: meaning が文字列でない`);
    else if (p.meaning !== gen.joinMeaning(ms)) fail(`${tag} #${n}: meaning 不一致「${p.meaning}」`);
    else if (ms.every(m => m && String(m).trim())) {
      if (p.meaning !== ms.map(m => String(m).trim()).join('、') + '。') fail(`${tag} #${n}: meaning の形「${p.meaning}」`);
      withMeaning++;
    }
    if (!Array.isArray(p.ms) || p.ms.length !== 5) fail(`${tag} #${n}: ms が 5 要素でない`);
    if (subject && p.subject !== subject) fail(`${tag} #${n}: subject が ${p.subject}`);
    if (mood && p.mood !== mood) fail(`${tag} #${n}: mood が ${p.mood}`);
  });
  for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
    const same = [0, 1, 2, 3, 4].filter(i => res[a].ku[i] === res[b].ku[i]).length;
    if (same >= 3) overlap++;
  }
}

/* ---------- ことば（DESIGN 13.2） ---------- */
// classic は modern の句があっても、無いときと同じ結果（同じ乱数で）
{
  let diff = 0, n = 0;
  for (const subject of [null, 'sakura', E.subjects[5].id]) for (const season of [null, '秋']) for (const words of [undefined, 'classic', 'bogus']) {
    const a = gen.make({ season, subject, mood: 'koishi', words, count: 3, rng: seeded(500 + n), data: E });
    const b = gen.make({ season, subject, mood: 'koishi', count: 3, rng: seeded(500 + n), data: classicOnly });
    n++;
    if (JSON.stringify(a.map(p => p.ku)) !== JSON.stringify(b.map(p => p.ku))) diff++;
    if (a.some(p => p.words !== 'classic')) fail(`words=${words} で戻り値の words が classic でない`);
  }
  if (diff) fail(`classic の結果が modern の句の有無で変わった ${diff} 件`);
}
// modern: 5/7/5/7/7・key 重複なし・S5! は pos3Ok・大半が modern の句
let mPoems = 0, mSlots = 0, mModern = 0;
for (const season of seasons) for (const subject of subjects) for (const mood of [null, ...E.moods.map(m => m.id).filter((_, i) => i % 3 === 0)]) {
  const tag = `modern ${season || '問わない'}×${subject || 'おまかせ'}×${mood || 'おまかせ'}`;
  let res;
  try { res = gen.make({ season, subject, mood, words: 'modern', count: 3, rng: seeded(seed++), data: E }); }
  catch (e) { fail(`${tag}: 例外 ${e.message}`); continue; }
  if (res.length !== 3) { fail(`${tag}: ${res.length} 首しか作れない`); continue; }
  res.forEach((p, n) => {
    mPoems++;
    if (p.words !== 'modern') fail(`${tag} #${n}: words が ${p.words}`);
    const keys = new Set();
    for (let i = 0; i < 5; i++) {
      const c = mora.count(p.kana[i]);
      if (c !== TARGET[i]) fail(`${tag} #${n}: ${i + 1} 句目「${p.ku[i]}」(${p.kana[i]}) が ${c} 音`);
      // 同じ本文・読みの句が古風と modern の両方にあることがあるので、key で特定し modern を優先
      const ms_ = E.phrases.filter(x => x.text === p.ku[i] && x.kana === p.kana[i] && x.role === p.roles[i] && x.key === p.keys[i]);
      const ph = ms_.find(x => x.modern === true) || ms_[0];
      if (!ph) { fail(`${tag} #${n}: phrases に無い句「${p.ku[i]}」`); continue; }
      if (p.slots[i].endsWith('!') && !ph.pos3Ok) fail(`${tag} #${n}: S5! に pos3Ok でない句「${ph.text}」`);
      if (keys.has(ph.key)) fail(`${tag} #${n}: key「${ph.key}」が 2 回`);
      keys.add(ph.key);
      if (subject && ph.subject && ph.subject !== subject && p.relax === 0) fail(`${tag} #${n}: 題材違いの句「${ph.text}」`);
      mSlots++; if (ph.modern === true) mModern++;
    }
  });
}
const modernRate = mSlots ? mModern / mSlots : 0;
if (modernRate < 0.8) fail(`modern の結果のうち modern の句が ${(modernRate * 100).toFixed(1)}%（8 割未満）`);
// 題材一致は modern より優先（題材の modern 句が無ければ、その題材の古風の句を使う）
{
  const D = JSON.parse(JSON.stringify(E));
  D.phrases = D.phrases.filter(p => !(p.modern && p.subject === 'sakura'));
  const r = gen.make({ season: '春', subject: 'sakura', mood: null, words: 'modern', count: 3, rng: seeded(31), data: D });
  r.forEach(p => p.ku.forEach((t, i) => {
    if (!/^S/.test(p.roles[i])) return;
    const ph = D.phrases.find(x => x.text === t && x.kana === p.kana[i]);
    if (ph && ph.subject && ph.subject !== 'sakura') fail(`題材の modern 句が無いとき、ほかの題材の modern 句「${t}」を使った`);
  }));
}
// modern の句が 1 つも無いデータでも、modern を選ぶと古風の句で作れる
{
  const r = gen.make({ season: '春', subject: 'sakura', mood: 'koishi', words: 'modern', count: 3, rng: seeded(32), data: classicOnly });
  if (r.length !== 3 || r.some(p => p.words !== 'modern' || p.relax !== 0)) fail('modern の句が無いデータで modern の生成が崩れる');
}
// alternatives の words
{
  let bad = 0;
  const rng = seeded(77);
  for (const s of E.subjects) for (const slot of ['S5', 'S7']) {
    const c = gen.alternatives({ slot, subject: s.id, season: s.season[0] || null, count: 6, rng, data: E });
    if (c.some(p => p.modern === true)) bad++;
    const m = gen.alternatives({ slot, subject: s.id, season: s.season[0] || null, words: 'modern', count: 6, rng, data: E });
    if (m.length !== 6) bad++;
    // modern を先に並べる（同じ段の中で modern が無くなるまで古風は出ない）
    const firstClassic = m.findIndex(p => p.modern !== true);
    if (firstClassic >= 0 && m.slice(firstClassic).some(p => p.modern === true && p.subject === m[firstClassic].subject)) bad++;
    if (!m[0] || m[0].modern !== true) bad++;
  }
  if (bad) fail(`alternatives の words の不正 ${bad} 件`);
}

// alternatives: 6 件、除外 key を含まない、同じスロットの条件
let altBad = 0;
const rng = seeded(99);
for (const s of E.subjects) for (const slot of ['S5', 'S5!', 'S7']) {
  const alts = gen.alternatives({ slot, subject: s.id, mood: 'koishi', season: s.season[0] || null, excludeKeys: ['こひし'], count: 6, rng, data: E });
  const role = slot.replace('!', '');
  if (alts.length !== 6 || alts.some(p => p.role !== role || (slot.endsWith('!') && !p.pos3Ok) || p.key === 'こひし')) altBad++;
  // 先頭はその題材の句
  if (alts[0].subject !== s.id) altBad++;
}
for (const m of E.moods) for (const slot of ['M7', 'C7']) {
  const alts = gen.alternatives({ slot, mood: m.id, count: 6, rng, data: E });
  if (alts.length !== 6 || alts.some(p => p.role !== slot)) altBad++;
}
if (altBad) fail(`alternatives の不正 ${altBad} 件`);
// alternatives の戻りに m（文字列）がある
{
  const alts = gen.alternatives({ slot: 'C7', count: 6, rng, data: E });
  if (!alts.every(p => typeof p.m === 'string')) fail('alternatives に m が無い');
  const src = alts.map(p => byText.get(p.text + '|' + p.kana));
  if (alts.some((p, i) => src[i] && src[i].m && p.m !== gen.cleanM(src[i].m))) fail('alternatives の m が句と違う');
}

// joinMeaning の単体
{
  const J = gen.joinMeaning;
  const eq = (a, b, m) => { if (a !== b) fail(`joinMeaning ${m}: 「${a}」≠「${b}」`); };
  eq(J(['山の桜', '散っていく空のもとで', 'ぼんやり眺めていると', 'あなたが恋しい', '夜は更けてしまった']),
    '山の桜、散っていく空のもとで、ぼんやり眺めていると、あなたが恋しい、夜は更けてしまった。', '全部あり');
  eq(J(['山の桜', '', undefined, 'あなたが恋しい', '夜は更けてしまった']),
    '山の桜、…、…、あなたが恋しい、夜は更けてしまった。', '欠けは …');
  eq(J(['山の桜。', '空のもとで、', 'a', 'b', 'c']), '山の桜、空のもとで、a、b、c。', '末尾の句読点を落とす');
  eq(J([]), '', '全部空');
  eq(J(null), '', 'null');
}
// m の無いデータでも落ちない
{
  const bare = JSON.parse(JSON.stringify(E));
  bare.phrases.forEach(p => { delete p.m; });
  try {
    const r = gen.make({ season: '春', subject: 'sakura', mood: 'sabishi', count: 3, rng: seeded(7), data: bare });
    if (r.length !== 3 || r.some(p => p.meaning !== '')) fail('m なしデータで meaning が空にならない');
    const a = gen.alternatives({ slot: 'S5', subject: 'sakura', count: 6, rng: seeded(8), data: bare });
    if (!a.length || a.some(p => p.m !== '')) fail('m なしデータで alternatives の m が空にならない');
  } catch (e) { fail('m なしデータで例外 ' + e.message); }
}

// rng 省略・data 省略（globalThis.WAKA）でも動く
globalThis.WAKA = { easy: E };
try { if (gen.make({ season: '春' }).length !== 3) fail('既定引数で 3 首にならない'); } catch (e) { fail('既定引数で例外 ' + e.message); }
if (overlap) fail(`3 首のあいだで 3 句以上かぶった組 ${overlap}`);

console.log(`組み合わせ ${combos} 通り / ${poems} 首を生成。条件を外した首 ${relaxed}。全句に m がそろった首 ${withMeaning}`);
console.log(`ことば: modern の句 ${modernCount} 件（${hasModernFile ? 'data/easy-modern.js' : '合成データ'}）。modern で ${mPoems} 首、modern の句の割合 ${(modernRate * 100).toFixed(1)}%`);
if (fails.length) { console.log('NG\n' + fails.join('\n')); process.exit(1); }
console.log('OK すべて合格');
