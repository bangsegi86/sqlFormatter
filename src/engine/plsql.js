/* PL/SQL 포매터: CREATE PROCEDURE · FUNCTION · PACKAGE [BODY] · TRIGGER, DECLARE / BEGIN 블록
 *
 * 블록 구조(IS · BEGIN · IF · LOOP · CASE · EXCEPTION)를 따라 들여쓰기 단계를 매기고,
 * 블록 안의 SQL 문장(SELECT INTO · INSERT · UPDATE · DELETE · MERGE · 커서 쿼리)은
 * 기존 쿼리 포매터(parser.js · render.js)로 정리한 뒤 그 단계만큼 들여써요.
 *
 * 안전 원칙
 *  - 문장 하나를 해석하지 못하면(PErr) 그 문장만 원문 그대로 두고 알려줘요.
 *  - 블록 구조 자체가 맞지 않으면(PlErr) 블록 전체를 원문 그대로 둬요 (format.js).
 */
(function (g) {
  'use strict';
  var S = (g.SQLF = g.SQLF || {});

  function mk(s) { var m = {}; s.split(/\s+/).forEach(function (w) { if (w) m[w] = true; }); return m; }
  function up(t) { return t && t.k === 'word' ? t.v.toUpperCase() : null; }
  function padEnd(s, n) { return s.length >= n ? s : s + new Array(n - s.length + 1).join(' '); }

  // PL/SQL 안에서만 대소문자를 맞추는 낱말 (일반 SQL 의 컬럼 이름에는 영향 없음)
  var PLKW = mk('IF THEN ELSIF ELSE END LOOP WHILE FOR FORALL REVERSE EXIT CONTINUE WHEN RETURN IS AS BEGIN DECLARE ' +
    'EXCEPTION OTHERS RAISE RAISE_APPLICATION_ERROR PRAGMA CURSOR OPEN FETCH CLOSE BULK COLLECT LIMIT SUBTYPE RECORD ' +
    'CONSTANT DEFAULT NOCOPY OUT COMMIT ROLLBACK SAVEPOINT EXECUTE IMMEDIATE PROCEDURE FUNCTION PACKAGE BODY TRIGGER ' +
    'CREATE REPLACE EDITIONABLE NONEDITIONABLE BEFORE AFTER INSTEAD EACH REFERENCING GOTO AUTONOMOUS_TRANSACTION ' +
    'EXCEPTION_INIT SQLERRM SQLCODE AUTHID DETERMINISTIC PIPELINED VARCHAR2 VARCHAR NVARCHAR2 CHAR NCHAR NUMBER ' +
    'INTEGER PLS_INTEGER BINARY_INTEGER BOOLEAN DATE TIMESTAMP CLOB BLOB NCLOB SYS_REFCURSOR TYPE ROWTYPE ROWCOUNT ' +
    'FOUND NOTFOUND ISOPEN BULK_ROWCOUNT TABLE INDEX REF VARRAY INSERTING UPDATING DELETING');

  var SEMI = mk(';'), LOOPW = mk('LOOP'), THENW = mk('THEN'), WHENW = mk('WHEN'), ISAS = mk('IS AS');
  var ALL_STOP = mk('END EXCEPTION ELSIF ELSE WHEN');
  var BLOCK_STOP = mk('END EXCEPTION'), IF_STOP = mk('ELSIF ELSE END'), END_STOP = mk('END');
  var HANDLER_STOP = mk('WHEN END'), CASE_STOP = mk('WHEN ELSE END');
  var SQL_START = mk('SELECT WITH INSERT UPDATE DELETE MERGE');
  var DML_START = mk('INSERT UPDATE DELETE MERGE EXECUTE');
  // 단순 문장 안에 나오면 구조가 어긋난 것 (END 누락 등)
  var STRUCT_IN_SIMPLE = mk('THEN LOOP BEGIN ELSIF DECLARE EXCEPTION END');
  var PARAM_MODE = mk('IN OUT NOCOPY');
  var TRIGGER_BREAK = mk('BEFORE AFTER INSTEAD FOR REFERENCING WHEN FOLLOWS PRECEDES ENABLE DISABLE');

  function PlErr(msg, tok) { this.message = msg; this.tok = tok || null; }
  PlErr.prototype = Object.create(Error.prototype);

  function Fmt(st, src, o, stats, warnings) {
    this.t = st.toks;
    this.i = 0;
    this.src = src;
    this.o = o;
    this.stats = stats;
    this.warnings = warnings;
    this.R = S.render;
    this.out = [];
    this.lv = 0;
    this.w = o.plind;
    this.lastEnd = st.toks.length ? st.toks[0].pos : 0;
    this.rawAt = [];      // 원문 그대로 둔 문장의 시작 위치
    this.asgRun = [];     // 연속된 대입문 (:= 정렬용)
    this.curAsg = null;
    this.noGap = -1;      // 이 위치까지는 원본 빈 줄을 남기지 않아요 (빈 줄 탭의 "빼기")
  }
  var F = Fmt.prototype;

  /* ---------- 토큰 ---------- */
  F.peek = function (k) { return this.t[this.i + (k || 0)]; };
  F.eof = function () { return this.i >= this.t.length; };
  F.is = function (t) {
    var u = up(t);
    if (!u) return false;
    for (var a = 1; a < arguments.length; a++) if (arguments[a] === u) return true;
    return false;
  };
  F.isP = function (t, v) { return !!t && t.k === 'punct' && t.v === v; };
  F.isOp = function (t, v) { return !!t && t.k === 'op' && t.v === v; };
  F.err = function (msg, tok) { throw new PlErr(msg, tok || this.peek() || this.t[this.t.length - 1]); };
  F.seen = function (t) {
    var e = t.end;
    (t.tc || []).forEach(function (c) { if (c.end > e) e = c.end; });
    if (e > this.lastEnd) this.lastEnd = e;
  };
  F.take = function (n) {
    var arr = this.t.slice(this.i, this.i + (n === undefined ? 1 : n));
    this.i += arr.length;
    var self = this;
    arr.forEach(function (t) { self.seen(t); });
    return arr;
  };
  F.take1 = function () { return this.take(1)[0]; };
  F.takeTo = function (j) { return this.take(Math.max(0, j - this.i)); };

  /* 괄호 깊이 0 에서 words 중 하나가 처음 나오는 위치 (식 안의 CASE ... END 는 건너뜀). ';' 을 만나면 멈춰요. */
  F.find = function (words, from) {
    var d = 0, cs = 0;
    for (var j = from === undefined ? this.i : from; j < this.t.length; j++) {
      var t = this.t[j];
      if (t.k === 'punct') {
        if (t.v === '(') d++;
        else if (t.v === ')') d--;
        else if (t.v === ';' && d <= 0) return words[';'] ? j : -1;
        continue;
      }
      if (d > 0 || t.k !== 'word') continue;
      var u = t.v.toUpperCase();
      if (u === 'CASE') { cs++; continue; }
      if (u === 'END' && cs > 0) { cs--; continue; }
      if (cs === 0 && words[u]) return j;
    }
    return -1;
  };
  F.semi = function () { return this.find(SEMI); };

  /* ---------- 출력 ---------- */
  F.pad = function (lv) { return this.R.sp((lv === undefined ? this.lv : lv) * this.w); };
  F.col = function () { return this.lv * this.w; };
  F.line = function (text) { this.out.push(this.pad() + text); };
  F.lines = function (L) {
    var p = this.pad(), out = this.out;
    L.forEach(function (l) { out.push(l === '' ? '' : p + l); });
  };
  // 끝에 빈 줄이 n 줄 이상 있게 (맨 처음에는 넣지 않아요)
  F.blanks = function (n) {
    var out = this.out, have = 0;
    while (have < out.length && out[out.length - 1 - have] === '') have++;
    if (have === out.length) return;
    for (; have < n; have++) out.push('');
  };
  F.blank = function () { this.blanks(1); };
  F.kw = function (t) { return this.R.K(t.v.toUpperCase(), this.o, t.v); };

  /* 원문에서 빈 줄이 있었으면 한 줄로 지켜요 */
  F.gapAt = function (pos) {
    if (!this.o.plblank || pos == null || pos <= this.lastEnd || pos <= this.noGap) return;
    var n = (this.src.slice(this.lastEnd, pos).match(/\n/g) || []).length - 1;
    if (n >= 1) this.blanks(Math.min(n, this.o.blankmax || 1));
  };
  function firstPos(tok) { return tok.lc && tok.lc.length ? tok.lc[0].pos : tok.pos; }
  F.gap = function (tok) { if (tok) this.gapAt(firstPos(tok)); };

  /* ---------- 빈 줄 탭: 블록 안쪽 경계 (원본대로 / 넣기 / 빼기) ---------- */
  // 블록의 첫 문장 앞 (THEN · LOOP · BEGIN 다음 등)
  F.edgeAfter = function (tok, key) {
    var m = this.o[key];
    if (!tok || !m || m === 'keep') return;
    if (m === 'add') this.blank();
    else this.noGap = firstPos(tok);
  };
  // 블록의 마지막 문장 다음 (END IF · ELSIF · EXCEPTION 앞 등). gap(tok) 대신 써요
  F.edgeBefore = function (tok, key) {
    var m = this.o[key];
    if (m === 'add') { this.blank(); this.gap(tok); }
    else if (m === 'remove') {
      this.noGap = firstPos(tok);
      while (this.out.length && this.out[this.out.length - 1] === '') this.out.pop();
    } else this.gap(tok);
  };

  /* ---------- 빈 줄 탭: 덩어리 앞뒤 ---------- */
  var KIND_OPT = { sql: 'b_sql', 'if': 'b_if', 'case': 'b_case', loop: 'b_loop', block: 'b_block', cursor: 'b_cursor', callm: 'b_call', tx: 'b_tx' };
  // 지금 위치 문장의 종류
  F.kindOf = function (off) {
    off = off || 0;
    var t = this.peek(off), u = up(t);
    if (!t) return 'simple';
    if (this.isOp(t, '<') && this.isOp(this.peek(off + 1), '<')) return 'label:' + this.kindOf(off + 5);
    if (u === 'IF') return 'if';
    if (u === 'CASE') return 'case';
    if (u === 'LOOP' || u === 'WHILE' || u === 'FOR' || u === 'FORALL') return 'loop';
    if (u === 'BEGIN' || u === 'DECLARE') return 'block';
    if (u && (SQL_START[u] || u === 'EXECUTE')) return 'sql';
    if (u === 'OPEN') return this.find(mk('FOR'), this.i + off) >= 0 ? 'sql' : 'cursor';
    if (u === 'FETCH' || u === 'CLOSE') return 'cursor';
    if (u === 'COMMIT' || u === 'ROLLBACK' || u === 'SAVEPOINT') return 'tx';
    if ((t.k === 'word' || t.k === 'name') && this.isP(this.peek(off + 1), '(')) return 'call';
    return 'simple';
  };
  function baseKind(k) { return k.indexOf('label:') === 0 ? k.slice(6) : k; }
  F.wantAfter = function (k) { var v = this.o[KIND_OPT[baseKind(k)]]; return v === 'after' || v === 'both'; };
  F.wantBefore = function (k, tok) {
    var v = this.o[KIND_OPT[baseKind(k)]];
    return v === 'before' || v === 'both' || !!(this.o.b_cmt && tok && tok.lc && tok.lc.length);
  };
  // start 부터 찍은 줄 중 주석 · 빈 줄을 뺀 줄이 2줄 이상인지
  F.multiFrom = function (start) {
    var n = 0;
    for (var k = start; k < this.out.length; k++) {
      var s = this.out[k].trim();
      if (s && s.indexOf('--') !== 0 && s.indexOf('/*') !== 0) n++;
    }
    return n > 1;
  };

  /* ---------- 주석 ---------- */
  // 주석 한 개를 한 줄(또는 원래 모양 그대로 여러 줄)로
  F.cmt = function (c) {
    c.used = true;
    var ls = c.v.split(/\r?\n/);
    this.line(ls[0].replace(/\s+$/, ''));
    if (ls.length > 1) {
      // 여러 줄 블록 주석은 첫 줄이 옮겨 간 만큼 나머지 줄도 같이 옮겨서 모양을 지켜요
      var ls0 = this.src.lastIndexOf('\n', c.pos - 1) + 1;
      var delta = this.col() - (c.pos - ls0);
      for (var i = 1; i < ls.length; i++) {
        var l = ls[i].replace(/\s+$/, '');
        if (delta > 0 && l) l = this.R.sp(delta) + l;
        else if (delta < 0) { var lead = /^ */.exec(l)[0].length; l = l.slice(Math.min(lead, -delta)); }
        this.out.push(l);
      }
    }
    if (c.end > this.lastEnd) this.lastEnd = c.end;
  };
  // tok 앞에 붙은 주석들을 줄로 꺼내요
  F.leadCmts = function (tok) {
    if (!tok || !tok.lc) return;
    var cs = tok.lc, self = this;
    tok.lc = null;
    cs.forEach(function (c) { self.gapAt(c.pos); self.cmt(c); });
    this.gapAt(tok.pos); // 주석과 문장 사이의 빈 줄도 지켜요
  };
  // 토큰들에 붙은 주석을 줄 끝 글자로 (마지막 하나만 -- 그대로, 나머지는 /* */)
  F.tailText = function (cs) {
    var R = this.R;
    if (!cs.length) return '';
    return ' ' + cs.map(function (c, i) { return i === cs.length - 1 ? R.cmtLine(c) : R.cmtInline(c); }).join(' ');
  };
  F.takeCmts = function (toks, skipFirstLead) {
    var cs = [];
    toks.forEach(function (t, i) {
      if (!t) return;
      if (t.lc && (i || !skipFirstLead)) { cs = cs.concat(t.lc); t.lc = null; }
      if (t.tc) { cs = cs.concat(t.tc); t.tc = null; }
    });
    return cs;
  };
  F.tail = function (toks, skipFirstLead) { return this.tailText(this.takeCmts(toks, skipFirstLead)); };

  /* ---------- 식 ---------- */
  F.expr = function (toks) { return S.parseExprToks(toks, this.stats); };
  F.layout = function (atoms, extra) { return this.R.layout(atoms, this.col() + (extra || 0), this.o); };
  // 해석이 안 되면 토큰을 그대로 이어 붙여요 (문자열 · 이름은 그대로)
  F.join = function (toks) {
    var s = '', prev = null, R = this.R, o = this.o;
    toks.forEach(function (t) {
      var txt = R.tokText(t, o);
      var tight = !prev ||
        (prev.k === 'punct' && prev.v === '(') ||
        (t.k === 'punct' && (t.v === ')' || t.v === ',' || t.v === ';')) ||
        (t.k === 'op' && (t.v === '.' || t.v === '%' || t.v === '..')) ||
        (prev.k === 'op' && (prev.v === '.' || prev.v === '%' || prev.v === '..')) ||
        (t.k === 'punct' && t.v === '(' && (prev.k === 'word' || prev.k === 'name'));
      s += (tight ? '' : ' ') + txt;
      prev = t;
    });
    return s;
  };
  F.exprLines = function (toks, extra) {
    if (!toks.length) return [''];
    try { return this.layout(this.expr(toks), extra); } catch (e) { if (e instanceof S.PErr) return [this.join(toks)]; throw e; }
  };
  F.flatLine = function (toks) {
    if (!toks.length) return '';
    try {
      var f = this.R.flat(this.expr(toks), this.o);
      if (f !== null) return f;
    } catch (e) { if (!(e instanceof S.PErr)) throw e; }
    return this.join(toks);
  };

  /* 괄호 깊이 0 의 콤마로 목록을 나눠요. 콤마 뒤 주석은 앞 항목 끝에, 콤마 앞 줄 주석은 다음 항목 위에 붙여요. */
  F.splitList = function (toks) {
    var items = [], cur = [], d = 0, nextLead = [];
    function push(comma) {
      var it = { toks: cur, lead: nextLead, tail: [] };
      if (cur.length && cur[0].lc) { it.lead = it.lead.concat(cur[0].lc); cur[0].lc = null; }
      cur.forEach(function (t) {
        if (t.lc) { it.tail = it.tail.concat(t.lc); t.lc = null; }
        if (t.tc) { it.tail = it.tail.concat(t.tc); t.tc = null; }
      });
      nextLead = [];
      if (comma) {
        // 줄 맨 앞 콤마(", b /* .. */")면 콤마 뒤 주석은 다음 항목 것이에요
        if (comma.lc) { nextLead = comma.lc; comma.lc = null; }
        if (comma.tc) {
          if (comma.nl) nextLead = nextLead.concat(comma.tc);
          else it.tail = it.tail.concat(comma.tc);
          comma.tc = null;
        }
      }
      items.push(it);
      cur = [];
    }
    toks.forEach(function (t) {
      if (t.k === 'punct') {
        if (t.v === ',' && d === 0) { push(t); return; }
        if (t.v === '(') d++;
        else if (t.v === ')') d--;
      }
      cur.push(t);
    });
    push(null);
    return items;
  };

  /* 목록 출력 (파라미터 · 레코드 필드 · 호출 인자 · FETCH INTO): 콤마 위치 옵션을 따르고 줄 끝 주석을 세로로 맞춰요.
   * rows: [{ lead:[주석], text:'한 줄', tail:[주석] }] → 지금 단계 + 1 에 출력 */
  F.listRows = function (rows) {
    var leading = this.o.comma === 'leading', self = this;
    var texts = rows.map(function (r, i) {
      if (leading) return (i === 0 ? '  ' : ', ') + r.text;
      return r.text + (i < rows.length - 1 ? ',' : '');
    });
    var w = 0;
    if (this.o.plalign) rows.forEach(function (r, i) { if (r.tail.length && texts[i].length > w) w = texts[i].length; });
    this.lv++;
    rows.forEach(function (r, i) {
      r.lead.forEach(function (c) { self.cmt(c); });
      var t = texts[i];
      if (r.tail.length) t = padEnd(t, w) + self.tailText(r.tail);
      self.line(t);
    });
    this.lv--;
  };

  /* ---------- 원문 그대로 (해석 못 한 문장) ---------- */
  F.raw = function (toks) {
    if (!toks.length) return;
    var start = toks[0].pos, end = toks[toks.length - 1].end;
    toks.forEach(function (t) {
      (t.lc || []).concat(t.tc || []).forEach(function (c) {
        c.used = true;
        if (c.pos < start) start = c.pos;
        if (c.end > end) end = c.end;
      });
      t.lc = null;
      t.tc = null;
    });
    var ls = this.src.slice(start, end).split(/\r?\n/);
    this.line(ls[0].replace(/^\s+/, '').replace(/\s+$/, ''));
    for (var k = 1; k < ls.length; k++) this.out.push(ls[k].replace(/\s+$/, ''));
    if (end > this.lastEnd) this.lastEnd = end;
    this.rawAt.push(start);
  };
  // fn 을 실행하다 문장 해석 오류(PErr)가 나면 [start, end] 를 원문 그대로 둬요
  F.safe = function (start, end, fn) {
    var snap = [];
    for (var j = start; j <= end && j < this.t.length; j++) {
      var t = this.t[j];
      snap.push([t, t.lc, t.tc]);
    }
    var outLen = this.out.length, lv = this.lv, last = this.lastEnd;
    try {
      fn.call(this);
    } catch (e) {
      if (!(e instanceof S.PErr)) throw e;
      snap.forEach(function (x) {
        x[0].lc = x[1];
        x[0].tc = x[2];
        (x[1] || []).concat(x[2] || []).forEach(function (c) { c.used = false; });
      });
      this.out.length = outLen;
      this.lv = lv;
      this.lastEnd = last;
      this.i = start;
      this.curAsg = null;
      this.raw(this.takeTo(Math.min(end + 1, this.t.length)));
    }
  };

  /* ---------- 대입문 := 세로 정렬 ---------- */
  F.flushAsg = function () {
    var run = this.asgRun;
    this.asgRun = [];
    if (run.length < 2 || !this.o.plalign) return;
    var max = 0, out = this.out;
    run.forEach(function (a) { if (a.lhs > max) max = a.lhs; });
    run.forEach(function (a) {
      var d = max - a.lhs;
      if (!d) return;
      var spc = new Array(d + 1).join(' ');
      for (var k = a.from; k < a.to; k++) {
        var at = k === a.from ? a.base + a.lhs : a.base;
        out[k] = out[k].slice(0, at) + spc + out[k].slice(at);
      }
    });
  };

  /* =================== 단위 (프로시저 · 블록) =================== */
  F.unit = function () {
    var t = this.peek(), u = up(t);
    if (u === 'CREATE') this.create();
    else if (u === 'DECLARE') this.declareBlock();
    else if (u === 'BEGIN') this.block();
    else this.err('PL/SQL 블록의 시작을 찾지 못했어요');
    // 같은 묶음 안에 남은 문장 ( / 없이 이어진 경우)
    while (!this.eof()) { this.lv = 0; this.stmtTop(); }
  };
  F.stmtTop = function () {
    var t = this.peek();
    if (this.is(t, 'CREATE')) { this.gap(t); this.leadCmts(t); this.create(); return; }
    this.stmt();
    this.flushAsg();
  };

  F.create = function () {
    var pre = [];
    while (!this.eof() && !this.is(this.peek(), 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'TRIGGER', 'TYPE')) {
      pre.push(this.take1());
      if (pre.length > 5) this.err('CREATE 다음에 PROCEDURE · FUNCTION · PACKAGE · TRIGGER 가 필요해요');
    }
    var self = this;
    var prefix = pre.map(function (t) { return self.kw(t); }).join(' ') + ' ';
    var preTail = this.takeCmts(pre, true);
    var u = up(this.peek());
    if (u === 'PROCEDURE' || u === 'FUNCTION') {
      if (this.signature(prefix, preTail) === 'body') this.subBody();
    } else if (u === 'PACKAGE') {
      this.packageUnit(prefix, preTail);
    } else if (u === 'TRIGGER') {
      this.trigger(prefix, preTail);
    } else {
      this.err('CREATE ' + (this.peek() ? this.peek().v : '') + ' 는 아직 정리하지 않아요');
    }
  };

  // IS/AS 다음: 선언부 → BEGIN ... END
  F.subBody = function () {
    this.lv++;
    var n0 = this.out.length;
    this.decls();
    this.lv--;
    if (this.is(this.peek(), 'BEGIN')) {
      if (this.out.length > n0) this.edgeBefore(this.peek(), 'e_declbegin'); else this.gap(this.peek());
      this.leadCmts(this.peek());
      this.block();
    }
    else this.endStmt(null);
  };

  /* PROCEDURE / FUNCTION 머리: 이름 (파라미터) [RETURN 타입] IS|AS 또는 ; (선언만)
   * 'body' 또는 'spec' 을 돌려줘요 */
  F.signature = function (prefix, preTail) {
    var kwT = this.take1(), name = this.take1();
    if (!name) this.err('이름이 없어요');
    var head = prefix + this.kw(kwT) + ' ' + name.v;
    var cs = (preTail || []).concat(this.takeCmts([kwT, name], true));
    var params = null;
    if (this.isP(this.peek(), '(')) {
      var open = this.take1();
      var close = this.matchParen(this.i - 1);
      var inner = this.takeTo(close);
      var cl = this.take1();
      cs = cs.concat(this.takeCmts([open], true));
      params = { items: this.splitList(inner).filter(function (it) { return it.toks.length; }), closeCmts: this.takeCmts([cl]) };
    }
    // RETURN 타입 · AUTHID 등 IS/AS/; 까지
    var j = this.find(mk('IS AS ;'));
    if (j < 0) this.err('IS / AS 를 찾지 못했어요');
    var rest = this.takeTo(j);
    var end = this.take1();
    var restCmts = this.takeCmts(rest);
    var restText = rest.length ? this.flatLine(rest) : '';
    var isSpec = this.isP(end, ';');
    var endCmts = this.takeCmts([end]);
    // 파라미터가 2개 이상이거나 주석이 달려 있으면 한 줄에 하나씩
    var expand = params && this.o.plparam === 'each' &&
      (params.items.length >= 2 || params.items.some(function (it) { return it.lead.length || it.tail.length; }));

    if (expand) {
      this.line(head + ' (' + this.tailText(cs));
      this.listRows(this.paramRows(params.items));
      if (restText) {
        this.line(')' + this.tailText(params.closeCmts));
        this.line(restText + (isSpec ? ';' : '') + this.tailText(restCmts.concat(isSpec ? endCmts : [])));
      } else {
        this.line(')' + (isSpec ? ';' : '') + this.tailText(params.closeCmts.concat(isSpec ? endCmts : [])));
      }
    } else {
      var txt = head;
      if (params) {
        var self = this;
        txt += ' (' + params.items.map(function (it) {
          cs = cs.concat(it.lead, it.tail);
          return self.paramText(it.toks, 0, 0);
        }).join(', ') + ')';
        cs = cs.concat(params.closeCmts);
      }
      if (restText) txt += ' ' + restText;
      this.line(txt + (isSpec ? ';' : '') + this.tailText(cs.concat(restCmts, isSpec ? endCmts : [])));
    }
    if (isSpec) return 'spec';
    this.line(this.kw(end) + this.tailText(endCmts));
    return 'body';
  };
  F.matchParen = function (openIdx) {
    var d = 0;
    for (var j = openIdx; j < this.t.length; j++) {
      var t = this.t[j];
      if (t.k !== 'punct') continue;
      if (t.v === '(') d++;
      else if (t.v === ')') { d--; if (d === 0) return j; }
    }
    this.err('닫는 괄호가 없어요', this.t[openIdx]);
  };
  // 파라미터: 이름 · 모드(IN/OUT/IN OUT/NOCOPY) · 타입(+ DEFAULT)
  F.paramParts = function (toks) {
    var k = 1, self = this;
    while (k < toks.length && PARAM_MODE[up(toks[k])]) k++;
    return {
      name: toks[0].v,
      mode: toks.slice(1, k).map(function (t) { return self.kw(t); }).join(' '),
      type: this.flatLine(toks.slice(k))
    };
  };
  F.paramText = function (toks, nw, mw) {
    var p = this.paramParts(toks);
    return padEnd(p.name, nw) + ' ' + (mw || p.mode ? padEnd(p.mode, mw) + ' ' : '') + p.type;
  };
  F.paramRows = function (items) {
    var self = this, parts = items.map(function (it) { return self.paramParts(it.toks); });
    var nw = 0, mw = 0;
    if (this.o.plalign) parts.forEach(function (p) { nw = Math.max(nw, p.name.length); mw = Math.max(mw, p.mode.length); });
    return parts.map(function (p, i) {
      var txt = padEnd(p.name, nw) + ' ' + (mw || p.mode ? padEnd(p.mode, mw) + ' ' : '') + p.type;
      return { lead: items[i].lead, text: txt.replace(/\s+$/, ''), tail: items[i].tail };
    });
  };

  F.packageUnit = function (prefix, preTail) {
    var p = this.take1();
    var body = this.is(this.peek(), 'BODY') ? this.take1() : null;
    var name = this.take1();
    var j = this.find(ISAS);
    if (j < 0) this.err('IS / AS 를 찾지 못했어요');
    var rest = this.takeTo(j);
    var isT = this.take1();
    var cs = (preTail || []).concat(this.takeCmts([p, body, name].concat(rest), true));
    var head = prefix + this.kw(p) + (body ? ' ' + this.kw(body) : '') + ' ' + name.v + (rest.length ? ' ' + this.flatLine(rest) : '');
    this.line(head + this.tailText(cs));
    this.line(this.kw(isT) + this.tail([isT]));
    this.subBody();
  };

  F.trigger = function (prefix, preTail) {
    var trg = this.take1(), name = this.take1();
    if (this.is(this.peek(), 'COMPOUND') || this.find(mk('COMPOUND')) >= 0) this.err('COMPOUND TRIGGER 는 아직 정리하지 않아요');
    var j = this.find(mk('DECLARE BEGIN'));
    if (j < 0) this.err('트리거 본문(BEGIN)을 찾지 못했어요');
    this.line(prefix + this.kw(trg) + ' ' + name.v + this.tailText((preTail || []).concat(this.takeCmts([trg, name], true))));
    var hd = this.takeTo(j), chunk = [], self = this;
    function flush() {
      if (!chunk.length) return;
      var cs = self.takeCmts(chunk, false);
      self.line(self.flatLine(chunk) + self.tailText(cs));
      chunk = [];
    }
    var d = 0;
    hd.forEach(function (t) {
      if (t.k === 'punct') { if (t.v === '(') d++; else if (t.v === ')') d--; }
      if (d === 0 && TRIGGER_BREAK[up(t)] && chunk.length && !(up(t) === 'FOR' && false)) flush();
      chunk.push(t);
    });
    flush();
    if (this.is(this.peek(), 'DECLARE')) this.declareBlock();
    else this.block();
  };

  /* =================== 선언부 =================== */
  F.decls = function () {
    var vars = [], prevK = null;
    while (!this.eof()) {
      var t = this.peek(), u = up(t);
      if (u === 'BEGIN' || u === 'END') break;
      var dk = u === 'PROCEDURE' || u === 'FUNCTION' ? 'sub' : u === 'CURSOR' ? 'cursor' : u === 'TYPE' || u === 'SUBTYPE' ? 'type' : 'var';
      if (prevK === null) this.edgeAfter(t, 'e_is');
      else if (this.o.b_decl && (dk !== prevK || dk === 'sub')) this.blank();
      prevK = dk;
      this.gap(t);
      this.leadCmts(t);
      if (u === 'PROCEDURE' || u === 'FUNCTION') {
        if (this.signature('', null) === 'body') this.subBody();
      } else if (u === 'CURSOR') this.cursorDecl();
      else if (u === 'TYPE') this.typeDecl();
      else if (u === 'PRAGMA' || u === 'SUBTYPE') this.simpleStmt();
      else this.varDecl(vars);
    }
    this.alignVars(vars);
  };

  // 변수 · 상수 · 예외 선언:  이름 [CONSTANT] 타입 [NOT NULL] [:= | DEFAULT 값];
  F.varDecl = function (vars) {
    var start = this.i, j = this.semi();
    if (j < 0) this.err("선언이 ';' 로 끝나지 않았어요");
    this.safe(start, j, function () {
      var toks = this.t.slice(start, j);
      if (toks.length < 2) throw new S.PErr('선언을 해석하지 못했어요', toks[0]);
      var k = -1, d = 0;
      for (var x = 1; x < toks.length; x++) {
        var t = toks[x];
        if (t.k === 'punct') { if (t.v === '(') d++; else if (t.v === ')') d--; }
        if (d === 0 && (this.isOp(t, ':=') || this.is(t, 'DEFAULT'))) { k = x; break; }
      }
      var cs = this.takeCmts(toks, true);
      var typeToks = toks.slice(1, k < 0 ? toks.length : k);
      var type = this.flatLine(typeToks);
      var op = k < 0 ? '' : (this.isOp(toks[k], ':=') ? ':=' : this.kw(toks[k]));
      var initR = k < 0 ? null : this.exprLines(toks.slice(k + 1));
      this.takeTo(j);
      cs = cs.concat(this.takeCmts([this.take1()]));
      var v = { from: this.out.length, name: toks[0].v, type: type, op: op, init: initR, cmts: cs, lv: this.lv };
      // 자리만 잡아 두고 alignVars 에서 정렬해서 채워요
      var n = initR ? initR.length : 1;
      for (var q = 0; q < n; q++) this.out.push('\u0002'); // 빈 줄과 구분되는 자리표시
      v.to = this.out.length;
      vars.push(v);
    });
  };
  F.alignVars = function (vars) {
    var nw = 0, tw = 0, cw = 0, self = this, R = this.R;
    if (this.o.plalign) {
      vars.forEach(function (v) {
        nw = Math.max(nw, v.name.length);
        if (v.init) tw = Math.max(tw, v.type.length);
      });
    }
    var texts = vars.map(function (v) {
      var head = padEnd(v.name, nw) + ' ';
      if (!v.init) return [head + v.type + ';'];
      var lead = head + padEnd(v.type, tw) + ' ' + v.op + ' ';
      var L = v.init.map(function (l, i) { return i ? R.sp(lead.length) + l : lead + l; });
      L[L.length - 1] += ';';
      return L;
    });
    if (this.o.plalign) vars.forEach(function (v, i) { if (v.cmts.length) cw = Math.max(cw, texts[i][texts[i].length - 1].length); });
    vars.forEach(function (v, i) {
      var L = texts[i], p = self.pad(v.lv);
      if (v.cmts.length) L[L.length - 1] = padEnd(L[L.length - 1], cw) + self.tailText(v.cmts);
      for (var k = 0; k < L.length; k++) self.out[v.from + k] = p + L[k];
    });
  };

  // CURSOR 이름 [(파라미터)] IS 쿼리;
  F.cursorDecl = function () {
    var j = this.find(mk('IS ;'));
    if (j < 0 || this.isP(this.t[j], ';')) { this.simpleStmt(); return; }
    var hd = this.takeTo(j), isT = this.take1();
    var cs = this.takeCmts(hd, true).concat(this.takeCmts([isT]));
    var txt = this.kw(hd[0]) + ' ' + this.flatLine(hd.slice(1));
    this.line(txt + ' ' + this.kw(isT) + this.tailText(cs));
    this.lv++;
    this.leadCmts(this.peek());
    this.sqlStmt();
    this.lv--;
  };

  // TYPE 이름 IS RECORD ( 필드 타입, ... );   그 밖의 TYPE 은 한 줄로
  F.typeDecl = function () {
    var t0 = this.peek(1), t1 = this.peek(2), t2 = this.peek(3), t3 = this.peek(4);
    if (!(this.is(t1, 'IS', 'AS') && this.is(t2, 'RECORD') && this.isP(t3, '('))) { this.simpleStmt(); return; }
    var hd = this.take(4), open = this.take1();
    var close = this.matchParen(this.i - 1);
    var inner = this.takeTo(close), cl = this.take1();
    var semi = this.isP(this.peek(), ';') ? this.take1() : null;
    var self = this;
    this.line(this.kw(hd[0]) + ' ' + t0.v + ' ' + this.kw(hd[2]) + ' ' + this.kw(hd[3]) + ' (' +
      this.tailText(this.takeCmts(hd, true).concat(this.takeCmts([open]))));
    var items = this.splitList(inner).filter(function (it) { return it.toks.length; });
    var parts = items.map(function (it) { return { name: it.toks[0].v, type: self.flatLine(it.toks.slice(1)) }; });
    var nw = 0;
    if (this.o.plalign) parts.forEach(function (p) { nw = Math.max(nw, p.name.length); });
    this.listRows(parts.map(function (p, i) { return { lead: items[i].lead, text: padEnd(p.name, nw) + ' ' + p.type, tail: items[i].tail }; }));
    (cl.lc || []).forEach(function (c) { self.lv++; self.cmt(c); self.lv--; });
    cl.lc = null;
    this.line(')' + (semi ? ';' : '') + this.tail([cl, semi]));
  };

  /* =================== 실행부 =================== */
  F.declareBlock = function () {
    var d = this.take1();
    this.line(this.kw(d) + this.tail([d], true));
    this.lv++;
    var n0 = this.out.length;
    this.decls();
    this.lv--;
    var b = this.peek();
    if (!this.is(b, 'BEGIN')) this.err('DECLARE 다음에 BEGIN 이 필요해요');
    if (this.out.length > n0) this.edgeBefore(b, 'e_declbegin'); else this.gap(b);
    this.leadCmts(b);
    this.block();
  };

  F.block = function () {
    var b = this.peek();
    if (!this.is(b, 'BEGIN')) this.err('BEGIN 이 필요해요');
    this.take1();
    this.line(this.kw(b) + this.tail([b], true));
    this.lv++;
    this.stmts(BLOCK_STOP, 'e_begin');
    this.lv--;
    var e = this.peek();
    if (this.is(e, 'EXCEPTION')) {
      this.edgeBefore(e, 'e_exc');
      this.leadCmts(e);
      this.take1();
      this.line(this.kw(e) + this.tail([e], true));
      this.lv++;
      var firstW = true;
      while (this.is(this.peek(), 'WHEN')) {
        if (firstW) this.gap(this.peek()); else this.edgeBefore(this.peek(), 'e_when');
        firstW = false;
        this.leadCmts(this.peek());
        this.condHead(THENW);
        this.lv++;
        this.stmts(HANDLER_STOP, 'e_then');
        this.lv--;
      }
      this.lv--;
    }
    this.endStmt(null);
  };

  // edgeKey: 첫 문장 앞 빈 줄 설정 (빈 줄 탭의 "블록 안쪽 경계")
  F.stmts = function (stop, edgeKey) {
    var prev = null;
    while (!this.eof()) {
      var t = this.peek(), u = up(t);
      if (u && ALL_STOP[u]) {
        this.flushAsg();
        if (stop[u]) return;
        this.err("이 위치에 '" + t.v + "' 가 올 수 없어요 (블록 짝이 맞지 않는 것 같아요)", t);
      }
      var k = this.kindOf();
      // 덩어리 앞뒤 빈 줄 (라벨 바로 다음 줄은 라벨과 붙여 둬요)
      if (prev === null) { if (edgeKey) this.edgeAfter(t, edgeKey); }
      else if (prev.indexOf('label:') !== 0 && (this.wantAfter(prev) || this.wantBefore(k, t))) this.blank();
      var start = this.out.length;
      this.stmt();
      if (k === 'call' && this.multiFrom(start)) {
        k = 'callm';
        // 여러 줄인지는 찍어 봐야 알아서, 앞 빈 줄은 찍은 뒤에 끼워 넣어요 (호출은 := 정렬 묶음에 들지 않아요)
        if (prev !== null && prev.indexOf('label:') !== 0 && this.wantBefore('callm') && start > 0 && this.out[start - 1] !== '' && this.out[start] !== '') this.out.splice(start, 0, '');
      }
      prev = k;
    }
    this.flushAsg();
    this.err('블록이 END 로 끝나지 않았어요');
  };

  F.stmt = function () {
    var t = this.peek(), before = this.out.length;
    this.gap(t);
    this.leadCmts(t);
    if (this.out.length !== before) {
      // 빈 줄 · 주석이 끼면 := 정렬 묶음을 끊어요 (끊기 전에 넣은 줄은 정렬 대상이 아니에요)
      var extra = this.out.splice(before);
      this.flushAsg();
      Array.prototype.push.apply(this.out, extra);
    }
    this.curAsg = null;
    this.dispatch(t);
    if (this.curAsg) this.asgRun.push(this.curAsg);
    else this.flushAsg();
    this.curAsg = null;
  };

  F.dispatch = function (t) {
    if (this.isOp(t, '<') && this.isOp(this.peek(1), '<')) return this.label();
    var u = up(t);
    if (u === 'IF') return this.ifStmt();
    if (u === 'CASE') return this.caseStmt();
    if (u === 'LOOP' || u === 'WHILE') return this.loopStmt();
    if (u === 'FOR' && this.find(LOOPW) >= 0) return this.loopStmt();
    if (u === 'FORALL') return this.forallStmt();
    if (u === 'BEGIN') return this.block();
    if (u === 'DECLARE') return this.declareBlock();
    if (u && SQL_START[u]) return this.sqlStmt();
    if (u === 'OPEN' && this.find(mk('FOR')) >= 0) return this.openFor();
    if (u === 'FETCH') return this.fetchStmt();
    return this.simpleStmt();
  };

  // <<라벨>>
  F.label = function () {
    var a = this.take(2), nm = this.peek(), b = this.peek(1), c = this.peek(2);
    if (!nm || !this.isOp(b, '>') || !this.isOp(c, '>')) this.err('<<라벨>> 모양이 아니에요', nm);
    this.take(3);
    this.line('<<' + nm.v + '>>' + this.tail(a.concat([nm, b, c]), true));
  };

  /* IF · ELSIF · WHILE · WHEN 머리:  키워드 조건 THEN|LOOP
   * 조건이 plcondmin 개 이상이면 AND / OR 마다 줄을 바꿔요. */
  F.condHead = function (endWords) {
    var kwT = this.take1();
    var j = this.find(endWords);
    if (j < 0) this.err(kwT.v + ' 뒤에 ' + Object.keys(endWords).join('/') + ' 가 필요해요', kwT);
    var condToks = this.takeTo(j), endT = this.take1();
    var kw = this.kw(kwT), endK = this.kw(endT);
    var cs = this.takeCmts([kwT], true);
    var L = this.condLines(kw, condToks, cs);
    cs = cs.concat(this.takeCmts([endT]));
    if (this.o.plthen === 'next' && L.length > 1) L.push(endK);
    else L[L.length - 1] += ' ' + endK;
    L[L.length - 1] += this.tailText(cs);
    this.lines(L);
  };
  F.condLines = function (kw, toks, cs) {
    var pre = kw + ' ', R = this.R, o = this.o, self = this;
    var atoms;
    try { atoms = this.expr(toks); } catch (e) { if (e instanceof S.PErr) return [pre + this.join(toks)]; throw e; }
    var conds;
    try { conds = S.splitConds(atoms); } catch (e2) { if (e2 instanceof S.PErr) return R.hang(pre, this.layout(atoms, pre.length)); throw e2; }
    if (conds.length < o.plcondmin) {
      conds.forEach(function (c) { Array.prototype.push.apply(cs, c.lead.concat(c.trail)); });
      var parts = conds.map(function (c, i) { return (i ? R.K(c.op, o) + ' ' : '') + (R.flat(c.atoms, o) || self.join(c.atoms)); });
      var flat = parts.join(' ');
      if (conds.every(function (c) { return R.flat(c.atoms, o) !== null; })) return [pre + flat];
      return R.hang(pre, this.layout(atoms, pre.length));
    }
    var out = [];
    conds.forEach(function (c, i) {
      var p = i === 0 ? pre : R.sp(pre.length) + R.K(c.op, o) + ' ';
      c.lead.forEach(function (cm) { out.push(R.sp(pre.length) + R.cmtLine(cm)); });
      var L = R.hang(p, self.layout(c.atoms, p.length));
      if (c.trail.length) L[L.length - 1] += self.tailText(c.trail);
      Array.prototype.push.apply(out, L);
    });
    return out;
  };

  F.ifStmt = function () {
    this.condHead(THENW);
    this.lv++;
    this.stmts(IF_STOP, 'e_then');
    this.lv--;
    while (this.is(this.peek(), 'ELSIF')) {
      this.edgeBefore(this.peek(), 'e_branch');
      this.leadCmts(this.peek());
      this.condHead(THENW);
      this.lv++;
      this.stmts(IF_STOP, 'e_then');
      this.lv--;
    }
    if (this.is(this.peek(), 'ELSE')) {
      var e = this.peek();
      this.edgeBefore(e, 'e_branch');
      this.leadCmts(e);
      this.take1();
      this.line(this.kw(e) + this.tail([e], true));
      this.lv++;
      this.stmts(END_STOP, 'e_then');
      this.lv--;
    }
    this.endStmt('IF');
  };

  F.caseStmt = function () {
    var c = this.take1();
    var j = this.find(WHENW);
    if (j < 0) this.err('CASE 에 WHEN 이 없어요', c);
    var sel = this.takeTo(j);
    var cs = this.takeCmts([c], true).concat(this.takeCmts(sel));
    this.line(this.kw(c) + (sel.length ? ' ' + this.flatLine(sel) : '') + this.tailText(cs));
    this.lv++;
    var firstW = true;
    while (this.is(this.peek(), 'WHEN')) {
      if (firstW) this.gap(this.peek()); else this.edgeBefore(this.peek(), 'e_branch');
      firstW = false;
      this.leadCmts(this.peek());
      this.condHead(THENW);
      this.lv++;
      this.stmts(CASE_STOP, 'e_then');
      this.lv--;
    }
    if (this.is(this.peek(), 'ELSE')) {
      var e = this.peek();
      this.edgeBefore(e, 'e_branch');
      this.leadCmts(e);
      this.take1();
      this.line(this.kw(e) + this.tail([e], true));
      this.lv++;
      this.stmts(END_STOP, 'e_then');
      this.lv--;
    }
    this.lv--;
    this.endStmt('CASE');
  };

  F.loopStmt = function () {
    var t = this.peek(), u = up(t);
    if (u === 'LOOP') {
      this.take1();
      this.line(this.kw(t) + this.tail([t], true));
    } else if (u === 'WHILE') {
      this.condHead(LOOPW);
    } else {
      // FOR i IN [REVERSE] a .. b LOOP  /  FOR r IN cursor(...) LOOP  /  FOR r IN (SELECT ...) LOOP
      var f = this.take1();
      var j = this.find(LOOPW);
      var hd = this.takeTo(j), l = this.take1();
      var pre = this.kw(f) + ' ';
      var cs = this.takeCmts([f], true);
      var L = this.R.hang(pre, this.exprLines(hd, pre.length));
      cs = cs.concat(this.takeCmts([l]));
      if (this.o.plthen === 'next' && L.length > 1) L.push(this.kw(l));
      else L[L.length - 1] += ' ' + this.kw(l);
      L[L.length - 1] += this.tailText(cs);
      this.lines(L);
    }
    this.lv++;
    this.stmts(END_STOP, 'e_loop');
    this.lv--;
    this.endStmt('LOOP');
  };

  // FORALL i IN a .. b  DML;
  F.forallStmt = function () {
    var f = this.take1();
    var j = this.find(DML_START);
    if (j < 0) { this.i--; this.simpleStmt(); return; }
    var hd = this.takeTo(j);
    var cs = this.takeCmts([f], true).concat(this.takeCmts(hd));
    this.line(this.kw(f) + ' ' + this.flatLine(hd) + this.tailText(cs));
    this.lv++;
    this.stmt();
    this.lv--;
  };

  // END [IF|LOOP|CASE] [이름|라벨] ;
  F.endStmt = function (word) {
    var t = this.peek();
    if (!t) this.err((word ? 'END ' + word : 'END') + ' 가 없어요');
    this.edgeBefore(t, word === 'LOOP' ? 'e_endloop' : word ? 'e_endif' : 'e_end');
    this.leadCmts(t);
    if (!this.is(t, 'END')) this.err((word ? 'END ' + word : 'END') + " 가 필요한데 '" + t.v + "' 가 있어요", t);
    var nx = this.peek(1);
    if (word && !this.is(nx, word)) this.err('END ' + word + ' 가 필요해요', nx || t);
    if (!word && this.is(nx, 'IF', 'LOOP', 'CASE')) this.err("블록의 END 자리에 'END " + nx.v + "' 가 있어요", nx);
    var j = this.semi();
    var toks = j < 0 ? this.takeTo(this.t.length) : this.takeTo(j + 1);
    if (toks.length > 4) this.err('END 뒤에 예상하지 못한 내용이 있어요', toks[2]);
    var self = this;
    var words = toks.filter(function (x) { return !self.isP(x, ';'); }).map(function (x, i) {
      return i === 0 || (word && i === 1) ? self.kw(x) : x.v;
    });
    this.line(words.join(' ') + (j >= 0 ? ';' : '') + this.tail(toks, true));
  };

  /* ---------- SQL 문장 ---------- */
  // 키워드 오른쪽 맞춤 때문에 " MERGE" 처럼 첫 줄이 밀려 있으면, 문장 전체를 그만큼 왼쪽으로 (상대 정렬은 그대로)
  function dedent(L) {
    var m = Infinity;
    L.forEach(function (l) { if (l.trim()) m = Math.min(m, /^ */.exec(l)[0].length); });
    if (!m || m === Infinity) return L;
    return L.map(function (l) { return l.slice(Math.min(m, /^ */.exec(l)[0].length)); });
  }
  F.sqlStmt = function () {
    var start = this.i, j = this.semi();
    var end = j < 0 ? this.t.length : j;
    this.safe(start, end, function () {
      var toks = this.t.slice(start, end);
      var ast = S.parseStmtToks(toks, this.stats);
      if (S.transform && S.transform.applyAst) S.transform.applyAst(ast, this.stats, this.o, this.warnings);
      var L = dedent(this.R.stmt(ast, this.o));
      this.takeTo(end);
      if (j >= 0) {
        var semi = this.take1();
        this.R.app(L, ';');
        L[L.length - 1] += this.tail([semi]);
      }
      this.lines(L);
    });
  };

  // OPEN 커서 FOR 쿼리 ;
  F.openFor = function () {
    var start = this.i, j = this.semi();
    var end = j < 0 ? this.t.length : j;
    var fi = this.find(mk('FOR'));
    this.safe(start, end, function () {
      var hd = this.t.slice(start, fi + 1);
      var q = this.t.slice(fi + 1, end);
      var ast = S.parseStmtToks(q, this.stats);
      if (S.transform && S.transform.applyAst) S.transform.applyAst(ast, this.stats, this.o, this.warnings);
      var L = dedent(this.R.stmt(ast, this.o));
      var cs = this.takeCmts(hd, true);
      this.line(this.join(hd) + this.tailText(cs));
      this.takeTo(end);
      if (j >= 0) {
        var semi = this.take1();
        this.R.app(L, ';');
        L[L.length - 1] += this.tail([semi]);
      }
      this.lv++;
      this.lines(L);
      this.lv--;
    });
  };

  // FETCH 커서 [BULK COLLECT] INTO a, b, ... [LIMIT n];  → INTO 항목이 여러 개면 한 줄에 하나
  F.fetchStmt = function () {
    var start = this.i, j = this.semi();
    var end = j < 0 ? this.t.length : j;
    var ii = this.find(mk('INTO'));
    if (ii < 0 || ii > end) { this.simpleStmt(); return; }
    var li = this.find(mk('LIMIT'), ii);
    var listEnd = li >= 0 && li < end ? li : end;
    var items = null;
    var self = this;
    this.safe(start, end, function () {
      var hd = this.t.slice(start, ii);
      var list = this.t.slice(ii + 1, listEnd);
      var lim = this.t.slice(listEnd, end);
      var itemsTmp = this.splitList(list);
      if (itemsTmp.length < 2) {
        // 항목이 하나면 한 줄
        this.i = start;
        var cs1 = this.takeCmts(this.t.slice(start, end), true);
        var L1 = this.flatLine(this.t.slice(start, end));
        this.takeTo(end);
        var semi1 = j >= 0 ? this.take1() : null;
        this.line(L1 + (semi1 ? ';' : '') + this.tailText(cs1.concat(semi1 ? this.takeCmts([semi1]) : [])));
        return;
      }
      items = itemsTmp;
      var into = this.t[ii];
      var cs = this.takeCmts(hd, true).concat(this.takeCmts([into]));
      var head = this.flatLine(hd);
      this.line(head + this.tailText(cs));
      // INTO 를 FETCH 끝에 맞춰요 ( FETCH / " INTO")
      var pre = ' ' + this.kw(into) + ' ';
      var leading = this.o.comma === 'leading';
      var texts = items.map(function (it, i) {
        var tx = self.flatLine(it.toks);
        if (i === 0) return pre + tx + (!leading && i < items.length - 1 ? ',' : '');
        return (leading ? self.R.sp(pre.length - 2) + ', ' : self.R.sp(pre.length)) + tx + (!leading && i < items.length - 1 ? ',' : '');
      });
      var w = 0;
      if (this.o.plalign) items.forEach(function (it, i) { if (it.tail.length) w = Math.max(w, texts[i].length); });
      items.forEach(function (it, i) {
        it.lead.forEach(function (c) { self.cmt(c); });
        self.line(it.tail.length ? padEnd(texts[i], w) + self.tailText(it.tail) : texts[i]);
      });
      if (lim.length) { var lcs = this.takeCmts(lim); this.line(this.flatLine(lim) + this.tailText(lcs)); }
      this.takeTo(end);
      if (j >= 0) {
        var semi = this.take1();
        var n = this.out.length - 1;
        var cm = this.tail([semi]);
        // ; 은 마지막 줄의 주석 앞에
        var last = this.out[n], k = last.indexOf(' --');
        this.out[n] = (k >= 0 ? last.slice(0, k) + ';' + last.slice(k) : last + ';') + cm;
      }
    });
  };

  /* ---------- 그 밖의 문장 (대입 · 프로시저 호출 · RETURN · RAISE · EXIT · NULL · COMMIT ...) ---------- */
  F.simpleStmt = function () {
    var start = this.i, j = this.semi();
    var end = j < 0 ? this.t.length : j;
    // 구조 키워드가 섞여 있으면 블록 짝이 어긋난 것 → 블록 전체를 원문으로
    var cs0 = 0;
    for (var x = start; x < end; x++) {
      var u = up(this.t[x]);
      if (u === 'CASE') cs0++;
      else if (u === 'END' && cs0 > 0) cs0--;
      else if (u && cs0 === 0 && STRUCT_IN_SIMPLE[u]) this.err("문장 안에 '" + this.t[x].v + "' 가 있어요 (';' 이 빠졌거나 블록 짝이 맞지 않는 것 같아요)", this.t[x]);
    }
    if (end === start) this.err("빈 문장이에요 (';' 이 두 번 있어요)");
    this.safe(start, end, function () {
      var toks = this.t.slice(start, end);
      var base = this.out.length;
      var r = this.simpleLines(toks);
      this.takeTo(end);
      var L = r.lines;
      if (j >= 0) {
        var semi = this.take1();
        L[L.length - 1] += ';';
        r.tail = r.tail.concat(this.takeCmts([semi]));
      }
      L[L.length - 1] += this.tailText(r.tail);
      this.lines(L);
      if (r.lhs) this.curAsg = { from: base, to: this.out.length, lhs: r.lhs, base: this.col() };
    });
  };
  F.simpleLines = function (toks) {
    var R = this.R, o = this.o;
    // 대입문:  왼쪽 := 오른쪽
    var k = -1, d = 0;
    for (var x = 0; x < toks.length; x++) {
      var t = toks[x];
      if (t.k === 'punct') { if (t.v === '(') d++; else if (t.v === ')') d--; }
      if (d === 0 && this.isOp(t, ':=')) { k = x; break; }
    }
    if (k > 0) {
      var lhsToks = toks.slice(0, k);
      var lhs = R.flat(this.expr(lhsToks), o);
      if (lhs === null) throw new S.PErr('대입문 왼쪽을 해석하지 못했어요', toks[0]);
      var asg = toks[k];
      var cs = this.takeCmts([asg]);
      var lead = lhs + ' := ';
      var rhs = this.expr(toks.slice(k + 1));
      var L = R.cat([lead], '', this.layout(rhs, lead.length));
      return { lines: L, tail: cs, lhs: lhs.length };
    }
    var atoms = this.expr(toks);
    // 인자에 주석이 달린 프로시저 호출은 인자마다 한 줄로
    if (atoms.length === 1 && atoms[0].t === 'group' && atoms[0].fn && !atoms[0].sub && hasCmt(atoms[0].args)) {
      return { lines: this.callLines(atoms[0]), tail: [] };
    }
    return { lines: this.layout(atoms), tail: [] };
  };
  function hasCmt(arr) {
    for (var i = 0; i < arr.length; i++) {
      var a = arr[i];
      if (Array.isArray(a)) { if (hasCmt(a)) return true; continue; }
      if (!a.t) { if (a.lc || a.tc) return true; continue; }
      if (a.t === 'group') { if ((a.fn && (a.fn.lc || a.fn.tc)) || (a.close && (a.close.lc || a.close.tc)) || hasCmt(a.args)) return true; }
      if (a.t === 'case' && (a.kw.tc || a.endTok.tc)) return true;
    }
    return false;
  }
  function firstTok(a) { if (!a.t) return a; if (a.t === 'group') return a.fn || a.open; return a.kw; }
  function lastTok(a) { if (!a.t) return a; if (a.t === 'group') return a.close || a.open; return a.endTok; }
  // 이름( 인자, 인자 ... )  → 결과 줄은 지금 단계 기준 (상대 위치)
  F.callLines = function (gp) {
    var R = this.R, o = this.o, self = this, w = this.w;
    var name = R.tokText(gp.fn, o);
    var openCs = this.takeCmts([gp.open]);
    var rows = gp.args.map(function (arg) {
      var lead = [], tail = [];
      if (arg.length) {
        var f = firstTok(arg[0]), l = lastTok(arg[arg.length - 1]);
        if (f.lc) { lead = f.lc; f.lc = null; }
        if (l.tc) { tail = l.tc; l.tc = null; }
      }
      var L = self.R.layout(arg, self.col() + w + 2, o);
      return { lead: lead, L: L, tail: tail };
    });
    var leading = o.comma === 'leading';
    var texts = rows.map(function (r, i) {
      var L = r.L.slice();
      var pre = leading ? (i === 0 ? '  ' : ', ') : '';
      L = R.hang(pre, L);
      if (!leading && i < rows.length - 1) L[L.length - 1] += ',';
      return L;
    });
    var cw = 0;
    if (o.plalign) rows.forEach(function (r, i) { if (r.tail.length) cw = Math.max(cw, texts[i][texts[i].length - 1].length); });
    var out = [name + '(' + this.tailText(openCs)];
    var ind = R.sp(w);
    rows.forEach(function (r, i) {
      r.lead.forEach(function (c) { out.push(ind + R.cmtLine(c)); });
      var L = texts[i];
      if (r.tail.length) L[L.length - 1] = padEnd(L[L.length - 1], cw) + self.tailText(r.tail);
      L.forEach(function (l) { out.push(ind + l); });
    });
    var closeCs = this.takeCmts([gp.close]);
    var closeLine = ')';
    if (closeCs.length) {
      // ) 앞 주석은 마지막 인자 아래 줄로
      closeCs.forEach(function (c) { out.push(ind + R.cmtLine(c)); });
    }
    out.push(closeLine);
    return out;
  };

  /* =================== 진입점 =================== */
  function lineOf(src, pos) {
    var n = 1;
    for (var i = 0; i < pos && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
    return n;
  }

  function formatPlsql(st, src, o, stats, warnings) {
    var toks = st.toks;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (t.k !== 'word') continue;
      var u = t.v.toUpperCase();
      if (PLKW[u] || (i && toks[i - 1].k === 'op' && toks[i - 1].v === '%')) t.plkw = true;
    }
    var f = new Fmt(st, src, o, stats, warnings);
    f.unit();
    f.flushAsg();
    if (f.rawAt.length) {
      var ln = f.rawAt.map(function (p) { return lineOf(src, p); });
      warnings.push('PL/SQL 안에서 해석하지 못한 문장 ' + ln.length + '개는 원문 그대로 두었어요 (원본 ' +
        ln.slice(0, 8).join(', ') + (ln.length > 8 ? ' …' : '') + '번째 줄).');
    }
    // 끝의 빈 줄 정리
    while (f.out.length && f.out[f.out.length - 1] === '') f.out.pop();
    return f.out;
  }

  S.plsql = { format: formatPlsql, PLKW: PLKW, PlErr: PlErr };
})(typeof window !== 'undefined' ? window : globalThis);
