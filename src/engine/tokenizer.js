/* 토크나이저: 주석(힌트 포함) · 문자열(q'[...]') · 바인드 · (+) 를 구분합니다. */
(function (g) {
  'use strict';
  var S = (g.SQLF = g.SQLF || {});

  function set(s) { var m = {}; s.split(/\s+/).forEach(function (w) { if (w) m[w] = true; }); return m; }

  // 대소문자 변환 대상 키워드
  var KW = set(
    'SELECT FROM WHERE AND OR NOT IN IS NULL AS ON JOIN INNER LEFT RIGHT FULL OUTER CROSS NATURAL USING ' +
    'GROUP BY ORDER HAVING UNION ALL MINUS INTERSECT DISTINCT UNIQUE CASE WHEN THEN ELSE END BETWEEN LIKE ' +
    'EXISTS ANY SOME ASC DESC NULLS FIRST LAST WITH CONNECT START PRIOR NOCYCLE SIBLINGS FOR UPDATE OF ' +
    'NOWAIT SKIP LOCKED FETCH NEXT ROWS ROW ONLY OFFSET INSERT INTO VALUES SET DELETE MERGE MATCHED ' +
    'RETURNING OVER PARTITION RANGE UNBOUNDED PRECEDING FOLLOWING WITHIN KEEP ESCAPE INTERVAL ' +
    'REGEXP_LIKE DENSE_RANK RETURN LATERAL APPLY MODEL PIVOT UNPIVOT'
  );
  var CONSTS = set('TRUE FALSE SYSDATE SYSTIMESTAMP CURRENT_DATE CURRENT_TIMESTAMP LOCALTIMESTAMP USER ROWNUM ROWID LEVEL DUAL');
  var FUNCS = set(
    'NVL NVL2 DECODE COALESCE NULLIF TRUNC ROUND CEIL FLOOR MOD ABS POWER SQRT SIGN SUM COUNT AVG MIN MAX ' +
    'TO_CHAR TO_DATE TO_NUMBER TO_TIMESTAMP TO_CLOB SUBSTR INSTR LENGTH UPPER LOWER INITCAP TRIM LTRIM RTRIM ' +
    'REPLACE TRANSLATE CONCAT LPAD RPAD ROW_NUMBER RANK DENSE_RANK LAG LEAD FIRST_VALUE LAST_VALUE NTILE ' +
    'GREATEST LEAST CAST EXTRACT LISTAGG ADD_MONTHS MONTHS_BETWEEN LAST_DAY NEXT_DAY SYS_GUID ' +
    'REGEXP_SUBSTR REGEXP_REPLACE REGEXP_INSTR REGEXP_COUNT STDDEV VARIANCE MEDIAN CHR ASCII LNNVL ' +
    'SYS_CONTEXT USERENV XMLAGG XMLELEMENT JSON_VALUE JSON_QUERY JSON_OBJECT WM_CONCAT TABLE'
  );
  // 별칭으로 쓸 수 없는 단어 (절 구분어 · 예약어)
  var RESERVED = set(
    'ALL AND ANY AS ASC BETWEEN BY CASE CONNECT CROSS DELETE DESC DISTINCT ELSE END EXISTS FOR FROM FULL ' +
    'GROUP HAVING IN INNER INSERT INTERSECT INTO IS JOIN LEFT LIKE MINUS NATURAL NOT NULL ON OR ORDER OUTER ' +
    'RIGHT SELECT SET START THEN UNION UNIQUE UPDATE USING VALUES WHEN WHERE WITH MERGE FETCH OFFSET ' +
    'RETURNING OVER PARTITION PRIOR NOCYCLE SIBLINGS FIRST LAST NULLS ROWS ONLY WITHIN KEEP MODEL PIVOT ' +
    'UNPIVOT SAMPLE ESCAPE MATCHED OF TO TABLE BEGIN DECLARE LOCKED SKIP NOWAIT'
  );

  var NAME_PIECE = '(?:"(?:[^"]|"")+"|[\\p{L}_][\\p{L}\\p{N}_$#]*)';
  var RE_NAME = new RegExp(NAME_PIECE + '(?:\\.(?:' + NAME_PIECE + '|\\*))*(?:@' + NAME_PIECE + ')?', 'uy');
  // 1..10 (PL/SQL 범위)의 '..' 을 소수점으로 먹지 않아요
  var RE_NUM = /(?:\d+(?:\.(?!\.)\d*)?|\.\d+)(?:[eE][+-]?\d+)?[fFdD]?/y;
  var RE_BIND = /(?::[\p{L}_][\p{L}\p{N}_$#]*|:\d+|&&?[\p{L}_][\p{L}\p{N}_]*)/uy;
  var RE_OUTER = /\(\s*\+\s*\)/y;
  var RE_STR = /[nN]?'(?:[^']|'')*'?/y;
  var RE_QSTR = /[nN]?[qQ]'/y;
  var TWO = { '||': 1, '<>': 1, '!=': 1, '^=': 1, '<=': 1, '>=': 1, ':=': 1, '=>': 1, '..': 1, '**': 1, '~=': 1 };

  function tokenize(src) {
    var out = [];
    var n = src.length;
    var i = 0;
    var nl = false;
    function mk(k, v, pos) { out.push({ k: k, v: v, nl: nl, pos: pos, end: i }); nl = false; }
    function m(re) { re.lastIndex = i; return re.exec(src); }

    while (i < n) {
      var c = src[i];
      if (c === '\n') { nl = true; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿') { i++; continue; }
      var st = i;
      var r;

      if (c === '-' && src[i + 1] === '-') {
        var e = src.indexOf('\n', i);
        if (e < 0) e = n;
        var v = src.slice(i, e).replace(/\s+$/, '');
        i = e;
        mk('lcomment', v, st);
        continue;
      }
      if (c === '/' && src[i + 1] === '*') {
        var e2 = src.indexOf('*/', i + 2);
        e2 = e2 < 0 ? n : e2 + 2;
        var v2 = src.slice(i, e2);
        i = e2;
        mk(v2.indexOf('/*+') === 0 ? 'hint' : 'bcomment', v2, st);
        continue;
      }
      if ((c === 'q' || c === 'Q' || c === 'n' || c === 'N') && (r = m(RE_QSTR))) {
        var p = i + r[0].length;
        var d = src[p];
        if (d && !/\s/.test(d)) {
          var close = ({ '[': ']', '(': ')', '{': '}', '<': '>' })[d] || d;
          var j = src.indexOf(close + "'", p + 1);
          i = j < 0 ? n : j + 2;
          mk('string', src.slice(st, i), st);
          continue;
        }
      }
      if ((c === "'" || ((c === 'n' || c === 'N') && src[i + 1] === "'")) && (r = m(RE_STR))) {
        i += r[0].length;
        mk('string', r[0], st);
        continue;
      }
      if (((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) && (r = m(RE_NUM))) {
        i += r[0].length;
        mk('number', r[0], st);
        continue;
      }
      if ((c === ':' || c === '&') && (r = m(RE_BIND))) {
        i += r[0].length;
        mk('bind', r[0], st);
        continue;
      }
      if (c === '(' && (r = m(RE_OUTER))) {
        i += r[0].length;
        mk('op', '(+)', st);
        continue;
      }
      if ((r = m(RE_NAME))) {
        i += r[0].length;
        var plain = r[0].indexOf('.') < 0 && r[0].indexOf('"') < 0 && r[0].indexOf('@') < 0;
        mk(plain ? 'word' : 'name', r[0], st);
        continue;
      }
      var two = src.substr(i, 2);
      if (TWO[two]) { i += 2; mk('op', two, st); continue; }
      i++;
      if (c === '(' || c === ')' || c === ',' || c === ';') mk('punct', c, st);
      else mk('op', c, st);
    }
    return out;
  }

  S.sets = { KW: KW, CONSTS: CONSTS, FUNCS: FUNCS, RESERVED: RESERVED };
  S.tokenize = tokenize;
})(typeof window !== 'undefined' ? window : globalThis);
