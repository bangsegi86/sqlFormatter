/* 결과 칸 "구조 · 설명" 화면
 * - 왼쪽 설명 칸: 덩어리마다 한 줄짜리 카드(설명 입력)를 그 덩어리 첫 줄 옆에 붙여요. 긴 덩어리를 지나는 동안엔 위에 고정돼요.
 * - 입력한 설명은 코드 칸에 흐린 미리보기 줄로 보이고, [주석으로 넣기]를 누르면 실제 주석이 돼요 (Ctrl+Z 로 되돌림).
 * - 카드의 ⠿ 를 끌거나 ↑↓ / Alt+↑↓ 로 같은 단계 안에서 덩어리를 옮겨요.
 * - 오른쪽 지도: 설명 있음 · 입력함 · 없음을 한눈에, 누르면 그 위치로. F8 = 설명 없는 다음 덩어리.
 * 덩어리 찾기 · 주석 만들기 · 옮기기 계산은 엔진(src/engine/blocks.js)이 해요. */
(function () {
  'use strict';
  var S = window.SQLF, C = window.CM, BN = S.blockNotes;

  var enabled = false;   // 구조 · 설명 화면이 켜져 있는지
  var pending = {};      // 덩어리 key → 아직 주석으로 넣지 않은 설명
  var fmt = 'dash';      // 주석 모양: dash(-- [1] 설명) · block(/* [1] 설명 */) · plain(-- 설명)
  var ui = null;

  var setRefresh = C.StateEffect.define();
  var setHl = C.StateEffect.define();

  // 덩어리 종류 표시(LOOP · BLOCK …)에 마우스를 올리면 나오는 뜻
  var KIND_TIP = {
    UNIT: '전체 — 프로시저 · 함수 · 패키지 자체',
    PROC: 'PROC — 패키지 안의 프로시저 · 함수 하나',
    DECL: 'DECL — 선언부 (변수 · 커서 · 타입 선언 묶음)',
    BLOCK: 'BLOCK — 안쪽 BEGIN ~ END 또는 DECLARE ~ END 블록',
    IF: 'IF — IF ~ END IF 조건 분기 전체',
    CASE: 'CASE — CASE ~ END CASE 분기 전체',
    LOOP: 'LOOP — 반복문 전체 (FOR · WHILE · LOOP ~ END LOOP)',
    DDL: 'DDL — 객체 생성 · 변경 문장 (CREATE TABLE · INDEX · VIEW, ALTER, COMMENT ON, GRANT, DROP …)',
    SQL: 'SQL — SQL 문장 하나 (SELECT INTO · INSERT · UPDATE · DELETE · MERGE · OPEN … FOR)',
    CURSOR: 'CURSOR — 커서 명령 (OPEN · FETCH · CLOSE)',
    SET: 'SET — 대입문 (:=). 빈 줄 없이 붙은 대입문은 한 덩어리로 묶어요',
    CALL: 'CALL — 프로시저 호출',
    TX: 'TX — 트랜잭션 (COMMIT · ROLLBACK · SAVEPOINT)',
    CTRL: 'CTRL — 흐름 제어 (RETURN · EXIT · RAISE · NULL)',
    EXC: 'EXC — EXCEPTION (오류 처리) 부분'
  };
  function cut(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function descOf(b) { return Object.prototype.hasOwnProperty.call(pending, b.key) ? pending[b.key] : (b.saved || ''); }
  function isPending(b) { return Object.prototype.hasOwnProperty.call(pending, b.key) && pending[b.key].trim() !== (b.saved || ''); }
  function stateOf(b) { return isPending(b) ? 'pend' : b.saved ? 'has' : 'none'; }

  /* ---------- 코드 칸: 미리보기 줄 · 강조 ---------- */
  class Ghost extends C.WidgetType {
    constructor(text) { super(); this.text = text; }
    eq(o) { return o.text === this.text; }
    toDOM() { var d = document.createElement('div'); d.className = 'cm-ghostnote'; d.textContent = this.text; d.title = '아직 주석으로 넣지 않은 설명 (미리보기)'; return d; }
    ignoreEvent() { return true; }
  }
  var OLD = C.Decoration.line({ class: 'cm-oldnote' });
  var HL = C.Decoration.line({ class: 'cm-grp' });

  function ghosts(st, info) {
    if (!info) return C.Decoration.none;
    var r = [], doc = st.doc;
    info.flat.forEach(function (b) {
      if (!isPending(b)) return;
      var d = pending[b.key].trim(), line = doc.line(b.start + 1);
      var ind = line.text.match(/^\s*/)[0];
      if (d) r.push(C.Decoration.widget({ widget: new Ghost(ind + BN.line(fmt, fmt === 'plain' ? '' : b.num, d)), block: true, side: -1 }).range(line.from));
      if (b.savedLine >= 0) r.push(OLD.range(doc.line(b.savedLine + 1).from));
    });
    return C.Decoration.set(r, true);
  }
  function hlDeco(st, info, key) {
    if (!info || !key) return C.Decoration.none;
    var b = info.flat.filter(function (x) { return x.key === key; })[0];
    if (!b) return C.Decoration.none;
    var r = [];
    for (var l = b.lead; l <= b.end && l < st.doc.lines; l++) r.push(HL.range(st.doc.line(l + 1).from));
    return C.Decoration.set(r);
  }
  var field = C.StateField.define({
    create: function (st) {
      var info = enabled ? S.codeBlocks(st.doc.toString()) : null;
      return { info: info, deco: ghosts(st, info), hl: null, hlDeco: C.Decoration.none };
    },
    update: function (v, tr) {
      var info = v.info, deco = v.deco, hl = v.hl, refresh = false;
      tr.effects.forEach(function (e) { if (e.is(setRefresh)) refresh = true; if (e.is(setHl)) hl = e.value; });
      if (!enabled) return info ? { info: null, deco: C.Decoration.none, hl: null, hlDeco: C.Decoration.none } : v;
      if (tr.docChanged || !info) { info = S.codeBlocks(tr.state.doc.toString()); deco = ghosts(tr.state, info); }
      else if (refresh) deco = ghosts(tr.state, info);
      var hd = hl === v.hl && info === v.info ? v.hlDeco : hlDeco(tr.state, info, hl);
      return { info: info, deco: deco, hl: hl, hlDeco: hd };
    },
    provide: function (f) {
      return [C.EditorView.decorations.from(f, function (v) { return v.deco; }), C.EditorView.decorations.from(f, function (v) { return v.hlDeco; })];
    }
  });
  var extension = [field, C.EditorView.updateListener.of(function (u) { if (ui) ui.onUpdate(u); })];

  /* =====================================================================
   * 설명 칸 · 지도 · 도구 막대
   * ===================================================================== */
  function attach(out, el, o) {
    var view = function () { return out.view; };
    var cards = {};          // key → 카드 DOM
    var raf = 0, mapDirty = true, wantFocus = null, foldOn = false, drag = null, maxLv = o.level || 0; // maxLv: 보여줄 카드 단계 (0 = 전체)
    var undoCmd = (C.historyKeymap.filter(function (k) { return k.key === 'Mod-z'; })[0] || {}).run;

    function info() { var f = view().state.field(field, false); return f && f.info; }
    function find(key) { var i = info(); return i ? i.flat.filter(function (b) { return b.key === key; })[0] : null; }
    function lineTop(ln) { var v = view(); return v.lineBlockAt(v.state.doc.line(Math.min(ln + 1, v.state.doc.lines)).from).top; }
    function lineBottom(ln) { var v = view(); return v.lineBlockAt(v.state.doc.line(Math.min(ln + 1, v.state.doc.lines)).from).bottom; }
    // 카드가 붙어 있는 범위: 안쪽 덩어리 카드가 보이면 그 앞까지, 안 보이면 덩어리 끝까지
    function segEnd(b) { var i = info(); return b.kids.length && shown(b.kids[0], i) ? Math.max(b.start, b.kids[0].lead - 1) : b.end; }
    function shown(b, i) { return !maxLv || depthOf(b, i) < maxLv; }
    function hidden(b) {
      var v = view(), pos = v.state.doc.line(b.start + 1).from, h = false;
      C.foldedRanges(v.state).between(pos, pos, function (a, z) { if (a < pos && z >= pos) h = true; });
      return h;
    }
    function depthOf(b, i) { return Math.max(0, b.depth - (i.single && b.parent ? 1 : 0)); }

    function schedule(map) { if (map) mapDirty = true; if (!raf) raf = requestAnimationFrame(render); }

    /* ---------- 카드 ---------- */
    function card(b) {
      var c = cards[b.key];
      if (!c) {
        c = document.createElement('div');
        c.className = 'nc';
        c.dataset.key = b.key;
        c.innerHTML = '<span class="nh" title="끌어서 옮기기 (같은 단계 안에서) · Alt+↑↓">⠿</span><span class="nk"></span><span class="nn"></span>' +
          '<input class="ni" type="text" spellcheck="false" autocomplete="off">' +
          '<span class="nm"><button type="button" class="nb" data-mv="-1" title="위로 (Alt+↑)" aria-label="위로">↑</button><button type="button" class="nb" data-mv="1" title="아래로 (Alt+↓)" aria-label="아래로">↓</button></span>';
        el.col.appendChild(c);
        cards[b.key] = c;
      }
      return c;
    }
    function fill(c, b, i) {
      var inp = c.querySelector('.ni'), d = descOf(b), mv = BN.canMove(i, b), st = stateOf(b);
      c.className = 'nc ' + st + (mv ? '' : ' fixed') + (b.kind === 'UNIT' ? ' unit' : '');
      c.style.paddingLeft = (4 + Math.min(depthOf(b, i), 8) * 10) + 'px';
      c.querySelector('.nk').textContent = b.kind === 'UNIT' ? '전체' : b.kind;
      c.querySelector('.nk').className = 'nk k-' + b.kind;
      c.querySelector('.nk').title = (KIND_TIP[b.kind] || b.kind) + '\n누르면 그 줄로 가요';
      c.querySelector('.nn').title = (b.num ? b.num + '번' : '전체') + ' · 점(.) 하나마다 한 단계 안쪽이에요 (6.1 = 6번 안의 첫째)';
      c.querySelector('.nn').textContent = b.num;
      c.querySelector('.nh').style.visibility = mv ? '' : 'hidden';
      c.querySelector('.nm').style.display = mv ? '' : 'none';
      if (document.activeElement !== inp && inp.value !== d) inp.value = d;
      inp.placeholder = b.kind === 'UNIT' ? '프로시저 전체 설명' : '설명 입력 · ' + (b.end - b.start + 1) + '줄';
      inp.title = (d ? d + '\n' : '') + (b.num ? b.num + ' · ' : '') + b.label + ' · ' + (b.start + 1) + '~' + (b.end + 1) + '번째 줄';
      inp.setAttribute('aria-label', (b.num || '전체') + '번 덩어리 설명');
    }

    function render() {
      raf = 0;
      if (!enabled) return;
      var v = view(), i = info();
      var used = {};
      if (i && i.flat.length) {
        var cr = el.col.getBoundingClientRect(), visTop = cr.top - v.documentTop, visBot = visTop + cr.height;
        var lh = v.defaultLineHeight;
        el.col.style.setProperty('--nlh', lh + 'px');
        var focusKey = document.activeElement && el.col.contains(document.activeElement) ? (document.activeElement.closest('.nc') || {}).dataset : null;
        focusKey = focusKey ? focusKey.key : null;
        var rows = [];
        i.flat.forEach(function (b) {
          if (!shown(b, i)) return;
          var top = lineTop(b.lead), bot = lineBottom(segEnd(b));
          var vis = bot > visTop && top < visBot && !hidden(b);
          if (!vis && b.key !== focusKey && b.key !== wantFocus) return;
          var c = card(b);
          fill(c, b, i);
          rows.push({ c: c, vis: vis, y: Math.max(top, Math.min(visTop, bot - lh)) });
          used[b.key] = 1;
        });
        // 카드끼리 겹치지 않게: 앞 카드 바로 아래보다 위로 오면 한 줄 내려요
        var prev = -1e9;
        rows.forEach(function (r) {
          if (!r.vis) { r.c.style.visibility = 'hidden'; return; }
          var y = Math.max(r.y, prev + lh);
          prev = y;
          r.c.style.transform = 'translateY(' + Math.round(y - visTop) + 'px)';
          r.c.style.visibility = '';
        });
      }
      Object.keys(cards).forEach(function (k) { if (!used[k]) { cards[k].remove(); delete cards[k]; } });
      if (wantFocus && cards[wantFocus]) { var inp = cards[wantFocus].querySelector('.ni'); inp.focus({ preventScroll: true }); inp.select(); wantFocus = null; }
      if (mapDirty) drawMap();
      thumb();
      drawBar();
      if (o.onScroll) o.onScroll();
    }

    /* ---------- 지도 ---------- */
    function drawMap() {
      mapDirty = false;
      var v = view(), i = info(), H = el.map.clientHeight, total = Math.max(1, v.contentHeight), html = [];
      if (i) i.flat.forEach(function (b) {
        if (hidden(b) || !shown(b, i)) return;
        var t = lineTop(b.lead), e = lineBottom(segEnd(b));
        html.push('<i class="' + stateOf(b) + '" data-k="' + encodeURIComponent(b.key) + '" style="top:' + (t / total * H).toFixed(1) + 'px;height:' + Math.max(2, (e - t) / total * H - 1).toFixed(1) + 'px;left:' + (3 + Math.min(depthOf(b, i), 3) * 2) + 'px"></i>');
      });
      el.map.innerHTML = html.join('') + '<b class="nthumb"></b>';
    }
    function thumb() {
      var t = el.map.querySelector('.nthumb'); if (!t) return;
      var sd = view().scrollDOM, H = el.map.clientHeight, total = Math.max(1, sd.scrollHeight);
      t.style.top = (sd.scrollTop / total * H) + 'px';
      t.style.height = Math.max(8, sd.clientHeight / total * H) + 'px';
    }
    el.map.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var r = el.map.getBoundingClientRect(), sd = view().scrollDOM;
      sd.scrollTop = (e.clientY - r.top) / r.height * sd.scrollHeight - sd.clientHeight / 2;
    });

    /* ---------- 도구 막대 ---------- */
    function counts() {
      var i = info(), all = i ? i.flat.length : 0, done = 0, pend = 0, renum = false;
      if (i) i.flat.forEach(function (b) {
        if (descOf(b).trim()) done++;
        if (isPending(b)) pend++;
        if (b.savedNum != null && fmt !== 'plain' && b.savedNum !== b.num && !isPending(b)) renum = true;
      });
      return { all: all, done: done, pend: pend, renum: renum };
    }
    function drawBar() {
      var c = counts();
      el.progText.textContent = '설명 ' + c.done + ' / ' + c.all;
      el.progBar.style.width = (c.all ? c.done / c.all * 100 : 0) + '%';
      el.apply.disabled = !c.pend && !c.renum;
      el.apply.textContent = c.pend ? '설명 ' + c.pend + '개 주석으로 넣기' : c.renum ? '번호 다시 매기기' : '주석으로 넣기';
      el.fold.setAttribute('aria-pressed', String(foldOn));
    }

    /* ---------- 강조 · 이동 ---------- */
    var hlKey = null;
    function hl(key) { if (key === hlKey) return; hlKey = key; view().dispatch({ effects: setHl.of(key) }); }
    function topBlock() {
      var v = view(), i = info(); if (!i) return -1;
      var y = el.col.getBoundingClientRect().top - v.documentTop + 4, best = -1;
      i.flat.forEach(function (b, k) { if (lineTop(b.lead) <= y && !hidden(b) && shown(b, i)) best = k; });
      return best;
    }
    function goTo(b, focus) {
      var v = view(), pos = v.state.doc.line(b.lead + 1).from;
      v.dispatch({ effects: C.EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }) });
      if (focus) wantFocus = b.key;
      flash(b.key);
      schedule();
    }
    var flashT = 0;
    function flash(key) { hl(key); clearTimeout(flashT); flashT = setTimeout(function () { if (hlKey === key && !(document.activeElement && cards[key] && cards[key].contains(document.activeElement))) hl(null); }, 1400); }

    function nextEmpty() {
      var i = info(); if (!i || !i.flat.length) return;
      var cur = document.activeElement && el.col.contains(document.activeElement) ? document.activeElement.closest('.nc') : null;
      var from = cur ? i.flat.map(function (b) { return b.key; }).indexOf(cur.dataset.key) + 1 : topBlock() + 1;
      for (var k = 0; k < i.flat.length; k++) {
        var b = i.flat[(Math.max(0, from) + k) % i.flat.length];
        if (!descOf(b).trim() && shown(b, i)) { goTo(b, true); return; }
      }
      o.toast('모든 덩어리에 설명이 있어요.');
    }
    var findPos = -1;
    function findBlock(q) {
      var i = info(); q = q.trim().toLowerCase(); if (!i || !q) return;
      var start = findPos >= 0 ? findPos : topBlock();
      for (var k = 1; k <= i.flat.length; k++) {
        var n = (start + k + i.flat.length) % i.flat.length, b = i.flat[n];
        var hay = (descOf(b) + ' ' + i.text.slice(i.starts[b.lead], i.lineEnd(b.end))).toLowerCase();
        if (hay.indexOf(q) >= 0) { findPos = n; goTo(b, false); o.toast((b.num || '전체') + '번 덩어리 · ' + (b.start + 1) + '번째 줄'); return; }
      }
      o.toast('"' + q + '" 가 들어 있는 덩어리가 없어요.');
    }

    function move(key, dir) {
      var i = info(), b = find(key); if (!b) return;
      var sib = BN.siblings(i, b), k = sib.indexOf(b);
      doMove(key, dir < 0 ? k - 1 : k + 2, true);
    }
    function doMove(key, toIdx, keepFocus) {
      var i = info(), r = BN.move(i, key, toIdx);
      if (r.error) { o.toast(r.error); return; }
      if (!r.change) return;
      var v = view();
      v.dispatch({ changes: r.change, userEvent: 'move.block' });
      var nb = find(key);
      if (nb) {
        var t = lineTop(nb.lead), sd = v.scrollDOM, vt = el.col.getBoundingClientRect().top - v.documentTop;
        if (t < vt || t > vt + sd.clientHeight - 60) v.dispatch({ effects: C.EditorView.scrollIntoView(v.state.doc.line(nb.lead + 1).from, { y: 'center' }) });
        if (keepFocus) wantFocus = key;
        flash(key);
      }
      schedule(true);
      var msg = '덩어리를 옮겼어요.';
      if (r.warnings.length) {
        var w = r.warnings[0];
        msg = '옮겼어요. 확인 필요: ' + w.v + ' 값을 ' + (w.other.num || '') + '번 덩어리(' + cut(descOf(w.other) || w.other.label, 24) + ')와 주고받아요. 순서가 바뀌면 결과가 달라질 수 있어요.' + (r.warnings.length > 1 ? ' (그 밖 ' + (r.warnings.length - 1) + '개)' : '');
      }
      o.toast(msg, '되돌리기', function () { if (undoCmd) undoCmd(view()); schedule(true); });
    }

    function apply() {
      var i = info(); if (!i) return;
      var edits = {};
      i.flat.forEach(function (b) { if (isPending(b)) edits[b.key] = pending[b.key]; });
      var r = BN.apply(i, edits, fmt);
      if (!r.changes.length) { o.toast('넣을 설명이 없어요.'); return; }
      var snap = Object.assign({}, pending);
      Object.keys(edits).forEach(function (k) { delete pending[k]; });
      view().dispatch({ changes: r.changes, userEvent: 'input.notes', effects: setRefresh.of(true) });
      schedule(true);
      var parts = [];
      if (r.added) parts.push(r.added + '개 넣음');
      if (r.changed) parts.push(r.changed + '개 고침');
      if (r.removed) parts.push(r.removed + '개 지움');
      o.toast('설명 주석: ' + parts.join(' · ') + '. 복사 · 저장하면 주석이 같이 들어가요.', '되돌리기', function () {
        if (undoCmd) undoCmd(view());
        pending = snap;
        view().dispatch({ effects: setRefresh.of(true) });
        schedule(true);
      });
    }

    function setFold(on) {
      var v = view(), i = info(), fx = [];
      foldOn = on;
      C.foldedRanges(v.state).between(0, v.state.doc.length, function (a, z) { fx.push(C.unfoldEffect.of({ from: a, to: z })); });
      if (on && i) i.flat.forEach(function (b) {
        if (b.kids.length) { if (b.headLine > b.start) fx.push(C.foldEffect.of({ from: i.lineEnd(b.start), to: i.lineEnd(b.headLine) })); }
        else if (b.end > b.start) fx.push(C.foldEffect.of({ from: i.lineEnd(b.start), to: i.lineEnd(b.end) }));
      });
      var anchor = i && i.flat[Math.max(0, topBlock())];
      v.dispatch({ effects: fx });
      if (anchor) v.dispatch({ effects: C.EditorView.scrollIntoView(v.state.doc.line(anchor.lead + 1).from, { y: 'start' }) });
      schedule(true);
    }

    /* ---------- 이벤트: 카드 ---------- */
    el.col.addEventListener('input', function (e) {
      var c = e.target.closest('.nc'); if (!c || !e.target.classList.contains('ni')) return;
      pending[c.dataset.key] = e.target.value;
      view().dispatch({ effects: setRefresh.of(true) });
      schedule(true);
    });
    el.col.addEventListener('keydown', function (e) {
      var c = e.target.closest('.nc'); if (!c) return;
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); move(c.dataset.key, e.key === 'ArrowUp' ? -1 : 1); }
      else if (e.key === 'Enter' && e.target.classList.contains('ni')) { e.preventDefault(); nextEmpty(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hl(null); view().focus(); }
    });
    el.col.addEventListener('focusin', function (e) { var c = e.target.closest('.nc'); if (c) hl(c.dataset.key); });
    el.col.addEventListener('focusout', function (e) { if (!el.col.contains(e.relatedTarget)) hl(null); });
    el.col.addEventListener('mouseover', function (e) {
      if (drag) return;
      var c = e.target.closest('.nc');
      if (c) hl(c.dataset.key);
    });
    el.col.addEventListener('mouseleave', function () {
      if (drag) return;
      var f = document.activeElement && el.col.contains(document.activeElement) ? document.activeElement.closest('.nc') : null;
      hl(f ? f.dataset.key : null);
    });
    el.col.addEventListener('click', function (e) {
      var mv = e.target.closest('[data-mv]'), c = e.target.closest('.nc');
      if (!c) return;
      if (mv) { move(c.dataset.key, +mv.dataset.mv); return; }
      if (e.target.classList.contains('nk') || e.target.classList.contains('nn')) {
        var b = find(c.dataset.key); if (!b) return;
        var v = view(), ln = v.state.doc.line(b.start + 1);
        v.dispatch({ selection: { anchor: ln.from + (ln.text.length - ln.text.replace(/^\s+/, '').length) }, effects: C.EditorView.scrollIntoView(ln.from, { y: 'nearest' }) });
        v.focus();
      }
    });
    // 설명 칸 위에서 굴려도 코드가 같이 움직여요
    el.col.addEventListener('wheel', function (e) {
      var sd = view().scrollDOM;
      sd.scrollTop += e.deltaMode === 1 ? e.deltaY * view().defaultLineHeight : e.deltaY;
      e.preventDefault();
    }, { passive: false });

    /* ---------- 끌어서 옮기기 ---------- */
    function sibGeo(b) {
      var i = info();
      return BN.siblings(i, b).map(function (x) { return { b: x, top: lineTop(x.lead), bot: lineBottom(x.end) }; });
    }
    function dropAt(clientY) {
      var v = view(), y = clientY - v.documentTop, g = drag.geo, lh = v.defaultLineHeight, ins = g.length;
      for (var k = 0; k < g.length; k++) {
        var mid = g[k].top + Math.min((g[k].bot - g[k].top) / 2, lh * 3);
        if (y < mid) { ins = k; break; }
      }
      var ok = y > g[0].top - lh * 3 && y < g[g.length - 1].bot + lh * 3;
      var lineY = ins < g.length ? g[ins].top : g[g.length - 1].bot;
      return { ins: ins, ok: ok, y: lineY };
    }
    function showDrop(d) {
      var v = view(), wr = el.wrap.getBoundingClientRect();
      el.drop.hidden = false;
      el.drop.classList.toggle('bad', !d.ok);
      var y = v.documentTop + d.y - wr.top;
      el.drop.style.top = Math.max(0, Math.min(wr.height - 2, y - 1)) + 'px';
      el.drop.title = d.ok ? '' : '같은 단계 안에서만 옮길 수 있어요';
    }
    var autoT = 0;
    function autoScroll() {
      if (!drag) return;
      var sd = view().scrollDOM, r = el.col.getBoundingClientRect(), y = drag.y, sp = 0;
      if (y < r.top + 40) sp = -Math.min(40, (r.top + 40 - y) / 2 + 4);
      else if (y > r.bottom - 40) sp = Math.min(40, (y - r.bottom + 40) / 2 + 4);
      if (sp) { sd.scrollTop += sp; showDrop(drag.d = dropAt(y)); }
      autoT = requestAnimationFrame(autoScroll);
    }
    el.col.addEventListener('pointerdown', function (e) {
      var h = e.target.closest('.nh'); if (!h || e.button !== 0) return;
      var c = h.closest('.nc'), b = find(c.dataset.key), i = info();
      if (!b || !BN.canMove(i, b)) return;
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      drag = { key: b.key, from: BN.siblings(i, b).indexOf(b), geo: sibGeo(b), y: e.clientY, d: null, el: h };
      el.wrap.classList.add('ndragging');
      el.ghost.textContent = (b.num ? b.num + ' ' : '') + cut(descOf(b) || b.label, 40);
      el.ghost.hidden = false;
      hl(b.key);
      autoT = requestAnimationFrame(autoScroll);
    });
    el.col.addEventListener('pointermove', function (e) {
      if (!drag) return;
      drag.y = e.clientY;
      drag.d = dropAt(e.clientY);
      showDrop(drag.d);
      var wr = el.wrap.getBoundingClientRect();
      el.ghost.style.transform = 'translate(' + (e.clientX - wr.left + 12) + 'px,' + (e.clientY - wr.top - 10) + 'px)';
    });
    function endDrag(commit) {
      if (!drag) return;
      cancelAnimationFrame(autoT);
      var d = drag.d, key = drag.key, from = drag.from;
      drag = null;
      el.wrap.classList.remove('ndragging');
      el.drop.hidden = true; el.ghost.hidden = true;
      if (!commit || !d) return;
      if (!d.ok) { o.toast('같은 단계 안에서만 옮길 수 있어요. 다른 블록 안으로는 넣지 않아요.'); return; }
      if (d.ins === from || d.ins === from + 1) return;
      doMove(key, d.ins, false);
    }
    el.col.addEventListener('pointerup', function () { endDrag(true); });
    el.col.addEventListener('pointercancel', function () { endDrag(false); });
    document.addEventListener('keydown', function (e) { if (drag && e.key === 'Escape') endDrag(false); }, true);

    /* ---------- 이벤트: 도구 막대 ---------- */
    el.next.addEventListener('click', nextEmpty);
    el.apply.addEventListener('click', apply);
    function setLevel(n) {
      maxLv = n;
      Array.prototype.forEach.call(el.level.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(+x.dataset.lv === n)); });
      o.store('noteLevel', n);
      schedule(true);
    }
    el.level.addEventListener('click', function (e) { var x = e.target.closest('[data-lv]'); if (x) setLevel(+x.dataset.lv); });
    setLevel(maxLv);
    el.fold.addEventListener('click', function () { setFold(!foldOn); o.toast(foldOn ? '쿼리 본문을 접었어요. 덩어리 첫 줄만 보여요.' : '모두 펼쳤어요.'); });
    el.fmt.addEventListener('change', function () { fmt = el.fmt.value; o.store('noteFmt', fmt); view().dispatch({ effects: setRefresh.of(true) }); schedule(); });
    el.findIn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); findBlock(el.findIn.value); }
      else if (e.key === 'Escape') { el.findIn.value = ''; findPos = -1; view().focus(); }
    });
    el.findIn.addEventListener('input', function () { findPos = -1; });

    view().scrollDOM.addEventListener('scroll', function () { schedule(); }, { passive: true });
    window.addEventListener('resize', function () { schedule(true); });

    var api = {
      onUpdate: function (u) {
        if (!enabled) return;
        var f0 = u.startState.field(field, false), f1 = u.state.field(field, false);
        if (u.docChanged || u.geometryChanged || u.heightChanged || f0 !== f1) schedule(true);
        else if (u.viewportChanged) schedule();
      },
      // 결과 칸 내용을 통째로 바꾼 뒤 (새 포맷 결과)
      afterSet: function () { foldOn = false; findPos = -1; if (enabled) { Object.keys(cards).forEach(function (k) { cards[k].remove(); delete cards[k]; }); schedule(true); } },
      setEnabled: function (on) {
        enabled = on;
        el.wrap.classList.toggle('notes-on', on);
        el.col.hidden = el.map.hidden = el.bar.hidden = !on;
        if (!on && foldOn) setFold(false);
        hl(null);
        view().dispatch({ effects: setRefresh.of(true) });
        Object.keys(cards).forEach(function (k) { cards[k].remove(); delete cards[k]; });
        view().requestMeasure();
        schedule(true);
      },
      on: function () { return enabled; },
      setFmt: function (f) { fmt = f; el.fmt.value = f; },
      nextEmpty: nextEmpty,
      // 현재 위치: 화면 맨 위 덩어리와 그 바깥 덩어리들
      crumbs: function () {
        var i = info(), k = topBlock(); if (!i || k < 0) return [];
        var b = i.flat[k], chain = [];
        while (b) { if (b.kind !== 'UNIT' || !i.single) chain.unshift(b); b = b.parent; }
        return chain.map(function (x) {
          var d = descOf(x).trim();
          return { label: x.num + ' ' + cut(d || x.label, 30), title: x.num + ' ' + (d || x.label) + ' (' + (x.start + 1) + '번째 줄로)', line: x.start };
        });
      },
      // 다시 포맷하기 전에: 결과에 넣어 둔 설명 주석을 "넣을 설명"으로 기억해서, 새 결과에도 다시 넣을 수 있게 해요
      harvest: function (text) {
        var i = S.codeBlocks(text), n = 0;
        i.flat.forEach(function (b) { if (b.saved && !Object.prototype.hasOwnProperty.call(pending, b.key)) { pending[b.key] = b.saved; n++; } });
        return n;
      },
      pendingCount: function () { return counts().pend; }
    };
    ui = api;
    return api;
  }

  window.SQLNotes = { extension: extension, attach: attach };
})();
