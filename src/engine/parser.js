/* 파서: 토큰 → 구조 트리(AST). SELECT/WITH/INSERT/UPDATE/DELETE/MERGE 를 지원합니다.
 * 식(expression)은 "atom" 배열로 표현합니다.
 *   atom = 토큰 | group({t:'group'}) | case({t:'case'})
 */
(function (g) {
  'use strict';
  var S = (g.SQLF = g.SQLF || {});
  var RESERVED = S.sets.RESERVED;

  function PErr(msg, tok) { this.message = msg; this.tok = tok || null; }
  PErr.prototype = Object.create(Error.prototype);

  function up(t) { return t && !t.t && t.k === 'word' ? t.v.toUpperCase() : null; }
  function mkset(s) { var m = {}; s.split(' ').forEach(function (w) { m[w] = true; }); return m; }

  var FROM_STOP = mkset('WHERE GROUP ORDER HAVING START CONNECT UNION MINUS INTERSECT FOR FETCH OFFSET JOIN INNER LEFT RIGHT FULL CROSS NATURAL OUTER ON USING MODEL SET VALUES RETURNING RETURN WHEN');
  var CLAUSE_STOP = mkset('WHERE START CONNECT GROUP HAVING ORDER UNION MINUS INTERSECT FOR FETCH OFFSET MODEL');
  var NOFN = mkset('RETURN IMMEDIATE ELSIF WHILE IF IN AND OR NOT AS ON USING VALUES WHEN THEN ELSE WHERE EXISTS ANY ALL SOME SET BY IS LIKE BETWEEN FROM JOIN SELECT UNION MINUS INTERSECT OVER GROUP WITHIN KEEP INTO CASE OF HAVING PRIOR CONNECT START WITH DISTINCT UNIQUE RETURNING INNER LEFT RIGHT FULL CROSS NATURAL OUTER');
  var CONT = mkset('AND OR NOT IS IN LIKE BETWEEN THEN ELSE WHEN CASE BY DISTINCT ALL PRIOR EXISTS ANY SOME INTERVAL ESCAPE OF TO');

  function firstTok(a) { if (!a.t) return a; if (a.t === 'group') return a.fn || a.open; return a.kw; }
  function lastTok(a) { if (!a.t) return a; if (a.t === 'group') return a.close || a.open; return a.endTok; }

  /* 항목 앞뒤 주석을 거둬서 돌려줍니다 (목록 렌더링에서 줄 단위로 다룸) */
  function harvest(atoms, aliasTok) {
    var lead = [], trail = [];
    if (atoms.length) {
      var f = firstTok(atoms[0]);
      if (f.lc) { lead = lead.concat(f.lc); f.lc = null; }
    }
    var l = aliasTok || (atoms.length ? lastTok(atoms[atoms.length - 1]) : null);
    if (l && l.tc) { trail = trail.concat(l.tc); l.tc = null; }
    return { lead: lead, trail: trail };
  }

  var IV_UNIT = mkset('YEAR MONTH DAY HOUR MINUTE SECOND');
  function aliasable(t) {
    if (t.t) return false;
    if (t.k === 'word') return !RESERVED[t.v.toUpperCase()];
    return t.k === 'name' && /^"(?:[^"]|"")+"$/.test(t.v);
  }
  function continues(prev) {
    if (prev.t) return false;
    if (prev.k === 'op') return prev.v !== '(+)';
    if (prev.k === 'punct') return true;
    if (prev.k === 'word') return !!CONT[prev.v.toUpperCase()];
    return false;
  }
  function splitAlias(atoms) {
    var n = atoms.length;
    if (n >= 3 && up(atoms[n - 2]) === 'AS' && aliasable(atoms[n - 1])) {
      return { rest: atoms.slice(0, n - 2), alias: atoms[n - 1], hadAs: true };
    }
    if (n >= 2 && aliasable(atoms[n - 1]) && !continues(atoms[n - 2])) {
      // INTERVAL '1' DAY 의 DAY 는 별칭이 아니라 단위예요. 단위 뒤에 온 이름(INTERVAL '1' DAY iv)은 별칭이에요.
      var hasInterval = atoms.some(function (a) { return up(a) === 'INTERVAL'; });
      if (!hasInterval || !IV_UNIT[up(atoms[n - 1])]) return { rest: atoms.slice(0, n - 1), alias: atoms[n - 1], hadAs: false };
    }
    return { rest: atoms, alias: null, hadAs: false };
  }

  /* 최상위 AND/OR 로 조건 나누기 (BETWEEN ... AND 는 제외) */
  function splitConds(atoms) {
    var conds = [], cur = [], op = null, between = false, pendLead = [];
    function push() {
      if (!cur.length) throw new PErr('조건이 비어 있어요', null);
      var h = harvest(cur);
      conds.push({ op: op, atoms: cur, lead: pendLead.concat(h.lead), trail: h.trail });
      cur = [];
      pendLead = [];
    }
    for (var i = 0; i < atoms.length; i++) {
      var a = atoms[i];
      var u = up(a);
      if (u === 'BETWEEN') between = true;
      if (u === 'AND' || u === 'OR') {
        if (u === 'AND' && between) { between = false; cur.push(a); continue; }
        push();
        op = u;
        pendLead = [].concat(a.lc || [], a.tc || []);
        a.lc = null; a.tc = null;
        continue;
      }
      cur.push(a);
    }
    push();
    return conds;
  }

  function kwTok() {
    var lead = [], parts = [];
    for (var i = 0; i < arguments.length; i++) {
      var t = arguments[i];
      parts.push(t.v);
      if (t.lc) { lead = lead.concat(t.lc); t.lc = null; }
      if (t.tc) { lead = lead.concat(t.tc); t.tc = null; }
    }
    return { kw: parts.join(' '), lead: lead };
  }

  function Parser(toks, stats) { this.t = toks; this.i = 0; this.st = stats; this.ctx = 'top'; }
  var P = Parser.prototype;

  P.peek = function (k) { return this.t[this.i + (k || 0)]; };
  P.next = function () { return this.t[this.i++]; };
  P.eof = function () { return this.i >= this.t.length; };
  P.isW = function (t) {
    if (!t || t.t || t.k !== 'word') return false;
    var u = t.v.toUpperCase();
    for (var i = 1; i < arguments.length; i++) if (arguments[i] === u) return true;
    return false;
  };
  P.isP = function (t, v) { return !!t && !t.t && t.k === 'punct' && t.v === v; };
  P.last = function () { return this.t[Math.min(this.i, this.t.length - 1)]; };
  P.expectW = function (w) {
    var t = this.peek();
    if (!this.isW(t, w)) throw new PErr("'" + w + "' 가 필요해요", t || this.last());
    return this.next();
  };
  P.expectP = function (v) {
    var t = this.peek();
    if (!this.isP(t, v)) throw new PErr("'" + v + "' 가 필요해요" + (v === ')' ? ' (닫는 괄호가 없는 것 같아요)' : ''), t || this.last());
    return this.next();
  };
  P.isSelectStart = function (t) { return this.isW(t, 'SELECT', 'WITH'); };

  /* ---------- 식 ---------- */
  P.readExpr = function (opts) {
    opts = opts || {};
    var atoms = [];
    while (!this.eof()) {
      var tk = this.peek();
      if (tk.k === 'punct') {
        if (tk.v === ')' || tk.v === ';') break;
        if (tk.v === ',') { if (opts.comma) break; atoms.push(this.next()); continue; }
        if (tk.v === '(') { atoms.push(this.parseGroup(atoms)); continue; }
      }
      if (tk.k === 'word') {
        var u = tk.v.toUpperCase();
        if (opts.stop && opts.stop[u]) break;
        if (u === 'CASE') { atoms.push(this.parseCase()); continue; }
      }
      atoms.push(this.next());
    }
    return atoms;
  };

  P.parseGroup = function (prev, noFn) {
    var open = this.next();
    var gp = { t: 'group', open: open, close: null, fn: null, args: [], sub: null, inList: false };
    if (!noFn && prev && prev.length) {
      var p = prev[prev.length - 1];
      var pu = up(p);
      if (pu === 'IN') gp.inList = true;
      else if (!p.t && ((p.k === 'word' && !NOFN[pu]) || p.k === 'name')) {
        gp.fn = prev.pop();
        gp.fn.fn = true;
        if (gp.fn.v.toUpperCase() === 'DECODE') this.st.decodes++;
      }
    }
    if (this.isSelectStart(this.peek())) {
      var kind = this.ctx === 'select' ? 'scalar' : this.ctx === 'from' ? 'inline' : this.ctx === 'cte' ? 'cte' : 'cond';
      this.st.sub++;
      this.st[kind]++;
      gp.sub = { q: this.parseQuery(), kind: kind };
      // "( -- 주석" 처럼 여는 괄호 뒤 주석은 첫 SELECT 위 주석으로 (몇 번을 정리해도 같은 결과가 나오게)
      var fp = gp.sub.q.parts[0];
      if (open.tc && !gp.sub.q.with.length && fp && fp.sel.t === 'select') {
        fp.sel.kwLead = open.tc.concat(fp.sel.kwLead);
        open.tc = null;
      }
    } else if (!this.isP(this.peek(), ')')) {
      var pend = null;
      for (;;) {
        var arg = this.readExpr({ comma: true });
        if (pend && arg.length) {
          var ft = firstTok(arg[0]);
          ft.lc = pend.concat(ft.lc || []);
          pend = null;
        }
        gp.args.push(arg);
        if (this.isP(this.peek(), ',')) {
          // 콤마에 붙은 주석은 버리지 않고 옮겨요:
          //   "a, -- 주석"  → 앞 인자 끝 /  줄 맨 앞 콤마 ", /* 주석 */ b" → 다음 인자 앞
          var cm = this.next();
          var cs = (cm.lc || []).concat(cm.tc || []);
          cm.lc = null;
          cm.tc = null;
          if (cs.length) {
            if (cm.nl) pend = cs;
            else if (arg.length) { var lt = lastTok(arg[arg.length - 1]); lt.tc = (lt.tc || []).concat(cs); }
            else pend = cs;
          }
          continue;
        }
        break;
      }
      if (pend && gp.args.length) {
        var la = gp.args[gp.args.length - 1];
        if (la.length) { var lt2 = lastTok(la[la.length - 1]); lt2.tc = (lt2.tc || []).concat(pend); }
      }
    }
    gp.close = this.expectP(')');
    return gp;
  };

  P.parseCase = function () {
    var kw = this.next();
    this.st.cases++;
    var node = { t: 'case', kw: kw, endTok: null, operand: null, whens: [], els: null };
    if (!this.isW(this.peek(), 'WHEN')) node.operand = this.readExpr({ stop: { WHEN: 1 } });
    // WHEN · THEN · ELSE 키워드에 붙은 주석은 분기 쪽으로 옮겨요 (버리지 않게)
    function grab(t) { var cs = (t.lc || []).concat(t.tc || []); t.lc = null; t.tc = null; return cs; }
    while (this.isW(this.peek(), 'WHEN')) {
      var cm = grab(this.next());
      var c = this.readExpr({ stop: { THEN: 1 } });
      cm = cm.concat(grab(this.expectW('THEN')));
      var r = this.readExpr({ stop: { WHEN: 1, ELSE: 1, END: 1 } });
      node.whens.push({ c: c, r: r, cm: cm });
    }
    if (!node.whens.length) throw new PErr('CASE 에 WHEN 이 없어요', kw);
    if (this.isW(this.peek(), 'ELSE')) { node.elsCm = grab(this.next()); node.els = this.readExpr({ stop: { END: 1 } }); }
    node.endTok = this.expectW('END');
    return node;
  };

  /* ---------- 목록 ---------- */
  /* 목록 사이 콤마에 붙은 주석 나누기
   *  - 콤마 앞 줄에 따로 있던 주석(-- , b.x 처럼 주석 처리한 항목)은 다음 항목 위로
   *  - 콤마 뒤 주석은: 콤마가 줄 맨 앞이면(", b") 다음 항목 것, 아니면("a, -- 주석") 앞 항목 것 */
  function commaCmts(c, prev) {
    var next = [];
    if (c.lc) { next = next.concat(c.lc); c.lc = null; }
    if (c.tc) {
      if (c.nl) next = next.concat(c.tc);
      else prev.trail = prev.trail.concat(c.tc);
      c.tc = null;
    }
    return next;
  }

  P.parseList = function (stop) {
    var items = [], pend = [];
    for (;;) {
      var atoms = this.readExpr({ comma: true, stop: stop });
      if (!atoms.length) throw new PErr('항목이 비어 있어요', this.peek() || this.last());
      var h = harvest(atoms);
      var it = { atoms: atoms, lead: pend.concat(h.lead), trail: h.trail };
      items.push(it);
      pend = [];
      if (this.isP(this.peek(), ',')) { pend = commaCmts(this.next(), it); continue; }
      break;
    }
    return items;
  };

  P.parseSelectItems = function () {
    var items = [], pend = [];
    for (;;) {
      var atoms = this.readExpr({ comma: true, stop: { FROM: 1, INTO: 1 } });
      if (!atoms.length) throw new PErr('SELECT 항목이 비어 있어요', this.peek() || this.last());
      var sa = splitAlias(atoms);
      var h = harvest(sa.rest, sa.alias);
      var it = { atoms: sa.rest, alias: sa.alias, hadAs: sa.hadAs, lead: pend.concat(h.lead), trail: h.trail };
      items.push(it);
      pend = [];
      if (this.isP(this.peek(), ',')) { pend = commaCmts(this.next(), it); continue; }
      break;
    }
    return items;
  };

  P.parseRef = function (stop) {
    var atoms = this.readExpr({ comma: true, stop: stop || FROM_STOP });
    if (!atoms.length) throw new PErr('테이블 이름이 필요해요', this.peek() || this.last());
    var sa = splitAlias(atoms);
    var h = harvest(sa.rest, sa.alias);
    return { atoms: sa.rest, alias: sa.alias, lead: h.lead, trail: h.trail };
  };

  P.isJoinStart = function () {
    return this.isW(this.peek(), 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'NATURAL');
  };

  P.parseJoin = function () {
    var words = [];
    while (!this.isW(this.peek(), 'JOIN')) {
      var t = this.peek();
      if (!this.isW(t, 'NATURAL', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER') || words.length > 3) {
        throw new PErr('JOIN 구문을 해석하지 못했어요', t || this.last());
      }
      words.push(this.next());
    }
    var jt = this.next();
    var all = words.concat([jt]);
    var kc = kwTok.apply(null, all);
    var join = { kind: words.map(function (w) { return w.v.toUpperCase(); }).concat(['JOIN']).join(' '), kwOrig: kc.kw, lead: kc.lead, ref: null, on: null, using: null };
    join.ref = this.parseRef();
    var saveCtx = this.ctx;
    if (this.isW(this.peek(), 'ON')) {
      var onTok = this.next();
      join.lead = join.lead.concat(kwTok(onTok).lead);
      this.ctx = 'cond';
      var atoms = this.readExpr({ comma: true, stop: FROM_STOP });
      if (!atoms.length) throw new PErr('ON 조건이 비어 있어요', onTok);
      join.on = splitConds(atoms);
    } else if (this.isW(this.peek(), 'USING')) {
      this.next();
      join.using = this.readExpr({ comma: true, stop: FROM_STOP });
    }
    this.ctx = saveCtx;
    return join;
  };

  P.parseFrom = function () {
    var items = [];
    for (;;) {
      var ref = this.parseRef();
      var it = { ref: ref, joins: [] };
      while (this.isJoinStart()) it.joins.push(this.parseJoin());
      items.push(it);
      if (this.isP(this.peek(), ',')) {
        var c = this.next();
        if (c.tc) { ref.trail = ref.trail.concat(c.tc); c.tc = null; }
        continue;
      }
      break;
    }
    return items;
  };

  P.parseCondClause = function (kwToks, stop) {
    var kc = kwTok.apply(null, kwToks);
    var atoms = this.readExpr({ stop: stop });
    if (!atoms.length) throw new PErr(kc.kw.toUpperCase() + ' 조건이 비어 있어요', kwToks[0]);
    return { kw: kc.kw, lead: kc.lead, conds: splitConds(atoms) };
  };

  /* ---------- SELECT ---------- */
  P.parseSelect = function () {
    var kwt = this.next();
    this.st.blocks++;
    var save = this.ctx;
    var kc = kwTok(kwt);
    var sel = { t: 'select', kw: kc.kw, kwLead: kc.lead, hint: null, quant: null, items: [], into: null, from: null,
      where: null, start: null, connect: null, group: null, having: null, order: null, tails: [] };
    if (this.peek() && this.peek().k === 'hint') sel.hint = this.next();
    if (this.isW(this.peek(), 'DISTINCT', 'UNIQUE', 'ALL')) sel.quant = this.next();
    this.ctx = 'select';
    sel.items = this.parseSelectItems();
    if (this.isW(this.peek(), 'INTO')) {
      var it = this.next();
      var ic = kwTok(it);
      this.ctx = 'cond';
      sel.into = { kw: ic.kw, lead: ic.lead, items: this.parseList({ FROM: 1 }) };
    }
    if (this.isW(this.peek(), 'FROM')) {
      var ft = this.next();
      var fc = kwTok(ft);
      this.ctx = 'from';
      sel.from = { kw: fc.kw, lead: fc.lead, items: this.parseFrom() };
    }
    this.ctx = 'cond';
    for (;;) {
      var t = this.peek();
      if (!t) break;
      if (this.isW(t, 'WHERE')) { this.next(); sel.where = this.parseCondClause([t], CLAUSE_STOP); continue; }
      if (this.isW(t, 'START')) { this.next(); var w = this.expectW('WITH'); sel.start = this.parseCondClause([t, w], CLAUSE_STOP); continue; }
      if (this.isW(t, 'CONNECT')) { this.next(); var b = this.expectW('BY'); sel.connect = this.parseCondClause([t, b], CLAUSE_STOP); continue; }
      if (this.isW(t, 'GROUP')) {
        this.next(); var b2 = this.expectW('BY');
        var gc = kwTok(t, b2);
        sel.group = { kw: gc.kw, lead: gc.lead, items: this.parseList(CLAUSE_STOP) };
        continue;
      }
      if (this.isW(t, 'HAVING')) { this.next(); sel.having = this.parseCondClause([t], CLAUSE_STOP); continue; }
      if (this.isW(t, 'ORDER')) {
        this.next();
        var toks = [t];
        if (this.isW(this.peek(), 'SIBLINGS')) toks.push(this.next());
        toks.push(this.expectW('BY'));
        var oc = kwTok.apply(null, toks);
        sel.order = { kw: oc.kw, lead: oc.lead, items: this.parseList(CLAUSE_STOP) };
        continue;
      }
      if (this.isW(t, 'FOR', 'FETCH', 'OFFSET')) {
        this.next();
        var tc = kwTok(t);
        sel.tails.push({ kw: tc.kw, lead: tc.lead, atoms: this.readExpr({ stop: CLAUSE_STOP }) });
        continue;
      }
      break;
    }
    this.ctx = save;
    return sel;
  };

  P.parseQuery = function () {
    var save = this.ctx;
    var q = { t: 'query', with: [], parts: [] };
    if (this.isW(this.peek(), 'WITH')) {
      var wt = this.next();
      q.withKw = kwTok(wt);
      for (;;) {
        var name = this.next();
        if (!name || (name.k !== 'word' && name.k !== 'name')) throw new PErr('WITH 의 이름이 필요해요', name || this.last());
        var cols = null;
        if (this.isP(this.peek(), '(')) cols = this.parseGroup([], true);
        this.expectW('AS');
        this.expectP('(');
        this.ctx = 'cte';
        var cq = this.parseQuery();
        this.expectP(')');
        this.st.cte++;
        q.with.push({ name: name, cols: cols, q: cq });
        if (this.isP(this.peek(), ',')) { this.next(); continue; }
        break;
      }
    }
    var op = null, opc = null;
    for (;;) {
      var sel;
      if (this.isP(this.peek(), '(')) {
        var open = this.next();
        var inner = this.parseQuery();
        var close = this.expectP(')');
        sel = { t: 'pq', q: inner, open: open, close: close };
      } else if (this.isW(this.peek(), 'SELECT')) {
        sel = this.parseSelect();
      } else {
        throw new PErr('SELECT 가 필요해요', this.peek() || this.last());
      }
      q.parts.push({ op: op, opLead: opc ? opc.lead : [], opTail: opc ? opc.tail : [], sel: sel });
      var t = this.peek();
      if (this.isW(t, 'UNION', 'MINUS', 'INTERSECT')) {
        // UNION ALL 앞뒤 주석도 함께 옮겨요
        var opToks = [this.next()];
        var s = t.v.toUpperCase();
        if (s === 'UNION' && this.isW(this.peek(), 'ALL')) { opToks.push(this.next()); s = 'UNION ALL'; }
        opc = { lead: [], tail: [] };
        opToks.forEach(function (x, i) {
          if (x.lc) { if (i === 0) opc.lead = opc.lead.concat(x.lc); else opc.tail = opc.tail.concat(x.lc); x.lc = null; }
          if (x.tc) { opc.tail = opc.tail.concat(x.tc); x.tc = null; }
        });
        op = s;
        continue;
      }
      break;
    }
    this.ctx = save;
    return q;
  };

  /* ---------- DML ---------- */
  P.parseAssigns = function (stop) {
    var items = this.parseList(stop);
    return items.map(function (it) {
      var idx = -1;
      for (var k = 0; k < it.atoms.length; k++) {
        var a = it.atoms[k];
        if (!a.t && a.k === 'op' && a.v === '=') { idx = k; break; }
      }
      if (idx < 1) throw new PErr('SET 항목에 = 가 필요해요', firstTok(it.atoms[0]));
      return { lhs: it.atoms.slice(0, idx), rhs: it.atoms.slice(idx + 1), lead: it.lead, trail: it.trail };
    });
  };

  P.parseReturning = function () {
    var t = this.peek();
    if (!this.isW(t, 'RETURNING', 'RETURN')) return null;
    this.next();
    var kc = kwTok(t);
    return { kw: kc.kw, lead: kc.lead, atoms: this.readExpr({}) };
  };

  P.parseOptWhere = function (stop) {
    var t = this.peek();
    if (!this.isW(t, 'WHERE')) return null;
    this.next();
    return this.parseCondClause([t], stop);
  };

  P.parseInsert = function () {
    var kw = this.next();
    var kc = kwTok(kw);
    var hint = null;
    if (this.peek() && this.peek().k === 'hint') hint = this.next();
    if (this.isW(this.peek(), 'ALL', 'FIRST')) throw new PErr('다중 테이블 INSERT 는 지원하지 않아요', this.peek());
    var it = this.expectW('INTO');
    var ic = kwTok(it);
    var table = [];
    while (!this.eof() && !this.isP(this.peek(), '(') && !this.isW(this.peek(), 'VALUES', 'SELECT', 'WITH')) table.push(this.next());
    if (!table.length) throw new PErr('INSERT 대상 테이블이 필요해요', this.peek() || this.last());
    var cols = null;
    if (this.isP(this.peek(), '(') && !this.isSelectStart(this.peek(1))) cols = this.parseGroup([], true);
    var values = null, query = null;
    this.ctx = 'cond';
    if (this.isW(this.peek(), 'VALUES')) {
      this.next();
      if (!this.isP(this.peek(), '(')) throw new PErr('VALUES 뒤에 ( 가 필요해요', this.peek() || this.last());
      values = this.parseGroup([], true);
    } else {
      query = this.parseQuery();
    }
    var tail = this.parseReturning();
    return { t: 'insert', kw: kc.kw, lead: kc.lead.concat(ic.lead), hint: hint, table: table, cols: cols, values: values, query: query, tail: tail };
  };

  P.parseUpdate = function () {
    var kw = this.next();
    var kc = kwTok(kw);
    var hint = null;
    if (this.peek() && this.peek().k === 'hint') hint = this.next();
    var ref = this.parseRef({ SET: 1 });
    var st = this.expectW('SET');
    var sc = kwTok(st);
    this.ctx = 'cond';
    var assigns = this.parseAssigns({ WHERE: 1, RETURNING: 1, RETURN: 1 });
    var where = this.parseOptWhere({ RETURNING: 1, RETURN: 1 });
    var tail = this.parseReturning();
    return { t: 'update', kw: kc.kw, lead: kc.lead, hint: hint, ref: ref, setKw: sc.kw, setLead: sc.lead, assigns: assigns, where: where, tail: tail };
  };

  P.parseDelete = function () {
    var kw = this.next();
    var kc = kwTok(kw);
    var hint = null;
    if (this.peek() && this.peek().k === 'hint') hint = this.next();
    var fromKw = null;
    if (this.isW(this.peek(), 'FROM')) fromKw = kwTok(this.next()).kw;
    var ref = this.parseRef({ WHERE: 1, RETURNING: 1, RETURN: 1 });
    this.ctx = 'cond';
    var where = this.parseOptWhere({ RETURNING: 1, RETURN: 1 });
    var tail = this.parseReturning();
    return { t: 'delete', kw: kc.kw, lead: kc.lead, hint: hint, fromKw: fromKw, ref: ref, where: where, tail: tail };
  };

  P.parseMerge = function () {
    var kw = this.next();
    var kc = kwTok(kw);
    var hint = null;
    if (this.peek() && this.peek().k === 'hint') hint = this.next();
    var it = this.expectW('INTO');
    var ic = kwTok(it);
    var target = this.parseRef({ USING: 1 });
    var ut = this.expectW('USING');
    this.ctx = 'from';
    var using = this.parseRef({ ON: 1 });
    var ot = this.expectW('ON');
    this.ctx = 'cond';
    var onAtoms = this.readExpr({ stop: { WHEN: 1 } });
    if (!onAtoms.length) throw new PErr('ON 조건이 비어 있어요', ot);
    var on = splitConds(onAtoms);
    var whens = [];
    while (this.isW(this.peek(), 'WHEN')) {
      var wt = this.next();
      var matched = true;
      var toks = [wt];
      if (this.isW(this.peek(), 'NOT')) { toks.push(this.next()); matched = false; }
      toks.push(this.expectW('MATCHED'));
      var and = null;
      if (this.isW(this.peek(), 'AND')) { this.next(); and = this.readExpr({ stop: { THEN: 1 } }); }
      var th = this.expectW('THEN');
      var wc = kwTok.apply(null, toks);
      var act = {};
      if (this.isW(this.peek(), 'UPDATE')) {
        this.next();
        this.expectW('SET');
        act.kind = 'update';
        act.assigns = this.parseAssigns({ WHERE: 1, DELETE: 1, WHEN: 1 });
        act.where = this.parseOptWhere({ DELETE: 1, WHEN: 1 });
        if (this.isW(this.peek(), 'DELETE')) {
          var dt = this.next();
          var wt2 = this.expectW('WHERE');
          act.del = this.parseCondClause([dt, wt2], { WHEN: 1 });
        }
      } else if (this.isW(this.peek(), 'INSERT')) {
        this.next();
        act.kind = 'insert';
        if (this.isP(this.peek(), '(')) act.cols = this.parseGroup([], true);
        this.expectW('VALUES');
        if (!this.isP(this.peek(), '(')) throw new PErr('VALUES 뒤에 ( 가 필요해요', this.peek() || this.last());
        act.values = this.parseGroup([], true);
        act.where = this.parseOptWhere({ WHEN: 1 });
      } else if (this.isW(this.peek(), 'DELETE')) {
        this.next();
        act.kind = 'delete';
      } else {
        throw new PErr('MERGE 의 UPDATE / INSERT / DELETE 가 필요해요', this.peek() || this.last());
      }
      void th;
      whens.push({ matched: matched, and: and, act: act, kwOrig: wc.kw, lead: wc.lead });
    }
    if (!whens.length) throw new PErr('MERGE 에 WHEN 절이 필요해요', this.peek() || this.last());
    return { t: 'merge', kw: kc.kw, lead: kc.lead.concat(ic.lead), hint: hint, target: target, using: using, on: on, whens: whens };
  };

  P.parseStatement = function () {
    var f = this.peek();
    if (!f) throw new PErr('비어 있어요', null);
    var ast;
    if (this.isW(f, 'SELECT', 'WITH') || this.isP(f, '(')) ast = { t: 'query', q: this.parseQuery() };
    else if (this.isW(f, 'INSERT')) ast = this.parseInsert();
    else if (this.isW(f, 'UPDATE')) ast = this.parseUpdate();
    else if (this.isW(f, 'DELETE')) ast = this.parseDelete();
    else if (this.isW(f, 'MERGE')) ast = this.parseMerge();
    else throw new PErr('지원하지 않는 구문이에요: ' + f.v, f);
    if (!this.eof()) throw new PErr("해석하지 못한 부분이 있어요: '" + this.peek().v + "'", this.peek());
    return ast;
  };

  /* ---------- 전체 입력 ---------- */
  function attach(raw) {
    var sig = [], pend = [], last = null, all = [];
    raw.forEach(function (t) {
      if (t.k === 'lcomment' || t.k === 'bcomment') {
        var c = { k: t.k, v: t.v, used: false, pos: t.pos, end: t.end };
        all.push(c);
        if (last && !t.nl) { (last.tc = last.tc || []).push(c); } else pend.push(c);
      } else {
        if (pend.length) { t.lc = pend; pend = []; }
        sig.push(t);
        last = t;
      }
    });
    return { sig: sig, tail: pend, all: all };
  }

  function lineOf(src, pos) {
    var line = 1;
    for (var i = 0; i < pos && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
    return line;
  }

  function startsPlsql(sig, i) {
    var t = sig[i];
    if (!t || t.k !== 'word') return false;
    var u = t.v.toUpperCase();
    if (u === 'BEGIN' || u === 'DECLARE') return true;
    if (u === 'CREATE') {
      for (var k = i + 1; k < Math.min(sig.length, i + 7); k++) {
        var w = sig[k].k === 'word' ? sig[k].v.toUpperCase() : '';
        if (w === 'PROCEDURE' || w === 'FUNCTION' || w === 'PACKAGE' || w === 'TRIGGER' || w === 'TYPE') return true;
      }
    }
    return false;
  }

  function newDdl(sig, i) {
    var t = sig[i], p = sig[i - 1];
    if (!t || t.k !== 'word' || !p) return false;
    var u = t.v.toUpperCase(), pu = p.k === 'word' ? p.v.toUpperCase() : '';
    if (pu === 'GRANT' || pu === 'REVOKE' || pu === 'ON' || (p.k === 'punct' && p.v === ',')) return false;
    if (u === 'COMMENT') return !!sig[i + 1] && sig[i + 1].k === 'word' && sig[i + 1].v.toUpperCase() === 'ON';
    return u === 'CREATE' || u === 'ALTER' || u === 'GRANT' || u === 'REVOKE' || u === 'DROP' || u === 'TRUNCATE';
  }

  function parse(src) {
    var raw = S.tokenize(src);
    var at = attach(raw);
    var sig = at.sig;
    var stats = { blocks: 0, sub: 0, scalar: 0, inline: 0, cond: 0, cte: 0, cases: 0, decodes: 0, outer: 0, binds: 0, ansi: 0 };
    var binds = {};
    sig.forEach(function (t) {
      if (t.k === 'op' && t.v === '(+)') stats.outer++;
      if (t.k === 'bind') binds[t.v.toLowerCase()] = 1;
    });
    stats.binds = Object.keys(binds).length;
    stats.bindNames = Object.keys(binds);

    var groups = [];
    var cur = [], plsql = false;
    function flush(semi, slash) {
      if (cur.length) groups.push({ toks: cur, semi: semi || null, slash: !!slash, plsql: plsql });
      cur = [];
      plsql = false;
    }
    function isSlash(i) {
      var t = sig[i];
      return t.k === 'op' && t.v === '/' && t.nl && (i + 1 >= sig.length || sig[i + 1].nl);
    }
    var depth = 0;
    for (var i = 0; i < sig.length; i++) {
      var t = sig[i];
      if (!cur.length) {
        if (isSlash(i)) continue;
        plsql = startsPlsql(sig, i);
        depth = 0;
      }
      if (isSlash(i) && cur.length) { flush(null, true); continue; }
      if (!plsql && t.k === 'punct' && t.v === ';') { flush(t); continue; }
      // ; 없이 이어 붙은 DDL (DB 도구에서 복사한 CREATE TABLE 뒤 COMMENT ON 등): 줄 맨 앞 DDL 단어에서 문장을 나눠요
      if (!plsql && cur.length && depth === 0 && t.nl && newDdl(sig, i)) { flush(null); plsql = startsPlsql(sig, i); }
      if (t.k === 'punct' && t.v === '(') depth++;
      else if (t.k === 'punct' && t.v === ')') depth = Math.max(0, depth - 1);
      cur.push(t);
    }
    flush(null);

    var stmts = groups.map(function (gr) {
      var toks = gr.toks;
      var st = { toks: toks, ast: null, err: null, lead: [], tail: [], raw: src.slice(toks[0].pos, toks[toks.length - 1].end), line: lineOf(src, toks[0].pos), hadSemi: !!gr.semi, slash: gr.slash, plsql: gr.plsql };
      if (toks[0].lc) { st.lead = toks[0].lc; toks[0].lc = null; }
      if (gr.semi && gr.semi.tc) { st.tail = gr.semi.tc; gr.semi.tc = null; }
      if (gr.plsql) return st; // PL/SQL 블록은 plsql.js 가 따로 정리해요
      try {
        st.ast = new Parser(toks, stats).parseStatement();
      } catch (e) {
        if (e instanceof PErr) {
          st.err = { message: e.message, line: e.tok ? lineOf(src, e.tok.pos) : st.line, near: e.tok ? e.tok.v : '' };
        } else throw e;
      }
      return st;
    });
    return { stmts: stmts, stats: stats, tail: at.tail, comments: at.all };
  }

  /* ---------- 트리 순회 ---------- */
  function walkAtoms(arr, cb) {
    cb(arr);
    for (var i = 0; i < arr.length; i++) {
      var a = arr[i];
      if (a.t === 'group') {
        a.args.forEach(function (x) { walkAtoms(x, cb); });
        if (a.sub) walkQuery(a.sub.q, cb);
      } else if (a.t === 'case') {
        if (a.operand) walkAtoms(a.operand, cb);
        a.whens.forEach(function (w) { walkAtoms(w.c, cb); walkAtoms(w.r, cb); });
        if (a.els) walkAtoms(a.els, cb);
      }
    }
  }
  function walkCondList(conds, cb) { if (conds) conds.forEach(function (c) { walkAtoms(c.atoms, cb); }); }
  function walkSelect(s, cb) {
    s.items.forEach(function (it) { walkAtoms(it.atoms, cb); });
    if (s.into) s.into.items.forEach(function (it) { walkAtoms(it.atoms, cb); });
    if (s.from) s.from.items.forEach(function (f) {
      walkAtoms(f.ref.atoms, cb);
      f.joins.forEach(function (j) {
        walkAtoms(j.ref.atoms, cb);
        walkCondList(j.on, cb);
        if (j.using) walkAtoms(j.using, cb);
      });
    });
    ['where', 'start', 'connect', 'having'].forEach(function (k) { if (s[k]) walkCondList(s[k].conds, cb); });
    ['group', 'order'].forEach(function (k) { if (s[k]) s[k].items.forEach(function (it) { walkAtoms(it.atoms, cb); }); });
    s.tails.forEach(function (t) { walkAtoms(t.atoms, cb); });
  }
  function walkQuery(q, cb) {
    q.with.forEach(function (c) { walkQuery(c.q, cb); });
    q.parts.forEach(function (p) { if (p.sel.t === 'select') walkSelect(p.sel, cb); else walkQuery(p.sel.q, cb); });
  }
  function walkAssigns(list, cb) { list.forEach(function (a) { walkAtoms(a.lhs, cb); walkAtoms(a.rhs, cb); }); }
  function walkStmt(st, cb) {
    switch (st.t) {
      case 'query': walkQuery(st.q, cb); break;
      case 'insert':
        if (st.cols) walkAtoms([st.cols], cb);
        if (st.values) walkAtoms([st.values], cb);
        if (st.query) walkQuery(st.query, cb);
        if (st.tail) walkAtoms(st.tail.atoms, cb);
        break;
      case 'update':
        walkAtoms(st.ref.atoms, cb);
        walkAssigns(st.assigns, cb);
        if (st.where) walkCondList(st.where.conds, cb);
        if (st.tail) walkAtoms(st.tail.atoms, cb);
        break;
      case 'delete':
        walkAtoms(st.ref.atoms, cb);
        if (st.where) walkCondList(st.where.conds, cb);
        if (st.tail) walkAtoms(st.tail.atoms, cb);
        break;
      case 'merge':
        walkAtoms(st.target.atoms, cb);
        walkAtoms(st.using.atoms, cb);
        walkCondList(st.on, cb);
        st.whens.forEach(function (w) {
          if (w.and) walkAtoms(w.and, cb);
          var a = w.act;
          if (a.assigns) walkAssigns(a.assigns, cb);
          if (a.where) walkCondList(a.where.conds, cb);
          if (a.del) walkCondList(a.del.conds, cb);
          if (a.cols) walkAtoms([a.cols], cb);
          if (a.values) walkAtoms([a.values], cb);
        });
        break;
    }
  }
  function eachSelect(st, fn) {
    function q(query) {
      query.with.forEach(function (c) { q(c.q); });
      query.parts.forEach(function (p) { if (p.sel.t === 'select') fn(p.sel); else q(p.sel.q); });
    }
    walkStmt(st, function (arr) {
      for (var i = 0; i < arr.length; i++) { /* 서브쿼리는 walkAtoms 가 따로 방문 */ }
    });
    // 최상위 쿼리 + 서브쿼리를 모두 모으기
    var seen = [];
    function collect(query) {
      seen.push(query);
      query.with.forEach(function (c) { collect(c.q); });
      query.parts.forEach(function (p) { if (p.sel.t === 'pq') collect(p.sel.q); });
    }
    var tops = [];
    if (st.t === 'query') tops.push(st.q);
    if (st.t === 'insert' && st.query) tops.push(st.query);
    tops.forEach(collect);
    walkStmt(st, function (arr) {
      arr.forEach(function (a) { if (a.t === 'group' && a.sub) collect(a.sub.q); });
    });
    seen.forEach(function (query) {
      query.parts.forEach(function (p) { if (p.sel.t === 'select') fn(p.sel); });
    });
    void q;
  }

  S.PErr = PErr;
  S.parse = parse;
  S.splitConds = splitConds;
  S.PErr = PErr;
  /* PL/SQL 포매터용: 토큰 조각을 식(atom 배열) · SQL 문장으로 해석해요 */
  S.parseExprToks = function (toks, stats) {
    var p = new Parser(toks, stats);
    var a = p.readExpr();
    if (!p.eof()) throw new PErr("해석하지 못한 부분이 있어요: '" + p.peek().v + "'", p.peek());
    return a;
  };
  S.parseStmtToks = function (toks, stats) { return new Parser(toks, stats).parseStatement(); };
  S.firstTok = firstTok;
  S.lastTok = lastTok;
  S.walk = { atoms: walkAtoms, query: walkQuery, stmt: walkStmt, eachSelect: eachSelect };
})(typeof window !== 'undefined' ? window : globalThis);
