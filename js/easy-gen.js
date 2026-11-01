/* =====================================================================
 * js/easy-gen.js — かんたんモードの歌の生成（純関数、DESIGN 9.2）
 * ---------------------------------------------------------------------
 *   WAKA.easyGen.make({season, subject, mood, words, count, rng, data})
 *       -> [{ku:[5], kana:[5], roles:[5], slots:[5], keys:[5], ms:[5], meaning,
 *            templateId, subject, mood, season, words, relax, nonModern}]
 *       ms = 各句の意味の断片（phrase.m、無ければ ''）、meaning = 大意（DESIGN 10.2）
 *       data/easy.js の templates の各スロットに phrases から句を割り当てる。
 *       season: '春'|'夏'|'秋'|'冬'（空・null は季節を問わない）
 *       subject / mood: id（空なら 1 首ごとにおまかせで選ぶ）
 *       words: 'classic'（既定。phrase.modern === true の句は使わない）|
 *              'modern'（各段でまず現代のことばの句、無ければ同じ段の古風の句。DESIGN 13.2）
 *   WAKA.easyGen.alternatives({slot, season, subject, mood, words, excludeKeys,
 *       excludeTexts, count, rng, data}) -> [phrase]   仕上げの「ほかの言い方」（m つき）
 *       words = 'modern' なら同じ段の中で現代のことばの句を先に並べ、足りなければ古風
 *   WAKA.easyGen.joinMeaning(ms) -> string   句の意味をつないだ大意
 *       「、」でつなぎ「。」で終える。空の句は「…」。全部空なら ''
 *   WAKA.easyGen.pickSubject(season, rng, data) / pickMood(rng, data)
 *   WAKA.easyGen.jstDate(now?) -> 'YYYY-MM-DD'（日本時間の日付）
 *   WAKA.easyGen.todayTheme(dateStr, data) -> {date, subject, mood, season}   今日のお題（DESIGN 12-2）
 *       日付の文字列でシードした決定的な乱数で 題材 × 気持ち を選ぶ（同じ日なら誰でも同じ）。
 *       題材はその月の季節（3〜5 春・6〜8 夏・9〜11 秋・12〜2 冬）の題材から 7 割、通年の題材から 3 割。
 *       season は Q1 に入れる値（その月の季節を含めばそれ、通年なら 'any'、ほかは題材の最初の季節）
 * 句の条件: role 一致（'S5!' は pos3Ok の句だけ）、題材・気持ちは一致か汎用（null）、
 * 季節は選んだ季節か空。候補が無ければ 季節 → 気持ち → 題材 の順に条件を外す
 * （題材がいちばん大事。現代のことばの優先はこの段の中だけ）。1 首の中で同じ key を 2 回使わない。count 首のあいだで
 * 同じ位置の句が 3 つ以上かぶらないようにする。DOM に触らないので Node でも使える。
 * ===================================================================== */
