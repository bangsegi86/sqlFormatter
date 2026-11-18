/* 편집기: 원본 칸 · 결과 칸 (CodeMirror 6, src/vendor/codemirror.js)
 * - 구문 강조는 엔진의 S.highlight 를 그대로 써요 (결과 칸 색과 같게)
 * - 결과 칸: 엑셀 그룹 같은 IF 접기 막대, 접힌 줄 요약, 커서 줄 음영, 줄 번호
 * - 두 칸 공통: 찾기 · 바꾸기 (Ctrl+F / Ctrl+H) */
(function () {
  'use strict';
  var S = window.SQLF, C = window.CM;
  var prog = C.Annotation.define(); // 프로그램이 바꾼 내용 표시 (사용자 입력과 구분)

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cut(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* ---------- 구문 강조: 문서 전체를 엔진 토크나이저로 나누고, 보이는 범위만 칠해요 ---------- */
  var MARK = {};
  function mark(c) { return MARK[c] || (MARK[c] = C.Decoration.mark({ class: c })); }
  var hlPlugin = C.ViewPlugin.fromClass(class {
    constructor(view) { this.parts = null; this.decorations = this.build(view); }
    update(u) {
      if (u.docChanged) this.parts = null;
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view) {
      if (!this.parts) {
        var parts = [], pos = 0;
        try {
          S.highlight(view.state.doc.toString()).forEach(function (p) {
            if (p.c) parts.push([pos, pos + p.t.length, p.c]);
            pos += p.t.length;
          });
        } catch (e) { parts = []; }
        this.parts = parts;
      }
      var b = new C.RangeSetBuilder(), parts2 = this.parts;
      view.visibleRanges.forEach(function (r) {
        var lo = 0, hi = parts2.length;
        while (lo < hi) { var m = (lo + hi) >> 1; if (parts2[m][1] <= r.from) lo = m + 1; else hi = m; }
        for (var i = lo; i < parts2.length && parts2[i][0] < r.to; i++) {
          var a = Math.max(parts2[i][0], r.from), z = Math.min(parts2[i][1], r.to);
          if (z > a) b.add(a, z, mark(parts2[i][2]));
        }
      });
      return b.finish();
    }
  }, { decorations: function (v) { return v.decorations; } });

  /* ---------- 찾기 표시 (노란 칸) ---------- */
  var setHits = C.StateEffect.define();
  var HIT = C.Decoration.mark({ class: 'cm-hit' }), NOW = C.Decoration.mark({ class: 'cm-hit cm-hitnow' });
  var hitField = C.StateField.define({
    create: function () { return C.Decoration.none; },
    update: function (d, tr) {
      d = d.map(tr.changes);
      tr.effects.forEach(function (e) { if (e.is(setHits)) d = e.value; });
      return d;
    },
    provide: function (f) { return C.EditorView.decorations.from(f); }
  });

  /* ---------- 공통 모양 ---------- */
  var theme = C.EditorView.theme({
    '&': { height: '100%', backgroundColor: 'var(--panel2)', color: '#d5dee8', fontSize: 'var(--code-size)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
    '.cm-content': { padding: '12px 0', caretColor: '#e6edf3' },
    '.cm-line': { padding: '0 16px 0 4px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#e6edf3', borderLeftWidth: '2px' },
    '.cm-selectionBackground': { backgroundColor: 'rgba(110, 168, 254, .18)' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'rgba(110, 168, 254, .32)' },
    '.cm-gutters': { backgroundColor: 'var(--panel2)', border: 'none', color: 'var(--faint)' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 6px', minWidth: '38px' },
    // 커서가 있는 줄: 아주 연한 음영 (결과 칸에 커서가 있을 때만)
    '.cm-activeLine': { backgroundColor: 'rgba(140, 170, 210, .07)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(140, 170, 210, .07)', color: '#c9d4e0' },
    '&:not(.cm-focused) .cm-activeLine, &:not(.cm-focused) .cm-activeLineGutter': { backgroundColor: 'transparent', color: 'inherit' },
    '.cm-placeholder': { color: 'var(--faint)', fontFamily: "'Segoe UI', 'Malgun Gothic', sans-serif" },
    '.cm-foldPlaceholder': { background: 'transparent', border: 'none', padding: '0', margin: '0' }
  }, { dark: true });

  // 기본 단축키에서 앱 단축키와 겹치는 것은 빼요 (Ctrl+Enter = 포맷 실행, Ctrl+[ ] = 접기와 헷갈림)
  var baseKeys = C.defaultKeymap.filter(function (k) { return ['Mod-Enter', 'Mod-[', 'Mod-]'].indexOf(k.key) < 0; });

  // Tab 은 탭 문자 대신 공백 (커서만 있으면 다음 탭 위치까지, 여러 줄이면 한꺼번에 들여쓰기)
  function tabKeys(getTs) {
    return [
      {
        key: 'Tab', run: function (view) {
          var st = view.state, sel = st.selection.main;
          if (st.selection.ranges.length === 1 && st.doc.lineAt(sel.from).number === st.doc.lineAt(sel.to).number) {
            var ts = getTs(), line = st.doc.lineAt(sel.from), col = sel.from - line.from;
            var n = ts - (col % ts);
            view.dispatch(st.update(st.replaceSelection(new Array(n + 1).join(' ')), { scrollIntoView: true, userEvent: 'input' }));
            return true;
          }
          return C.indentMore(view);
        }
      },
      { key: 'Shift-Tab', run: C.indentLess }
    ];
  }

  function baseExt(o) {
    return [
      C.history(),
      C.drawSelection(),
      hlPlugin,
      hitField,
      theme,
      C.EditorState.tabSize.of(o.tabSize()),
      C.indentUnit.of(new Array(o.tabSize() + 1).join(' ')),
      C.placeholder(o.placeholder || ''),
      C.keymap.of(tabKeys(o.tabSize).concat(C.historyKeymap, baseKeys)),
      C.EditorView.contentAttributes.of({ 'aria-label': o.label || '', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' })
    ];
  }

  /* =====================================================================
   * 원본 칸
   * ===================================================================== */
  function createSource(parent, o) {
    var view = new C.EditorView({
      parent: parent,
      state: C.EditorState.create({
        doc: '',
        extensions: [
          baseExt(o),
          C.EditorView.lineWrapping,
          C.EditorView.updateListener.of(function (u) {
            if (!u.docChanged) return;
            if (u.transactions.some(function (tr) { return tr.annotation(prog); })) return;
            var paste = u.transactions.some(function (tr) { return tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop'); });
            o.onChange(paste);
          })
        ]
      })
    });
    return {
      view: view,
      get value() { return view.state.doc.toString(); },
      set value(v) {
        // 프로그램이 넣는 내용도 Ctrl+Z 로 되돌릴 수 있게 기록해요
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: String(v) }, selection: { anchor: 0 }, annotations: prog.of(true), scrollIntoView: true });
      },
      focus: function () { view.focus(); }
    };
  }

  /* =====================================================================
   * 결과 칸: IF 구조 · 접기 · 그룹 막대
   * ===================================================================== */
  var structField = C.StateField.define({
    create: function (st) { return buildStruct(st.doc); },
    update: function (v, tr) { return tr.docChanged ? buildStruct(tr.state.doc) : v; }
  });
  function buildStruct(doc) {
    var blocks = (S.ifBlocks ? S.ifBlocks(doc.toString()) : []).filter(function (b) { return b.foldable; });
    var chain = {}, levels = 0, byStart = {};
    blocks.forEach(function (b, i) {
      b.id = i;
      levels = Math.max(levels, b.depth + 1);
      byStart[b.start] = b;
      for (var l = b.start; l <= b.end; l++) (chain[l] || (chain[l] = []))[b.depth] = b;
    });
    var brAt = {};
    blocks.forEach(function (b) { b.branches.forEach(function (br) { if (br.kind !== 'IF') brAt[br.start] = br; br.block = b; }); });
    return { blocks: blocks, chain: chain, levels: Math.min(levels, 9), byStart: byStart, brAt: brAt };
  }
  function wholeRange(b) { return { from: b.firstLineEnd, to: b.endPos }; }
  function brRange(br) { return { from: br.hdrEndPos, to: br.bodyEndPos }; }
  function hasFold(st, r) {
    var f = false;
    C.foldedRanges(st).between(r.from, r.from, function (a, z) { if (a === r.from && z === r.to) f = true; });
    return f;
  }
  function innerCount(st, from, to, depth) {
    return st.field(structField).blocks.filter(function (x) { return x.pos > from && x.endPos < to && (depth == null || x.depth === depth); }).length;
  }

  // 마우스를 올린 그룹 (괄호 선 · 상자) — 그 IF 범위를 연하게 칠해요
  var setHover = C.StateEffect.define();
  var GRP = C.Decoration.line({ class: 'cm-grp' });
  var hoverField = C.StateField.define({
    create: function () { return { id: null, deco: C.Decoration.none }; },
    update: function (v, tr) {
      var nv = v;
      tr.effects.forEach(function (e) {
        if (!e.is(setHover)) return;
        var b = e.value == null ? null : tr.state.field(structField).blocks[e.value];
        if (!b) { nv = { id: null, deco: C.Decoration.none }; return; }
        var r = [];
        for (var l = b.start; l <= b.end && l < tr.state.doc.lines; l++) r.push(GRP.range(tr.state.doc.line(l + 1).from));
        nv = { id: e.value, deco: C.Decoration.set(r) };
      });
      if (tr.docChanged && nv === v && v.id != null) nv = { id: null, deco: C.Decoration.none };
      return nv;
    },
    provide: function (f) { return C.EditorView.decorations.from(f, function (v) { return v.deco; }); }
  });

  class OlMarker extends C.GutterMarker {
    constructor(html) { super(); this.html = html; }
    eq(o) { return o.html === this.html; }
    toDOM() { var d = document.createElement('div'); d.className = 'ol'; d.innerHTML = this.html; return d; }
  }
  function olHtml(st, ln) {
    var s = st.field(structField), hov = st.field(hoverField).id, cells = '';
    var ch = s.chain[ln] || [];
    for (var d = 0; d < s.levels; d++) {
      var b = ch[d];
      if (!b) { cells += '<span class="oc"></span>'; continue; }
      var cls = 'oc' + (hov === b.id ? ' hov' : ''), at = ' data-blk="' + b.id + '"';
      if (b.start === ln) {
        var whole = hasFold(st, wholeRange(b));
        cells += '<span class="' + cls + (whole ? '' : ' s') + '"' + at + '><span class="bx' + (whole ? ' plus' : '') + '" data-tg="' + ln + '" title="' +
          (whole ? '펼치기' : b.branches.length > 1 ? '누를 때마다: 조건 줄만 보기 → 통째로 접기' : '접기') + ' (' + (b.start + 1) + '~' + (b.end + 1) + '번째 줄)">' + (whole ? '+' : '−') + '</span></span>';
      } else if (b.end === ln) {
        cells += '<span class="' + cls + ' e"' + at + '></span>';
      } else {
        var br = s.brAt[ln], box = '';
        if (br && br.block === b && br.foldable) {
          var f = hasFold(st, brRange(br));
          box = '<span class="bx br' + (f ? ' plus' : '') + '" data-tg="' + ln + '" title="' + br.kind + ' 가지만 ' + (f ? '펼치기' : '접기') + '">' + (f ? '+' : '−') + '</span>';
        }
        cells += '<span class="' + cls + ' l"' + at + '>' + box + '</span>';
      }
    }
    return cells;
  }
  function foldChanged(u) { return u.startState.field(C.foldState, false) !== u.state.field(C.foldState, false); }
  function hoverChanged(u) { return u.startState.field(hoverField).id !== u.state.field(hoverField).id; }
  function lineNo(view, blockInfo) { return view.state.doc.lineAt(blockInfo.from).number - 1; }

  var outlineGutter = C.gutter({
    class: 'cm-outline',
    lineMarker: function (view, line) {
      if (!view.state.field(structField).levels) return null;
      return new OlMarker(olHtml(view.state, lineNo(view, line)));
    },
    lineMarkerChange: function (u) { return u.docChanged || foldChanged(u) || hoverChanged(u); },
    domEventHandlers: {
      mousedown: function (view, line, e) {
        var t = e.target.closest && e.target.closest('[data-tg]');
        if (!t) return false;
        toggleAt(view, +t.getAttribute('data-tg'));
        e.preventDefault();
        return true;
      },
      mouseover: function (view, line, e) {
        var c = e.target.closest && e.target.closest('[data-blk]');
        var id = c ? +c.getAttribute('data-blk') : null;
        if (id !== view.state.field(hoverField).id) view.dispatch({ effects: setHover.of(id) });
        return false;
      }
    }
  });

  // IF 상자: 가지가 여럿이면 펼침 → 조건 줄만(개요) → 통째로 접힘 → 펼침, 하나면 접힘 ↔ 펼침
  //          ELSIF · ELSE 상자: 그 가지만 접기 ↔ 펼치기
  function toggleAt(view, ln) {
    var st = view.state, s = st.field(structField), fx = [];
    var b = s.byStart[ln];
    if (b) {
      var wr = wholeRange(b), brs = b.branches.filter(function (x) { return x.foldable; });
      if (hasFold(st, wr)) {
        fx.push(C.unfoldEffect.of(wr));
        brs.forEach(function (x) { if (hasFold(st, brRange(x))) fx.push(C.unfoldEffect.of(brRange(x))); });
      } else if (b.branches.length < 2 || !brs.length || brs.every(function (x) { return hasFold(st, brRange(x)); })) {
        brs.forEach(function (x) { if (hasFold(st, brRange(x))) fx.push(C.unfoldEffect.of(brRange(x))); });
        fx.push(C.foldEffect.of(wr));
      } else {
        brs.forEach(function (x) { if (!hasFold(st, brRange(x))) fx.push(C.foldEffect.of(brRange(x))); });
      }
    } else {
      var br = s.brAt[ln];
      if (!br || !br.foldable) return false;
      var r = brRange(br);
      fx.push(hasFold(st, r) ? C.unfoldEffect.of(r) : C.foldEffect.of(r));
    }
    if (fx.length) view.dispatch({ effects: fx });
    return true;
  }
  function innermost(view) {
    var st = view.state, ln = st.doc.lineAt(st.selection.main.head).number - 1;
    var ch = st.field(structField).chain[ln] || [];
    return ch.filter(Boolean);
  }
  function foldHere(view) {
    var ch = innermost(view), st = view.state;
    for (var i = ch.length - 1; i >= 0; i--) if (!hasFold(st, wholeRange(ch[i]))) { view.dispatch({ effects: C.foldEffect.of(wholeRange(ch[i])) }); return true; }
    return false;
  }
  function unfoldHere(view) {
    var st = view.state, line = st.doc.lineAt(st.selection.main.head), fx = [];
    C.foldedRanges(st).between(line.from, line.to, function (a, z) { fx.push(C.unfoldEffect.of({ from: a, to: z })); });
    if (fx.length) { view.dispatch({ effects: fx }); return true; }
    return false;
  }
  function unfoldAllFx(st) {
    var fx = [];
    C.foldedRanges(st).between(0, st.doc.length, function (a, z) { fx.push(C.unfoldEffect.of({ from: a, to: z })); });
    return fx;
  }
  // 엑셀 단계 번호: n 단계 이상 깊이의 IF 를 통째로 접어요 (1 = 전체 접기, 마지막 = 전체 펼치기)
  function setLevel(view, n) {
    var st = view.state, fx = unfoldAllFx(st);
    st.field(structField).blocks.forEach(function (b) { if (b.depth >= n - 1) fx.push(C.foldEffect.of(wholeRange(b))); });
    view.dispatch({ effects: fx });
  }

  // 접힌 자리에 보여줄 요약
  function prepare(st, r) {
    var s = st.field(structField);
    for (var i = 0; i < s.blocks.length; i++) {
      var b = s.blocks[i];
      if (b.firstLineEnd === r.from && b.endPos === r.to) {
        var el = b.branches.filter(function (x) { return x.kind === 'ELSIF'; }).length;
        var parts = [(b.end - b.start - 1) + '줄'];
        if (el) parts.push('ELSIF ' + el);
        if (b.branches.some(function (x) { return x.kind === 'ELSE'; })) parts.push('ELSE');
        var inn = innerCount(st, b.pos, b.endPos);
        if (inn) parts.push('안쪽 IF ' + inn);
        return { rest: b.rest, label: '⋯ ' + parts.join(' · '), title: 'IF ' + b.cond + ' THEN … END IF  (' + (b.start + 1) + '~' + (b.end + 1) + '번째 줄 · 눌러서 펼치기)' };
      }
      for (var k = 0; k < b.branches.length; k++) {
        var br = b.branches[k];
        if (br.hdrEndPos === r.from && br.bodyEndPos === r.to) {
          var inn2 = innerCount(st, r.from, r.to, b.depth + 1);
          return { rest: '', label: '⋯ ' + (br.bodyEnd - br.bodyStart + 1) + '줄' + (inn2 ? ' · 안쪽 IF ' + inn2 : ''), title: br.kind + (br.cond ? ' ' + br.cond : '') + ' 가지 (눌러서 펼치기)' };
        }
      }
    }
    return { rest: '', label: '⋯', title: '눌러서 펼치기' };
  }
  function placeholderDOM(view, onclick, info) {
    info = info || { rest: '', label: '⋯', title: '' };
    var w = document.createElement('span');
    w.className = 'cm-foldwrap';
    w.title = info.title;
    if (info.rest) {
      var r = document.createElement('span');
      r.className = 'cm-foldrest';
      r.textContent = ' ' + cut(info.rest, 70);
      w.appendChild(r);
    }
    var c = document.createElement('span');
    c.className = 'cm-foldchip';
    c.textContent = info.label;
    c.onclick = onclick;
    w.appendChild(c);
    return w;
  }

  // 지금 커서가 어느 IF 의 어느 가지 안인지 (위쪽 경로 표시줄)
  function crumbs(view) {
    var st = view.state, ln = st.doc.lineAt(st.selection.main.head).number - 1;
    var ch = (st.field(structField).chain[ln] || []).filter(Boolean);
    return ch.map(function (b) {
      var cur = b.branches[0];
      b.branches.forEach(function (x) { if (x.start <= ln) cur = x; });
      var lab = cur.kind === 'ELSE' ? 'ELSE' : cur.kind + ' ' + cut(cur.cond, 28);
      return { label: lab, line: cur.start, title: (cur.kind === 'ELSE' ? 'ELSE' : cur.kind + ' ' + cur.cond) + ' (' + (cur.start + 1) + '번째 줄로)' };
    });
  }
  function gotoLine(view, ln) {
    var line = view.state.doc.line(Math.min(ln + 1, view.state.doc.lines));
    var pos = line.from + (line.text.length - line.text.replace(/^\s+/, '').length);
    view.dispatch({ selection: { anchor: pos }, effects: C.EditorView.scrollIntoView(pos, { y: 'center' }) });
    view.focus();
  }

  // 옵션을 바꿔 다시 정리해도 접힌 상태를 유지하려고 n번째 IF 기준으로 기억해요
  function foldMemo(view) {
    var st = view.state, m = { whole: [], br: [] };
    st.field(structField).blocks.forEach(function (b, i) {
      if (hasFold(st, wholeRange(b))) m.whole.push(i);
      b.branches.forEach(function (x, k) { if (x.foldable && hasFold(st, brRange(x))) m.br.push(i + ':' + k); });
    });
    return m;
  }
  function applyMemo(view, m) {
    if (!m || (!m.whole.length && !m.br.length)) return;
    var fx = [];
    view.state.field(structField).blocks.forEach(function (b, i) {
      if (m.whole.indexOf(i) >= 0) fx.push(C.foldEffect.of(wholeRange(b)));
      b.branches.forEach(function (x, k) { if (x.foldable && m.br.indexOf(i + ':' + k) >= 0) fx.push(C.foldEffect.of(brRange(x))); });
    });
    if (fx.length) view.dispatch({ effects: fx });
  }

  function createResult(parent, o) {
    var ext = [
      baseExt(o),
      structField,
      hoverField,
      C.codeFolding({ preparePlaceholder: prepare, placeholderDOM: placeholderDOM }),
      outlineGutter,
      C.lineNumbers(),
      C.highlightActiveLine(),
      C.highlightActiveLineGutter(),
      C.keymap.of([
        { key: 'Mod-Shift-[', run: foldHere },
        { key: 'Mod-Shift-]', run: unfoldHere }
      ]),
      C.EditorView.updateListener.of(function (u) {
        if (u.docChanged && !u.transactions.some(function (tr) { return tr.annotation(prog); })) o.onEdit();
        if (u.docChanged || u.selectionSet || u.focusChanged || foldChanged(u)) o.onCursor();
      })
    ];
    var view = new C.EditorView({ parent: parent, state: C.EditorState.create({ doc: '', extensions: ext }) });
    view.dom.addEventListener('mouseleave', function () { if (view.state.field(hoverField).id != null) view.dispatch({ effects: setHover.of(null) }); });
    return {
      view: view,
      get value() { return view.state.doc.toString(); },
      // 새 결과로 바꿔요 (되돌리기 기록 · 접힘은 새로 시작)
      setText: function (t, memo) {
        view.setState(C.EditorState.create({ doc: String(t), extensions: ext }));
        applyMemo(view, memo);
        o.onCursor();
      },
      foldMemo: function () { return foldMemo(view); },
      levels: function () { return view.state.field(structField).levels; },
      ifCount: function () { return view.state.field(structField).blocks.length; },
      setLevel: function (n) { setLevel(view, n); },
      unfoldAll: function () { view.dispatch({ effects: unfoldAllFx(view.state) }); },
      foldHere: function () { return foldHere(view); },
      unfoldHere: function () { return unfoldHere(view); },
      crumbs: function () { return crumbs(view); },
      gotoLine: function (ln) { gotoLine(view, ln); },
      focus: function () { view.focus(); }
    };
  }

  /* =====================================================================
   * 찾기 · 바꾸기 (원본 · 결과 칸 공통, 막대 하나를 누른 칸으로 옮겨 써요)
   * ===================================================================== */
  function createFind(o) {
    var bar = o.bar, q = o.q, r = o.r, cnt = o.cnt;
    var st = { target: null, cs: false, word: false, hits: [], cur: -1, timer: 0 };
    var MAXH = 20000;

    function regex() {
      if (!q.value) return null;
      var p = q.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (st.word) p = '(?<![\\w$#ㄱ-ㆎ가-힣])' + p + '(?![\\w$#ㄱ-ㆎ가-힣])';
      return new RegExp(p, st.cs ? 'g' : 'gi');
    }
    function scan(keepNear) {
      var t = st.target; if (!t) return;
      var view = t.view, text = view.state.doc.toString(), re = regex(), hits = [], m;
      if (re) while ((m = re.exec(text)) && hits.length < MAXH) { if (!m[0].length) { re.lastIndex++; continue; } hits.push({ from: m.index, to: m.index + m[0].length }); }
      st.hits = hits;
      if (keepNear != null) {
        st.cur = -1;
        for (var i = 0; i < hits.length; i++) if (hits[i].from >= keepNear) { st.cur = i; break; }
        if (st.cur < 0 && hits.length) st.cur = 0;
      } else if (st.cur >= hits.length) st.cur = hits.length ? 0 : -1;
      paint();
    }
    function paint() {
      var t = st.target; if (!t) return;
      var ds = st.hits.map(function (h, i) { return (i === st.cur ? NOW : HIT).range(h.from, h.to); });
      t.view.dispatch({ effects: setHits.of(C.Decoration.set(ds, true)) });
      cnt.classList.toggle('none', !!q.value && !st.hits.length);
      cnt.textContent = !q.value ? '' : !st.hits.length ? '결과 없음' : (st.cur >= 0 ? (st.cur + 1) + ' / ' : '') + st.hits.length + (st.hits.length >= MAXH ? '+' : '') + '개';
    }
    function show(i, focusEditor) {
      var t = st.target, h = st.hits[i]; if (!t || !h) return;
      st.cur = i;
      // 선택을 옮기면 접힌 곳 안의 결과는 편집기가 알아서 펼쳐요
      t.view.dispatch({ selection: { anchor: h.from, head: h.to }, effects: C.EditorView.scrollIntoView(h.from, { y: 'center' }) });
      paint();
      if (focusEditor) t.view.focus();
    }
    function step(d) {
      if (!st.target) return;
      if (!st.hits.length) scan(st.target.view.state.selection.main.from);
      if (!st.hits.length) return;
      var n = st.cur < 0 ? (d > 0 ? 0 : st.hits.length - 1) : (st.cur + d + st.hits.length) % st.hits.length;
      show(n);
    }
    function replaceOne() {
      var t = st.target; if (!t || !st.hits.length) return;
      if (st.cur < 0) { step(1); return; }
      var h = st.hits[st.cur], from = h.from;
      t.view.dispatch({ changes: { from: h.from, to: h.to, insert: r.value }, userEvent: 'input.replace' });
      scan(from + r.value.length);
      if (st.hits.length) show(st.cur);
    }
    function replaceAll() {
      var t = st.target; if (!t || !st.hits.length) return;
      var n = st.hits.length;
      // 한 번에 바꿔서 Ctrl+Z 한 번으로 되돌려요
      t.view.dispatch({ changes: st.hits.map(function (h) { return { from: h.from, to: h.to, insert: r.value }; }), userEvent: 'input.replace.all' });
      scan(0);
      o.onReplaced(n, t);
    }
    function open(target, withReplace) {
      if (st.target && st.target !== target) clearHits(st.target);
      st.target = target;
      target.wrap.appendChild(bar);
      bar.hidden = false;
      if (withReplace) setRep(true);
      var view = target.view, sel = view.state.selection.main;
      var picked = view.state.sliceDoc(sel.from, sel.to);
      if (picked && picked.indexOf('\n') < 0 && picked.length < 200) q.value = picked;
      scan(sel.from);
      (withReplace && q.value ? r : q).focus();
      (withReplace && q.value ? r : q).select();
    }
    function clearHits(t) { t.view.dispatch({ effects: setHits.of(C.Decoration.none) }); }
    function close() {
      if (bar.hidden) return false;
      bar.hidden = true;
      if (st.target) { clearHits(st.target); st.target.view.focus(); }
      st.hits = []; st.cur = -1;
      return true;
    }
    function setRep(on) {
      o.repRow.hidden = !on;
      o.repToggle.setAttribute('aria-expanded', String(on));
      o.repToggle.textContent = on ? '▾' : '▸';
    }
    // 편집하는 동안 결과 표시를 따라가게
    function docChanged(target) {
      if (bar.hidden || st.target !== target) return;
      clearTimeout(st.timer);
      st.timer = setTimeout(function () { scan(target.view.state.selection.main.from); }, 120);
    }
    function retarget(target) { if (!bar.hidden && st.target !== target) { if (st.target) clearHits(st.target); st.target = target; target.wrap.appendChild(bar); scan(target.view.state.selection.main.from); } }

    q.addEventListener('input', function () { scan(st.target ? st.target.view.state.selection.main.from : 0); if (st.cur >= 0) show(st.cur); });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    r.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey || e.metaKey) replaceAll(); else replaceOne(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    });
    o.prev.addEventListener('click', function () { step(-1); });
    o.next.addEventListener('click', function () { step(1); });
    o.caseBtn.addEventListener('click', function () { st.cs = !st.cs; o.caseBtn.setAttribute('aria-pressed', String(st.cs)); scan(st.target ? st.target.view.state.selection.main.from : 0); });
    o.wordBtn.addEventListener('click', function () { st.word = !st.word; o.wordBtn.setAttribute('aria-pressed', String(st.word)); scan(st.target ? st.target.view.state.selection.main.from : 0); });
    o.repBtn.addEventListener('click', replaceOne);
    o.repAllBtn.addEventListener('click', replaceAll);
    o.repToggle.addEventListener('click', function () { setRep(o.repRow.hidden); });
    o.closeBtn.addEventListener('click', close);

    return { open: open, close: close, step: step, docChanged: docChanged, retarget: retarget, isOpen: function () { return !bar.hidden; }, target: function () { return st.target; } };
  }

  window.SQLEditor = { createSource: createSource, createResult: createResult, createFind: createFind };
})();
