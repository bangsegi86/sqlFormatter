/* 화면 로직: 좌우 스플릿 · 옵션 패널 · 프리셋 · 별칭 패널 */
(function () {
  'use strict';
  var S = window.SQLF;

  function $(id) { return document.getElementById(id); }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (k === 'text') e.textContent = v;
        else if (k === 'class') e.className = v;
        else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
        else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v);
      });
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('sqlf.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('sqlf.' + k, JSON.stringify(v)); } catch (e) { /* 저장 불가여도 동작은 유지 */ } }
  };

  // 저장된 옵션 · 프리셋을 지금 옵션 정의에 맞춰요 (예전 버전 값도 바꿔 줘요)
  function cleanOpts(o) {
    var s = S.sanitizeOpts(o || {}), out = {};
    Object.keys(S.DEFAULTS).forEach(function (k) { out[k] = s[k]; });
    return out;
  }

  var state = {
    opts: Object.assign({}, S.DEFAULTS, cleanOpts(store.get('opts', {}))),
    userPresets: store.get('presets', {}),
    basePreset: store.get('basePreset', null), // 마지막으로 고른/저장한 사용자 프리셋 (옵션을 바꿔도 기억해요)
    tab: store.get('tab', 'basic'),
    auto: store.get('auto', true),
    size: store.get('size', 13),
    lw: store.get('lw', 1),
    renames: {},
    inputs: {},
    aliasRows: [],
    aliasKey: null,
    res: null,
    fileName: null
  };

  var timer = null;
  var E = window.SQLEditor;
  function tabSize() { return parseInt(state.opts.tabsize, 10) || 4; }

  /* ---------- 편집기: 원본 칸 · 결과 칸 (editor.js) ---------- */
  var src = E.createSource($('srcEd'), {
    label: '원본 SQL 입력', tabSize: tabSize,
    placeholder: '여기에 Oracle 쿼리를 붙여넣으세요. .sql 파일을 끌어다 놓아도 돼요.',
    onChange: function (paste) {
      afterSourceChange();
      $('srcInfo').textContent = countLines(src.value) + '줄 · ' + src.value.length.toLocaleString() + '자';
      if (state.auto) { if (paste) setTimeout(run, 0); else schedule(); } else setStale(true);
      find.docChanged(src);
    }
  });
  var out = E.createResult($('outEd'), {
    label: '포맷된 SQL (직접 고칠 수 있어요)', tabSize: tabSize,
    extra: window.SQLNotes.extension,
    placeholder: '왼쪽에 쿼리를 붙여넣으면 여기에 정리된 결과가 나와요. 결과는 여기서 바로 고칠 수 있어요.',
    onEdit: function () {
      if (!state.edited) setEdited(true);
      $('outInfo').textContent = countLines(out.value) + '줄';
      drawLevels();
      find.docChanged(out);
    },
    onCursor: function () { drawCrumb(); }
  });
  src.wrap = $('srcwrap');
  out.wrap = $('outwrap');
  var lastEd = out; // 찾기 버튼을 누르면 마지막으로 쓰던 칸에서 찾아요
  src.wrap.addEventListener('focusin', function (e) { if (!$('find').contains(e.target)) lastEd = src; });
  out.wrap.addEventListener('focusin', function (e) { if (!$('find').contains(e.target)) lastEd = out; });
  var find = E.createFind({
    bar: $('find'), q: $('fq'), r: $('fr'), cnt: $('fCnt'),
    prev: $('fPrev'), next: $('fNext'), caseBtn: $('fCase'), wordBtn: $('fWord'),
    repBtn: $('fRep'), repAllBtn: $('fRepAll'), repRow: $('fRepRow'), repToggle: $('fRepToggle'), closeBtn: $('fClose'),
    onReplaced: function (n, t) { toast(n.toLocaleString() + '개를 바꿨어요. Ctrl+Z 로 한 번에 되돌릴 수 있어요.'); if (t === out) t.view.focus(); }
  });

  /* ---------- 알림 ---------- */
  var toastT = null;
  // actionLabel/action 을 주면 알림 안에 버튼(예: 되돌리기)이 생겨요
  function toast(msg, actionLabel, action) {
    var t = $('toast');
    t.textContent = '';
    t.appendChild(h('span', { text: msg }));
    if (actionLabel) {
      t.appendChild(h('button', { type: 'button', class: 'tact', text: actionLabel, on: { click: function () { t.classList.remove('show'); action(); } } }));
    }
    t.classList.toggle('hasact', !!actionLabel);
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { t.classList.remove('show'); }, actionLabel ? 6000 : 2600);
  }

  /* ---------- 구조 · 설명 화면 (notes.js) ---------- */
  var notes = window.SQLNotes.attach(out, {
    wrap: $('outwrap'), col: $('ncol'), map: $('nmap'), bar: $('notesbar'), drop: $('ndrop'), ghost: $('nghost'),
    progBar: $('nProgBar'), progText: $('nProgText'), next: $('nNext'), findIn: $('nFind'), fold: $('nFold'), fmt: $('nFmt'), apply: $('nApply'), level: $('nLv')
  }, {
    toast: function (m, l, a) { toast(m, l, a); },
    store: function (k, v) { store.set(k, v); },
    onScroll: function () { drawCrumb(); },
    level: store.get('noteLevel', 0)
  });
  notes.setFmt(store.get('noteFmt', 'dash'));
  function setNotesMode(on, quiet) {
    $('mCode').setAttribute('aria-pressed', String(!on));
    $('mNotes').setAttribute('aria-pressed', String(on));
    store.set('notesMode', on);
    // 결과 칸이 좁으면 설명 칸 자리를 만들려고 옵션 패널을 접어요 (끄면 다시 펼쳐요)
    if (on && !state.optsHidden && $('paneR').clientWidth < 760) {
      setOptsHidden(true);
      state.notesHidOpts = true;
      if (!quiet) toast('설명 칸 자리를 만들려고 옵션 패널을 접었어요. Ctrl+B 로 다시 열 수 있어요.');
    } else if (!on && state.notesHidOpts) {
      if (state.optsHidden) setOptsHidden(false);
      state.notesHidOpts = false;
    }
    notes.setEnabled(on);
    drawCrumb();
  }
  $('mCode').addEventListener('click', function () { setNotesMode(false); });
  $('mNotes').addEventListener('click', function () { setNotesMode(true); });

  /* ---------- 포맷 실행 ---------- */
  function run() {
    clearTimeout(timer);
    var text = src.value;
    var res = S.format(text, Object.assign({}, state.opts, { aliasRenames: state.renames }));
    state.res = res;
    setStale(false);
    // 결과를 직접 고친 상태에서 다시 정리하면, 고친 내용을 되살릴 수 있게 알려줘요
    var edited = state.edited ? out.value : null;
    // 원본이 같으면(옵션만 바꿈) 접힌 IF 를 그대로 접어 둬요
    var memo = state.foldSrc === text ? out.foldMemo() : null;
    // 결과에 넣어 둔 설명 주석은 새 결과에서 "넣을 설명"으로 다시 보여줘요
    var kept = edited !== null ? notes.harvest(edited) : 0;
    drawOutput(res, text, memo);
    state.foldSrc = text;
    if (edited !== null && edited !== out.value) {
      toast('다시 정리해서 결과에 직접 고친 내용이 바뀌었어요.' + (kept ? ' 넣어 둔 설명 ' + kept + '개는 [구조 · 설명]에 그대로 있어요.' : ''), '되돌리기', function () {
        out.setText(edited);
        notes.afterSet();
        setEdited(true);
        drawLevels();
        $('outInfo').textContent = countLines(edited) + '줄';
      });
    }
    drawNotes(res, text);
    drawStatus(res, text);
    drawInfo(text, res);
    if (state.tab === 'alias') refreshAliasRows(text);
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(run, 250);
  }

  function countLines(s) { return s ? s.split('\n').length : 0; }

  // 자동 포맷이 꺼져 있을 때 원본을 고치면 "결과가 예전 것"이라고 알려줘요
  function setStale(on) {
    var c = $('staleChip');
    if (c) c.hidden = !on;
  }

  function setFileName(name) {
    state.fileName = name;
    document.title = (name ? name + ' - ' : '') + 'Oracle SQL 포매터';
  }

  function drawInfo(text, res) {
    $('srcInfo').textContent = countLines(text) + '줄 · ' + text.length.toLocaleString() + '자';
    $('outInfo').textContent = countLines(res.text) + '줄';
  }

  /* ---------- 결과 칸 ---------- */
  function drawOutput(res, text, memo) {
    out.setText(text.trim() ? res.text : '', memo);
    notes.afterSet();
    setEdited(false);
    drawLevels();
  }
  function setEdited(on) {
    state.edited = on;
    $('editChip').hidden = !on;
  }
  // 복사 · 저장 · 원본으로에 쓰는 결과 (직접 고쳤으면 고친 내용, 접혀 있어도 전체)
  function resultText() { return out.value; }

  // 엑셀 그룹처럼 단계 번호로 한 번에 접기 · 펼치기 (1 = 전체 접기, 마지막 = 전체 펼치기)
  var lvShown = -1;
  function drawLevels() {
    var n = out.levels();
    if (n === lvShown) return;
    lvShown = n;
    var box = $('lvs');
    box.textContent = '';
    $('lvwrap').hidden = !n;
    for (var i = 1; i <= n + 1; i++) {
      (function (k) {
        var tip = k === 1 ? '1: 모든 IF 를 접어요 (전체 접기)' : k === n + 1 ? k + ': 모두 펼쳐요 (전체 펼치기)' : k + ': ' + (k - 1) + '단계 IF 까지 펼치고, 그 안쪽 IF 는 접어요';
        box.appendChild(h('button', { type: 'button', class: 'lv', text: String(k), title: tip, on: { click: function () { out.setLevel(k); } } }));
      })(i);
    }
  }
  // 커서가 어느 IF 의 어느 가지 안에 있는지 (누르면 그 줄로 이동)
  function drawCrumb() {
    var box = $('crumb'), items = notes && notes.on() ? notes.crumbs() : out.crumbs();
    box.textContent = '';
    if (!items.length) {
      if (out.ifCount()) box.appendChild(h('span', { class: 'lab', text: '현재 위치 · IF 문 밖' }));
      return;
    }
    box.appendChild(h('span', { class: 'lab', text: '현재 위치' }));
    items.forEach(function (it, i) {
      if (i) box.appendChild(h('span', { class: 'sep', text: '›' }));
      box.appendChild(h('a', { text: it.label, title: it.title, on: { click: function () { out.gotoLine(it.line); } } }));
    });
  }
  function drawNotes(res, text) {
    var box = $('notes');
    box.textContent = '';
    if (!text.trim()) { box.hidden = true; return; }
    res.errors.forEach(function (e) {
      var where = (res.options && e.stmt ? e.stmt + '번째 문장 · ' : '') + e.line + '번째 줄' + (e.near ? " 부근 '" + e.near + "'" : '');
      box.appendChild(h('div', { class: 'err', text: where + ': ' + e.message + ' — 이 문장은 원문 그대로 두었어요.' }));
    });
    res.warnings.forEach(function (w) { box.appendChild(h('div', { class: 'warn', text: w })); });
    box.hidden = !box.children.length;
  }

  function drawStatus(res, text) {
    var st = $('status'), s = res.stats;
    st.textContent = '';
    if (!text.trim()) { st.appendChild(h('span', { text: '쿼리를 붙여넣으면 구조를 분석해서 보여줘요.' })); return; }
    var cls = res.errors.length ? 'err' : res.warnings.length ? 'warn' : '';
    var label = res.errors.length ? '일부 문장 해석 실패' : res.warnings.length ? '확인할 내용 있음' : '파싱 성공';
    st.appendChild(h('span', { class: 'st-ok' }, [h('span', { class: 'dot ' + cls }), label]));
    st.appendChild(h('span', { text: '쿼리 블록 ' + s.blocks }));
    if (s.sub) st.appendChild(h('span', { text: '서브쿼리 ' + s.sub + ' (스칼라 ' + s.scalar + ' · 인라인 뷰 ' + s.inline + ' · 조건 ' + s.cond + (s.cte ? ' · WITH ' + s.cte : '') + ')' }));
    else if (s.cte) st.appendChild(h('span', { text: 'WITH ' + s.cte }));
    if (s.cases) st.appendChild(h('span', { text: 'CASE ' + s.cases }));
    if (s.decodes) st.appendChild(h('span', { text: 'DECODE ' + s.decodes }));
    if (s.binds) st.appendChild(h('span', { text: '바인드 ' + s.bindNames.slice(0, 4).join(' ') + (s.bindNames.length > 4 ? ' …' : '') }));
    if (s.outer) st.appendChild(h('span', { text: '외부 조인 (+) ' + s.outer }));
    if (s.ansi) st.appendChild(h('span', { text: 'ANSI JOIN 변환 ' + s.ansi }));
    st.appendChild(h('div', { class: 'spacer' }));
    st.appendChild(h('span', { class: 'keys', text: 'Ctrl+Enter 포맷 · Ctrl+Shift+C 복사 · Ctrl+S 저장 · Ctrl+O 열기' }));
  }

  /* ---------- 옵션 패널 ---------- */
  function setOpt(key, val) {
    state.opts[key] = val;
    store.set('opts', state.opts);
    drawRailDot();
    buildTabs();
    buildBody();
    renderPresetSel();
    run();
  }
  function setAllOpts(opts) {
    state.opts = cleanOpts(opts);
    store.set('opts', state.opts);
    drawRailDot();
    buildTabs();
    buildBody();
    renderPresetSel();
    run();
  }

  /* ---------- 툴팁: data-tip 이 있는 요소에 마우스/포커스가 가면 화면 위에 떠서 보여요 ---------- */
  var tipBox = null;
  function showTip(el) {
    var text = el.getAttribute('data-tip');
    if (!text) return;
    if (!tipBox) { tipBox = h('div', { class: 'tipbox', role: 'tooltip' }); document.body.appendChild(tipBox); }
    tipBox.textContent = text;
    tipBox.style.display = 'block';
    var r = el.getBoundingClientRect(), b = tipBox.getBoundingClientRect();
    var left = Math.min(Math.max(8, r.left + r.width / 2 - b.width / 2), window.innerWidth - b.width - 8);
    var top = r.bottom + 6;
    if (top + b.height > window.innerHeight - 8) top = Math.max(8, r.top - b.height - 6);
    tipBox.style.left = left + 'px';
    tipBox.style.top = top + 'px';
  }
  function hideTip() { if (tipBox) tipBox.style.display = 'none'; }
  ['mouseover', 'focusin'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
      if (el) showTip(el); else hideTip();
    });
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('mousedown', hideTip);
  document.addEventListener('scroll', hideTip, true);

  function labelEl(o) {
    var kids = [o.label];
    if (o.tip) kids.push(h('span', { class: 'tipq', tabindex: '0', 'data-tip': o.tip, 'aria-label': o.label + ' 설명' , text: '?' }));
    return h('span', { class: 'olabel' }, kids);
  }

  function control(o) {
    var val = state.opts[o.key];
    // 다른 옵션 때문에 지금은 효과가 없으면 흐리게 보이고 이유를 알려줘요 (눌러서 미리 바꿔 둘 수는 있어요)
    var off = o.off ? o.off(state.opts) : false;
    var changed = val !== S.DEFAULTS[o.key];
    var wrap = h('div', { class: 'opt' + (off ? ' off' : '') + (changed ? ' changed' : '') });
    if (o.type === 'seg') {
      wrap.appendChild(h('div', { class: 'orow' }, [labelEl(o)]));
      var g = h('div', { class: 'segs', role: 'group', 'aria-label': o.label });
      o.choices.forEach(function (c) {
        g.appendChild(h('button', { type: 'button', class: 'seg', 'aria-pressed': String(val === c[0]), 'data-tip': c[2] || null, text: c[1], on: { click: function () { setOpt(o.key, c[0]); } } }));
      });
      wrap.appendChild(g);
    } else if (o.type === 'switch') {
      var sw = h('button', { type: 'button', class: 'sw', role: 'switch', 'aria-checked': String(!!val), 'aria-label': o.label, on: { click: function () { setOpt(o.key, !val); } } }, [h('span')]);
      wrap.appendChild(h('div', { class: 'orow' }, [labelEl(o), sw]));
    } else {
      var st = h('div', { class: 'stepper' }, [
        h('button', { type: 'button', 'aria-label': o.label + ' 줄이기', text: '−', on: { click: function () { setOpt(o.key, Math.max(o.min, val - o.step)); } } }),
        h('span', { text: val + o.unit }),
        h('button', { type: 'button', 'aria-label': o.label + ' 늘리기', text: '+', on: { click: function () { setOpt(o.key, Math.min(o.max, val + o.step)); } } })
      ]);
      wrap.appendChild(h('div', { class: 'orow' }, [labelEl(o), st]));
    }
    if (off && typeof off === 'string') wrap.appendChild(h('span', { class: 'hint offwhy', text: off }));
    else if (o.hint) wrap.appendChild(h('span', { class: 'hint', text: o.hint }));
    return wrap;
  }

  // 탭 안에 기본값과 다른 옵션이 있으면 탭 이름 옆에 점을 찍어요
  function tabChanged(t) {
    return t.groups.some(function (g) { return g.opts.some(function (o) { return state.opts[o.key] !== S.DEFAULTS[o.key]; }); });
  }

  function buildTabs() {
    var box = $('tabs');
    box.textContent = '';
    S.OPTION_SPEC.forEach(function (t) {
      var ch = tabChanged(t);
      box.appendChild(h('button', {
        type: 'button', class: 'tab' + (ch ? ' changed' : ''), role: 'tab', 'aria-selected': String(state.tab === t.id), text: t.label,
        title: ch ? '기본값과 다르게 바꾼 옵션이 있어요' : null,
        on: { click: function () { state.tab = t.id; store.set('tab', t.id); buildTabs(); buildBody(); if (t.id === 'alias') refreshAliasRows(src.value); } }
      }));
    });
  }

  function buildBody() {
    hideTip(); // 다시 그리면 마우스 아래 요소가 바뀌므로 떠 있던 설명을 닫아요
    var box = $('obody');
    var top = box.scrollTop;
    box.textContent = '';
    var tab = S.OPTION_SPEC.filter(function (t) { return t.id === state.tab; })[0] || S.OPTION_SPEC[0];
    tab.groups.forEach(function (g) {
      var sec = h('section', { class: 'grp' }, [h('h3', { text: g.title })]);
      g.opts.forEach(function (o) { sec.appendChild(control(o)); });
      box.appendChild(sec);
    });
    if (tab.id === 'alias') box.appendChild(aliasSection());
    box.scrollTop = top;
  }

  /* ---------- 별칭 패널 ---------- */
  function refreshAliasRows(text) {
    var key = text + '\u0000' + state.opts.tblrule;
    if (key === state.aliasKey) return;
    state.aliasKey = key;
    try { state.aliasRows = text.trim() ? S.analyzeAliases(text, state.opts) : []; } catch (e) { state.aliasRows = []; }
    if (state.tab === 'alias') buildBody();
  }

  function aliasSection() {
    var sec = h('section', { class: 'grp' });
    sec.appendChild(h('h3', { text: '별칭 일괄 변경' }));
    sec.appendChild(h('p', { class: 'hint', text: '바꾸면 SELECT · WHERE · ORDER BY 안의 a.컬럼 같은 참조도 같은 범위 안에서 함께 바뀌어요.' }));
    var rows = state.aliasRows;
    if (!rows.length) {
      sec.appendChild(h('p', { class: 'aempty', text: '왼쪽에 테이블이 있는 쿼리를 넣으면 별칭 목록이 나와요.' }));
      return sec;
    }
    var list = h('div', { class: 'arows' });
    var lastScope = null;
    rows.forEach(function (r) {
      if (r.scope !== lastScope) { list.appendChild(h('div', { class: 'ascope', text: r.scope })); lastScope = r.scope; }
      var cur = state.inputs[r.id] !== undefined ? state.inputs[r.id] : r.alias;
      var inp = h('input', {
        type: 'text', value: cur, 'aria-label': r.target + ' 별칭', spellcheck: 'false', placeholder: r.alias ? '' : '새 별칭',
        class: state.renames[r.id] !== undefined && state.renames[r.id] === cur ? 'applied' : '',
        on: { input: function (e) { state.inputs[r.id] = e.target.value; e.target.classList.remove('applied'); } }
      });
      list.appendChild(h('div', { class: 'arow' }, [
        h('span', { class: 'cur' + (r.alias ? '' : ' none'), text: r.alias || '없음' }),
        h('span', { 'aria-hidden': 'true', text: '→' }),
        inp,
        h('div', { class: 'tgt' }, [h('b', { text: r.target, title: r.target }), h('small', { text: r.kind === 'view' ? '인라인 뷰' : '테이블' })])
      ]));
    });
    sec.appendChild(list);
    sec.appendChild(h('div', { class: 'abtns' }, [
      h('button', {
        type: 'button', class: 'btn', text: '자동 제안',
        on: { click: function () { rows.forEach(function (r) { state.inputs[r.id] = r.suggest; }); buildBody(); toast('"' + ruleName() + '" 규칙으로 제안했어요. 확인하고 [변경 적용]을 누르세요.'); } }
      }),
      h('button', { type: 'button', class: 'btn primary', text: '변경 적용', on: { click: applyRenames } }),
      h('button', { type: 'button', class: 'btn', text: '되돌리기', on: { click: function () { state.renames = {}; state.inputs = {}; buildBody(); run(); } } })
    ]));
    return sec;
  }
  function ruleName() { return { first: '첫 글자', abbr: '약어', seq: 't1, t2' }[state.opts.tblrule] || ''; }

  function applyRenames() {
    var renames = {}, n = 0;
    state.aliasRows.forEach(function (r) {
      var v = (state.inputs[r.id] || '').trim();
      if (v && v.toLowerCase() !== r.alias.toLowerCase()) { renames[r.id] = v; n++; }
    });
    state.renames = renames;
    run();
    buildBody();
    var warn = state.res ? state.res.warnings.length : 0;
    toast(n ? n + '개 별칭을 바꿨어요.' + (warn ? ' (건너뛴 항목은 결과 위 안내를 확인하세요)' : '') : '바꿀 항목이 없어요.');
  }

  /* ---------- 프리셋 ---------- */
  function allPresets() {
    var out = {};
    Object.keys(S.BUILTIN_PRESETS).forEach(function (n) { out[n] = { builtin: true, opts: Object.assign({}, S.DEFAULTS, S.BUILTIN_PRESETS[n]) }; });
    Object.keys(state.userPresets).forEach(function (n) { out[n] = { builtin: false, opts: Object.assign({}, S.DEFAULTS, cleanOpts(state.userPresets[n])) }; });
    return out;
  }
  function sameOpts(a, b) { return Object.keys(S.DEFAULTS).every(function (k) { return a[k] === b[k]; }); }
  function currentPresetName() {
    var all = allPresets();
    var names = Object.keys(all);
    for (var i = 0; i < names.length; i++) if (sameOpts(all[names[i]].opts, state.opts)) return names[i];
    return null;
  }
  function setBasePreset(name) {
    state.basePreset = name && state.userPresets[name] ? name : null;
    store.set('basePreset', state.basePreset);
  }
  function renderPresetSel() {
    var sel = $('presetSel');
    var all = allPresets();
    var cur = currentPresetName();
    if (state.basePreset && !state.userPresets[state.basePreset]) setBasePreset(null);
    sel.textContent = '';
    if (!cur) sel.appendChild(h('option', { value: '', text: state.basePreset ? '★ ' + state.basePreset + ' (수정됨)' : '사용자 지정', selected: 'selected' }));
    Object.keys(all).forEach(function (n) {
      sel.appendChild(h('option', { value: n, text: (all[n].builtin ? '' : '★ ') + n, selected: n === cur ? 'selected' : false }));
    });
    sel.value = cur || '';
  }

  var dlgResolve = null;
  function askDialog(cfg) {
    var dlg = $('dlg');
    $('dlgTitle').textContent = cfg.title;
    $('dlgText').textContent = cfg.text;
    var inp = $('dlgInput');
    inp.hidden = !cfg.input;
    inp.value = cfg.value || '';
    var ok = $('dlgOk');
    // 확인 버튼 글자를 입력값에 따라 바꿀 수 있어요 (예: 새로 저장 / 덮어쓰기)
    function refresh() {
      ok.textContent = cfg.okTextFor ? cfg.okTextFor(inp.value.trim()) : (cfg.okText || '확인');
      Array.prototype.forEach.call($('dlgChips').querySelectorAll('button'), function (b) {
        b.setAttribute('aria-pressed', String(b.getAttribute('data-name') === inp.value.trim()));
      });
    }
    inp.oninput = refresh;
    // 고를 수 있는 이름 목록 (누르면 입력칸에 채워져요)
    var chips = $('dlgChips');
    chips.textContent = '';
    chips.hidden = !(cfg.chips && cfg.chips.length);
    if (!chips.hidden) {
      chips.appendChild(h('span', { text: cfg.chipsLabel || '' }));
      cfg.chips.forEach(function (n) {
        chips.appendChild(h('button', { type: 'button', 'data-name': n, text: n, on: { click: function () { inp.value = n; refresh(); inp.focus(); } } }));
      });
    }
    refresh();
    return new Promise(function (resolve) {
      dlgResolve = resolve;
      dlg.showModal();
      if (cfg.input) { inp.focus(); inp.select(); }
    });
  }
  function closeDialog(v) {
    var dlg = $('dlg');
    if (dlg.open) dlg.close();
    if (dlgResolve) { var r = dlgResolve; dlgResolve = null; r(v); }
  }

  function savePreset() {
    var names = Object.keys(state.userPresets);
    var cur = currentPresetName();
    var base = state.basePreset || (cur && state.userPresets[cur] ? cur : null);
    askDialog({
      title: '프리셋 저장',
      text: base
        ? '"' + base + '" 프리셋을 기준으로 바꾼 옵션이에요. 그대로 Enter 를 누르면 덮어써요. 새 이름을 쓰면 새로 저장해요.'
        : '새 이름을 입력하거나, 아래 기존 프리셋을 눌러 덮어쓸 수 있어요.',
      input: true,
      value: base || '',
      chips: names,
      chipsLabel: '기존 프리셋에 덮어쓰기',
      okTextFor: function (v) { return state.userPresets[v] ? '덮어쓰기' : '새로 저장'; }
    }).then(function (name) {
      if (name === null) return;
      name = name.trim();
      if (!name) { toast('이름을 입력해 주세요.'); return; }
      if (S.BUILTIN_PRESETS[name]) { toast('기본 프리셋 이름은 쓸 수 없어요.'); return; }
      var existed = !!state.userPresets[name];
      state.userPresets[name] = cleanOpts(state.opts);
      store.set('presets', state.userPresets);
      setBasePreset(name);
      renderPresetSel();
      toast('프리셋 "' + name + '" 을 ' + (existed ? '덮어썼어요.' : '저장했어요.'));
    });
  }
  function deletePreset() {
    var name = $('presetSel').value || state.basePreset;
    if (!name || !state.userPresets[name]) { toast('삭제할 수 있는 사용자 프리셋을 먼저 선택하세요.'); return; }
    askDialog({ title: '프리셋 삭제', text: '"' + name + '" 프리셋을 삭제할까요?', input: false, okText: '삭제' }).then(function (ok) {
      if (ok === null) return;
      delete state.userPresets[name];
      store.set('presets', state.userPresets);
      if (state.basePreset === name) setBasePreset(null);
      renderPresetSel();
      toast('삭제했어요.');
    });
  }
  function exportPresets() {
    var data = { app: 'oracle-sql-formatter', version: 1, current: cleanOpts(state.opts), presets: state.userPresets };
    download('sql-formatter-presets.json', JSON.stringify(data, null, 2), 'application/json');
  }
  function importPresets(file) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var d = JSON.parse(String(fr.result));
        var n = 0;
        var src2 = d.presets || {};
        Object.keys(src2).forEach(function (k) {
          if (S.BUILTIN_PRESETS[k]) return;
          state.userPresets[k] = cleanOpts(src2[k]);
          n++;
        });
        if (d.current && !d.presets) { state.userPresets[file.name.replace(/\.json$/i, '')] = cleanOpts(d.current); n++; }
        store.set('presets', state.userPresets);
        renderPresetSel();
        toast(n + '개 프리셋을 가져왔어요.');
      } catch (e) { toast('프리셋 파일을 읽지 못했어요.'); }
    };
    fr.readAsText(file);
  }

  /* ---------- 파일 · 클립보드 ---------- */
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function decode(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) {
      try { return new TextDecoder('euc-kr').decode(buf); } catch (e2) { return new TextDecoder('utf-8').decode(buf); }
    }
  }
  function loadFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      src.value = decode(fr.result).replace(/^﻿/, '');
      setFileName(file.name);
      afterSourceChange();
      run();
      toast(file.name + ' 을(를) 열었어요.');
    };
    fr.readAsArrayBuffer(file);
  }
  function copyText(text) {
    function fallback() {
      var ta = h('textarea', { style: 'position:fixed;opacity:0' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      toast(ok ? '결과를 복사했어요.' : '복사하지 못했어요. 결과를 직접 선택해 주세요.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('결과를 복사했어요.'); }, fallback);
    } else fallback();
  }

  function afterSourceChange() {
    if (Object.keys(state.renames).length || Object.keys(state.inputs).length) {
      state.renames = {};
      state.inputs = {};
      toast('원본이 바뀌어서 별칭 변경을 초기화했어요.');
    }
    state.aliasKey = null;
  }

  /* ---------- 이벤트 연결 ---------- */
  // 원본 칸 내용을 통째로 바꿀 때: 이전 내용을 되돌릴 수 있게 알려줘요
  function replaceSource(text, name, msg) {
    var prev = src.value, prevName = state.fileName;
    src.value = text;
    setFileName(name || null);
    afterSourceChange();
    run();
    if (msg) {
      if (prev.trim() && prev !== text) toast(msg, '되돌리기', function () { src.value = prev; setFileName(prevName); afterSourceChange(); run(); });
      else toast(msg);
    }
  }
  function openFile() { $('fileIn').value = ''; $('fileIn').click(); }
  function saveResult() {
    if (!resultText().trim()) { toast('저장할 결과가 없어요.'); return; }
    var name = state.fileName ? state.fileName.replace(/\.[^.]+$/, '') + '_formatted.sql' : 'formatted.sql';
    download(name, resultText() + '\n');
    toast(name + ' 로 저장했어요. (다운로드 폴더)');
  }
  function copyResult() {
    if (resultText().trim()) copyText(resultText()); else toast('복사할 결과가 없어요.');
  }

  $('btnRun').addEventListener('click', run);
  $('btnOpen').addEventListener('click', openFile);
  $('fileIn').addEventListener('change', function (e) { if (e.target.files[0]) loadFile(e.target.files[0]); });
  $('btnClear').addEventListener('click', function () {
    if (!src.value) { src.focus(); return; }
    replaceSource('', null, '원본을 지웠어요.');
    src.focus();
  });
  $('btnPaste').addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.readText) {
      navigator.clipboard.readText().then(function (t) {
        if (!t.trim()) { toast('클립보드가 비어 있어요.'); return; }
        replaceSource(t, null, '클립보드 내용으로 바꿨어요.');
      }, function () { src.focus(); toast('붙여넣기 권한이 없어요. 입력칸을 누르고 Ctrl+V 를 사용하세요.'); });
    } else { src.focus(); toast('입력칸을 누르고 Ctrl+V 를 사용하세요.'); }
  });
  $('btnCopy').addEventListener('click', copyResult);
  $('btnSave').addEventListener('click', saveResult);
  $('btnToSrc').addEventListener('click', function () {
    var t = resultText();
    if (!t.trim()) { toast('옮길 결과가 없어요.'); return; }
    if (t === src.value) { toast('원본과 결과가 이미 같아요.'); return; }
    setEdited(false); // 고친 내용이 원본이 되니 덮어쓰기 알림은 필요 없어요
    replaceSource(t, state.fileName, '결과를 원본 칸으로 옮겼어요.');
  });
  function drawAuto() {
    $('swAuto').setAttribute('aria-checked', String(state.auto));
    $('btnRun').classList.toggle('primary', !state.auto);
  }
  $('swAuto').addEventListener('click', function () {
    state.auto = !state.auto;
    store.set('auto', state.auto);
    drawAuto();
    if (state.auto) run();
    toast(state.auto ? '자동 포맷을 켰어요. 입력하면 바로 정리돼요.' : '자동 포맷을 껐어요. [포맷 실행] 또는 Ctrl+Enter 로 정리하세요.');
  });
  /* 옵션 패널 접기 · 펼치기 (밀어내기: 접으면 원본 · 결과 칸이 넓어져요) */
  function drawRailDot() {
    var rail = $('optsRail'), dot = rail.querySelector('.odot'), changed = !sameOpts(state.opts, S.DEFAULTS);
    if (changed && !dot) rail.appendChild(h('span', { class: 'odot', title: '기본값과 다른 옵션이 있어요' }));
    else if (!changed && dot) dot.remove();
    rail.title = '옵션 패널 펼치기 (Ctrl+B)' + (changed ? ' · 기본값과 다른 옵션이 있어요' : '');
  }
  function setOptsHidden(on, focus) {
    state.optsHidden = on;
    store.set('optsHidden', on);
    hideTip();
    $('opts').classList.toggle('collapsed', on);
    $('btnOptsHide').setAttribute('aria-expanded', String(!on));
    $('optsRail').setAttribute('aria-expanded', String(!on));
    drawRailDot();
    if (focus) (on ? $('optsRail') : $('btnOptsHide')).focus();
  }
  $('btnOptsHide').addEventListener('click', function () { setOptsHidden(true, true); });
  $('optsRail').addEventListener('click', function () { setOptsHidden(false, true); });

  function setSize(n) {
    state.size = Math.max(10, Math.min(20, n));
    store.set('size', state.size);
    document.documentElement.style.setProperty('--code-size', state.size + 'px');
    src.view.requestMeasure();
    out.view.requestMeasure();
  }
  $('btnSmaller').addEventListener('click', function () { setSize(state.size - 1); });
  $('btnBigger').addEventListener('click', function () { setSize(state.size + 1); });

  $('presetSel').addEventListener('change', function (e) {
    var all = allPresets();
    var n = e.target.value;
    if (!all[n]) return;
    var prev = state.opts, prevBase = state.basePreset;
    setBasePreset(all[n].builtin ? null : n); // 기본 프리셋은 덮어쓸 수 없어서 기억하지 않아요
    setAllOpts(all[n].opts);
    toast('"' + n + '" 프리셋을 적용했어요.', '되돌리기', function () { setBasePreset(prevBase); setAllOpts(prev); });
  });
  $('btnReset').addEventListener('click', function () {
    if (sameOpts(state.opts, S.DEFAULTS)) { toast('이미 기본값이에요.'); return; }
    var prev = state.opts, prevBase = state.basePreset;
    setBasePreset(null);
    setAllOpts(S.DEFAULTS);
    toast('모든 옵션을 기본값으로 되돌렸어요.', '되돌리기', function () { setBasePreset(prevBase); setAllOpts(prev); });
  });
  $('btnSavePreset').addEventListener('click', savePreset);

  var menu = $('presetMenu');
  $('btnPresetMenu').addEventListener('click', function (e) { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', function () { menu.hidden = true; });
  $('mExport').addEventListener('click', exportPresets);
  $('mImport').addEventListener('click', function () { $('presetIn').value = ''; $('presetIn').click(); });
  $('presetIn').addEventListener('change', function (e) { if (e.target.files[0]) importPresets(e.target.files[0]); });
  $('mDelete').addEventListener('click', deletePreset);

  $('dlgForm').addEventListener('submit', function (e) { e.preventDefault(); closeDialog($('dlgInput').hidden ? 'ok' : $('dlgInput').value); });
  $('dlgCancel').addEventListener('click', function () { closeDialog(null); });
  $('dlg').addEventListener('cancel', function (e) { e.preventDefault(); closeDialog(null); });

  /* 파일 끌어다 놓기 */
  var wrap = $('srcwrap');
  function hasFiles(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
  // 파일은 편집기보다 먼저 받아서 인코딩(UTF-8 / EUC-KR)을 맞춰 열어요. 글자를 끌어다 놓는 건 편집기가 처리해요
  ['dragenter', 'dragover'].forEach(function (ev) {
    wrap.addEventListener(ev, function (e) { if (!hasFiles(e)) return; e.preventDefault(); wrap.classList.add('drag'); }, true);
  });
  wrap.addEventListener('dragleave', function () { wrap.classList.remove('drag'); });
  wrap.addEventListener('drop', function (e) {
    wrap.classList.remove('drag');
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    e.preventDefault();
    e.stopPropagation();
    loadFile(f);
  }, true);
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('drop', function (e) { e.preventDefault(); });

  /* 단축키 */
  function edFor(el) { return src.wrap.contains(el) ? src : out.wrap.contains(el) ? out : lastEd; }
  $('btnFind').addEventListener('click', function () { find.open(lastEd, true); });
  var chordUntil = 0; // Ctrl+K 다음 키 (VS Code 와 같은 전체 접기 · 펼치기)
  document.addEventListener('keydown', function (e) {
    var ctrl = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
    if (chordUntil && Date.now() < chordUntil && ctrl && (k === '0' || k === 'j')) {
      e.preventDefault(); chordUntil = 0;
      if (k === '0') out.setLevel(1); else out.unfoldAll();
      return;
    }
    if (ctrl && !e.shiftKey && k === 'k') { e.preventDefault(); chordUntil = Date.now() + 1500; return; }
    if (ctrl && !e.shiftKey && !e.altKey && k === 'b') { e.preventDefault(); setOptsHidden(!state.optsHidden, $('opts').contains(document.activeElement)); return; }
    chordUntil = 0;
    if (ctrl && !e.shiftKey && (k === 'f' || k === 'h')) {
      if ($('find').contains(e.target) && k === 'f') { e.preventDefault(); $('fq').select(); return; }
      e.preventDefault();
      find.open($('find').contains(e.target) ? find.target() : edFor(e.target), k === 'h');
    }
    else if (e.key === 'F8' && notes.on()) { e.preventDefault(); notes.nextEmpty(); }
    else if (e.key === 'F3') { e.preventDefault(); if (find.isOpen()) find.step(e.shiftKey ? -1 : 1); else find.open(edFor(e.target)); }
    else if (ctrl && e.key === 'Enter') { if ($('find').contains(e.target)) return; e.preventDefault(); run(); }
    else if (ctrl && e.shiftKey && k === 'c') { e.preventDefault(); copyResult(); }
    else if (ctrl && !e.shiftKey && k === 's') { e.preventDefault(); saveResult(); }
    else if (ctrl && !e.shiftKey && k === 'o') { e.preventDefault(); openFile(); }
    else if (e.key === 'Escape') { menu.hidden = true; hideTip(); find.close(); }
  });

  /* 좌우 스플릿 */
  var splitter = $('splitter'), split = $('split');
  function setLeft(px) {
    var total = split.clientWidth - 12;
    var min = 220;
    px = Math.max(min, Math.min(total - min, px));
    state.lw = px / (total - px);
    document.documentElement.style.setProperty('--lw', String(state.lw));
    store.set('lw', state.lw);
  }
  splitter.addEventListener('pointerdown', function (e) {
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add('drag');
  });
  splitter.addEventListener('pointermove', function (e) {
    if (!splitter.classList.contains('drag')) return;
    setLeft(e.clientX - split.getBoundingClientRect().left - 6);
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    splitter.addEventListener(ev, function () { splitter.classList.remove('drag'); });
  });
  splitter.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    var w = $('paneL').getBoundingClientRect().width;
    setLeft(w + (e.key === 'ArrowLeft' ? -40 : 40));
  });

  /* ---------- 시작 ---------- */
  document.documentElement.style.setProperty('--code-size', state.size + 'px');
  document.documentElement.style.setProperty('--lw', String(state.lw));
  drawAuto();
  buildTabs();
  buildBody();
  renderPresetSel();
  setOptsHidden(!!store.get('optsHidden', false));
  run();
  if (store.get('notesMode', false)) setNotesMode(true, true);
  src.focus();

  window.__app = { state: state, run: run, src: src, out: out, find: find, notes: notes }; // 점검·테스트용
})();
