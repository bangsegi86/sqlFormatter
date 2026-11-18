/* 공개 API: format / highlight / (alias.js 에서) analyzeAliases · suggestAliases */
(function (g) {
  'use strict';
  var S = (g.SQLF = g.SQLF || {});

  function normalizeOpts(user) {
    var o = {};
    var k;
    for (k in S.DEFAULTS) o[k] = S.DEFAULTS[k];
    if (user) for (k in user) if (user[k] !== undefined && user[k] !== null) o[k] = user[k];
    o = S.sanitizeOpts(o); // 없어진 선택지(예전 프리셋)를 지금 선택지로 바꿔요
    ['oneline', 'inmax', 'arithmin', 'concatmin', 'plind', 'plcondmin', 'insline', 'tabsize', 'blankmax', 'stmtgap'].forEach(function (key) {
      var n = parseInt(o[key], 10);
      o[key] = isNaN(n) ? S.DEFAULTS[key] : n;
    });
    // 줄 길이 제한 없음 (예전 프리셋에 width 가 남아 있어도 무시해요)
    o.width = Infinity;
    o.perline = String(o.perline);
    return o;
  }

  /* 결과에 남은 탭(주석 · 원문 그대로 둔 부분)을 공백으로 바꿔요.
   * 탭 간격(ts) 기준으로 바꿔서 원래 줄 맞춤을 지키고, 한글 등 넓은 글자는 2칸으로 셉니다.
   * 문자열 값 안의 탭은 데이터라서 그대로 둬요. */
  var WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
  function detab(text, ts) {
    if (text.indexOf('\t') < 0) return text;
    var keep = [];
    S.tokenize(text).forEach(function (t) { if (t.k === 'string' && t.v.indexOf('\t') >= 0) keep.push([t.pos, t.end]); });
    var out = [], col = 0, k = 0;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      while (k < keep.length && keep[k][1] <= i) k++;
      if (ch === '\n') { out.push(ch); col = 0; continue; }
      if (ch === '\t' && !(k < keep.length && keep[k][0] <= i)) {
        var n = ts - (col % ts);
        out.push(new Array(n + 1).join(' '));
        col += n;
        continue;
      }
      out.push(ch);
      col += WIDE.test(ch) ? 2 : 1;
    }
    return out.join('');
  }

  function format(src, userOpts) {
    var o = normalizeOpts(userOpts);
    src = String(src == null ? '' : src);
    var parsed = S.parse(src);
    var warnings = [];
    var errors = [];
    var blocks = [];
    var R = S.render;

    // 원문 그대로 두는 문장 안의 주석은 원문에 이미 들어 있으니 "사용함"으로 표시해요 (맨 아래에 또 붙지 않게)
    function markRaw(st) {
      var a = st.toks[0].pos, b = st.toks[st.toks.length - 1].end;
      parsed.comments.forEach(function (c) { if (c.pos >= a && c.end <= b) c.used = true; });
    }
    // 여러 줄 블록 주석은 원래 줄 모양 그대로
    function cmtLines(c) {
      c.used = true;
      return c.v.split(/\r?\n/).map(function (l) { return l.replace(/\s+$/, ''); });
    }

    parsed.stmts.forEach(function (st, idx) {
      var lines = null;
      var raw = !st.ast;
      if (st.plsql) {
        raw = true;
        if (o.plmode === 'format' && S.plsql) {
          try {
            lines = S.plsql.format(st, src, o, parsed.stats, warnings);
            raw = false;
          } catch (e) {
            var near = e && e.tok ? " '" + e.tok.v + "'" : '';
            var ln = e && e.tok && e.tok.pos != null ? src.slice(0, e.tok.pos).split('\n').length : st.line;
            warnings.push('PL/SQL 블록 구조를 해석하지 못해 원문 그대로 두었어요 — ' + ln + '번째 줄' + near + ': ' + (e && e.message ? e.message : e));
          }
        }
      } else if (st.ast) {
        try {
          if (S.transform) S.transform.apply(parsed, st, idx, o, warnings);
          lines = R.stmt(st.ast, o);
        } catch (e) {
          st.err = { message: '포맷 중 오류: ' + (e && e.message ? e.message : e), line: st.line, near: '' };
          lines = null;
          raw = true;
        }
      }
      if (st.err) errors.push({ message: st.err.message, line: st.err.line, near: st.err.near, stmt: idx + 1 });
      var out = [];
      st.lead.forEach(function (c) { out.push.apply(out, cmtLines(c)); });
      if (raw) {
        markRaw(st);
        out.push.apply(out, st.raw.split(/\r?\n/));
        if (st.slash) out.push('/');
        else if (st.hadSemi) R.app(out, ';');
      } else if (st.plsql) {
        out.push.apply(out, lines);
        if (st.slash || o.term === 'slash') out.push('/');
      } else {
        out.push.apply(out, lines);
        var isLast = idx === parsed.stmts.length - 1;
        if (o.term === 'slash') out.push('/');
        else if (o.term === 'semi' || !isLast) R.app(out, ';');
      }
      if (st.tail.length) out[out.length - 1] += ' ' + st.tail.map(R.cmtLine).join(' ');
      blocks.push(out.join('\n'));
    });

    if (parsed.tail.length) blocks.push(parsed.tail.map(R.cmtLine).join('\n'));
    var lost = parsed.comments.filter(function (c) { return !c.used; });
    if (lost.length) {
      warnings.push('주석 ' + lost.length + '개의 위치를 정하지 못해 맨 아래로 옮겼어요.');
      blocks.push(lost.map(R.cmtLine).join('\n'));
    }

    var text = blocks.join(new Array(o.stmtgap + 2).join('\n'))
      .replace(new RegExp(R.SENT, 'g'), ' ')
      .split('\n').map(function (l) { return l.replace(/\s+$/, ''); }).join('\n');
    text = detab(text, o.tabsize);

    return { text: text, stats: parsed.stats, warnings: warnings, errors: errors, options: o };
  }

  /* 구문 강조용: 원문 공백을 그대로 두고 조각으로 나눠요 */
  function highlight(text) {
    var toks = S.tokenize(text);
    var out = [];
    var pos = 0;
    var K = S.sets;
    toks.forEach(function (t, i) {
      if (t.pos > pos) out.push({ t: text.slice(pos, t.pos), c: '' });
      var c = '';
      var v = t.v;
      if (t.k === 'lcomment' || t.k === 'bcomment') c = 'cm';
      else if (t.k === 'hint') c = 'ht';
      else if (t.k === 'string') c = 'st';
      else if (t.k === 'number') c = 'nu';
      else if (t.k === 'bind') c = 'bd';
      else if (t.k === 'word') {
        var u = v.toUpperCase();
        var next = toks[i + 1];
        var isFn = next && next.k === 'punct' && next.v === '(' && next.pos === t.end;
        if (K.KW[u] || K.CONSTS[u] || (S.plsql && S.plsql.PLKW[u])) c = 'kw';
        else if (isFn && K.FUNCS[u]) c = 'fn';
      } else if (t.k === 'name') {
        var dot = v.indexOf('.');
        if (dot > 0) {
          out.push({ t: v.slice(0, dot), c: 'al' });
          out.push({ t: v.slice(dot), c: '' });
          pos = t.end;
          return;
        }
      } else if (t.k === 'op' && v === '(+)') c = 'oj';
      out.push({ t: v, c: c });
      pos = t.end;
    });
    if (pos < text.length) out.push({ t: text.slice(pos), c: '' });
    return out;
  }

  S.format = format;
  S.highlight = highlight;
  S.normalizeOpts = normalizeOpts;
})(typeof window !== 'undefined' ? window : globalThis);
