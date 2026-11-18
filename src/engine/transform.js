/* 구문 변환: DECODE→CASE, NVL→COALESCE, (+)→ANSI JOIN, 별칭 자동 부여 */
(function (g) {
  'use strict';
  var S = (g.SQLF = g.SQLF || {});

  function tok(k, v) { return { k: k, v: v, nl: false, pos: 0, end: 0 }; }
  function up(t) { return t && !t.t && t.k === 'word' ? t.v.toUpperCase() : null; }

  /* ---------- DECODE → CASE ---------- */
  function isLiteral(atoms) {
    return atoms.length === 1 && !atoms[0].t && (atoms[0].k === 'string' || atoms[0].k === 'number');
  }
  function isNullLit(atoms) { return atoms.length === 1 && up(atoms[0]) === 'NULL'; }

  function decodeToCase(gp) {
    var args = gp.args;
    if (args.length < 3) return null;
    var x = args[0];
    var whens = [];
    var simpleX = x.length === 1 && !x[0].t;
    var k;
    for (k = 1; k + 1 < args.length; k += 2) {
      var s = args[k], r = args[k + 1];
      var c;
      if (isNullLit(s)) {
        c = x.concat([tok('word', 'IS'), tok('word', 'NULL')]);
      } else if (isLiteral(s)) {
        c = x.concat([tok('op', '=')], s);
      } else {
        // 검색값이 식이면 NULL 끼리도 같다고 보는 DECODE 규칙을 맞춰줘요
        var inner = x.concat([tok('op', '=')], s, [tok('word', 'OR')], x, [tok('word', 'IS'), tok('word', 'NULL'), tok('word', 'AND')], s, [tok('word', 'IS'), tok('word', 'NULL')]);
        var og = { t: 'group', open: tok('punct', '('), close: tok('punct', ')'), fn: null, args: [inner], sub: null, inList: false };
        c = [og];
        void simpleX;
      }
      whens.push({ c: c, r: r });
    }
    var els = (args.length - 1) % 2 === 1 ? args[args.length - 1] : null;
    return { t: 'case', kw: tok('word', 'CASE'), endTok: tok('word', 'END'), operand: null, whens: whens, els: els };
  }

  function convertDecode(st, stats) {
    var n = 0;
    S.walk.stmt(st, function (arr) {
      for (var i = 0; i < arr.length; i++) {
        var a = arr[i];
        if (a.t === 'group' && a.fn && a.fn.v.toUpperCase() === 'DECODE' && !a.sub) {
          var c = decodeToCase(a);
          if (c) { arr[i] = c; n++; }
        }
      }
    });
    if (n) { stats.cases += n; stats.decodes -= n; }
  }

  function convertNvl(st) {
    S.walk.stmt(st, function (arr) {
      arr.forEach(function (a) {
        if (a.t === 'group' && a.fn && a.fn.v.toUpperCase() === 'NVL' && a.args.length === 2) {
          a.fn = tok('word', 'COALESCE');
          a.fn.fn = true;
        }
      });
    });
  }

  /* ---------- (+) → ANSI JOIN ---------- */
  function quals(atoms, keys, out, outerOf) {
    var ok = true;
    for (var i = 0; i < atoms.length; i++) {
      var a = atoms[i];
      if (a.t === 'group') {
        if (a.sub) { /* 서브쿼리는 상관 참조를 알 수 없으므로 그대로 둠 */ continue; }
        a.args.forEach(function (x) { if (!quals(x, keys, out, outerOf)) ok = false; });
      } else if (a.t === 'case') {
        var parts = [].concat(a.operand ? [a.operand] : [], a.els ? [a.els] : []);
        a.whens.forEach(function (w) { parts.push(w.c, w.r); });
        parts.forEach(function (x) { if (!quals(x, keys, out, outerOf)) ok = false; });
      } else if (a.k === 'name') {
        var m = /^([^."@]+)\./.exec(a.v);
        if (m && keys[m[1].toLowerCase()]) out[m[1].toLowerCase()] = true;
      } else if (a.k === 'op' && a.v === '(+)') {
        var p = atoms[i - 1];
        var mm = p && !p.t && p.k === 'name' ? /^([^."@]+)\./.exec(p.v) : null;
        if (!mm || !keys[mm[1].toLowerCase()]) ok = false;
        else outerOf[mm[1].toLowerCase()] = true;
      }
    }
    return ok;
  }
  function stripOuter(atoms) {
    for (var i = atoms.length - 1; i >= 0; i--) {
      var a = atoms[i];
      if (a.t === 'group') a.args.forEach(stripOuter);
      else if (a.t === 'case') {
        [a.operand, a.els].forEach(function (x) { if (x) stripOuter(x); });
        a.whens.forEach(function (w) { stripOuter(w.c); stripOuter(w.r); });
      } else if (a.k === 'op' && a.v === '(+)') atoms.splice(i, 1);
    }
  }

  /* 콤마 조인(FROM a, b WHERE ...)을 모두 ANSI JOIN 으로 바꿔요.
   * (+) 가 있으면 LEFT/RIGHT OUTER JOIN, 없으면 INNER JOIN.
   * 두 테이블 이상을 잇는 조건과 (+) 쪽 테이블만 보는 조건은 ON 으로, 한 테이블만 보는 일반 조건은 WHERE 에 남겨요. */
  function ansiJoin(sel, stats, warnings) {
    var from = sel.from;
    if (!from || from.items.length < 2) return;
    if (from.items.some(function (f) { return f.joins.length; })) return; // 이미 JOIN 이 섞여 있으면 그대로
    function fail(msg) { warnings.push('콤마 조인을 ANSI JOIN으로 바꾸지 못했어요 (원문 유지): ' + msg); }
    if (!sel.where) return fail('WHERE 조건이 없어요 (조인 조건이 없는 카티션 곱)');

    var tabs = from.items.map(function (f) {
      var key = f.ref.alias ? f.ref.alias.v : (f.ref.atoms.length === 1 && !f.ref.atoms[0].t && f.ref.atoms[0].k === 'word' ? f.ref.atoms[0].v : null);
      // 스키마.테이블 (별칭 없음) → 테이블 이름으로 참조해요
      if (!key && f.ref.atoms.length === 1 && !f.ref.atoms[0].t && f.ref.atoms[0].k === 'name') key = f.ref.atoms[0].v.split('.').pop();
      return { f: f, key: key ? key.toLowerCase() : null };
    });
    if (tabs.some(function (t) { return !t.key; })) return fail('별칭이 없는 인라인 뷰가 있어요');
    var keys = {};
    tabs.forEach(function (t) { keys[t.key] = true; });
    if (Object.keys(keys).length !== tabs.length) return fail('별칭이 겹쳐요');
    var conds = sel.where.conds;
    if (conds.some(function (c, i) { return i > 0 && c.op === 'OR'; })) return fail('WHERE 에 OR 가 있어요');

    var info = conds.map(function (c) {
      var q = {}, o = {};
      var ok = quals(c.atoms, keys, q, o);
      return { c: c, q: Object.keys(q), opt: Object.keys(o), ok: ok, used: false };
    });
    if (info.some(function (x) { return !x.ok || x.opt.length > 1 || (x.opt.length && x.q.length > 2); })) return fail('조건이 복잡해요');

    var joined = {};
    joined[tabs[0].key] = true;
    var remaining = tabs.slice(1);
    var joins = [];
    while (remaining.length) {
      var pick = -1;
      for (var r = 0; r < remaining.length && pick < 0; r++) {
        var t = remaining[r];
        var cs = info.filter(function (x) {
          return !x.used && x.q.indexOf(t.key) >= 0 && x.q.length >= 2 && x.q.every(function (k) { return k === t.key || joined[k]; });
        });
        if (cs.length) pick = r;
      }
      if (pick < 0) return fail('조인 조건으로 연결되지 않는 테이블이 있어요 (' + remaining.map(function (x) { return x.key; }).join(', ') + ')');
      var tb = remaining.splice(pick, 1)[0];
      var onInfo = info.filter(function (x) {
        if (x.used || x.q.indexOf(tb.key) < 0) return false;
        if (!x.q.every(function (k) { return k === tb.key || joined[k]; })) return false;
        return x.q.length >= 2 || (x.opt.length === 1 && x.opt[0] === tb.key);
      });
      var left = false, right = false;
      onInfo.forEach(function (x) {
        if (x.opt.length) { if (x.opt[0] === tb.key) left = true; else right = true; }
      });
      if (left && right) return fail('양쪽 모두 (+)가 있어요');
      joins.push({ tb: tb, onInfo: onInfo, kind: left ? 'LEFT OUTER JOIN' : right ? 'RIGHT OUTER JOIN' : 'INNER JOIN' });
      onInfo.forEach(function (x) { x.used = true; });
      joined[tb.key] = true;
    }
    if (info.some(function (x) { return !x.used && x.opt.length; })) return fail('남는 (+) 조건이 있어요');

    // 변환 적용
    var first = tabs[0].f;
    first.joins = [];
    joins.forEach(function (jn) {
      var on = jn.onInfo.map(function (x, i) {
        stripOuter(x.c.atoms);
        return { op: i === 0 ? null : 'AND', atoms: x.c.atoms, lead: x.c.lead, trail: x.c.trail };
      });
      first.joins.push({ kind: jn.kind, kwOrig: jn.kind, lead: [], ref: jn.tb.f.ref, on: on, using: null });
    });
    from.items = [first];
    var rest = info.filter(function (x) { return !x.used; }).map(function (x) { return x.c; });
    if (rest.length) {
      rest[0].op = null;
      for (var i = 1; i < rest.length; i++) if (!rest[i].op) rest[i].op = 'AND';
      sel.where.conds = rest;
    } else {
      sel.where = null;
    }
    stats.ansi++;
  }

  /* ---------- 진입점 ---------- */
  function apply(parsed, st, idx, o, warnings) {
    var ast = st.ast;
    if (o.join === 'ansi') S.walk.eachSelect(ast, function (sel) { ansiJoin(sel, parsed.stats, warnings); });
    if (o.decode2case) convertDecode(ast, parsed.stats);
    if (o.nvl2coal) convertNvl(ast);
    if (S.alias) S.alias.apply(parsed, st, idx, o, warnings);
  }

  /* PL/SQL 안의 SQL 문장용 (별칭 자동 부여는 빼고 구문 변환만) */
  function applyAst(ast, stats, o, warnings) {
    if (o.join === 'ansi') S.walk.eachSelect(ast, function (sel) { ansiJoin(sel, stats, warnings); });
    if (o.decode2case) convertDecode(ast, stats);
    if (o.nvl2coal) convertNvl(ast);
  }

  S.transform = { apply: apply, applyAst: applyAst };
})(typeof window !== 'undefined' ? window : globalThis);
