// データ整合性チェック (Node)。使い方: node tools/validate.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const warns = [];
const err = m => errors.push(m);
const warn = m => warns.push(m);

// window を模して data/*.js を読む
const fake = { WAKA: {} };
function load(rel) {
  const src = fs.readFileSync(path.join(root, rel), 'utf8');
  const module = { exports: {} };
  new Function('window', 'module', 'exports', src)(fake, module, module.exports);
  return module.exports;
}

// 自前の音数カウント (DESIGN 3.3)
const SMALL = 'ぁぃぅぇぉゃゅょゎ';
function ownCount(s) {
  let n = 0;
  for (const ch of String(s)) {
    let c = ch;
    const code = c.charCodeAt(0);
    if (code >= 0x30a1 && code <= 0x30f6) c = String.fromCharCode(code - 0x60);
    if (/[\s、。,.・「」]/.test(c)) continue;
    if (SMALL.includes(c)) continue;
    if (/[ぁ-ゖーゝゞヽヾ]/.test(c) || ch === 'ヰ' || ch === 'ヱ') { n++; continue; }
    return NaN;
  }
  return n;
}

// 本番の js/mora.js があればそちらを優先
let count = ownCount;
let countSource = '自前実装';
try {
  const modPath = path.join(root, 'js/mora.js');
  if (fs.existsSync(modPath)) {
    const exp = load('js/mora.js');
    const m = (exp && typeof exp.count === 'function') ? exp : fake.WAKA.mora;
    if (m && typeof m.count === 'function') {
      count = m.count;
      countSource = 'js/mora.js';
      // 本番と自前の食い違いは警告
      for (const t of ['きょう', 'ちっと', 'がっこう', 'ー', 'ゐ']) {
        if (m.count(t) !== ownCount(t)) warn(`mora.js と自前実装が不一致: 「${t}」 ${m.count(t)} vs ${ownCount(t)}`);
      }
    }
  }
} catch (e) {
  warn('js/mora.js の読込に失敗。自前実装で数えます: ' + e.message);
}

for (const f of ['site', 'words', 'makura', 'parts', 'samples', 'readings', 'easy', 'easy-modern']) {
  try { load(`data/${f}.js`); } catch (e) { err(`data/${f}.js の読込に失敗: ${e.message}`); }
}
const W = fake.WAKA;

// site
if (!W.site || !W.site.name || !/\/$/.test(W.site.url || '')) err('site: name / url (末尾 /) が不正');

// words
const SEASONS = ['春', '夏', '秋', '冬', '恋', '雑'];
const KINDS = ['季語', '歌語', '古語'];
const seasonCount = {};
const kindCount = {};
(W.words || []).forEach((w, i) => {
  if (w.id !== i + 1) err(`words[${i}]: id が連番でない (${w.id})`);
  if (!SEASONS.includes(w.season)) err(`words id=${w.id}: season 不正 ${w.season}`);
  if (!KINDS.includes(w.kind)) err(`words id=${w.id}: kind 不正 ${w.kind}`);
  const c = count(w.kana);
  if (c !== w.mora) err(`words id=${w.id} ${w.word}: mora=${w.mora} だが kana「${w.kana}」は ${c}`);
  if (!w.meaning) err(`words id=${w.id}: meaning が空`);
  seasonCount[w.season] = (seasonCount[w.season] || 0) + 1;
  kindCount[w.kind] = (kindCount[w.kind] || 0) + 1;
});
const seen = new Set();
(W.words || []).forEach(w => {
  const k = w.word + '/' + w.kana;
  if (seen.has(k)) err(`words: 重複 ${k}`);
  seen.add(k);
});
if ((W.words || []).length < 300) err(`words: ${(W.words || []).length} 語 (300 未満)`);
for (const s of SEASONS) if ((seasonCount[s] || 0) < 40) err(`words: ${s} が ${seasonCount[s] || 0} 語 (40 未満)`);

// makura
(W.makura || []).forEach((m, i) => {
  if (m.id !== i + 1) err(`makura[${i}]: id が連番でない`);
  const c = count(m.kana);
  if (c !== m.mora) err(`makura id=${m.id} ${m.word}: mora=${m.mora} だが kana は ${c}`);
  if (!Array.isArray(m.leads) || !m.leads.length) err(`makura id=${m.id}: leads が空`);
  if (!m.example) warn(`makura id=${m.id} ${m.word}: example が空`);
});
if ((W.makura || []).length < 60) err(`makura: ${(W.makura || []).length} 件 (60 未満)`);

