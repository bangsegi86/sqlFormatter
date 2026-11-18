/* 별칭: 분석(범위별 목록) · 일괄 변경 · 테이블/컬럼 별칭 자동 생성
 * 문자열 치환이 아니라 구조 트리의 "별칭 선언 ↔ 참조"를 이어서 처리해요.
 */
(function (g) {
  'use strict';
  var S = (g.SQLF = g.SQLF || {});
  var RESERVED = S.sets.RESERVED, KW = S.sets.KW, CONSTS = S.sets.CONSTS;

  function up(t) { return t && !t.t && t.k === 'word' ? t.v.toUpperCase() : null; }
  var KINDLABEL = { top: '메인 쿼리', scalar: '스칼라 서브쿼리', inline: '인라인 뷰', cond: '조건 서브쿼리', cte: 'WITH 쿼리', pq: '괄호 쿼리' };

  /* 이 select 에 "직접" 속한 식 목록 (서브쿼리 안쪽은 제외) */
  function directLists(sel) {
    var lists = [];
    sel.items.forEach(function (it) { lists.push(it.atoms); });
    if (sel.into) sel.into.items.forEach(function (it) { lists.push(it.atoms); });
    if (sel.from) sel.from.items.forEach(function (f) {
      lists.push(f.ref.atoms);
      f.joins.forEach(function (j) {
        lists.push(j.ref.atoms);
        if (j.on) j.on.forEach(function (c) { lists.push(c.atoms); });
        if (j.using) lists.push(j.using);
      });
    });
    ['where', 'start', 'connect', 'having'].forEach(function (k) { if (sel[k]) sel[k].conds.forEach(function (c) { lists.push(c.atoms); }); });
    ['group', 'order'].forEach(function (k) { if (sel[k]) sel[k].items.forEach(function (it) { lists.push(it.atoms); }); });
    sel.tails.forEach(function (t) { lists.push(t.atoms); });
    return lists;
  }
  function dmlLists(st) {
    var l = [];
    function assigns(a) { a.forEach(function (x) { l.push(x.lhs, x.rhs); }); }
    function conds(c) { if (c) c.conds.forEach(function (x) { l.push(x.atoms); }); }
    if (st.t === 'insert') {
      if (st.cols) l.push([st.cols]);
      if (st.values) l.push([st.values]);
    } else if (st.t === 'update') {
      l.push(st.ref.atoms); assigns(st.assigns); conds(st.where);
      if (st.tail) l.push(st.tail.atoms);
    } else if (st.t === 'delete') {
      l.push(st.ref.atoms); conds(st.where);
      if (st.tail) l.push(st.tail.atoms);
    } else if (st.t === 'merge') {
      l.push(st.target.atoms, st.using.atoms);
      st.on.forEach(function (c) { l.push(c.atoms); });
      st.whens.forEach(function (w) {
        if (w.and) l.push(w.and);
        var a = w.act;
        if (a.assigns) assigns(a.assigns);
        conds(a.where); conds(a.del);
        if (a.cols) l.push([a.cols]);
        if (a.values) l.push([a.values]);
      });
    }
    return l;
  }

  function subGroups(atoms, out) {
    atoms.forEach(function (a) {
      if (a.t === 'group') { if (a.sub) out.push(a); else a.args.forEach(function (x) { subGroups(x, out); }); }
      else if (a.t === 'case') {
        [a.operand, a.els].forEach(function (x) { if (x) subGroups(x, out); });
        a.whens.forEach(function (w) { subGroups(w.c, out); subGroups(w.r, out); });
      }
    });
    return out;
  }

  function refKey(ref) {
    if (ref.alias) return ref.alias.v.toLowerCase();
    if (ref.atoms.length === 1 && !ref.atoms[0].t && ref.atoms[0].k === 'word') return ref.atoms[0].v.toLowerCase();
    return null;
  }
  function refEntry(ref) {
    var isView = ref.atoms.length >= 1 && ref.atoms[0].t === 'group' && !!ref.atoms[0].sub;
    var key = refKey(ref);
    if (!key) return null;
    var target = isView ? '(SELECT …)' : ref.atoms.map(function (a) { return a.v || ''; }).join(' ');
    return { key: key, ref: ref, kind: isView ? 'view' : 'table', target: target, hasAlias: !!ref.alias };
  }

  /* 문장 하나의 범위(scope) 목록. 깊이 우선 순서로 번호가 매겨져 일관된 id 를 만들어요. */
  function buildScopes(st) {
    var list = [];
    function mkScope(parent, kind, sel, lists, entries) {
      var sc = { idx: list.length, parent: parent, kind: kind, sel: sel, lists: lists, entries: entries, depth: parent ? parent.depth + 1 : 0 };
      list.push(sc);
      return sc;
    }
    function descend(lists, scope) {
      lists.forEach(function (atoms) {
        subGroups(atoms, []).forEach(function (gp) { query(gp.sub.q, scope, gp.sub.kind); });
      });
    }
    function query(q, parent, kind) {
      q.with.forEach(function (c) { query(c.q, parent, 'cte'); });
      q.parts.forEach(function (p, i) {
        if (p.sel.t === 'select') select(p.sel, parent, kind, i);
        else query(p.sel.q, parent, 'pq');
      });
    }
    function select(sel, parent, kind, partIdx) {
      var entries = [];
      if (sel.from) sel.from.items.forEach(function (f) {
        var e = refEntry(f.ref); if (e) entries.push(e);
        f.joins.forEach(function (j) { var e2 = refEntry(j.ref); if (e2) entries.push(e2); });
      });
      var sc = mkScope(parent, kind, sel, directLists(sel), entries);
      sc.partIdx = partIdx;
      sel.scope = sc;
      descend(sc.lists, sc);
    }
    if (st.t === 'query') query(st.q, null, 'top');
    else {
      var entries = [];
      var refs = st.t === 'update' || st.t === 'delete' ? [st.ref] : st.t === 'merge' ? [st.target, st.using] : [];
      refs.forEach(function (r) { var e = refEntry(r); if (e) entries.push(e); });
      var sc = mkScope(null, 'top', null, dmlLists(st), entries);
      sc.dml = true;
      if (st.t === 'insert' && st.query) query(st.query, sc, 'top');
      descend(sc.lists, sc);
    }
    return list;
  }

  function nameTokens(lists, fn) {
    function visit(atoms) {
      atoms.forEach(function (a) {
        if (a.t === 'group') a.args.forEach(visit);
        else if (a.t === 'case') {
          [a.operand, a.els].forEach(function (x) { if (x) visit(x); });
          a.whens.forEach(function (w) { visit(w.c); visit(w.r); });
        } else if (a.k === 'name') fn(a);
      });
    }
    lists.forEach(visit);
  }

  function rewriteQualifiers(scope, all, oldKey, newName) {
    function visit(sc, root) {
      if (!root && sc.entries.some(function (e) { return e.key === oldKey; })) return;
      nameTokens(sc.lists, function (t) {
        var m = /^([^."@]+)\./.exec(t.v);
        if (m && m[1].toLowerCase() === oldKey) t.v = newName + t.v.slice(m[1].length);
      });
      all.forEach(function (c) { if (c.parent === sc) visit(c, false); });
    }
    visit(scope, true);
  }

  function ancestors(sc) { var r = []; for (var p = sc.parent; p; p = p.parent) r.push(p); return r; }
  function descendants(sc, all) {
    var r = [];
    all.forEach(function (c) { for (var p = c.parent; p; p = p.parent) if (p === sc) { r.push(c); break; } });
    return r;
  }
  function usedNames(sc, all) {
    var names = {};
    [sc].concat(ancestors(sc), descendants(sc, all)).forEach(function (s) {
      s.entries.forEach(function (e) { names[e.key] = true; });
    });
    return names;
  }
  function validName(n) {
    return /^[A-Za-z_ㄱ-힝][A-Za-z0-9_$#ㄱ-힝]*$/.test(n) && !RESERVED[n.toUpperCase()];
  }

  function renameEntry(scope, all, entry, newName, warnings) {
    var nn = newName.trim();
    var nk = nn.toLowerCase();
    if (!validName(nn)) { warnings.push("별칭 '" + nn + "' 는 쓸 수 없는 이름이에요 (예약어이거나 형식이 달라요)."); return false; }
    var used = usedNames(scope, all);
    delete used[entry.key];
    if (used[nk]) { warnings.push("별칭 '" + nn + "' 는 이미 쓰는 이름이라 바꾸지 않았어요."); return false; }
    var old = entry.key;
    if (entry.ref.alias) entry.ref.alias.v = nn;
    else entry.ref.alias = { k: 'word', v: nn, nl: false, pos: 0, end: 0 };
    rewriteQualifiers(scope, all, old, nn);
    entry.key = nk;
    entry.hasAlias = true;
    return true;
  }

  /* ---------- 자동 제안 ---------- */
  var PREFIX = /^(tb|tbl|t|vw|v|tm|th|ts)_/i;
  function suggestName(target, rule, seq) {
    if (rule === 'seq') return 't' + seq;
    if (!/^[A-Za-z_"]/.test(target)) return 'v' + seq; /* 인라인 뷰 등 이름이 없는 대상 */
    var base = target.split('.').pop().replace(/^"|"$/g, '');
    var stripped = base.replace(PREFIX, '');
    if (!stripped) stripped = base;
    if (rule === 'abbr') {
      var ab = stripped.split('_').filter(Boolean).map(function (w) { return w.charAt(0); }).join('').toLowerCase();
      return ab.length === 1 ? stripped.slice(0, 2).toLowerCase() : ab;
    }
    return stripped.charAt(0).toLowerCase();
  }
  function uniqueName(name, used) {
    var n = name, i = 2;
    while (used[n.toLowerCase()] || RESERVED[n.toUpperCase()] || KW[n.toUpperCase()]) { n = name + i; i++; }
    return n;
  }

  function entryId(stmtIdx, sc, e) { return stmtIdx + '.' + sc.idx + ':' + e.key; }

  /* ---------- 공개: 분석 ---------- */
  function analyzeAliases(src, o) {
    var opts = S.normalizeOpts(o);
    var parsed = S.parse(src);
    var rows = [];
    var seqByStmt = {};
    parsed.stmts.forEach(function (st, si) {
      if (!st.ast) return;
      var scopes = buildScopes(st.ast);
      var subCount = {};
      scopes.forEach(function (sc) {
        if (sc.entries.length === 0) return;
        var label = KINDLABEL[sc.kind] || '서브쿼리';
        if (sc.kind !== 'top') { subCount[sc.kind] = (subCount[sc.kind] || 0) + 1; label += ' ' + subCount[sc.kind]; }
        if (parsed.stmts.length > 1) label = si + 1 + '번 문장 · ' + label;
        var used = usedNames(sc, scopes);
        sc.entries.forEach(function (e) {
          if (e.kind === 'view' && !e.hasAlias) return;
          var row = { id: entryId(si, sc, e), key: e.key, alias: e.hasAlias ? e.ref.alias.v : '', target: e.target, kind: e.kind, scope: label, depth: sc.depth };
          if (!e.hasAlias) {
            if (e.target.indexOf('.') >= 0) return; // 스키마 접두 테이블은 한정자 재작성이 위험해서 제외
          }
          seqByStmt[si] = (seqByStmt[si] || 0) + 1;
          row.suggest = uniqueName(suggestName(e.target, opts.tblrule, seqByStmt[si]), used);
          used[row.suggest.toLowerCase()] = true;
          rows.push(row);
        });
      });
    });
    return rows;
  }

  /* ---------- 컬럼 별칭 자동 부여 ---------- */
  var SKIP_NAME = { '*': 1 };
  // INTERVAL '1' DAY · DATE '2020-01-01' 같은 리터럴의 낱말은 별칭 이름으로 쓰지 않아요
  var IV_SKIP = { INTERVAL: 1, YEAR: 1, MONTH: 1, DAY: 1, HOUR: 1, MINUTE: 1, SECOND: 1, DATE: 1, TIMESTAMP: 1 };
  function firstName(atoms) {
    for (var i = 0; i < atoms.length; i++) {
      var a = atoms[i];
      if (a.t === 'group') {
        if (a.sub) continue;
        for (var k = 0; k < a.args.length; k++) { var r = firstName(a.args[k]); if (r) return r; }
      } else if (a.t === 'case') {
        var parts = [].concat(a.operand ? [a.operand] : []);
        a.whens.forEach(function (w) { parts.push(w.c, w.r); });
        if (a.els) parts.push(a.els);
        for (var j = 0; j < parts.length; j++) { var r2 = firstName(parts[j]); if (r2) return r2; }
      } else if (a.k === 'name' && a.v.indexOf('*') < 0) {
        var seg = a.v.split('.').pop().replace(/^"|"$/g, '');
        if (/^[A-Za-z_][A-Za-z0-9_$#]*$/.test(seg)) return seg.toLowerCase();
      } else if (a.k === 'word' && !a.fn) {
        var u = a.v.toUpperCase();
        if (!RESERVED[u] && !KW[u] && !CONSTS[u] && !IV_SKIP[u]) return a.v.toLowerCase();
      }
    }
    return null;
  }
  function isPlainColumn(atoms) {
    if (atoms.length !== 1 || atoms[0].t) return false;
    var a = atoms[0];
    if (a.k === 'name') return true;
    if (a.k === 'word') { var u = a.v.toUpperCase(); return !CONSTS[u] && !KW[u]; }
    if (a.k === 'op' && a.v === '*') return true;
    return false;
  }
  function autoColumnAliases(scopes, o) {
    scopes.forEach(function (sc) {
      if (!sc.sel || sc.kind === 'cond' || sc.partIdx > 0) return;
      var taken = {};
      sc.sel.items.forEach(function (it) {
        if (it.alias) taken[it.alias.v.toLowerCase()] = true;
        else if (it.atoms.length === 1 && it.atoms[0].k === 'name') taken[it.atoms[0].v.split('.').pop().toLowerCase()] = true;
        else if (it.atoms.length === 1 && it.atoms[0].k === 'word') taken[it.atoms[0].v.toLowerCase()] = true;
      });
      sc.sel.items.forEach(function (it, i) {
        if (it.alias || isPlainColumn(it.atoms)) return;
        var base = o.autorule === 'name' ? firstName(it.atoms) : null;
        if (!base) base = 'col_' + (i + 1);
        var n = base, k = 2;
        while (taken[n.toLowerCase()] || RESERVED[n.toUpperCase()] || KW[n.toUpperCase()]) { n = base + '_' + k; k++; }
        taken[n.toLowerCase()] = true;
        it.alias = { k: 'word', v: n, nl: false, pos: 0, end: 0 };
        it.hadAs = false;
      });
    });
  }

  /* ---------- 포맷 파이프라인에서 호출 ---------- */
  function apply(parsed, st, idx, o, warnings) {
    var renames = o.aliasRenames || {};
    var needScopes = o.autotbl || o.autoalias || Object.keys(renames).length;
    if (!needScopes) return;
    var scopes = buildScopes(st.ast);

    // 1) 사용자가 지정한 이름 변경
    scopes.forEach(function (sc) {
      sc.entries.slice().forEach(function (e) {
        var id = entryId(idx, sc, e);
        if (renames[id] && renames[id].trim() && renames[id].trim().toLowerCase() !== (e.hasAlias ? e.ref.alias.v.toLowerCase() : '')) {
          renameEntry(sc, scopes, e, renames[id], warnings);
        }
      });
    });
    // 2) 별칭 없는 테이블에 자동 부여
    if (o.autotbl) {
      var seq = 0;
      scopes.forEach(function (sc) {
        sc.entries.forEach(function (e) {
          if (e.kind !== 'table' || e.hasAlias || e.ref.atoms[0].v.indexOf('.') >= 0) return;
          seq++;
          var nn = uniqueName(suggestName(e.target, o.tblrule, seq), usedNames(sc, scopes));
          renameEntry(sc, scopes, e, nn, warnings);
        });
      });
    }
    // 3) 컬럼 별칭 자동 부여
    if (o.autoalias) autoColumnAliases(scopes, o);
  }

  S.alias = { apply: apply, analyze: analyzeAliases };
  S.analyzeAliases = analyzeAliases;
})(typeof window !== 'undefined' ? window : globalThis);
