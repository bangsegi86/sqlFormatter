/* IF ~ ELSIF ~ ELSE ~ END IF 짝 찾기 (결과 칸 접기용)
 * 글자(결과 텍스트)에서 다시 찾기 때문에 결과를 직접 고쳐도 따라가요.
 * 주석 · 문자열 안의 IF, END IF 의 IF, CASE 안의 THEN · ELSE 는 무시해요.
 * 짝이 안 맞는 IF(END IF 없음 등)는 결과에 넣지 않아요 — 잘못 접혀서 내용이 사라져 보이지 않게. */
(function (g) {
  'use strict';
  var S = (g.SQLF = g.SQLF || {});

  function ifBlocks(text) {
    text = String(text == null ? '' : text);
    var toks;
    try { toks = S.tokenize(text); } catch (e) { return []; }
    var code = toks.filter(function (t) { return t.k !== 'lcomment' && t.k !== 'bcomment' && t.k !== 'hint'; });
    var cmts = toks.filter(function (t) { return t.k === 'lcomment' || t.k === 'bcomment'; });

    var starts = [0];
    for (var i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
    function lineOf(pos) {
      var lo = 0, hi = starts.length - 1;
      while (lo < hi) { var m = (lo + hi + 1) >> 1; if (starts[m] <= pos) lo = m; else hi = m - 1; }
      return lo;
    }
    function lineEnd(ln) { return ln + 1 < starts.length ? starts[ln + 1] - 1 : text.length; }
    // 주석을 빼고 공백을 하나로 (접힌 줄 요약 · 경로 표시용)
    function flat(a, b) {
      var s = '', p = a;
      cmts.forEach(function (c) { if (c.pos >= a && c.end <= b) { s += text.slice(p, c.pos) + ' '; p = c.end; } });
      s += text.slice(p, b);
      return s.replace(/\s+/g, ' ').trim();
    }
    function W(t) { return t && t.k === 'word' ? t.v.toUpperCase() : ''; }

    var out = [], stack = [];
    function topIf() { var t = stack[stack.length - 1]; return t && t.type === 'IF' ? t : null; }
    function ifDepth() { return stack.filter(function (x) { return x.type === 'IF'; }).length; }
    function newBranch(b, kind, tok) {
      var ln = lineOf(tok.pos);
      var br = { kind: kind, start: ln, pos: tok.pos, hdrEnd: ln, condFrom: tok.end, condTo: tok.end, cond: '' };
      b.branches.push(br);
      return br;
    }
    function closeBranch(b, ln) { var br = b.branches[b.branches.length - 1]; br.bodyEnd = ln - 1; }

    for (var k = 0; k < code.length; k++) {
      var t = code[k], w = W(t);
      if (!w) continue;
      var top = stack[stack.length - 1];
      if (w === 'END') {
        var nx = W(code[k + 1]);
        if (nx === 'IF') {
          while (stack.length && stack[stack.length - 1].type !== 'IF') stack.pop(); // 닫히지 않은 CASE 정리
          var e = stack.pop();
          if (e) {
            var b = e.block;
            b.end = lineOf(t.pos);
            b.endPos = t.pos;
            closeBranch(b, b.end);
            out.push(b);
          }
          k++;
        } else if (nx === 'CASE') {
          if (top && top.type === 'CASE') stack.pop();
          k++;
        } else if (nx === 'LOOP') {
          k++;
        } else if (top && top.type === 'CASE') {
          stack.pop(); // CASE 식의 END
        }
        continue;
      }
      if (w === 'CASE') { stack.push({ type: 'CASE' }); continue; }
      if (w === 'IF') {
        var blk = { start: lineOf(t.pos), pos: t.pos, depth: ifDepth(), branches: [] };
        newBranch(blk, 'IF', t);
        stack.push({ type: 'IF', block: blk, awaiting: true });
        continue;
      }
      var ti = topIf();
      if (!ti) continue;
      var cur = ti.block.branches[ti.block.branches.length - 1];
      if (w === 'THEN' && ti.awaiting) {
        cur.hdrEnd = lineOf(t.pos);
        cur.condTo = t.pos;
        ti.awaiting = false;
      } else if (w === 'ELSIF') {
        closeBranch(ti.block, lineOf(t.pos));
        newBranch(ti.block, 'ELSIF', t);
        ti.awaiting = true;
      } else if (w === 'ELSE') {
        closeBranch(ti.block, lineOf(t.pos));
        newBranch(ti.block, 'ELSE', t);
        ti.awaiting = false;
      }
    }

    out.sort(function (a, b) { return a.pos - b.pos; });
    out.forEach(function (b, n) {
      b.id = n;
      b.firstLineEnd = lineEnd(b.start);
      var h = b.branches[0];
      // 첫 줄 뒤에 이어지는 조건 (여러 줄 조건일 때 접힌 줄에 이어 붙여 보여줘요)
      b.rest = h.hdrEnd > b.start ? flat(b.firstLineEnd, h.condTo + 4) : '';
      b.foldable = b.end > b.start && b.endPos > b.firstLineEnd;
      b.branches.forEach(function (br, i) {
        br.key = n + ':' + i;
        br.cond = br.kind === 'ELSE' ? '' : flat(br.condFrom, br.condTo);
        br.bodyStart = br.hdrEnd + 1;
        br.hdrEndPos = lineEnd(br.hdrEnd);
        br.bodyEndPos = br.bodyEnd >= 0 ? lineEnd(br.bodyEnd) : br.hdrEndPos;
        br.foldable = br.bodyEnd >= br.bodyStart && br.hdrEnd < b.end;
      });
      b.cond = h.cond;
    });
    return out;
  }

  S.ifBlocks = ifBlocks;
})(typeof window !== 'undefined' ? window : globalThis);