(function (root) {
  'use strict';

  var SEASONS = ['春', '夏', '秋', '冬'];
  // 条件の外し方（上から順に試す）。1 = その条件を守る
  var LEVELS = [
    { subject: 1, mood: 1, season: 1 },
    { subject: 1, mood: 1, season: 0 },
    { subject: 1, mood: 0, season: 0 },
    { subject: 0, mood: 1, season: 1 },
    { subject: 0, mood: 0, season: 0 }
  ];

  function getData(d) {
    if (d) return d;
    var w = root && root.WAKA;
    return (w && w.easy) || { subjects: [], moods: [], phrases: [], templates: [] };
  }

  // 句の意味の断片を整える（末尾の句読点は落とす）
  function cleanM(m) { return String(m == null ? '' : m).trim().replace(/[。、，．,.\s]+$/, ''); }

  // 大意: 5 句の m を「、」でつなぎ「。」で終える。m の無い句は「…」
  function joinMeaning(ms) {
    var parts = [], any = false;
    for (var i = 0; i < 5; i++) {
      var m = cleanM(ms && ms[i]);
      if (m) any = true;
      parts.push(m || '…');
    }
    return any ? parts.join('、') + '。' : '';
  }

  function rint(rng, n) { return Math.min(n - 1, Math.floor(rng() * n)); }
  function pick(rng, list) { return list.length ? list[rint(rng, list.length)] : null; }
  function shuffled(rng, list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = rint(rng, i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  function normSeason(s) { return SEASONS.indexOf(s) >= 0 ? s : null; }

  // 'S5!' → {role:'S5', pos3:true}
  function parseSlot(slot) {
    slot = String(slot || '');
    var bang = slot.charAt(slot.length - 1) === '!';
    return { role: bang ? slot.slice(0, -1) : slot, pos3: bang };
  }

  function seasonOk(p, season) {
    if (!season) return true;
    return !p.season || !p.season.length || p.season.indexOf(season) >= 0;
  }

  function normWords(w) { return w === 'modern' ? 'modern' : 'classic'; }
  function isModern(p) { return p.modern === true; }

  // 1 スロットの候補。cond = {subject, mood, season}、lv = LEVELS の 1 つ
  // kind: 'modern' = 現代のことばの句だけ、'classic' = 古風の句だけ（DESIGN 13.2）
  function candidates(data, slot, cond, lv, usedKeys, kind) {
    var s = parseSlot(slot);
    return data.phrases.filter(function (p) {
      if (p.role !== s.role) return false;
      if (kind === 'modern' ? !isModern(p) : isModern(p)) return false;
      if (s.pos3 && !p.pos3Ok) return false;
      if (usedKeys && usedKeys[p.key]) return false;
      if (lv.subject && cond.subject && p.subject != null && p.subject !== cond.subject) return false;
      if (lv.mood && cond.mood && p.mood != null && p.mood !== cond.mood) return false;
      if (lv.season && !seasonOk(p, cond.season)) return false;
      return true;
    });
  }

  // 季節に合う題材をおまかせで 1 つ（季節の題材と通年の題材から）
  function pickSubject(season, rng, data) {
    data = getData(data); rng = rng || Math.random;
    season = normSeason(season);
    var list = data.subjects.filter(function (s) { return !season || !s.season.length || s.season.indexOf(season) >= 0; });
    var sp = season ? list.filter(function (s) { return s.season.length; }) : [];
    // 季節を選んだときは半分の確率で季節の題材を優先する
    if (sp.length && rng() < 0.5) list = sp;
    var s = pick(rng, list.length ? list : data.subjects);
    return s ? s.id : null;
  }

  function pickMood(rng, data) {
    data = getData(data); rng = rng || Math.random;
    var m = pick(rng, data.moods);
    return m ? m.id : null;
  }

  // 段 lv の候補。modern は まず現代のことばの句だけ、無ければ同じ段の古風の句
  function levelCands(data, slot, cond, lv, usedKeys, words) {
    if (words === 'modern') {
      var mo = candidates(data, slot, cond, lv, usedKeys, 'modern');
      if (mo.length) return mo;
    }
    return candidates(data, slot, cond, lv, usedKeys, 'classic');
  }

  // 1 つの型を埋める。埋められなければ null
  function fill(data, tpl, cond, rng) {
    var used = {}, out = { ku: [], kana: [], roles: [], slots: [], keys: [], ms: [] }, relax = 0, nonModern = 0;
    // 条件のきびしいスロット（'!'）から先に埋める
    var order = [0, 1, 2, 3, 4].sort(function (a, b) {
      return (parseSlot(tpl.slots[b]).pos3 ? 1 : 0) - (parseSlot(tpl.slots[a]).pos3 ? 1 : 0) || a - b;
    });
    for (var n = 0; n < order.length; n++) {
      var i = order[n], slot = tpl.slots[i], got = null;
      for (var l = 0; l < LEVELS.length && !got; l++) {
        var list = levelCands(data, slot, cond, LEVELS[l], used, cond.words);
        if (list.length) { got = pick(rng, list); relax += l; }
      }
      if (!got) return null;
      if (cond.words === 'modern' && !isModern(got)) nonModern++;
      used[got.key] = true;
      out.ku[i] = got.text; out.kana[i] = got.kana;
      out.roles[i] = parseSlot(slot).role; out.slots[i] = slot; out.keys[i] = got.key;
      out.ms[i] = cleanM(got.m);
    }
    out.meaning = joinMeaning(out.ms);
    out.templateId = tpl.id;
    out.subject = cond.subject; out.mood = cond.mood; out.season = cond.season;
    out.words = cond.words;
    out.relax = relax; out.nonModern = nonModern;
    return out;
  }
  // 型の良し悪し: 条件の外し方が少ないほど、modern なら古風の句が少ないほど良い
  function better(r, best) {
    return !best || r.relax < best.relax || (r.relax === best.relax && r.nonModern < best.nonModern);
  }

  function sameCount(a, b) {
    var n = 0;
    for (var i = 0; i < 5; i++) if (a.ku[i] === b.ku[i]) n++;
    return n;
  }

  // 1 首。usedTpl の型はなるべく避ける
  function makeOne(data, cond, rng, usedTpl) {
    var tpls = shuffled(rng, data.templates);
    tpls.sort(function (a, b) { return (usedTpl[a.id] ? 1 : 0) - (usedTpl[b.id] ? 1 : 0); });
    var best = null;
    for (var t = 0; t < tpls.length; t++) {
      var r = fill(data, tpls[t], cond, rng);
      if (r && better(r, best)) best = r;
      if (best && best.relax === 0 && best.nonModern === 0) break;
    }
    return best;
  }

  function make(opts) {
    opts = opts || {};
    var data = getData(opts.data), rng = opts.rng || Math.random;
    var count = opts.count == null ? 3 : Math.max(0, opts.count | 0);
    var season = normSeason(opts.season), words = normWords(opts.words);
    var out = [], usedTpl = {};
    if (!data.templates.length || !data.phrases.length) return out;
    for (var k = 0; k < count; k++) {
      var chosen = null, first = null;
      for (var tries = 0; tries < 30 && !chosen; tries++) {
        var cond = {
          season: season,
          subject: opts.subject || pickSubject(season, rng, data),
          mood: opts.mood || pickMood(rng, data),
          words: words
        };
        var r = makeOne(data, cond, rng, usedTpl);
        if (!r) continue;
        if (!first) first = r;
        // ほかの候補と 3 句以上かぶるものは作り直す
        if (out.every(function (p) { return sameCount(p, r) < 3; })) chosen = r;
      }
      chosen = chosen || first;
      if (!chosen) break;
      usedTpl[chosen.templateId] = true;
      out.push(chosen);
    }
    return out;
  }

  // 仕上げの「ほかの言い方」。同じスロット・同じ条件の句を count 件（足りなければ条件を外して足す）
  function alternatives(opts) {
    opts = opts || {};
    var data = getData(opts.data), rng = opts.rng || Math.random;
    var count = opts.count || 6;
    var cond = { subject: opts.subject || null, mood: opts.mood || null, season: normSeason(opts.season) };
    var words = normWords(opts.words);
    var used = {};
    (opts.excludeKeys || []).forEach(function (k) { if (k) used[k] = true; });
    var noText = {};
    (opts.excludeTexts || []).forEach(function (t) { if (t) noText[t] = true; });
    var out = [], seen = {};
    function add(p) {
      if (out.length >= count || seen[p.text] || noText[p.text]) return;
      seen[p.text] = true;
      var c = {};
      Object.keys(p).forEach(function (k) { c[k] = p[k]; });
      c.m = cleanM(p.m);
      out.push(c);
    }
    // 同じ段の中で modern を先に、足りなければ古風（classic は modern を出さない）
    var kinds = words === 'modern' ? ['modern', 'classic'] : ['classic'];
    for (var l = 0; l < LEVELS.length && out.length < count; l++) {
      for (var q = 0; q < kinds.length && out.length < count; q++) {
        shuffled(rng, candidates(data, opts.slot, cond, LEVELS[l], used, kinds[q])).forEach(add);
      }
    }
    return out;
  }

  /* ---------- 今日のお題 ---------- */
  function hashStr(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  }
  function seeded(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function jstDate(now) {
    var d = new Date((now == null ? Date.now() : +now) + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }
  function seasonOfMonth(m) { return m >= 3 && m <= 5 ? '春' : m >= 6 && m <= 8 ? '夏' : m >= 9 && m <= 11 ? '秋' : '冬'; }
  function todayTheme(dateStr, data) {
    var D = getData(data);
    dateStr = dateStr || jstDate();
    var subjects = D.subjects || [], moods = D.moods || [];
    if (!subjects.length || !moods.length) return null;
    var season = seasonOfMonth(Number(dateStr.slice(5, 7)));
    var rnd = seeded(hashStr('waka-odai:' + dateStr));
    rnd(); rnd();   // 最初の数回は偏りやすいので捨てる
    // 7 割はその季節の題材、3 割は通年の題材から（季節感を出す）
    var inSeason = subjects.filter(function (s) { return s.season && s.season.indexOf(season) >= 0; });
    var allYear = subjects.filter(function (s) { return !s.season || !s.season.length; });
    var pool = rnd() < 0.7 ? inSeason : allYear;
    if (!pool.length) pool = inSeason.length ? inSeason : allYear.length ? allYear : subjects;
    var subj = pool[Math.floor(rnd() * pool.length)];
    var mood = moods[Math.floor(rnd() * moods.length)];
    var ss = subj.season || [];
    var q1 = !ss.length ? 'any' : ss.indexOf(season) >= 0 ? season : ss[0];
    return { date: dateStr, subject: subj.id, mood: mood.id, season: q1 };
  }

  var api = {
    make: make, alternatives: alternatives, pickSubject: pickSubject, pickMood: pickMood,
    jstDate: jstDate, todayTheme: todayTheme,
    joinMeaning: joinMeaning, cleanM: cleanM,
    parseSlot: parseSlot, SEASONS: SEASONS
  };

  if (root) {
    root.WAKA = root.WAKA || {};
    root.WAKA.easyGen = api;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null));
