/* 렌더러: 구조 트리 → 줄 목록.
 * 각 렌더 함수는 "첫 줄은 시작 위치에서, 나머지 줄은 같은 시작 위치 기준 들여쓰기"인 줄 배열(R)을 돌려줍니다.
 */
(function (g) {
  'use strict';
  var S = (g.SQLF = g.SQLF || {});
  var KW = S.sets.KW, CONSTS = S.sets.CONSTS, FUNCS = S.sets.FUNCS;
  var SENT = '\u0001'; // 줄 끝 주석 표시 (뒤에 붙는 , ) ; 는 주석 앞으로 들어감)

  function sp(n) { return n > 0 ? new Array(n + 1).join(' ') : ''; }
  function hang(prefix, R) {
    var p = sp(prefix.length);
    return R.map(function (l, i) { return i ? p + l : prefix + l; });
  }
  function app(R, text) {
    var i = R.length - 1;
    var l = R[i];
    var k = l.indexOf(SENT);
    R[i] = k < 0 ? l + text : l.slice(0, k) + text + l.slice(k);
    return R;
  }
  function cat(R1, text, R2) {
    var last = R1[R1.length - 1] + text;
    var ind = last.length;
    var out = R1.slice(0, -1);
    out.push(last + R2[0]);
    for (var i = 1; i < R2.length; i++) out.push(sp(ind) + R2[i]);
    return out;
  }
  function lastLen(R) { return R[R.length - 1].length; }

  /* ---------- 키워드·토큰 텍스트 ---------- */
  function K(canon, o, orig) {
    if (o.kwcase === 'lower') return canon.toLowerCase();
    if (o.kwcase === 'keep' && orig) return orig;
    return canon;
  }
  function caseKw(v, o) {
    return o.kwcase === 'lower' ? v.toLowerCase() : o.kwcase === 'keep' ? v : v.toUpperCase();
  }
  function cmtInline(c) {
    c.used = true;
    if (c.k === 'lcomment') return '/* ' + c.v.replace(/^--\s?/, '').replace(/\*\//g, '* /') + ' */';
    return c.v.replace(/\s*\n\s*/g, ' ');
  }
  function cmtLine(c) {
    c.used = true;
    return c.k === 'lcomment' ? c.v : c.v.replace(/\s*\n\s*/g, ' ');
  }
  function wrapC(tok, s) {
    if (tok.lc) s = tok.lc.map(cmtInline).join(' ') + ' ' + s;
    if (tok.tc) s = s + ' ' + tok.tc.map(cmtInline).join(' ');
    return s;
  }
  function tokText(t, o) {
    var s = t.v;
    if (t.k === 'word') {
      var u = s.toUpperCase();
      if (KW[u] || CONSTS[u] || (t.fn && FUNCS[u]) || t.plkw) s = caseKw(s, o);
    }
    return wrapC(t, s);
  }

  /* ---------- 공백 규칙 ---------- */
  var CMP = { '=': 1, '<>': 1, '!=': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '^=': 1, '||': 1, ':=': 1, '=>': 1 };
  var UNARY_PREV = { AND: 1, OR: 1, NOT: 1, THEN: 1, ELSE: 1, WHEN: 1, IN: 1, BETWEEN: 1, SELECT: 1, WHERE: 1, ON: 1, BY: 1, IS: 1, LIKE: 1, SET: 1, HAVING: 1,
    RETURN: 1, DEFAULT: 1, IF: 1, ELSIF: 1, WHILE: 1, REVERSE: 1 };
  function isUnary(p2, op) {
    if (op.t || op.k !== 'op' || (op.v !== '-' && op.v !== '+')) return false;
    if (!p2) return true;
    if (p2.t) return false;
    if (p2.k === 'op') return p2.v !== '(+)';
    if (p2.k === 'punct') return p2.v !== ')';
    if (p2.k === 'word') return !!UNARY_PREV[p2.v.toUpperCase()];
    return false;
  }
  function needSpace(p2, p, a, o) {
    if (!p) return false;
    if (!a.t) {
      // tb.col%TYPE · SQL%ROWCOUNT · 1..10 은 붙여 써요
      if (a.k === 'op' && (a.v === '.' || a.v === '(+)' || a.v === '%' || a.v === '..')) return false;
      if (a.k === 'punct' && a.v === ',') return false;
    }
    if (!p.t) {
      if (p.k === 'op' && (p.v === '.' || p.v === '%' || p.v === '..')) return false;
      if (isUnary(p2, p)) return false;
    }
    if (!o.opspace) {
      if (!a.t && a.k === 'op' && CMP[a.v]) return false;
      if (!p.t && p.k === 'op' && CMP[p.v]) return false;
    }
    return true;
  }

  /* ---------- 한 줄 만들기 ---------- */
  function forced(gp, o) {
    if (gp.sub) return false;
    var u = gp.fn ? gp.fn.v.toUpperCase() : null;
    if (gp.inList && gp.args.length > o.inmax) return true;
    if (u === 'DECODE' && o.decodeargs === 'pair' && gp.args.length > 4) return true;
    return false;
  }
  /* "복잡한 식" 판단 (길이 대신 구조로 판단해요)
   * hasCall : 함수 호출 · CASE · 서브쿼리 중 하나라도 들어 있음
   * isHeavy : CASE · 서브쿼리가 있거나, 함수 안에 또 함수/CASE 가 있음 (NVL(a, 0) 같은 단순 함수는 제외) */
  function hasCall(atoms) {
    for (var i = 0; i < atoms.length; i++) {
      var a = atoms[i];
      if (!a.t) continue;
      if (a.t === 'case' || a.fn || a.sub) return true;
      if (a.args && a.args.some(hasCall)) return true;
    }
    return false;
  }
  function isHeavy(atoms) {
    for (var i = 0; i < atoms.length; i++) {
      var a = atoms[i];
      if (!a.t) continue;
      if (a.t === 'case' || a.sub) return true;
      if (a.args && (a.fn ? a.args.some(hasCall) : a.args.some(isHeavy))) return true;
    }
    return false;
  }
  function caseBreaks(c, o) {
    if (o.casewhen === 'break') return c.whens.length >= 2;
    if (o.casewhen === 'complex') {
      if (c.whens.length >= 2) return true;
      return c.whens.some(function (w) { return hasCall(w.r); }) || (!!c.els && hasCall(c.els));
    }
    return false;
  }

  function flat(atoms, o) {
    // 함수 안의 복잡한 연산식은 한 줄로 만들지 않아요 (opinner)
    if (o.opinner) { var so = splitOps(atoms, o); if (so && so.segs.some(hasCall)) return null; }
    var out = '', p = null, p2 = null;
    for (var i = 0; i < atoms.length; i++) {
      var a = atoms[i];
      var s = flatAtom(a, o);
      if (s === null) return null;
      if (out && needSpace(p2, p, a, o)) out += ' ';
      out += s;
      p2 = p;
      p = a;
    }
    return out;
  }
  function flatCase(c, o) {
    var parts = [tokText(c.kw, o)];
    if (c.operand) { var f = flat(c.operand, o); if (f === null) return null; parts.push(f); }
    function inl(list) { return list && list.length ? list.map(cmtInline).join(' ') + ' ' : ''; }
    for (var i = 0; i < c.whens.length; i++) {
      var fc = flat(c.whens[i].c, o), fr = flat(c.whens[i].r, o);
      if (fc === null || fr === null) return null;
      parts.push(inl(c.whens[i].cm) + K('WHEN', o) + ' ' + fc + ' ' + K('THEN', o) + ' ' + fr);
    }
    if (c.els) { var fe = flat(c.els, o); if (fe === null) return null; parts.push(inl(c.elsCm) + K('ELSE', o) + ' ' + fe); }
    parts.push(closeLead(c.endTok) + K('END', o) + closeTail(c.endTok));
    return parts.join(' ');
  }
  // 닫는 괄호 · END 에 붙은 주석 (앞 주석은 그 앞에, 뒤 주석은 그 뒤에 /* */ 로)
  function closeLead(t) { return t && t.lc && t.lc.length ? t.lc.map(cmtInline).join(' ') + ' ' : ''; }
  function closeTail(t) { return t && t.tc && t.tc.length ? ' ' + t.tc.map(cmtInline).join(' ') : ''; }
  function flatMark(R) { R.flatDone = true; return R; }
  function flatAtom(a, o) {
    if (!a.t) return tokText(a, o);
    if (a.t === 'case') return caseBreaks(a, o) ? null : flatCase(a, o);
    if (a.sub) {
      if (o.scalar === 'short' && simpleScalar(a.sub)) {
        var s = flatQuery(a.sub.q, o);
        return s === null ? null : (a.fn ? tokText(a.fn, o) : '') + '(' + s + closeLeadIn(a.close) + ')' + closeTail(a.close);
      }
      return null;
    }
    if (forced(a, o)) return null;
    var parts = [];
    for (var i = 0; i < a.args.length; i++) {
      var f = flat(a.args[i], o);
      if (f === null) return null;
      parts.push(f);
    }
    return wrapC(a.open, (a.fn ? tokText(a.fn, o) : '') + '(' + parts.join(', ') + closeLeadIn(a.close) + ')') + closeTail(a.close);
  }
  function closeLeadIn(t) { return t && t.lc && t.lc.length ? ' ' + t.lc.map(cmtInline).join(' ') : ''; }

  /* ---------- 식 배치 ---------- */
  /* 최상위 산술(+ -) · 연결(||) 연산자 앞에서 줄을 바꿔요 (옵션: arithwrap/arithmin, concatwrap/concatmin)
   * 비교식(a = b + c ...)이면 오른쪽 식만 나눠요. 그 밖의 조건 키워드가 섞여 있으면 손대지 않아요. */
  var ARITH = { '+': 1, '-': 1 };
  var NOWRAP_KW = { AND: 1, OR: 1, NOT: 1, BETWEEN: 1, LIKE: 1, IN: 1, IS: 1, EXISTS: 1, WHEN: 1, THEN: 1, ELSE: 1, ESCAPE: 1 };
  function splitOps(atoms, o) {
    var useA = o.arithwrap === 'break', useC = o.concatwrap === 'break';
    if (!useA && !useC) return null;
    var segs = [], ops = [], cur = [], nA = 0, nC = 0, p = null;
    for (var i = 0; i < atoms.length; i++) {
      var a = atoms[i];
      if (!a.t && a.k === 'word' && NOWRAP_KW[a.v.toUpperCase()]) return null;
      var isC = !a.t && a.k === 'op' && a.v === '||';
      var isA = !a.t && a.k === 'op' && ARITH[a.v] && cur.length && !isUnary(p, a);
      if (isC || isA) { segs.push(cur); ops.push(a); cur = []; if (isC) nC++; else nA++; }
      else cur.push(a);
      p = a;
    }
    segs.push(cur);
    if (!cur.length) return null;
    var wantA = useA && nA > 0 && nA + 1 >= o.arithmin;
    var wantC = useC && nC > 0 && nC + 1 >= o.concatmin;
    if (!wantA && !wantC) return null;
    // 나누지 않는 연산자는 앞 조각에 다시 붙여요
    var outSegs = [segs[0]], outOps = [];
    for (var k = 0; k < ops.length; k++) {
      var brk = ops[k].v === '||' ? wantC : wantA;
      if (brk) { outOps.push(ops[k]); outSegs.push(segs[k + 1]); }
      else outSegs[outSegs.length - 1] = outSegs[outSegs.length - 1].concat([ops[k]], segs[k + 1]);
    }
    return { segs: outSegs, ops: outOps };
  }
  function wrapOps(atoms, col, o) {
    if (o.arithwrap !== 'break' && o.concatwrap !== 'break') return null;
    // 괄호 · 함수 안(o._nest > 0): opinner 가 꺼져 있으면 안 나누고, 켜져 있으면 항에 함수 · CASE 가 있을 때만 나눠요
    var nested = o._nest > 0;
    if (nested && !o.opinner) return null;
    function ok(s) { return s && (!nested || s.segs.some(hasCall)); }
    for (var i = 0; i < atoms.length; i++) {
      var a = atoms[i];
      if (!a.t && a.k === 'op' && SYMCMP[a.v]) {
        var l = flat(atoms.slice(0, i), o);
        var rs = splitOps(atoms.slice(i + 1), o);
        if (l === null || !ok(rs)) return null;
        var lead = l + ' ' + tokText(a, o) + ' ';
        return cat([lead], '', opLines(rs, col + lead.length, o));
      }
    }
    var s = splitOps(atoms, o);
    return ok(s) ? opLines(s, col, o) : null;
  }
  function opLines(s, col, o) {
    var out = layout(s.segs[0], col, o);
    for (var k = 0; k < s.ops.length; k++) {
      var pre = tokText(s.ops[k], o) + ' ';
      out = out.concat(hang(pre, layout(s.segs[k + 1], col + pre.length, o)));
    }
    return out;
  }

  function layout(atoms, col, o) {
    if (!atoms.length) return [''];
    var wo = wrapOps(atoms, col, o);
    if (wo) return wo;
    var f = flat(atoms, o);
    if (f !== null && col + f.length <= o.width) return [f];
    var lines = [], cur = '', p = null, p2 = null;
    for (var i = 0; i < atoms.length; i++) {
      var a = atoms[i];
      var spc = p && needSpace(p2, p, a, o) ? ' ' : '';
      var start = cur.length + spc.length;
      var R = renderAtom(a, col + start, o);
      cur += spc + R[0];
      if (R.length > 1) {
        lines.push(cur);
        for (var k = 1; k < R.length - 1; k++) lines.push(sp(start) + R[k]);
        cur = sp(start) + R[R.length - 1];
      }
      p2 = p;
      p = a;
    }
    lines.push(cur);
    return lines;
  }
  function renderAtom(a, col, o) {
    if (!a.t) return [tokText(a, o)];
    var R = a.t === 'case' ? renderCase(a, col, o) : renderGroup(a, col, o);
    // 여러 줄로 그린 경우: 닫는 괄호 · END 에 붙은 주석을 마지막 줄 끝에 (한 줄짜리는 이미 들어 있어요)
    if (!R.flatDone) {
      var ct = a.t === 'case' ? a.endTok : a.close;
      var cs = ct ? (ct.lc || []).concat(ct.tc || []) : [];
      if (cs.length) R[R.length - 1] += ' ' + cs.map(cmtInline).join(' ');
    }
    return R;
  }

  function renderList(prefix, items, o) {
    var pl = prefix.length, leading = o.comma === 'leading', out = [];
    items.forEach(function (it, i) {
      var lead = it.lead || [], tr = it.trail || [];
      if (!o.cmtkeep && tr.length) { lead = lead.concat(tr); tr = []; }
      lead.forEach(function (c) { out.push(sp(i === 0 ? 0 : pl) + cmtLine(c)); });
      var p = i === 0 ? prefix : (leading ? sp(Math.max(0, pl - 2)) + ', ' : sp(pl));
      var lines = hang(p, it.R);
      if (!leading && i < items.length - 1) app(lines, ',');
      if (tr.length) lines[lines.length - 1] += SENT + tr.map(cmtLine).join(' ');
      out.push.apply(out, lines);
    });
    return out;
  }

  function argsBlock(pre, args, col, o) {
    var items = args.map(function (a) { return { R: layout(a, col + pre.length, o) }; });
    var lines = renderList(pre, items, o);
    app(lines, ')');
    return lines;
  }

  function renderGroup(gp, col, o) {
    if (gp.sub) {
      // 서브쿼리 안은 새 문장처럼 "바깥"부터 다시 시작해요
      var saved = o._nest; o._nest = 0;
      try { return renderSub(gp, col, o); } finally { o._nest = saved; }
    }
    if (!forced(gp, o)) {
      var f = flatAtom(gp, o);
      if (f !== null && col + f.length <= o.width) return flatMark([f]);
    }
    // 괄호 · 함수 안을 그리는 동안은 "안쪽"으로 표시해요 (연산자 줄바꿈 opinner 판단용)
    o._nest = (o._nest || 0) + 1;
    try { return renderGroupBody(gp, col, o); } finally { o._nest--; }
  }
  function renderGroupBody(gp, col, o) {
    var u = gp.fn ? gp.fn.v.toUpperCase() : null;
    var fnT = gp.fn ? tokText(gp.fn, o) : '';
    var pre = fnT + '(';
    if (gp.inList && gp.args.length > o.inmax) {
      var rows = [], ok = true;
      for (var i = 0; i < gp.args.length; i += o.inmax) {
        var chunk = gp.args.slice(i, i + o.inmax).map(function (a) { var s = flat(a, o); if (s === null) ok = false; return s; });
        rows.push({ R: [chunk.join(', ')] });
      }
      if (ok) {
        var pp = o.comma === 'leading' && pre.length < 2 ? '( ' : pre;
        var ls = renderList(pp, rows, o);
        return app(ls, ')');
      }
    }
    if (u === 'DECODE' && gp.args.length >= 3 && o.decodeargs !== 'one') {
      var d = renderDecode(gp, col, o, pre);
      if (d) return d;
    }
    if (!gp.fn && gp.args.length === 1) {
      var conds = S.splitConds(gp.args[0]);
      if (conds.length > 1) {
        var out = [];
        conds.forEach(function (c, i) {
          var pfx = i === 0 ? '(' : ' ' + K(c.op, o) + ' ';
          var R = layout(c.atoms, col + pfx.length, o);
          out.push.apply(out, hang(pfx, R));
        });
        return app(out, ')');
      }
    }
    var pre2 = pre;
    if (!gp.fn && o.comma === 'leading') pre2 = '( ';
    return argsBlock(pre2, gp.args, col, o);
  }

  function renderDecode(gp, col, o, pre) {
    var args = gp.args;
    var a0 = layout(args[0], col + pre.length, o);
    if (a0.length > 1) return null;
    var head = pre + a0[0] + ', ';
    var pstart = head.length;
    var items = [];
    for (var k = 1; k + 1 < args.length; k += 2) {
      var sR = layout(args[k], col + pstart, o);
      var rR = layout(args[k + 1], col + pstart + lastLen(sR) + 2, o);
      items.push(cat(sR, ', ', rR));
    }
    if ((args.length - 1) % 2 === 1) items.push(layout(args[args.length - 1], col + pstart, o));
    var leading = o.comma === 'leading';
    var out = [];
    items.forEach(function (R, i) {
      var lines;
      if (i === 0) lines = hang(head, R);
      else lines = hang(leading ? sp(Math.max(0, pstart - 2)) + ', ' : sp(pstart), R);
      if (!leading && i < items.length - 1) app(lines, ',');
      out.push.apply(out, lines);
    });
    return app(out, ')');
  }

  function renderCase(c, col, o) {
    var f = flatCase(c, o);
    if (f !== null) {
      if (o.casewhen === 'one') return flatMark([f]);
      if (o.casewhen === 'auto' && col + f.length <= o.width) return flatMark([f]);
      if ((o.casewhen === 'break' || o.casewhen === 'complex') && !caseBreaks(c, o) && col + f.length <= o.width) return flatMark([f]);
    }
    var kw = tokText(c.kw, o);
    var W = K('WHEN', o), T = K('THEN', o), E = K('ELSE', o), N = K('END', o);
    var ind = kw.length + 1;
    var indStr = sp(ind);
    var blocks = c.whens.map(function (w) {
      var cR = layout(w.c, col + ind + W.length + 1, o);
      if (o.casethen === 'next') {
        var rR = layout(w.r, col + ind + 2 + T.length + 1, o);
        return hang(W + ' ', cR).concat(hang(sp(2) + T + ' ', rR));
      }
      var rCol = col + ind + W.length + 1 + lastLen(cR) + 1 + T.length + 1;
      return cat(hang(W + ' ', cR), ' ' + T + ' ', layout(w.r, rCol, o));
    });
    var out = [];
    // WHEN · ELSE 앞에 있던 주석(주석 처리한 분기 등)은 그 위 줄에 그대로
    function cmts(list, at) { (list || []).forEach(function (cm) { out.push(at + cmtLine(cm)); }); }
    if (c.operand) {
      out = hang(kw + ' ', layout(c.operand, col + ind, o));
      blocks.forEach(function (b, i) { cmts(c.whens[i].cm, indStr); out.push.apply(out, hang(indStr, b)); });
    } else {
      blocks.forEach(function (b, i) {
        if (i === 0) { var first = hang(kw + ' ', b); if (c.whens[0].cm && c.whens[0].cm.length) first[0] += ' ' + c.whens[0].cm.map(cmtInline).join(' '); out.push.apply(out, first); }
        else { cmts(c.whens[i].cm, indStr); out.push.apply(out, hang(indStr, b)); }
      });
    }
    if (c.els) { cmts(c.elsCm, indStr); out.push.apply(out, hang(indStr, hang(E + ' ', layout(c.els, col + ind + E.length + 1, o)))); }
    out.push((o.caseend === 'when' ? indStr : '') + closeLead(c.endTok) + N + closeTail(c.endTok));
    return flatMark(out); // END 의 주석은 위에서 넣었어요
  }

  /* "단순한" 스칼라 서브쿼리: 항목 1개 · 테이블 1개 · 조건 2개 이하 · GROUP BY 등 없음
   * (줄 길이 제한이 없어서 길이 대신 구조로 판단해요) */
  function simpleScalar(sub) {
    if (sub.kind !== 'scalar') return false;
    var q = sub.q;
    if (q.with.length || q.parts.length !== 1) return false;
    var sel = q.parts[0].sel;
    if (sel.t !== 'select' || sel.items.length !== 1) return false;
    if (sel.from && (sel.from.items.length !== 1 || sel.from.items[0].joins.length)) return false;
    if (sel.where && sel.where.conds.length > 2) return false;
    return !(sel.group || sel.having || sel.order || sel.start || sel.connect || sel.tails.length);
  }

  function renderSub(gp, col, o) {
    var kind = gp.sub.kind, q = gp.sub.q;
    var pre = gp.fn ? tokText(gp.fn, o) : '';
    if (o.scalar === 'short' && simpleScalar(gp.sub)) {
      var s = flatQuery(q, o);
      if (s !== null && col + pre.length + s.length + 2 <= o.width) return [pre + '(' + s + ')'];
    }
    var brk = o.subind === 'fixed' || (kind === 'inline' && o.inline === 'next');
    var out;
    if (!brk) {
      out = hang(pre + '(', renderQuery(q, col + pre.length + 1, o));
      app(out, ')');
    } else {
      var qR = renderQuery(q, col + 4, o);
      out = [pre + '('].concat(qR.map(function (l) { return sp(4) + l; }));
      out.push(')');
    }
    return out;
  }

  /* ---------- 한 줄 SELECT (스칼라 서브쿼리 "짧으면 한 줄"용) ---------- */
  function aliasText(it, o) {
    if (!it.alias) return '';
    var as = o.asword === 'omit' ? '' : (o.asword === 'keep' ? (it.hadAs ? K('AS', o) + ' ' : '') : K('AS', o) + ' ');
    return ' ' + as + it.alias.v;
  }
  function flatConds(conds, o) {
    var out = [];
    for (var i = 0; i < conds.length; i++) {
      var f = flat(conds[i].atoms, o);
      if (f === null || conds[i].lead.length || conds[i].trail.length) return null;
      out.push((i ? K(conds[i].op, o) + ' ' : '') + f);
    }
    return out.join(' ');
  }
  function flatSelect(sel, o) {
    if (sel.into || sel.kwLead.length) return null;
    var parts = [K('SELECT', o, sel.kw)];
    if (sel.hint) parts.push(sel.hint.v);
    if (sel.quant) parts.push(tokText(sel.quant, o));
    var its = [];
    for (var i = 0; i < sel.items.length; i++) {
      var it = sel.items[i];
      var f = flat(it.atoms, o);
      if (f === null || it.lead.length || it.trail.length) return null;
      its.push(f + aliasText(it, o));
    }
    parts.push(its.join(', '));
    if (sel.from) {
      var fr = [];
      for (var j = 0; j < sel.from.items.length; j++) {
        var fi = sel.from.items[j];
        var rf = flat(fi.ref.atoms, o);
        if (rf === null || fi.ref.lead.length || fi.ref.trail.length) return null;
        var t = rf + (fi.ref.alias ? ' ' + fi.ref.alias.v : '');
        for (var k = 0; k < fi.joins.length; k++) {
          var jn = fi.joins[k];
          var jr = flat(jn.ref.atoms, o);
          if (jr === null) return null;
          t += ' ' + K(jn.kind, o) + ' ' + jr + (jn.ref.alias ? ' ' + jn.ref.alias.v : '');
          if (jn.on) { var fo = flatConds(jn.on, o); if (fo === null) return null; t += ' ' + K('ON', o) + ' ' + fo; }
          else if (jn.using) { var fu = flat(jn.using, o); if (fu === null) return null; t += ' ' + K('USING', o) + ' ' + fu; }
        }
        fr.push(t);
      }
      parts.push(K('FROM', o) + ' ' + fr.join(', '));
    }
    var cl = [['where', 'WHERE'], ['start', 'START WITH'], ['connect', 'CONNECT BY'], ['having', 'HAVING']];
    var order = [];
    for (var m = 0; m < cl.length; m++) if (sel[cl[m][0]]) order.push(cl[m]);
    for (var n = 0; n < order.length; n++) {
      var fc = flatConds(sel[order[n][0]].conds, o);
      if (fc === null) return null;
      parts.push(K(order[n][1], o) + ' ' + fc);
    }
    var lists = [['group', 'GROUP BY'], ['order', 'ORDER BY']];
    for (var l = 0; l < lists.length; l++) {
      var cur = sel[lists[l][0]];
      if (!cur) continue;
      var fl = [];
      for (var x = 0; x < cur.items.length; x++) {
        var ff = flat(cur.items[x].atoms, o);
        if (ff === null) return null;
        fl.push(ff);
      }
      parts.push(K(cur.kw.toUpperCase(), o) + ' ' + fl.join(', '));
    }
    for (var y = 0; y < sel.tails.length; y++) {
      var ft = flat(sel.tails[y].atoms, o);
      if (ft === null) return null;
      parts.push(K(sel.tails[y].kw.toUpperCase(), o) + ' ' + ft);
    }
    return parts.join(' ');
  }
  function flatQuery(q, o) {
    if (q.with.length) return null;
    var out = [];
    for (var i = 0; i < q.parts.length; i++) {
      var p = q.parts[i];
      if (p.sel.t !== 'select') return null;
      var s = flatSelect(p.sel, o);
      if (s === null) return null;
      out.push((p.op ? K(p.op, o) + ' ' : '') + s);
    }
    return out.join(' ');
  }

  /* ---------- 절(clause) ---------- */
  function head(canon, orig, o) {
    var first = canon.split(' ')[0];
    var t = K(canon, o, orig);
    return (o.clause === 'right' ? sp(6 - first.length) : '') + t + ' ';
  }
  function cmtLines(list, ind, out) { (list || []).forEach(function (c) { out.push(sp(ind) + cmtLine(c)); }); }

  function withAlias(R, it, o) {
    if (!it.alias) return R;
    var as = o.asword === 'omit' ? '' : (o.asword === 'keep' ? (it.hadAs ? K('AS', o) + ' ' : '') : K('AS', o) + ' ');
    return cat(R, ' ' + as, [it.alias.v]);
  }
  function refWithAlias(ref, col, o) {
    var base = layout(ref.atoms, col, o);
    return ref.alias ? cat(base, ' ', [ref.alias.v]) : base;
  }

  function listLines(prefix, items, o, col, pack) {
    var pl = prefix.length;
    // 복잡한 항목(heavy)은 다른 항목과 한 줄로 묶지 않아요
    var plain = items.every(function (i) { return i.R.length === 1 && !i.heavy && !(i.lead || []).length && !(i.trail || []).length; });
    if (pack && plain) {
      var one = prefix + items.map(function (i) { return i.R[0]; }).join(', ');
      if (items.length <= o.oneline && col + one.length <= o.width) return [one];
    }
    if (pack && o.perline !== '1') {
      var per = o.perline === 'auto' ? 1e9 : parseInt(o.perline, 10);
      var rows = [], cur = null, cnt = 0;
      items.forEach(function (it) {
        var ok = it.R.length === 1 && !it.heavy && !(it.lead || []).length && !(it.trail || []).length;
        if (!ok) {
          if (cur !== null) { rows.push({ R: [cur] }); cur = null; cnt = 0; }
          rows.push(it);
          return;
        }
        var t = it.R[0];
        if (cur === null) { cur = t; cnt = 1; return; }
        if (cnt < per && col + pl + cur.length + 2 + t.length + 1 <= o.width) { cur += ', ' + t; cnt++; }
        else { rows.push({ R: [cur] }); cur = t; cnt = 1; }
      });
      if (cur !== null) rows.push({ R: [cur] });
      return renderList(prefix, rows, o);
    }
    return renderList(prefix, items, o);
  }

  function renderListClause(canon, cl, o, col) {
    var out = [];
    cmtLines(cl.lead, 0, out);
    var prefix = head(canon, cl.kw, o), pl = prefix.length;
    var plain = cl.items.every(function (i) { return !i.lead.length && !i.trail.length; });
    if (plain) {
      var fl = cl.items.map(function (i) { return flat(i.atoms, o); });
      if (fl.every(function (x) { return x !== null; })) {
        var line = prefix + fl.join(', ');
        if (col + line.length <= o.width) { out.push(line); return out; }
      }
    }
    var items = cl.items.map(function (i) { return { R: layout(i.atoms, col + pl, o), lead: i.lead, trail: i.trail }; });
    out.push.apply(out, renderList(prefix, items, o));
    return out;
  }

  var SYMCMP = { '=': 1, '<>': 1, '!=': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '^=': 1 };
  function simpleCmp(atoms, o) {
    var idx = -1;
    for (var i = 0; i < atoms.length; i++) {
      var a = atoms[i];
      if (!a.t && a.k === 'op' && SYMCMP[a.v]) { if (idx >= 0) return null; idx = i; }
    }
    if (idx < 1 || idx === atoms.length - 1) return null;
    var l = flat(atoms.slice(0, idx), o), r = flat(atoms.slice(idx + 1), o);
    if (l === null || r === null) return null;
    return { l: l, op: atoms[idx].v, r: r };
  }

  function renderConds(conds, firstPrefix, o, col) {
    var pl = firstPrefix.length;
    var aligned = null;
    if (o.opalign) {
      var parts = conds.map(function (c) { return simpleCmp(c.atoms, o); });
      var have = parts.filter(Boolean);
      if (have.length >= 2) {
        var max = Math.max.apply(null, have.map(function (p) { return p.l.length; }));
        aligned = parts.map(function (p) {
          if (!p) return null;
          var s = p.l + sp(max - p.l.length) + (o.opspace ? ' ' : '') + p.op + (o.opspace ? ' ' : '') + p.r;
          return col + pl + s.length <= o.width ? s : null;
        });
      }
    }
    var out = [];
    conds.forEach(function (c, i) {
      var prefix = i === 0 ? firstPrefix : sp(pl - 1 - c.op.length) + K(c.op, o) + ' ';
      var lead = c.lead || [], tr = c.trail || [];
      if (!o.cmtkeep && tr.length) { lead = lead.concat(tr); tr = []; }
      lead.forEach(function (cm) { out.push(sp(i === 0 ? 0 : pl) + cmtLine(cm)); });
      var R = aligned && aligned[i] !== null && !wrapOps(c.atoms, col + pl, o) ? [aligned[i]] : layout(c.atoms, col + pl, o);
      var lines = hang(prefix, R);
      if (tr.length) lines[lines.length - 1] += SENT + tr.map(cmtLine).join(' ');
      out.push.apply(out, lines);
    });
    return out;
  }
  function condClause(canon, cl, o, col) {
    var out = [];
    cmtLines(cl.lead, 0, out);
    out.push.apply(out, renderConds(cl.conds, head(canon, cl.kw, o), o, col));
    return out;
  }


  function breakSubRef(ref, o) {
    if (ref.atoms.length !== 1) return null;
    var gp = ref.atoms[0];
    if (gp.t !== 'group' || !gp.sub || gp.fn) return null;
    if (!(o.subind === 'fixed' || o.inline === 'next')) return null;
    return gp;
  }
  /* 인라인 뷰: 여는 괄호 뒤에서 줄을 바꾸고, 절 키워드 기준으로 4칸 들여써요 */
  function renderBreakRef(gp, ref, openPrefix, base, col, o) {
    var inner = renderQuery(gp.sub.q, col + base + 4, o).map(function (l) { return sp(base + 4) + l; });
    return [openPrefix + '('].concat(inner, [sp(base) + ')' + (ref.alias ? ' ' + ref.alias.v : '')]);
  }

  function renderJoin(j, J, col, o) {
    var out = [];
    cmtLines(j.lead, J, out);
    var jp = sp(J) + K(j.kind, o, j.kwOrig) + ' ';
    var bs = breakSubRef(j.ref, o);
    var lines = bs ? renderBreakRef(bs, j.ref, jp, J, col, o) : hang(jp, refWithAlias(j.ref, col + jp.length, o));
    (j.ref.lead || []).forEach(function (c) { out.push(sp(J) + cmtLine(c)); });
    if (j.ref.trail && j.ref.trail.length) lines[lines.length - 1] += SENT + j.ref.trail.map(cmtLine).join(' ');
    out.push.apply(out, lines);
    if (j.on) out.push.apply(out, renderConds(j.on, sp(J + 2) + K('ON', o) + ' ', o, col));
    else if (j.using) out.push(sp(J + 2) + K('USING', o) + ' ' + (flat(j.using, o) || ''));
    return out;
  }

  function renderFrom(sel, col, o) {
    var from = sel.from, out = [];
    cmtLines(from.lead, 0, out);
    var prefix = head('FROM', from.kw, o), pl = prefix.length;
    var J = prefix.length - prefix.replace(/^ +/, '').length;
    function simple(it) { return !it.joins.length && it.ref.alias && it.ref.atoms.length === 1 && !it.ref.atoms[0].t; }
    var maxName = 0, nSimple = 0;
    if (o.tblalign) {
      from.items.forEach(function (it) {
        if (simple(it)) { nSimple++; maxName = Math.max(maxName, tokText(it.ref.atoms[0], o).length); }
      });
    }
    var leading = o.comma === 'leading';
    from.items.forEach(function (it, i) {
      var refR;
      var bsr = breakSubRef(it.ref, o);
      if (bsr) {
        refR = null;
      } else if (o.tblalign && nSimple > 1 && simple(it)) {
        var nm = tokText(it.ref.atoms[0], o);
        refR = [nm + sp(maxName - nm.length) + ' ' + it.ref.alias.v];
      } else {
        refR = refWithAlias(it.ref, col + pl, o);
      }
      (it.ref.lead || []).forEach(function (c) { out.push(sp(i === 0 ? 0 : pl) + cmtLine(c)); });
      var p = i === 0 ? prefix : (leading ? sp(Math.max(0, pl - 2)) + ', ' : sp(pl));
      var lines = bsr ? renderBreakRef(bsr, it.ref, p, i === 0 ? J : (leading ? Math.max(0, pl - 2) : pl), col, o) : hang(p, refR);
      if (it.ref.trail && it.ref.trail.length) lines[lines.length - 1] += SENT + it.ref.trail.map(cmtLine).join(' ');
      it.joins.forEach(function (j) { lines = lines.concat(renderJoin(j, J, col, o)); });
      if (!leading && i < from.items.length - 1) app(lines, ',');
      out.push.apply(out, lines);
    });
    return out;
  }

  function renderSelect(sel, col, o) {
    var out = [];
    cmtLines(sel.kwLead, 0, out);
    var prefix = head('SELECT', sel.kw, o), pl = prefix.length;
    var first = '';
    if (sel.hint) first += sel.hint.v + ' ';
    if (sel.quant) first += tokText(sel.quant, o) + ' ';
    var items = sel.items.map(function (it, idx) {
      var R = withAlias(layout(it.atoms, col + pl + (idx === 0 ? first.length : 0), o), it, o);
      if (idx === 0 && first) R = hang(first, R);
      return { R: R, lead: it.lead, trail: it.trail, heavy: isHeavy(it.atoms) };
    });
    out.push.apply(out, listLines(prefix, items, o, col, true));
    if (sel.into) out.push.apply(out, renderListClause('INTO', sel.into, o, col));
    if (sel.from) out.push.apply(out, renderFrom(sel, col, o));
    if (sel.where) out.push.apply(out, condClause('WHERE', sel.where, o, col));
    if (sel.start) out.push.apply(out, condClause('START WITH', sel.start, o, col));
    if (sel.connect) out.push.apply(out, condClause('CONNECT BY', sel.connect, o, col));
    if (sel.group) out.push.apply(out, renderListClause('GROUP BY', sel.group, o, col));
    if (sel.having) out.push.apply(out, condClause('HAVING', sel.having, o, col));
    if (sel.order) out.push.apply(out, renderListClause(sel.order.kw.toUpperCase(), sel.order, o, col));
    sel.tails.forEach(function (t) {
      cmtLines(t.lead, 0, out);
      var pfx = head(t.kw.toUpperCase(), t.kw, o);
      out.push.apply(out, hang(pfx, layout(t.atoms, col + pfx.length, o)));
    });
    return out;
  }

  function renderQuery(q, col, o) {
    var out = [];
    q.with.forEach(function (c, i) {
      var lead = i === 0 ? K('WITH', o, q.withKw && q.withKw.kw) + ' ' : (o.comma === 'leading' ? ', ' : sp(5));
      var nameT = c.name.v + (c.cols ? ' ' + (flatAtom(c.cols, o) || '') : '');
      out.push(lead + nameT + ' ' + K('AS', o) + ' (');
      renderQuery(c.q, col + 4, o).forEach(function (l) { out.push(sp(4) + l); });
      out.push(')' + (o.comma !== 'leading' && i < q.with.length - 1 ? ',' : ''));
    });
    q.parts.forEach(function (p) {
      (p.opLead || []).forEach(function (c) { out.push(cmtLine(c)); });
      if (p.op) out.push(K(p.op, o) + ((p.opTail || []).length ? ' ' + p.opTail.map(cmtLine).join(' ') : ''));
      if (p.sel.t === 'select') out.push.apply(out, renderSelect(p.sel, col, o));
      else { var r = hang('(', renderQuery(p.sel.q, col + 1, o)); app(r, ')'); out.push.apply(out, r); }
    });
    return out;
  }

  /* ---------- DML ---------- */
  function tableText(atoms, o) { return flat(atoms, o) || atoms.map(function (a) { return tokText(a, o); }).join(' '); }

  function tailClause(t, o) {
    var out = [];
    if (!t) return out;
    cmtLines(t.lead, 0, out);
    var pfx = head(t.kw.toUpperCase(), t.kw, o);
    out.push.apply(out, hang(pfx, layout(t.atoms, pfx.length, o)));
    return out;
  }

  function assignItems(assigns, pl, o) {
    var maxL = 0;
    var lhs = assigns.map(function (a) { var s = flat(a.lhs, o) || ''; maxL = Math.max(maxL, s.length); return s; });
    return assigns.map(function (a, i) {
      var l = o.opalign ? lhs[i] + sp(maxL - lhs[i].length) : lhs[i];
      var text = l + (o.opspace ? ' = ' : '=');
      var R = cat([text], '', layout(a.rhs, pl + text.length, o));
      return { R: R, lead: a.lead, trail: a.trail };
    });
  }

  function groupInline(gp, prefixLen, o) {
    var f = flatAtom(gp, o);
    return f !== null && prefixLen + f.length <= o.width ? f : null;
  }

  function renderInsert(s, o) {
    var out = [];
    cmtLines(s.lead, 0, out);
    var h = head('INSERT', s.kw, o) + (s.hint ? s.hint.v + ' ' : '') + K('INTO', o) + ' ';
    var line1 = h + tableText(s.table, o);
    // 컬럼 · 값 목록: "INSERT 목록 N개 이하면 한 줄" 보다 많으면 한 줄에 하나
    function inline(gp, pl) {
      if (gp.args.length > o.insline) return null;
      return groupInline(gp, pl, o);
    }
    if (s.cols) {
      var cf = inline(s.cols, line1.length + 1);
      if (cf !== null) { out.push(line1 + ' ' + cf); }
      else {
        out.push(line1);
        out.push.apply(out, hang(sp(7), argsBlock(o.comma === 'leading' ? '( ' : '(', s.cols.args, 7, o)));
      }
    } else out.push(line1);
    if (s.values) {
      var vp = head('VALUES', 'values', o);
      var vf = inline(s.values, vp.length);
      if (vf !== null) out.push(vp + vf);
      else out.push.apply(out, hang(vp, argsBlock(o.comma === 'leading' ? '( ' : '(', s.values.args, vp.length, o)));
    }
    if (s.query) out.push.apply(out, renderQuery(s.query, 0, o));
    out.push.apply(out, tailClause(s.tail, o));
    return out;
  }

  function renderUpdate(s, o) {
    var out = [];
    cmtLines(s.lead, 0, out);
    var pfx = head('UPDATE', s.kw, o) + (s.hint ? s.hint.v + ' ' : '');
    out.push.apply(out, hang(pfx, refWithAlias(s.ref, pfx.length, o)));
    var sp0 = head('SET', s.setKw, o);
    cmtLines(s.setLead, 0, out);
    out.push.apply(out, renderList(sp0, assignItems(s.assigns, sp0.length, o), o));
    if (s.where) out.push.apply(out, condClause('WHERE', s.where, o, 0));
    out.push.apply(out, tailClause(s.tail, o));
    return out;
  }

  function renderDelete(s, o) {
    var out = [];
    cmtLines(s.lead, 0, out);
    var pfx = head('DELETE', s.kw, o) + (s.hint ? s.hint.v + ' ' : '') + (s.fromKw ? K('FROM', o, s.fromKw) + ' ' : '');
    out.push.apply(out, hang(pfx, refWithAlias(s.ref, pfx.length, o)));
    if (s.where) out.push.apply(out, condClause('WHERE', s.where, o, 0));
    out.push.apply(out, tailClause(s.tail, o));
    return out;
  }

  function renderMerge(s, o) {
    var out = [];
    cmtLines(s.lead, 0, out);
    var p1 = head('MERGE', s.kw, o) + (s.hint ? s.hint.v + ' ' : '') + K('INTO', o) + ' ';
    out.push.apply(out, hang(p1, refWithAlias(s.target, p1.length, o)));
    var p2 = head('USING', 'using', o);
    out.push.apply(out, hang(p2, refWithAlias(s.using, p2.length, o)));
    out.push.apply(out, renderConds(s.on, head('ON', 'on', o), o, 0));
    var base = o.clause === 'right' ? 7 : 2, ba = sp(base);
    s.whens.forEach(function (w) {
      cmtLines(w.lead, 0, out);
      var wp = o.clause === 'right' ? sp(2) : '';
      var txt = wp + K(w.matched ? 'WHEN MATCHED' : 'WHEN NOT MATCHED', o, w.kwOrig);
      if (w.and) txt += ' ' + K('AND', o) + ' ' + (flat(w.and, o) || '');
      out.push(txt + ' ' + K('THEN', o));
      var a = w.act;
      if (a.kind === 'update') {
        var up0 = ba + K('UPDATE', o) + ' ' + K('SET', o) + ' ';
        out.push.apply(out, renderList(up0, assignItems(a.assigns, up0.length, o), o));
        if (a.where) out.push.apply(out, renderConds(a.where.conds, ba + K('WHERE', o) + ' ', o, 0));
        if (a.del) out.push.apply(out, renderConds(a.del.conds, ba + K('DELETE', o) + ' ' + K('WHERE', o) + ' ', o, 0));
      } else if (a.kind === 'insert') {
        var ip = ba + K('INSERT', o) + ' ';
        if (a.cols) {
          var cf = a.cols.args.length > o.insline ? null : groupInline(a.cols, ip.length, o);
          if (cf !== null) out.push(ip + cf);
          else out.push.apply(out, hang(ip, argsBlock('(', a.cols.args, ip.length, o)));
        } else out.push(ip.replace(/\s+$/, ''));
        var vp = ba + K('VALUES', o) + ' ';
        var vf = a.values.args.length > o.insline ? null : groupInline(a.values, vp.length, o);
        if (vf !== null) out.push(vp + vf);
        else out.push.apply(out, hang(vp, argsBlock('(', a.values.args, vp.length, o)));
        if (a.where) out.push.apply(out, renderConds(a.where.conds, ba + K('WHERE', o) + ' ', o, 0));
      } else {
        out.push(ba + K('DELETE', o));
      }
    });
    return out;
  }

  function renderStmt(ast, o) {
    switch (ast.t) {
      case 'query': return renderQuery(ast.q, 0, o);
      case 'insert': return renderInsert(ast, o);
      case 'update': return renderUpdate(ast, o);
      case 'delete': return renderDelete(ast, o);
      case 'merge': return renderMerge(ast, o);
    }
    return [];
  }

  S.render = {
    stmt: renderStmt, flat: flat, SENT: SENT, cmtLine: cmtLine, app: app,
    // PL/SQL 포매터가 같이 쓰는 도구들
    layout: layout, K: K, hang: hang, cat: cat, sp: sp, cmtInline: cmtInline, tokText: tokText, lastLen: lastLen
  };
})(typeof window !== 'undefined' ? window : globalThis);