// 意味 m の検査 (DESIGN 10.1): 欠落・末尾句読点はエラー、長さ 5〜15 字 (【】を除く) は警告
const M_PUNCT = /[。、．，,.!！?？…]$/;
function checkM(tag, m, needMark, lenCheck = true) {
  if (typeof m !== 'string' || !m.trim()) { err(`${tag}: m (意味) が無い`); return; }
  if (M_PUNCT.test(m.trim())) err(`${tag}: m「${m}」の末尾が句読点`);
  if (needMark && !m.includes('【】')) err(`${tag}: 空欄入りの m「${m}」に【】が無い`);
  const len = [...m.replace(/【】/g, '')].length;
  if (lenCheck && !needMark && (len < 2 || len > 15)) warn(`${tag}: m「${m}」が ${len} 字 (2〜15 字を想定)`);
}

// parts
const TARGET = { 1: 5, 2: 7, 3: 5, 4: 7, 5: 7 };
const TAGS = ['春', '夏', '秋', '冬', '恋', '旅'];
const partsStat = {};
for (const s of [1, 2, 3, 4, 5]) {
  const arr = (W.parts || {})[s] || [];
  const st = { total: arr.length, generic: 0 };
  TAGS.forEach(t => (st[t] = 0));
  const dup = new Set();
  arr.forEach(p => {
    const c = count(p.kana);
    if (c !== TARGET[s]) err(`parts[${s}] 「${p.text}」(${p.kana}): ${c} 音 (目標 ${TARGET[s]})`);
    checkM(`parts[${s}] 「${p.text}」`, p.m, false);
    if (dup.has(p.kana)) warn(`parts[${s}] 重複: ${p.text}`);
    dup.add(p.kana);
    if (!Array.isArray(p.tags)) { err(`parts[${s}] 「${p.text}」: tags が配列でない`); return; }
    if (!p.tags.length) st.generic++;
    p.tags.forEach(t => { if (TAGS.includes(t)) st[t]++; else err(`parts[${s}] 「${p.text}」: 不明なタグ ${t}`); });
  });
  if (arr.length < 60) err(`parts[${s}]: ${arr.length} 件 (60 未満)`);
  TAGS.forEach(t => { if (st[t] < 8) warn(`parts[${s}]: タグ ${t} が ${st[t]} 件 (8 未満)`); });
  partsStat[s] = st;
}

// samples
(W.samples || []).forEach((p, i) => {
  if (!p.ku || p.ku.length !== 5 || !p.kana || p.kana.length !== 5) { err(`samples[${i}]: ku/kana が 5 要素でない`); return; }
  p.kana.forEach((k, j) => {
    const c = count(k);
    const d = c - TARGET[j + 1];
    if (Number.isNaN(c)) err(`samples[${i}] ${p.author} 第${j + 1}句: kana に仮名以外「${k}」`);
    else if (Math.abs(d) >= 2) err(`samples[${i}] ${p.author} 第${j + 1}句「${k}」: ${c} 音 (差 ${d})`);
    else if (d !== 0) warn(`samples[${i}] ${p.author} 第${j + 1}句「${k}」: ${c} 音 (字${d > 0 ? '余り' : '足らず'})`);
  });
  if (!p.author || !p.source || !p.meaning) err(`samples[${i}]: author/source/meaning のいずれかが空`);
});
if ((W.samples || []).length < 15) warn(`samples: ${(W.samples || []).length} 首 (20 首程度を想定)`);

// readings（歌読み辞書）: 読みが仮名だけか
const RD = W.readings || {};
Object.keys(RD).forEach((k) => {
  if (Number.isNaN(count(RD[k])) || !RD[k]) err(`readings「${k}」: 読みに仮名以外「${RD[k]}」`);
});

