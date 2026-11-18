/* 덩어리(블록) 찾기 · 설명 주석 넣기 · 덩어리 옮기기 (결과 칸 "구조 · 설명" 화면용)
 * - 결과 글자에서 다시 찾기 때문에 결과를 직접 고쳐도 따라가요 (ifblocks.js 와 같은 방식).
 * - 덩어리: SQL 문장, IF, CASE, 반복문, 안쪽 BEGIN~END, 커서 명령, COMMIT, 이어진 := 대입문, 프로시저 호출 …
 * - 줄 단위로만 다뤄요. 한 줄에 두 덩어리가 섞여 있으면 그 안쪽은 나누지 않아요 (옮기다 깨지지 않게).
 * - 덩어리 바로 위 주석 한 줄은 그 덩어리의 설명으로 읽어요. `-- [3] 설명` 의 [3] 번호는 넣을 때 다시 매겨요. */
(function (g) {
  'use strict';
  var S = (g.SQLF = g.SQLF || {});

  function mk(s) { var m = {}; s.split(/\s+/).forEach(function (w) { if (w) m[w] = true; }); return m; }
  var SQLW = mk('SELECT WITH INSERT UPDATE DELETE MERGE EXECUTE LOCK FORALL CREATE ALTER DROP TRUNCATE GRANT REVOKE COMMENT');
  var CURW = mk('OPEN FETCH CLOSE');
  var TXW = mk('COMMIT ROLLBACK SAVEPOINT');
  var CTRLW = mk('RETURN EXIT CONTINUE RAISE NULL GOTO PIPE');
  var FIXED = mk('DECL EXC');
  var NOTKW = mk(
    'SELECT FROM WHERE AND OR NOT IN IS NULL AS ON JOIN INNER LEFT RIGHT FULL OUTER CROSS USING GROUP BY ORDER HAVING ' +
    'UNION ALL MINUS INTERSECT DISTINCT CASE WHEN THEN ELSE ELSIF END BETWEEN LIKE EXISTS ASC DESC WITH FOR UPDATE OF ' +
    'INSERT INTO VALUES SET DELETE MERGE MATCHED RETURNING IF LOOP WHILE BEGIN DECLARE EXCEPTION OPEN FETCH CLOSE ' +
    'COMMIT ROLLBACK RETURN EXIT CONTINUE RAISE OTHERS TRUE FALSE SYSDATE NVL COUNT SUM MAX MIN AVG TRUNC ROUND ' +
    'TO_CHAR TO_DATE TO_NUMBER DECODE SUBSTR LENGTH ROWNUM DUAL BULK COLLECT LIMIT FORALL EXECUTE IMMEDIATE'
  );

  function W(t) { return t && t.k === 'word' ? t.v.toUpperCase() : ''; }
  function isP(t, v) { return !!t && t.k === 'punct' && t.v === v; }
  function isOp(t, v) { return !!t && t.k === 'op' && t.v === v; }

  /* ================= 덩어리 찾기 ================= */
  function codeBlocks(text) {
    text = String(text == null ? '' : text);
    var toks;
    try { toks = S.tokenize(text); } catch (e) { toks = []; }
    var code = [];
    toks.forEach(function (t) {
      if (t.k === 'lcomment' || t.k === 'bcomment' || t.k === 'hint') return;
      code.push(t);
    });
    var cmts = toks.filter(function (t) { return t.k === 'lcomment' || t.k === 'bcomment'; });

    var starts = [0];
    for (var i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    function lineOf(pos) {
      var lo = 0, hi = starts.length - 1;
      while (lo < hi) { var m = (lo + hi + 1) >> 1; if (starts[m] <= pos) lo = m; else hi = m - 1; }
      return lo;
    }
    function lineEnd(ln) { return ln + 1 < starts.length ? starts[ln + 1] - 1 : text.length; }
    function lineText(ln) { return text.slice(starts[ln], lineEnd(ln)); }

    var n = code.length;
    // 괄호 · CASE 식 깊이를 세면서 단어를 찾아요 (조건 안의 CASE ... END 를 건너뛰려고)
    function findWord(i, words, stopSemi) {
      var d = 0, cd = 0;
      for (var j = i; j < n; j++) {
        var t = code[j], w = W(t);
        if (isP(t, '(')) d++;
        else if (isP(t, ')')) d--;
        else if (d === 0) {
          if (w === 'CASE') cd++;
          else if (w === 'END' && cd > 0) cd--;
          else if (cd === 0 && words[w]) return j;
          else if (stopSemi && isP(t, ';')) return -1;
        }
      }
      return -1;
    }
    function semi(i) {
      var d = 0;
      for (var j = i; j < n; j++) {
        if (isP(code[j], '(')) d++;
        else if (isP(code[j], ')')) d = Math.max(0, d - 1);
        else if (d === 0 && isP(code[j], ';')) return j;
      }
      return n - 1;
    }
    function blk(kind, t0, t1, o) {
      var b = { kind: kind, t0: t0, t1: Math.max(t0, t1), kids: [], group: '', head: -1 };
      if (o) Object.keys(o).forEach(function (k) { b[k] = o[k]; });
      return b;
    }
    // END [IF|LOOP|CASE] [이름] ; 을 먹어요
    function eatEnd(i, word) {
      if (W(code[i]) !== 'END') return i - 1;
      var j = i + 1;
      if (word && W(code[j]) === word) j++;
      if (code[j] && (code[j].k === 'word' || code[j].k === 'name') && !isP(code[j], ';') && W(code[j]) !== 'END' && !/^(IF|LOOP|CASE)$/.test(W(code[j]))) {
        if (isP(code[j + 1], ';')) j++;
      }
      return isP(code[j], ';') ? j : j - 1;
    }

    function body(i, stops, group) {
      var items = [];
      while (i < n) {
        var t = code[i], w = W(t);
        if (w === 'END' || stops[w]) break;
        var r = stmt(i);
        if (!r) { i++; continue; }
        r.b.group = group;
        items.push(r.b);
        i = r.i;
      }
      return { items: items, i: i };
    }
    function excSection(i) {
      // i: EXCEPTION
      var b = blk('EXC', i, i, { head: i, label: 'EXCEPTION' });
      var j = i + 1, h = 0, last = i;
      while (j < n && W(code[j]) === 'WHEN') {
        var th = findWord(j + 1, { THEN: 1 });
        if (th < 0) break;
        var r = body(th + 1, { WHEN: 1 }, 'h' + h++);
        b.kids = b.kids.concat(r.items);
        last = r.i - 1;
        j = r.i;
      }
      b.t1 = Math.max(i, last);
      return { b: b, i: j };
    }
    function decls(i, group) {
      var items = [], cur = null;
      while (i < n) {
        var w = W(code[i]);
        if (w === 'BEGIN' || w === 'END') break;
        if (w === 'PROCEDURE' || w === 'FUNCTION') {
          var sp = subprogram(i, i, 'PROC');
          if (sp) { cur = null; sp.b.group = group; items.push(sp.b); i = sp.i; continue; }
        }
        var e = semi(i);
        if (cur && lineOf(code[i].pos) <= lineOf(code[cur.t1].end) + 1 && !leadGap(i)) cur.t1 = e;
        else { cur = blk('DECL', i, e, { group: group, label: '선언부' }); items.push(cur); }
        i = e + 1;
      }
      return { items: items, i: i };
    }
    // i 앞에 빈 줄이 있으면 선언 묶음을 나눠요
    function leadGap(i) {
      var prevEnd = lineOf(code[i - 1].end), here = lineOf(code[i].pos);
      for (var l = prevEnd + 1; l < here; l++) if (!lineText(l).trim()) return true;
      return false;
    }
    // [CREATE ...] PROCEDURE|FUNCTION|PACKAGE [BODY] 이름 ... IS|AS 선언 [BEGIN 본문] [EXCEPTION] END;
    function subprogram(t0, i, kind) {
      var isAt = findWord(i + 1, { IS: 1, AS: 1 }, true);
      if (isAt < 0) return null; // 앞선 선언(;) 등
      // RETURN 타입 IS ... 처럼 중간 IS 가 아닌지: 괄호 밖 첫 IS/AS 가 머리 끝
      var b = blk(kind, t0, isAt, { head: isAt });
      var d = decls(isAt + 1, 'decl');
      b.kids = d.items;
      var j = d.i;
      if (W(code[j]) === 'BEGIN') {
        var r = body(j + 1, { EXCEPTION: 1 }, 'body');
        b.kids = b.kids.concat(r.items);
        j = r.i;
        if (W(code[j]) === 'EXCEPTION') { var x = excSection(j); x.b.group = 'exc'; b.kids.push(x.b); j = x.i; }
      }
      var e = eatEnd(j, null);
      b.t1 = Math.max(b.t1, e);
      b.tail = W(code[j]) === 'END' ? j : -1;
      return { b: b, i: e + 1 };
    }
    function anon(t0, i) {
      // DECLARE ... BEGIN ... [EXCEPTION ...] END;  또는 BEGIN ...
      var b = blk('BLOCK', t0, i, { head: i });
      var j = i;
      if (W(code[j]) === 'DECLARE') {
        var d = decls(j + 1, 'decl');
        b.kids = d.items;
        j = d.i;
        b.head = i;
      }
      if (W(code[j]) !== 'BEGIN') return null;
      if (W(code[i]) === 'BEGIN') b.head = j;
      var r = body(j + 1, { EXCEPTION: 1 }, 'body');
      b.kids = b.kids.concat(r.items);
      j = r.i;
      if (W(code[j]) === 'EXCEPTION') { var x = excSection(j); x.b.group = 'exc'; b.kids.push(x.b); j = x.i; }
      var e = eatEnd(j, null);
      b.t1 = e;
      b.tail = W(code[j]) === 'END' ? j : -1;
      return { b: b, i: e + 1 };
    }

    function stmt(i0) {
      var i = i0;
      // <<라벨>>
      while (isOp(code[i], '<') && isOp(code[i + 1], '<') && isOp(code[i + 3], '>') && isOp(code[i + 4], '>')) i += 5;
      var t = code[i], w = W(t);
      if (!t) return null;
      if (w === 'IF') {
        var th = findWord(i + 1, { THEN: 1 });
        if (th < 0) return simple(i0, i);
        var b = blk('IF', i0, th, { head: th }), g = 0, j = th + 1;
        for (;;) {
          var r = body(j, { ELSIF: 1, ELSE: 1 }, 'b' + g++);
          b.kids = b.kids.concat(r.items);
          j = r.i;
          var w2 = W(code[j]);
          if (w2 === 'ELSIF') { var th2 = findWord(j + 1, { THEN: 1 }); if (th2 < 0) break; j = th2 + 1; continue; }
          if (w2 === 'ELSE') { j++; continue; }
          break;
        }
        var e = eatEnd(j, 'IF');
        b.t1 = e; b.tail = W(code[j]) === 'END' ? j : -1;
        return { b: b, i: e + 1 };
      }
      if (w === 'CASE') {
        var wh = findWord(i + 1, { WHEN: 1 });
        if (wh < 0) return simple(i0, i);
        var c = blk('CASE', i0, wh - 1, { head: Math.max(i, wh - 1) }), k = wh, gi = 0;
        while (k < n) {
          var wk = W(code[k]);
          if (wk === 'WHEN') { var th3 = findWord(k + 1, { THEN: 1 }); if (th3 < 0) break; var r3 = body(th3 + 1, { WHEN: 1, ELSE: 1 }, 'w' + gi++); c.kids = c.kids.concat(r3.items); k = r3.i; continue; }
          if (wk === 'ELSE') { var r4 = body(k + 1, {}, 'w' + gi++); c.kids = c.kids.concat(r4.items); k = r4.i; continue; }
          break;
        }
        var e3 = eatEnd(k, 'CASE');
        c.t1 = e3; c.tail = W(code[k]) === 'END' ? k : -1;
        return { b: c, i: e3 + 1 };
      }
      if (w === 'LOOP' || w === 'WHILE' || w === 'FOR') {
        var lp = w === 'LOOP' ? i : findWord(i + 1, { LOOP: 1 }, true);
        if (lp < 0) return simple(i0, i);
        var l = blk('LOOP', i0, lp, { head: lp });
        var r5 = body(lp + 1, {}, 'body');
        l.kids = r5.items;
        var e5 = eatEnd(r5.i, 'LOOP');
        l.t1 = e5; l.tail = W(code[r5.i]) === 'END' ? r5.i : -1;
        return { b: l, i: e5 + 1 };
      }
      if (w === 'BEGIN' || w === 'DECLARE') { var a = anon(i0, i); if (a) return a; }
      return simple(i0, i);
    }
    function simple(i0, i) {
      var e = semi(i), t = code[i], w = W(t), kind;
      if (SQLW[w]) kind = 'SQL';
      else if (CURW[w]) kind = w === 'OPEN' && findWord(i + 1, { FOR: 1 }, true) >= 0 ? 'SQL' : 'CURSOR';
      else if (TXW[w]) kind = 'TX';
      else if (CTRLW[w]) kind = 'CTRL';
      else if (isOp(code[i + 1], ':=')) kind = 'SET';
      else kind = 'CALL';
      return { b: blk(kind, i0, e), i: e + 1 };
    }

    // 맨 바깥: CREATE ... / DECLARE · BEGIN / 일반 SQL / 슬래시(/) 줄
    function top() {
      var items = [], i = 0;
      while (i < n) {
        var t = code[i], w = W(t);
        if (isOp(t, '/') && lineText(lineOf(t.pos)).trim() === '/') { i++; continue; }
        if (w === 'CREATE') {
          var j = i + 1;
          while (/^(OR|REPLACE|EDITIONABLE|NONEDITIONABLE)$/.test(W(code[j]))) j++;
          var w2 = W(code[j]);
          var r = null;
          if (w2 === 'PROCEDURE' || w2 === 'FUNCTION' || w2 === 'PACKAGE' || w2 === 'TYPE') r = subprogram(i, j, 'UNIT');
          else if (w2 === 'TRIGGER') {
            var hb = findWord(j + 1, { DECLARE: 1, BEGIN: 1, COMPOUND: 1 }, true);
            if (hb >= 0 && W(code[hb]) !== 'COMPOUND') {
              r = anon(i, hb);
              if (r) { r.b.kind = 'UNIT'; r.b.head = W(code[hb]) === 'BEGIN' ? hb : hb; }
            }
          }
          if (r) { items.push(r.b); i = r.i; continue; }
          var s = simple(i, i); items.push(s.b); i = s.i; continue;
        }
        var st = stmt(i);
        if (!st) { i++; continue; }
        items.push(st.b);
        i = st.i;
      }
      return items;
    }

    var tree = [];
    try { tree = top(); } catch (e) { tree = []; }

    /* ---------- 줄 정보 붙이기 · 한 줄에 섞인 덩어리 정리 ---------- */
    function leadInfo(b) {
      // 시작 토큰 바로 위에 붙은 주석 줄들 (빈 줄 없이, 줄 맨 앞에서 시작하는 주석)
      var ln = b.start, lead = ln, last = null, startPos = code[b.t0].pos;
      var prevCodeEnd = b.t0 > 0 ? code[b.t0 - 1].end : -1;
      var lo = 0, hi = cmts.length;
      while (lo < hi) { var m = (lo + hi) >> 1; if (cmts[m].pos < startPos) lo = m + 1; else hi = m; }
      for (var k = lo - 1; k >= 0; k--) {
        var c = cmts[k];
        if (c.pos < prevCodeEnd) break;
        var cl = lineOf(c.pos), ce = lineOf(c.end - 1);
        if (ce !== lead - 1) break; // 빈 줄이 끼면 멈춤
        if (text.slice(starts[cl], c.pos).trim()) break; // 앞에 코드가 있는 줄 끝 주석
        if (!last) last = c;
        lead = cl;
      }
      b.lead = lead;
      if (last && lineOf(last.pos) === ln - 1 && lineOf(last.end - 1) === ln - 1) {
        var p = parseNote(last.v);
        if (p) { b.saved = p.text; b.savedNum = p.num; b.savedLine = ln - 1; }
      }
    }
    function lineClean(b) {
      var s = code[b.t0], e = code[b.t1];
      if (text.slice(starts[lineOf(s.pos)], s.pos).trim()) return false;
      var le = lineOf(e.end), rest = text.slice(e.end, lineEnd(le)).trim();
      return !rest || /^--/.test(rest) || /^\/\*.*\*\/$/.test(rest);
    }
    function finish(list, parent, depth) {
      var out = [];
      list.forEach(function (b) {
        b.start = lineOf(code[b.t0].pos);
        b.end = lineOf(code[b.t1].end);
        b.headLine = b.head >= 0 ? lineOf(code[b.head].end) : b.start;
        b.tailLine = b.tail >= 0 && b.tail != null ? lineOf(code[b.tail].pos) : b.end + 1;
        if (!lineClean(b)) return;
        if (out.length && b.start <= out[out.length - 1].end) return;
        if (parent && (b.start <= parent.headLine || b.end >= parent.tailLine)) return;
        b.parent = parent || null;
        b.depth = depth;
        out.push(b);
      });
      out.forEach(function (b) {
        var kids = finish(b.kids, b, depth + 1);
        b.kids = kids;
      });
      return out;
    }
    tree = finish(tree, null, 0);

    // 이어진 := 대입문은 한 덩어리로 (빈 줄 · 주석 없이 붙어 있을 때)
    function mergeSets(list) {
      var out = [];
      list.forEach(function (b) {
        var p = out[out.length - 1];
        if (b.kind === 'SET' && p && p.kind === 'SET' && p.group === b.group && b.start === p.end + 1) {
          leadInfo(b);
          if (b.lead === b.start) { p.t1 = b.t1; p.end = b.end; p.count = (p.count || 1) + 1; return; }
        }
        out.push(b);
      });
      out.forEach(function (b) { b.kids = mergeSets(b.kids); });
      return out;
    }
    tree = mergeSets(tree);

    var flat = [], seen = {};
    function sig(b) {
      var parts = [];
      for (var k = b.t0; k <= b.t1 && parts.length < 80; k++) parts.push(code[k].k === 'word' ? code[k].v.toUpperCase() : code[k].v);
      return b.kind + ':' + parts.join(' ') + ':' + (b.t1 - b.t0);
    }
    function walk(list) {
      list.forEach(function (b) {
        b.saved = null; b.savedNum = null; b.savedLine = -1;
        leadInfo(b);
        var s = sig(b);
        seen[s] = (seen[s] || 0) + 1;
        b.key = s + '#' + seen[s];
        b.fixed = !!FIXED[b.kind];
        b.label = labelOf(b);
        flat.push(b);
        walk(b.kids);
      });
    }
    function labelOf(b) {
      if (b.kind === 'DECL') return '선언부 (' + (b.end - b.start + 1) + '줄)';
      if (b.kind === 'EXC') return 'EXCEPTION';
      var s = text.slice(code[b.t0].pos, lineEnd(b.start)).replace(/\s+/g, ' ').trim();
      if (b.kind === 'SET' && b.count > 1) s += ' … (' + b.count + '줄)';
      return s;
    }
    walk(tree);

    // 번호: 프로시저 하나만 있으면 그 안쪽부터 1, 2, 3 …
    var single = tree.length === 1 && tree[0].kind === 'UNIT';
    function number(list, pre) {
      list.forEach(function (b, i) {
        b.num = pre ? pre + '.' + (i + 1) : String(i + 1);
        number(b.kids, b.num);
      });
    }
    if (single) { tree[0].num = ''; number(tree[0].kids, ''); } else number(tree, '');

    return { text: text, tree: tree, flat: flat, starts: starts, code: code, single: single, lineEnd: lineEnd };
  }

  /* ================= 설명 주석 ================= */
  // "-- [3] 설명", "/* [3] 설명 */", "-- 설명" 에서 번호와 글을 꺼내요. 기호만 있는 줄(---- 같은)은 설명이 아니에요
  function parseNote(c) {
    var s = String(c).trim(), body;
    if (/^--/.test(s)) body = s.replace(/^-+/, '');
    else if (/^\/\*[\s\S]*\*\/$/.test(s) && s.indexOf('\n') < 0 && !/^\/\*\+/.test(s)) body = s.slice(2, -2);
    else return null;
    body = body.trim();
    var num = null, m = body.match(/^\[(\d+(?:\.\d+)*)\]\s*/);
    if (m) { num = m[1]; body = body.slice(m[0].length); }
    if (!/[\p{L}\p{N}]/u.test(body)) return null;
    return { text: body, num: num };
  }
  function noteLine(fmt, num, desc) {
    desc = String(desc).replace(/\s*\n\s*/g, ' ').trim();
    if (fmt === 'block') return '/* ' + (num ? '[' + num + '] ' : '') + desc.replace(/\*\//g, '* /') + ' */';
    if (fmt === 'plain' || !num) return '-- ' + desc;
    return '-- [' + num + '] ' + desc;
  }
  function indentOf(info, ln) { var t = info.text.slice(info.starts[ln], info.lineEnd(ln)); return t.match(/^\s*/)[0]; }

  /* edits: { 덩어리 key: 새 설명 } (빈 글이면 설명 줄을 지워요)
   * 바꾼 설명 · 번호가 달라진 [n] 설명 줄만 고쳐요. 결과: { changes: [{from,to,insert}], added, changed, removed } */
  function applyNotes(info, edits, fmt) {
    edits = edits || {};
    var changes = [], added = 0, changed = 0, removed = 0;
    info.flat.forEach(function (b) {
      var has = Object.prototype.hasOwnProperty.call(edits, b.key);
      var want = has ? String(edits[b.key]).trim() : b.saved;
      var num = fmt === 'plain' ? '' : b.num;
      if (b.savedLine >= 0) {
        var from = info.starts[b.savedLine], to = info.lineEnd(b.savedLine);
        if (has && !want) { changes.push({ from: from, to: Math.min(info.text.length, to + 1), insert: '' }); removed++; return; }
        var renum = b.savedNum != null && fmt !== 'plain' && b.savedNum !== num;
        if ((has && want !== b.saved) || renum) {
          changes.push({ from: from, to: to, insert: indentOf(info, b.start) + noteLine(fmt, num, want) });
          changed++;
        }
        return;
      }
      if (want) {
        var at = info.starts[b.start];
        changes.push({ from: at, to: at, insert: indentOf(info, b.start) + noteLine(fmt, num, want) + '\n' });
        added++;
      }
    });
    changes.sort(function (a, c) { return a.from - c.from; });
    return { changes: changes, added: added, changed: changed, removed: removed };
  }

  /* ================= 덩어리 옮기기 ================= */
  function siblings(info, b) {
    var list = b.parent ? b.parent.kids : info.tree;
    return list.filter(function (x) { return x.group === b.group; });
  }
  function canMove(info, b) { return !!b && !b.fixed && siblings(info, b).length > 1 && !(info.single && !b.parent); }
  function chunk(info, b) { return { from: info.starts[b.lead], to: info.lineEnd(b.end) }; }

  // 값 넣기 / 쓰기 (순서 경고용, 이름만 보고 판단해요)
  function varsOf(info, b) {
    if (b._vars) return b._vars;
    var sets = {}, uses = {}, code = info.code;
    for (var k = b.t0; k <= b.t1; k++) {
      var t = code[k]; if (!t || (t.k !== 'word' && t.k !== 'name')) continue;
      var v = t.v.toLowerCase().split('.')[0];
      if (NOTKW[t.v.toUpperCase()]) {
        if (t.v.toUpperCase() === 'INTO' && !/^(INSERT|MERGE)$/.test(W(code[k - 1]))) {
          for (var j = k + 1; j <= b.t1; j++) {
            var u = code[j];
            if (u.k === 'word' || u.k === 'name' || u.k === 'bind') { if (!NOTKW[String(u.v).toUpperCase()]) sets[u.v.toLowerCase().split('.')[0]] = 1; else break; }
            else if (!isP(u, ',')) break;
          }
        }
        continue;
      }
      if (isOp(code[k + 1], ':=')) sets[v] = 1; else uses[v] = 1;
    }
    return (b._vars = { sets: sets, uses: uses });
  }
  function clash(info, a, c) {
    // a 가 c 를 건너뛸 때: 한쪽이 넣는 값을 다른 쪽이 쓰면 경고
    var A = varsOf(info, a), Cc = varsOf(info, c), out = [];
    Object.keys(A.uses).forEach(function (v) { if (Cc.sets[v]) out.push(v); });
    Object.keys(A.sets).forEach(function (v) { if (Cc.uses[v] && out.indexOf(v) < 0) out.push(v); });
    return out;
  }

  /* key 덩어리를 같은 단계(형제) 안의 toIdx 자리로 (toIdx: 옮기기 전 기준 끼워 넣을 위치)
   * 결과: { change: {from,to,insert}, warnings: [{v, other}] } 또는 { error } */
  function moveBlock(info, key, toIdx) {
    var b = null;
    info.flat.forEach(function (x) { if (x.key === key) b = x; });
    if (!b) return { error: '덩어리를 찾지 못했어요.' };
    if (!canMove(info, b)) return { error: b.fixed ? '선언부 · EXCEPTION 은 옮길 수 없어요.' : '옮길 수 있는 같은 단계 덩어리가 없어요.' };
    var sib = siblings(info, b), from = sib.indexOf(b);
    if (toIdx < 0 || toIdx > sib.length) return { error: '더 옮길 수 없어요.' };
    var to = toIdx > from ? toIdx - 1 : toIdx;
    if (to === from) return { error: null, change: null, warnings: [] };
    var ch = sib.map(function (x) { return chunk(info, x); });
    var gaps = [];
    for (var i = 0; i < ch.length - 1; i++) gaps.push(info.text.slice(ch[i].to, ch[i + 1].from));
    var order = sib.slice();
    order.splice(from, 1);
    order.splice(to, 0, b);
    var parts = [];
    order.forEach(function (x, k) { var c = chunk(info, x); parts.push(info.text.slice(c.from, c.to)); if (k < gaps.length) parts.push(gaps[k]); });
    var lo = Math.min(from, to), hi = Math.max(from, to), warnings = [];
    for (var j = lo; j <= hi; j++) {
      if (sib[j] === b) continue;
      clash(info, b, sib[j]).forEach(function (v) { warnings.push({ v: v, other: sib[j] }); });
    }
    return { change: { from: ch[0].from, to: ch[ch.length - 1].to, insert: parts.join('') }, warnings: warnings, to: to };
  }

  S.codeBlocks = codeBlocks;
  S.blockNotes = { parse: parseNote, line: noteLine, apply: applyNotes, move: moveBlock, canMove: canMove, siblings: siblings };
})(typeof window !== 'undefined' ? window : globalThis);
