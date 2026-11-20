/* DDL(객체 생성 스크립트) 포매터
 * CREATE TABLE · INDEX · VIEW · MATERIALIZED VIEW · SEQUENCE · SYNONYM, ALTER TABLE, COMMENT ON, GRANT · REVOKE · DROP · TRUNCATE
 * - 테이블 컬럼은 한 줄에 하나씩, 이름 · 타입을 세로로 맞춰요.
 * - 저장 속성(SEGMENT · PCTFREE · STORAGE · TABLESPACE …)은 묶음마다 한 줄씩.
 * - VIEW / CREATE TABLE … AS 의 SELECT 는 쿼리 옵션대로 정리해요.
 * - 해석하지 못하면 예외를 던지고, format.js 가 원문 그대로 둬요. */
(function (g) {
  'use strict';
  var S = (g.SQLF = g.SQLF || {});

  function mk(s) { var m = {}; s.split(/\s+/).forEach(function (w) { if (w) m[w] = true; }); return m; }
  // 대소문자 옵션을 따르는 DDL 키워드 · 데이터 타입
  var KW = mk(
    'CREATE ALTER DROP TRUNCATE RENAME COMMENT GRANT REVOKE REPLACE FORCE NOFORCE EDITIONABLE NONEDITIONABLE GLOBAL TEMPORARY PRIVATE ' +
    'TABLE INDEX VIEW MATERIALIZED SEQUENCE SYNONYM PUBLIC UNIQUE BITMAP COLUMN CONSTRAINT PRIMARY KEY FOREIGN REFERENCES CHECK ' +
    'DEFAULT ENABLE DISABLE VALIDATE NOVALIDATE RELY NORELY DEFERRABLE INITIALLY DEFERRED IMMEDIATE CASCADE PURGE ADD MODIFY ' +
    'TABLESPACE STORAGE INITIAL MINEXTENTS MAXEXTENTS PCTINCREASE FREELISTS FREELIST GROUPS BUFFER_POOL FLASH_CACHE ' +
    'CELL_FLASH_CACHE KEEP RECYCLE PCTFREE PCTUSED INITRANS MAXTRANS COMPUTE STATISTICS SEGMENT CREATION COMPRESS NOCOMPRESS ' +
    'LOGGING NOLOGGING CACHE NOCACHE PARALLEL NOPARALLEL MONITORING NOMONITORING ROWDEPENDENCIES NOROWDEPENDENCIES ' +
    'ORGANIZATION HEAP INDEX OVERFLOW PARTITION SUBPARTITION RANGE LIST HASH INTERVAL LESS THAN MAXVALUE MINVALUE ' +
    'NOMAXVALUE NOMINVALUE INCREMENT CYCLE NOCYCLE ORDER NOORDER NOKEEP SCALE NOSCALE SESSION LOCAL LOB STORE SECUREFILE ' +
    'BASICFILE CHUNK RETENTION ROW MOVEMENT COMMIT PRESERVE ROWS BUILD REFRESH FAST COMPLETE DEMAND NEVER QUERY REWRITE ' +
    'GENERATED ALWAYS IDENTITY VIRTUAL INVISIBLE VISIBLE SORT NOSORT REVERSE ONLINE USAGE ENCRYPT DECRYPT DEFINITION ' +
    'VARCHAR2 NVARCHAR2 VARCHAR CHAR NCHAR NUMBER INTEGER INT SMALLINT FLOAT BINARY_FLOAT BINARY_DOUBLE DECIMAL DATE TIMESTAMP ' +
    'TIME ZONE YEAR MONTH DAY SECOND CLOB NCLOB BLOB BFILE RAW LONG ROWID UROWID XMLTYPE BOOLEAN BYTE PRECISION DOUBLE ' +
    'ON IS TO FOR AS WITH READ ONLY OPTION NOT NULL USING BY ALL'
  );
  var TYPE_CONT = mk('WITH LOCAL TIME ZONE TO DAY SECOND YEAR MONTH RAW PRECISION VARYING');
  var CONS_START = mk('CONSTRAINT PRIMARY UNIQUE FOREIGN CHECK SUPPLEMENTAL PERIOD SCOPE REF');
  // 저장 속성 묶음의 첫 단어 (여기서 줄을 바꿔요)
  var PROP_START = mk('SEGMENT PCTFREE COMPRESS NOCOMPRESS STORAGE TABLESPACE LOB PARTITION CACHE NOCACHE PARALLEL NOPARALLEL ' +
    'MONITORING NOMONITORING ORGANIZATION ON LOCAL GLOBAL BUILD REFRESH ROWDEPENDENCIES NOROWDEPENDENCIES RESULT_CACHE INMEMORY NOINMEMORY ENABLE DISABLE');
  var SEQ_START = mk('MINVALUE MAXVALUE NOMINVALUE NOMAXVALUE INCREMENT START CACHE NOCACHE ORDER NOORDER CYCLE NOCYCLE KEEP NOKEEP ' +
    'SCALE NOSCALE GLOBAL SESSION SHARING EXTEND NOEXTEND');
  var CONS_BREAK = mk('USING STORAGE TABLESPACE');
  var DDL_START = mk('CREATE ALTER COMMENT GRANT REVOKE DROP TRUNCATE RENAME');

  function W(t) { return t && t.k === 'word' ? t.v.toUpperCase() : ''; }
  function isP(t, v) { return !!t && t.k === 'punct' && t.v === v; }
  function IND() { return '    '; }

  function Fmt(toks, o) { this.t = toks; this.o = o; }
  var F = Fmt.prototype;

  // 짝 괄호 끝 (i: '(' 위치)
  F.close = function (i) {
    var d = 0;
    for (var j = i; j < this.t.length; j++) {
      if (isP(this.t[j], '(')) d++;
      else if (isP(this.t[j], ')')) { d--; if (!d) return j; }
    }
    throw new Error('괄호 짝이 맞지 않아요');
  };
  // 괄호 밖에서 단어 찾기
  F.findTop = function (from, to, pred) {
    for (var j = from; j < to; j++) {
      if (isP(this.t[j], '(')) { j = this.close(j); continue; }
      if (pred(this.t[j], j)) return j;
    }
    return -1;
  };
  F.word = function (t) {
    var s = t.v;
    if (t.k === 'word' && (KW[s.toUpperCase()] || S.sets.KW[s.toUpperCase()])) {
      s = this.o.kwcase === 'lower' ? s.toLowerCase() : this.o.kwcase === 'keep' ? s : s.toUpperCase();
    }
    return s;
  };
  // 토큰 [a, b) 를 한 줄로: 원문에서 붙어 있던 것은 붙여 쓰고, 나머지는 한 칸 (줄 안 주석은 /* */ 로)
  F.join = function (a, b) {
    var s = '', R = S.render;
    for (var j = a; j < b; j++) {
      var t = this.t[j], p = this.t[j - 1], piece = this.word(t);
      if (t.lc) piece = t.lc.map(R.cmtInline).join(' ') + ' ' + piece;
      if (t.tc) piece = piece + ' ' + t.tc.map(R.cmtInline).join(' ');
      if (j > a) {
        var tight = p.end === t.pos && !p.tc && !t.lc && (!isP(p, ',') || (t.k === 'number' && this.t[j - 2] && this.t[j - 2].k === 'number'));
        var glue = isP(p, '(') || isP(t, ')') || isP(t, ',') || tight ? '' : ' ';
        s += glue;
      }
      s += piece;
    }
    return s;
  };
  // [a, b) 를 시작 단어(starts)마다 줄을 나눠요
  F.split = function (a, b, starts, skip) {
    var cuts = [a], self = this;
    this.findTop(a + 1, b, function (t, j) {
      var w = W(t);
      if (starts[w] && !(skip && skip(w, self.t[j - 1], self.t[j + 1]))) cuts.push(j);
      return false;
    });
    var out = [];
    for (var k = 0; k < cuts.length; k++) out.push(this.join(cuts[k], k + 1 < cuts.length ? cuts[k + 1] : b));
    return out;
  };
  // 괄호 안 [a, b) 를 괄호 밖 콤마로 나눠요 → [{a, b, comma}]
  F.items = function (a, b) {
    var out = [], s = a;
    for (var j = a; j < b; j++) {
      if (isP(this.t[j], '(')) { j = this.close(j); continue; }
      if (isP(this.t[j], ',')) { out.push({ a: s, b: j, comma: this.t[j] }); s = j + 1; }
    }
    if (s < b) out.push({ a: s, b: b, comma: null });
    return out;
  };
  function propSkip(w, prev, next) {
    var pw = W(prev);
    if ((w === 'COMPRESS' || w === 'NOCOMPRESS') && (pw === 'STORE' || pw === 'ROW' || pw === 'FOR')) return true;
    if (w === 'ON' && pw !== '' && pw !== 'ENABLE' && !isP(prev, ')')) return true;
    if ((w === 'PARTITION' || w === 'LOCAL' || w === 'GLOBAL') && (pw === 'BY' || pw === 'ON')) return true;
    if (w === 'CACHE' && (pw === 'RESULT_CACHE' || pw === 'FLASH_CACHE')) return true;
    if ((w === 'ENABLE' || w === 'DISABLE') && W(next) !== 'ROW') return true;
    return false;
  }

  /* ---------- 컬럼 · 제약 목록 ---------- */
  F.colList = function (a, b, ind) {
    var self = this, items = this.items(a, b), rows = [], o = this.o;
    items.forEach(function (it) {
      var f = self.t[it.a], row = { it: it, pre: [] };
      if (f.lc) { row.pre = f.lc.map(S.render.cmtLine); f.lc = null; }
      if (CONS_START[W(f)] || !(f.k === 'word' || f.k === 'name')) {
        var parts = self.split(it.a, it.b, CONS_BREAK, function (w, p, n) { return w === 'USING' && W(n) !== 'INDEX'; });
        row.cons = parts;
      } else {
        var j = it.a + 1;
        var tS = j;
        if (j < it.b && (self.t[j].k === 'word' || self.t[j].k === 'name')) {
          j++;
          for (;;) {
            if (isP(self.t[j], '(') && j < it.b) { j = self.close(j) + 1; continue; }
            if (j < it.b && TYPE_CONT[W(self.t[j])]) { j++; continue; }
            break;
          }
        }
        row.name = self.join(it.a, it.a + 1);
        row.type = self.join(tS, j);
        row.rest = j < it.b ? self.join(j, it.b) : '';
      }
      rows.push(row);
    });
    var nw = 0, tw = 0;
    rows.forEach(function (r) { if (r.name != null) { nw = Math.max(nw, r.name.length); tw = Math.max(tw, r.type.length); } });
    var R = S.render, out = [], lead = o.comma === 'leading';
    rows.forEach(function (r, k) {
      r.pre.forEach(function (c) { out.push(ind + c); });
      var first = lead ? (k > 0 ? ', ' : '  ') : ''; // 앞 콤마면 첫 줄도 두 칸 들여서 이름을 맞춰요
      var lines;
      if (r.name != null) {
        var l = R.sp(0) + first + (r.rest || r.type ? (r.name + R.sp(nw - r.name.length + 1)) : r.name);
        if (r.type) l += r.rest ? r.type + R.sp(tw - r.type.length + 1) + r.rest : r.type;
        lines = [l.replace(/\s+$/, '')];
      } else {
        lines = r.cons.map(function (p, i) { return (i ? IND() : first) + p; });
      }
      var c = r.it.comma;
      if (c && !lead) lines[lines.length - 1] += ',';
      if (c && c.tc) lines[lines.length - 1] += ' ' + c.tc.map(R.cmtLine).join(' ');
      lines.forEach(function (l) { out.push(ind + l); });
    });
    return out;
  };

  // SELECT 부분은 쿼리 포매터로
  F.query = function (a, b) {
    var src = this.src.slice(this.t[a].pos, this.t[b - 1].end);
    var p = S.parse(src);
    if (p.stmts.length !== 1 || !p.stmts[0].ast) throw new Error('SELECT 를 해석하지 못했어요');
    if (S.transform) S.transform.apply(p, p.stmts[0], 0, this.o, []);
    return S.render.stmt(p.stmts[0].ast, this.o);
  };

  /* ---------- 문장별 ---------- */
  F.run = function () {
    var t = this.t, n = t.length, w0 = W(t[0]);
    if (w0 === 'COMMENT') return this.comment();
    if (w0 === 'CREATE') {
      var k = this.findTop(1, Math.min(n, 12), function (x) { return /^(TABLE|INDEX|VIEW|SEQUENCE|SYNONYM)$/.test(W(x)); });
      var obj = k >= 0 ? W(t[k]) : '';
      if (obj === 'TABLE') return this.table(k);
      if (obj === 'INDEX') return this.index(k);
      if (obj === 'VIEW') return this.view(k);
      if (obj === 'SEQUENCE') return this.seq(k);
      return this.props(0, n);
    }
    if (w0 === 'ALTER' && W(t[1]) === 'TABLE') return this.alter();
    return [this.join(0, n)];
  };
  F.comment = function () {
    var is = this.findTop(0, this.t.length, function (x) { return W(x) === 'IS'; });
    if (is < 0) return [this.join(0, this.t.length)];
    this.head = this.join(0, is);
    this.tail = this.join(is, this.t.length);
    return [this.head + ' ' + this.tail];
  };
  // 첫 줄(머리) + 속성 묶음 줄들
  F.props = function (a, b, headEnd) {
    var lines = [];
    var self = this;
    var cut = headEnd != null ? headEnd : this.findTop(a + 1, b, function (x, j) { return PROP_START[W(x)] && !propSkip(W(x), self.t[j - 1], self.t[j + 1]); });
    if (cut < 0) cut = b;
    lines.push(this.join(a, cut));
    if (cut < b) this.propLines(cut, b).forEach(function (l) { lines.push(l); });
    return lines;
  };
  F.propLines = function (a, b) {
    var self = this, cuts = [a];
    this.findTop(a + 1, b, function (x, j) { if (PROP_START[W(x)] && !propSkip(W(x), self.t[j - 1], self.t[j + 1])) cuts.push(j); return false; });
    var out = [];
    for (var k = 0; k < cuts.length; k++) {
      var e = k + 1 < cuts.length ? cuts[k + 1] : b;
      // PARTITION BY … ( PARTITION p1 …, PARTITION p2 … ) 는 파티션마다 한 줄
      var lp = -1;
      for (var j = cuts[k]; j < e; j++) if (isP(this.t[j], '(')) { var c = this.close(j); if (c === e - 1 && /^(PARTITION|SUBPARTITION)$/.test(W(this.t[j + 1]))) lp = j; j = c; }
      if (lp >= 0) {
        out.push(this.join(cuts[k], lp) + ' (');
        this.items(lp + 1, e - 1).forEach(function (it, i, arr) { out.push(IND() + self.join(it.a, it.b) + (i < arr.length - 1 ? ',' : '')); });
        out.push(')');
      } else out.push(this.join(cuts[k], e));
    }
    return out;
  };
  F.table = function (k) {
    var t = this.t, n = t.length;
    var p;
    for (p = k + 1; p < n && !isP(t[p], '('); p++) if (W(t[p]) === 'AS') break;
    var lines = [];
    if (p < n && isP(t[p], '(')) {
      var c = this.close(p);
      lines.push(this.join(0, p) + ' (');
      this.colList(p + 1, c, IND()).forEach(function (l) { lines.push(l); });
      var after = c + 1, as = this.findTop(after, n, function (x) { return W(x) === 'AS'; });
      var propEnd = as >= 0 ? as : n;
      lines.push(')');
      if (after < propEnd) this.propLines(after, propEnd).forEach(function (l) { lines.push(l); });
      if (as >= 0) { lines.push(this.word(t[as])); this.query(as + 1, n).forEach(function (l) { lines.push(l); }); }
      return lines;
    }
    // CREATE TABLE t [속성] AS SELECT …
    var as2 = this.findTop(k + 1, n, function (x) { return W(x) === 'AS'; });
    if (as2 < 0) return this.props(0, n);
    var head = this.props(0, as2);
    head.push(this.word(t[as2]));
    return head.concat(this.query(as2 + 1, n));
  };
  F.index = function (k) {
    var t = this.t, n = t.length;
    var on = this.findTop(k + 1, n, function (x) { return W(x) === 'ON'; });
    if (on < 0) return [this.join(0, n)];
    var e = on + 1;
    while (e < n && !isP(t[e], '(')) e++;
    if (e < n) e = this.close(e) + 1;
    var lines = [this.join(0, e)];
    if (e < n) this.propLines(e, n).forEach(function (l) { lines.push(l); });
    return lines;
  };
  F.view = function (k) {
    var t = this.t, n = t.length;
    var as = this.findTop(k + 1, n, function (x) { return W(x) === 'AS'; });
    if (as < 0) return [this.join(0, n)];
    // 끝의 WITH READ ONLY / WITH CHECK OPTION 은 따로
    var end = n, tailText = null;
    var wi = this.findTop(as + 1, n, function (x, j) { return W(x) === 'WITH' && /^(READ|CHECK)$/.test(W(t[j + 1])); });
    if (wi >= 0) { end = wi; tailText = this.join(wi, n); }
    var head = this.props(0, as);
    head.push(this.word(t[as]));
    var lines = head.concat(this.query(as + 1, end));
    if (tailText) lines.push(tailText);
    return lines;
  };
  F.seq = function (k) {
    var self = this, n = this.t.length, cuts = [];
    this.findTop(k + 2, n, function (x, j) { if (SEQ_START[W(x)]) cuts.push(j); return false; });
    var lines = [this.join(0, cuts.length ? cuts[0] : n)];
    cuts.forEach(function (c, i) { lines.push(IND() + self.join(c, i + 1 < cuts.length ? cuts[i + 1] : n)); });
    return lines;
  };
  F.alter = function () {
    var t = this.t, n = t.length;
    var name = 3; // ALTER TABLE 이름
    var lines = [this.join(0, name)];
    if (name >= n) return lines;
    var w = W(t[name]);
    // ADD ( 컬럼들 ) / MODIFY ( … )
    if ((w === 'ADD' || w === 'MODIFY') && isP(t[name + 1], '(') && this.close(name + 1) === n - 1 && W(t[name + 2]) !== 'CONSTRAINT') {
      lines[0] += ' ' + this.word(t[name]) + ' (';
      this.colList(name + 2, n - 1, IND()).forEach(function (l) { lines.push(l); });
      lines.push(')');
      return lines;
    }
    var parts = this.split(name, n, CONS_BREAK, function (x, p, nx) { return x === 'USING' && W(nx) !== 'INDEX'; });
    parts.forEach(function (p, i) { lines.push(IND() + (i ? IND() : '') + p); });
    return lines;
  };

  /* format.js 에서 부름: DDL 문장이면 줄 목록, 아니면 null. 해석 실패면 예외 */
  function isDdl(toks) {
    var w = W(toks[0]);
    return !!DDL_START[w];
  }
  function format(st, src, o) {
    var f = new Fmt(st.toks, o);
    f.src = src;
    var lines = f.run();
    if (W(st.toks[0]) === 'COMMENT' && f.head) st.ddlComment = { head: f.head, tail: f.tail };
    return lines;
  }

  /* DB 도구에서 복사할 때 앞뒤에 붙는 따옴표 정리:
   * 따옴표 하나만 있는 줄로 시작하고, 뒤쪽에 따옴표 개수가 홀수인 줄이 따옴표로 끝나면 그 두 개를 빼요. */
  function stripWrapQuotes(src) {
    var lines = src.split('\n'), removed = 0;
    function quoteCount(l) { return (l.replace(/'(?:[^']|'')*'/g, '').match(/"/g) || []).length; }
    for (var i = 0; i < lines.length; i++) {
      if (!/^\s*"\s*$/.test(lines[i]) && !/^\s*"\s*(CREATE|ALTER|COMMENT|GRANT)\b/i.test(lines[i])) continue;
      if (/^\s*"\s*$/.test(lines[i])) { lines[i] = ''; removed++; }
      else if (quoteCount(lines[i]) % 2 === 1) { lines[i] = lines[i].replace(/^(\s*)"/, '$1'); removed++; }
      else continue;
      for (var j = i + 1; j < lines.length; j++) {
        if (/^\s*"\s*;?\s*$/.test(lines[j])) { lines[j] = lines[j].replace('"', ''); removed++; i = j; break; }
        if (quoteCount(lines[j]) % 2 === 1 && /"\s*;?\s*$/.test(lines[j])) { lines[j] = lines[j].replace(/\s*"(\s*;?\s*)$/, '$1'); removed++; i = j; break; }
      }
    }
    return { text: removed ? lines.join('\n') : src, removed: removed };
  }

  S.ddl = { KW: KW, isDdl: isDdl, format: format, stripWrapQuotes: stripWrapQuotes, START: DDL_START };
})(typeof window !== 'undefined' ? window : globalThis);