// easy（かんたんモード, DESIGN 9.3）
const E = W.easy || {};
const easyLines = [];
{
  const ROLE_MORA = { S5: 5, S7: 7, J5: 5, M7: 7, C7: 7 };
  const EASY_SEASONS = ['春', '夏', '秋', '冬'];
  const GROUPS = ['花・草木', '空・天気', '月・星', '水・山', '生きもの', '人・暮らし'];
  const MOOD_IDS = ['sabishi', 'koishi', 'ureshi', 'natsukashi', 'utsukushi', 'hakanai', 'machidooshi', 'setsunai', 'odayaka', 'itooshi', 'nagorioshi', 'hokorashi'];
  if (!W.easy) err('easy: WAKA.easy が未定義');
  const subs = E.subjects || [];
  const moods = E.moods || [];
  const subIds = new Set();
  subs.forEach((s, i) => {
    if (!s.id || subIds.has(s.id)) err(`easy.subjects[${i}]: id が空または重複 (${s.id})`);
    subIds.add(s.id);
    if (!s.label) err(`easy.subjects ${s.id}: label が空`);
    if (!s.meaning) err(`easy.subjects ${s.id}: meaning が空`);
    if (!Number.isFinite(count(s.kana))) err(`easy.subjects ${s.id}: kana が不正「${s.kana}」`);
    if (!Array.isArray(s.season) || s.season.some(x => !EASY_SEASONS.includes(x))) err(`easy.subjects ${s.id}: season は春夏秋冬の配列`);
    if (!GROUPS.includes(s.group)) err(`easy.subjects ${s.id}: group 不正 ${s.group}`);
  });
  if (subs.length < 70) err(`easy.subjects: ${subs.length} 件 (70 未満)`);
  const moodIds = new Set(moods.map(m => m.id));
  if (moods.length !== 12 || MOOD_IDS.some(id => !moodIds.has(id)) || moodIds.size !== 12) err('easy.moods: 12 種の id (sabishi/koishi/ureshi/natsukashi/utsukushi/hakanai/machidooshi/setsunai/odayaka/itooshi/nagorioshi/hokorashi) と一致しない');
  moods.forEach(m => {
    if (!m.label || !m.hint) err(`easy.moods ${m.id}: label/hint が空`);
    if (!/^[A-Za-z]+$/.test(m.id)) err(`easy.moods ${m.id}: id は半角英字`);
    if (!Number.isFinite(count(m.kana))) err(`easy.moods ${m.id}: kana が不正「${m.kana}」`);
  });

  // phrases
  const ph = E.phrases || [];
  const roleCount = {};
  const subjStat = {}; subs.forEach(s => (subjStat[s.id] = { S5: 0, S7: 0, pos3: 0 }));
  const moodStat = {}; moods.forEach(m => (moodStat[m.id] = { M7: 0, C7: 0 }));
  let genJ5 = 0, genC7 = 0, pos3Total = 0;
  // modern (現代のことばの句, DESIGN 13.3) は別に数える
  const modRole = {};
  const mSubj = {}; subs.forEach(s => (mSubj[s.id] = { S5: 0, S7: 0, pos3: 0 }));
  const mMood = {}; moods.forEach(m => (mMood[m.id] = { M7: 0, C7: 0 }));
  let mJ5 = 0, mC7 = 0;
  const OLD_KANA = /[ゐゑぢ]|(?<!わ)くわ|ふ(?![ぁ-ゖ])/;
  const dupPh = new Set();
  ph.forEach((p, i) => {
    const tag = `easy.phrases[${i}] ${p.role} 「${p.text}」(${p.kana})`;
    if (!(p.role in ROLE_MORA)) { err(`${tag}: role 不正`); return; }
    roleCount[p.role] = (roleCount[p.role] || 0) + 1;
    const mod = !!p.modern;
    if (mod) {
      modRole[p.role] = (modRole[p.role] || 0) + 1;
      if (OLD_KANA.test(p.kana || '')) warn(`${tag}: modern の kana に歴史的かなづかいの疑い`);
    }
    const c = count(p.kana);
    if (Number.isNaN(c)) err(`${tag}: kana に仮名以外`);
    else if (c !== ROLE_MORA[p.role]) err(`${tag}: ${c} 音 (目標 ${ROLE_MORA[p.role]})`);
    if (!p.text) err(`${tag}: text が空`);
    checkM(tag, p.m, false);
    if (!p.key || Number.isNaN(count(p.key))) err(`${tag}: key が空、または仮名でない「${p.key}」`);
    const dk = (p.modern ? 'm/' : '') + p.role + '/' + p.kana + '/' + (p.subject || '') + '/' + (p.mood || '');
    if (dupPh.has(dk)) warn(`${tag}: 重複`);
    dupPh.add(dk);
    if (p.season !== undefined && (!Array.isArray(p.season) || p.season.some(x => !EASY_SEASONS.includes(x)))) err(`${tag}: season 不正`);
    if (p.pos3Ok && p.role !== 'S5') err(`${tag}: pos3Ok は S5 のみ`);
    if (p.subject && !subIds.has(p.subject)) err(`${tag}: 未知の subject ${p.subject}`);
    if (p.mood && !moodIds.has(p.mood)) err(`${tag}: 未知の mood ${p.mood}`);
    if (p.role === 'S5' || p.role === 'S7') {
      if (!p.subject) err(`${tag}: subject が必要`);
      else if (mod) { const st = mSubj[p.subject]; if (st) { st[p.role]++; if (p.pos3Ok) st.pos3++; } }
      else if (subjStat[p.subject]) { subjStat[p.subject][p.role]++; if (p.pos3Ok) { subjStat[p.subject].pos3++; pos3Total++; } }
    }
    const ms = mod ? mMood : moodStat;
    if (p.role === 'M7') { if (!p.mood) err(`${tag}: mood が必要`); else if (ms[p.mood]) ms[p.mood].M7++; }
    if (p.role === 'C7' && p.mood && ms[p.mood]) ms[p.mood].C7++;
    if (p.role === 'J5' && !p.subject && !p.mood) { if (mod) mJ5++; else genJ5++; }
    if (p.role === 'C7' && !p.subject && !p.mood) { if (mod) mC7++; else genC7++; }
  });
  subs.forEach(s => {
    const st = subjStat[s.id];
    if (st.S5 < 8) err(`easy: 題材 ${s.id} の S5 が ${st.S5} 件 (8 未満)`);
    if (st.S7 < 8) err(`easy: 題材 ${s.id} の S7 が ${st.S7} 件 (8 未満)`);
    if (st.pos3 < 3) err(`easy: 題材 ${s.id} の pos3Ok S5 が ${st.pos3} 件 (3 未満)`);
  });
  moods.forEach(m => {
    const st = moodStat[m.id];
    if (st.M7 < 10) err(`easy: 気持ち ${m.id} の M7 が ${st.M7} 件 (10 未満)`);
    if (st.C7 < 6) err(`easy: 気持ち ${m.id} の C7 が ${st.C7} 件 (6 未満)`);
  });
  if (genJ5 < 60) err(`easy: 汎用 J5 が ${genJ5} 件 (60 未満)`);
  if (genC7 < 40) err(`easy: 汎用 C7 が ${genC7} 件 (40 未満)`);

  // modern の件数 (DESIGN 13.3)
  if (modRole.S5 || modRole.S7 || modRole.M7 || modRole.C7 || modRole.J5) {
    subs.forEach(s => {
      const st = mSubj[s.id];
      if (st.S5 < 3) err(`easy(modern): 題材 ${s.id} の S5 が ${st.S5} 件 (3 未満)`);
      if (st.pos3 < 2) err(`easy(modern): 題材 ${s.id} の pos3Ok S5 が ${st.pos3} 件 (2 未満)`);
      if (st.S7 < 3) err(`easy(modern): 題材 ${s.id} の S7 が ${st.S7} 件 (3 未満)`);
    });
    moods.forEach(m => {
      const st = mMood[m.id];
      if (st.M7 < 5) err(`easy(modern): 気持ち ${m.id} の M7 が ${st.M7} 件 (5 未満)`);
      if (st.C7 < 3) err(`easy(modern): 気持ち ${m.id} の C7 が ${st.C7} 件 (3 未満)`);
    });
    if (mJ5 < 25) err(`easy(modern): 汎用 J5 が ${mJ5} 件 (25 未満)`);
    if (mC7 < 20) err(`easy(modern): 汎用 C7 が ${mC7} 件 (20 未満)`);
  } else err('easy(modern): modern の句が 1 件も無い (data/easy-modern.js)');

  // templates
  const tp = E.templates || [];
  if (tp.length < 16) err(`easy.templates: ${tp.length} 型 (16 未満)`);
  const tIds = new Set();
  tp.forEach(t => {
    if (!t.id || tIds.has(t.id)) err(`easy.templates: id が空または重複 (${t.id})`);
    tIds.add(t.id);
    if (!Array.isArray(t.slots) || t.slots.length !== 5) { err(`easy.templates ${t.id}: slots が 5 要素でない`); return; }
    t.slots.forEach((sl, j) => {
      const role = String(sl).replace('!', '');
      if (!(role in ROLE_MORA)) { err(`easy.templates ${t.id} slot${j + 1}: role 不正 ${sl}`); return; }
      if (!roleCount[role]) err(`easy.templates ${t.id} slot${j + 1}: role ${role} の句が存在しない`);
      if (ROLE_MORA[role] !== TARGET[j + 1]) err(`easy.templates ${t.id} slot${j + 1}: ${role} は ${ROLE_MORA[role]} 音だが第${j + 1}句は ${TARGET[j + 1]} 音`);
      if (String(sl).includes('!') && role !== 'S5') err(`easy.templates ${t.id} slot${j + 1}: ! は S5 のみ`);
    });
  });

  // fillTemplates
  const ft = E.fillTemplates || [];
  if (ft.length < 30) err(`easy.fillTemplates: ${ft.length} 型 (30 未満)`);
  const fIds = new Set();
  ft.forEach(f => {
    if (!f.id || fIds.has(f.id)) err(`easy.fillTemplates: id が空または重複 (${f.id})`);
    fIds.add(f.id);
    if (!f.label) err(`easy.fillTemplates ${f.id}: label が空`);
    if (!Array.isArray(f.ku) || f.ku.length !== 5) { err(`easy.fillTemplates ${f.id}: ku が 5 要素でない`); return; }
    let blanks = 0;
    f.ku.forEach((k, j) => {
      const tag = `easy.fillTemplates ${f.id} ku${j + 1}`;
      const fixed = count(k.kana || '');
      if (Number.isNaN(fixed)) { err(`${tag}: kana に仮名以外「${k.kana}」`); return; }
      const hasMark = String(k.text).includes('【　】');
      checkM(tag, k.m, !!k.blank, false);
      if (k.blank) {
        blanks++;
        const b = k.blank;
        if (!hasMark) err(`${tag}: 空欄があるのに text に【　】が無い`);
        if (!Number.isInteger(b.mora) || b.mora < 1) { err(`${tag}: blank.mora 不正`); return; }
        if (fixed + b.mora !== TARGET[j + 1]) err(`${tag}: 固定部 ${fixed} + 空欄 ${b.mora} = ${fixed + b.mora} 音 (目標 ${TARGET[j + 1]})`);
        const cand = b.candidates;
        if (Array.isArray(cand)) {
          if (cand.length < 3) err(`${tag}: candidates が ${cand.length} 件 (3 未満)`);
          cand.forEach(x => { checkM(`${tag} 候補「${x.text}」`, x.m, false, false); const c = count(x.kana); if (c !== b.mora) err(`${tag}: 候補「${x.text}」(${x.kana}) が ${c} 音 (空欄 ${b.mora})`); });
        } else if (cand === 'subject') {
          const n = subs.filter(s => count(s.kana) === b.mora).length;
          if (n < 3) err(`${tag}: subject 候補が ${b.mora} 音で ${n} 件 (3 未満)`);
        } else if (cand === 'words') {
          const n = (W.words || []).filter(w => w.mora === b.mora && (!b.kind || b.kind.includes(w.kind))).length;
          if (n < 3) err(`${tag}: words 候補が ${b.mora} 音で ${n} 件 (3 未満)`);
        } else if (cand === 'makura') {
          const n = (W.makura || []).filter(m => m.mora === b.mora).length;
          if (n < 3) err(`${tag}: makura 候補が ${b.mora} 音で ${n} 件 (3 未満)`);
        } else err(`${tag}: candidates 不正`);
      } else {
        if (hasMark) err(`${tag}: 【　】があるのに blank が無い`);
        if (fixed !== TARGET[j + 1]) err(`${tag}: 「${k.text}」${fixed} 音 (目標 ${TARGET[j + 1]})`);
      }
    });
    if (blanks < 2 || blanks > 3) err(`easy.fillTemplates ${f.id}: 空欄が ${blanks} か所 (2〜3)`);
  });

  // synonyms
  const sy = E.synonyms || {};
  const synKeys = Object.keys(sy);
  if (synKeys.length < 800) err(`easy.synonyms: ${synKeys.length} 語 (800 未満)`);
  synKeys.forEach(k => { if (!subIds.has(sy[k]) && !moodIds.has(sy[k])) err(`easy.synonyms「${k}」: 値 ${sy[k]} が subjects/moods に無い`); });
  subs.forEach(s => { if (!synKeys.some(k => sy[k] === s.id)) warn(`easy.synonyms: 題材 ${s.id} に対応する語が無い`); });
  moods.forEach(m => { if (!synKeys.some(k => sy[k] === m.id)) err(`easy.synonyms: 気持ち ${m.id} に対応する語が無い`); });

  const minOf = o => Math.min(...Object.values(o));
  easyLines.push(`easy  : subjects ${subs.length} / moods ${moods.length} / phrases ${ph.length} (${Object.keys(ROLE_MORA).map(r => `${r}:${roleCount[r] || 0}`).join(' ')}) 汎用J5 ${genJ5} 汎用C7 ${genC7}`);
  easyLines.push(`easy  : 題材別 最小 S5 ${minOf(Object.fromEntries(subs.map(s => [s.id, subjStat[s.id].S5])))} S7 ${minOf(Object.fromEntries(subs.map(s => [s.id, subjStat[s.id].S7])))} pos3Ok計 ${pos3Total} / 気持ち別 最小 M7 ${minOf(Object.fromEntries(moods.map(m => [m.id, moodStat[m.id].M7])))} C7 ${minOf(Object.fromEntries(moods.map(m => [m.id, moodStat[m.id].C7])))}`);
  const minM = o => Math.min(...Object.values(o));
  easyLines.push(`easy  : modern 計 ${Object.values(modRole).reduce((a, b) => a + b, 0)} (${['S5', 'S7', 'J5', 'M7', 'C7'].map(r => `${r}:${modRole[r] || 0}`).join(' ')}) 汎用J5 ${mJ5} 汎用C7 ${mC7} / 題材別最小 S5 ${minM(Object.fromEntries(subs.map(s => [s.id, mSubj[s.id].S5])))} S7 ${minM(Object.fromEntries(subs.map(s => [s.id, mSubj[s.id].S7])))} pos3 ${minM(Object.fromEntries(subs.map(s => [s.id, mSubj[s.id].pos3])))} / 気持ち別最小 M7 ${minM(Object.fromEntries(moods.map(m => [m.id, mMood[m.id].M7])))} C7 ${minM(Object.fromEntries(moods.map(m => [m.id, mMood[m.id].C7])))}`);
  easyLines.push(`easy  : templates ${tp.length} / fillTemplates ${ft.length} / synonyms ${synKeys.length} 語`);
}

// 結果表示
console.log(`音数カウント: ${countSource}`);
console.log(`words : ${(W.words || []).length} 語  季節別 ${SEASONS.map(s => `${s}${seasonCount[s] || 0}`).join(' ')}  種別 ${KINDS.map(k => `${k}${kindCount[k] || 0}`).join(' ')}`);
console.log(`makura: ${(W.makura || []).length} 件`);
for (const s of [1, 2, 3, 4, 5]) {
  const st = partsStat[s];
  console.log(`parts ${s} (${TARGET[s]}音): ${st.total} 件  ${TAGS.map(t => `${t}${st[t]}`).join(' ')} 汎用${st.generic}`);
}
console.log(`samples: ${(W.samples || []).length} 首`);
console.log(`readings: ${Object.keys(RD).length} 語`);
easyLines.forEach(l => console.log(l));
warns.forEach(m => console.log('警告: ' + m));
errors.forEach(m => console.log('エラー: ' + m));
console.log(errors.length ? `NG: エラー ${errors.length} 件 / 警告 ${warns.length} 件` : `OK: エラー 0 件 / 警告 ${warns.length} 件`);
process.exit(errors.length ? 1 : 0);
