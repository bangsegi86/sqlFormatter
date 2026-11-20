'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/engine/load.js');

const MAIN = "select a.emp_no,a.emp_nm,b.dept_nm,decode(a.gender,'M','Male','F','Female','Other') gender_nm,case when a.sal>=5000 then 'HIGH' when a.sal>=3000 then 'MID' else 'LOW' end sal_grade,(select count(*) from tb_order o where o.emp_no=a.emp_no and o.ord_dt>=trunc(sysdate,'MM')) ord_cnt,nvl(c.bonus,0) bonus from tb_emp a,tb_dept b,(select emp_no,sum(bonus_amt) bonus from tb_bonus where yy='2026' group by emp_no) c where a.dept_no=b.dept_no and a.emp_no=c.emp_no(+) and a.use_yn='Y' and b.dept_no in (select dept_no from tb_dept_auth where user_id=:user_id) order by a.emp_no";

const CORPUS = [
  MAIN,
  "select * from dual",
  "select distinct a.x, b.y from t1 a inner join t2 b on a.id=b.id and a.k=b.k left join t3 c on c.id=a.id where a.z between 1 and 10 and (a.q='A' or a.q='B') group by a.x,b.y having count(*)>1 order by 1 desc,2",
  "with e as (select emp_no, dept_no from tb_emp where use_yn='Y'), d as (select dept_no, dept_nm from tb_dept) select e.emp_no, d.dept_nm from e join d on d.dept_no=e.dept_no",
  "select a from t1 union all select a from t2 minus select a from t3",
  "insert into tb_emp (emp_no, emp_nm, sal) values (:no, :nm, 100)",
  "insert into tb_emp_hist (emp_no,emp_nm) select emp_no, emp_nm from tb_emp where sal>1000",
  "update tb_emp a set a.emp_nm=:nm, a.sal=a.sal*1.1 where a.emp_no=:no and exists (select 1 from tb_dept d where d.dept_no=a.dept_no)",
  "delete from tb_emp where emp_no in (select emp_no from tb_retire) and use_yn='N'",
  "merge into tb_a a using (select id, val from tb_b where use_yn='Y') b on (a.id=b.id) when matched then update set a.val=b.val, a.upd_dt=sysdate when not matched then insert (id,val) values (b.id,b.val)",
  "select level, connect_by_root emp_no from tb_emp start with mgr is null connect by prior emp_no=mgr order siblings by emp_nm",
  "select e.*, row_number() over (partition by dept_no order by sal desc) rn from tb_emp e where rownum<=10 for update of e.sal nowait",
  "select nvl(a,0)+1 x, -1 y, a||b||'c' z, to_char(sysdate,'YYYY-MM-DD') d, date '2020-01-01' dt, interval '1' day iv from t",
  "select case a.t when 'A' then 1 when 'B' then 2 else 3 end x, decode(a.c,null,'N',1,'one','other') y from t a",
  "select /*+ index(a idx_a) */ a.x from t a where a.y in (1,2,3,4,5,6,7,8,9,10,11,12) and a.z not in (select z from u)",
  "select a.x -- first\n, a.y /* second */ , a.z\nfrom t a -- table\nwhere a.x = 1 -- cond\n and a.y = 2",
  "select 1 from dual; select 2 from dual; update t set a=1;",
  "select \"MyCol\", t.\"Other\" as \"My Alias\", q'[it's]' q from \"Tbl\" t"
];

function sig(text) {
  return S.tokenize(text)
    .filter((t) => t.k !== 'lcomment' && t.k !== 'bcomment')
    .map((t) => (t.k === 'word' ? t.v.toUpperCase() : t.v))
    .filter((v) => v !== ';');
}

test('시안과 같은 모양으로 포맷한다 (후행 콤마)', () => {
  const r = S.format(MAIN, {});
  assert.equal(r.errors.length, 0);
  const expect = [
    'SELECT a.emp_no,',
    '       a.emp_nm,',
    '       b.dept_nm,',
    "       DECODE(a.gender, 'M', 'Male',",
    "                        'F', 'Female',",
    "                        'Other') AS gender_nm,",
    "       CASE WHEN a.sal >= 5000 THEN 'HIGH'",
    "            WHEN a.sal >= 3000 THEN 'MID'",
    "            ELSE 'LOW'",
    '       END AS sal_grade,',
    '       (SELECT COUNT(*)',
    '          FROM tb_order o',
    '         WHERE o.emp_no = a.emp_no',
    "           AND o.ord_dt >= TRUNC(SYSDATE, 'MM')) AS ord_cnt,",
    '       NVL(c.bonus, 0) AS bonus',
    '  FROM tb_emp  a,',
    '       tb_dept b,',
    '       (SELECT emp_no, SUM(bonus_amt) AS bonus',
    '          FROM tb_bonus',
    "         WHERE yy = '2026'",
    '         GROUP BY emp_no) c',
    ' WHERE a.dept_no = b.dept_no',
    '   AND a.emp_no  = c.emp_no(+)',
    "   AND a.use_yn  = 'Y'",
    '   AND b.dept_no IN (SELECT dept_no',
    '                       FROM tb_dept_auth',
    '                      WHERE user_id = :user_id)',
    ' ORDER BY a.emp_no;'
  ].join('\n');
  assert.equal(r.text, expect);
});

test('선행 콤마', () => {
  const t = S.format(MAIN, { comma: 'leading' }).text;
  assert.match(t, /^SELECT a\.emp_no\n {5}, a\.emp_nm\n {5}, b\.dept_nm/);
  assert.match(t, /\n {22}, 'F', 'Female'\n {22}, 'Other'\) AS gender_nm/);
  assert.match(t, /\n {2}FROM tb_emp {2}a\n {5}, tb_dept b\n {5}, \(SELECT/);
});

test('통계: 블록·서브쿼리 종류·CASE·DECODE·바인드·(+)', () => {
  const s = S.format(MAIN, {}).stats;
  assert.equal(s.blocks, 4);
  assert.equal(s.scalar, 1);
  assert.equal(s.inline, 1);
  assert.equal(s.cond, 1);
  assert.equal(s.cases, 1);
  assert.equal(s.decodes, 1);
  assert.equal(s.binds, 1);
  assert.equal(s.outer, 1);
});

test('멱등성: 한 번 더 포맷해도 같다', () => {
  const variants = [{}, { comma: 'leading' }, { clause: 'left' }, { kwcase: 'lower' }, { perline: '3', casewhen: 'auto', scalar: 'short' }, { subbreak: true }, { arithwrap: 'break', concatwrap: 'break', arithmin: 2, concatmin: 2 }, { arithwrap: 'break', concatwrap: 'break', arithmin: 2, casewhen: 'complex', casethen: 'next' }];
  for (const opt of variants) {
    for (const q of CORPUS) {
      const once = S.format(q, opt);
      assert.equal(once.errors.length, 0, 'errors for: ' + q + ' ' + JSON.stringify(once.errors));
      const twice = S.format(once.text, opt);
      assert.equal(twice.text, once.text, '멱등성 실패 ' + JSON.stringify(opt) + '\n' + q + '\n--1--\n' + once.text + '\n--2--\n' + twice.text);
    }
  }
});

test('의미 보존: 토큰 순서가 원본과 같다 (변환 옵션 끔)', () => {
  const variants = [{}, { comma: 'leading', kwcase: 'lower' }, { clause: 'left', perline: 'auto' }, { opspace: false }, { arithwrap: 'break', concatwrap: 'break', arithmin: 2, concatmin: 2 }];
  for (const opt of variants) {
    for (const q of CORPUS) {
      const out = S.format(q, Object.assign({ asword: 'keep' }, opt));
      assert.deepEqual(sig(out.text).map((v) => v.toUpperCase()), sig(q).map((v) => v.toUpperCase()), '토큰 달라짐 ' + JSON.stringify(opt) + '\n' + q + '\n' + out.text);
    }
  }
});

test('INSERT / UPDATE / DELETE / MERGE', () => {
  assert.equal(
    S.format("insert into tb_emp (emp_no, emp_nm, sal) values (:no, :nm, 100)").text,
    'INSERT INTO tb_emp (emp_no, emp_nm, sal)\nVALUES (:no, :nm, 100);'
  );
  assert.equal(
    S.format("update tb_emp a set a.emp_nm=:nm, a.sal=a.sal*1.1 where a.emp_no=:no").text,
    ['UPDATE tb_emp a', '   SET a.emp_nm = :nm,', '       a.sal    = a.sal * 1.1', ' WHERE a.emp_no = :no;'].join('\n')
  );
  assert.equal(
    S.format("delete from tb_emp where emp_no=1 and use_yn='N'").text,
    ['DELETE FROM tb_emp', " WHERE emp_no = 1", "   AND use_yn = 'N';"].join('\n')
  );
  const m = S.format(CORPUS[9]).text;
  assert.match(m, /MERGE INTO tb_a a\n USING \(SELECT id, val\n/);
  assert.match(m, /\n {4}ON \(a\.id = b\.id\)\n {2}WHEN MATCHED THEN\n {7}UPDATE SET a\.val\s+= b\.val,/);
  assert.match(m, /WHEN NOT MATCHED THEN\n {7}INSERT \(id, val\)\n {7}VALUES \(b\.id, b\.val\);$/);
});

test('WITH / UNION / ANSI JOIN 표기', () => {
  const w = S.format(CORPUS[3]).text;
  assert.match(w, /^WITH e AS \(\n {4}SELECT emp_no, dept_no\n/);
  assert.match(w, /\n\),\n {5}d AS \(\n/);
  const u = S.format(CORPUS[4]).text;
  assert.equal(u, ['SELECT a', '  FROM t1', 'UNION ALL', 'SELECT a', '  FROM t2', 'MINUS', 'SELECT a', '  FROM t3;'].join('\n'));
  const j = S.format(CORPUS[2]).text;
  assert.match(j, /\n {2}INNER JOIN t2 b\n {4}ON a\.id = b\.id\n {3}AND a\.k {2}= b\.k\n {2}LEFT JOIN t3 c\n/);
});

test('한 줄에 컬럼 몇 개 / N개 이하 한 줄', () => {
  const q = 'select a,b,c,d,e from t';
  assert.equal(S.format(q, { oneline: 1 }).text, 'SELECT a,\n       b,\n       c,\n       d,\n       e\n  FROM t;');
  assert.equal(S.format(q, { perline: '2' }).text, 'SELECT a, b,\n       c, d,\n       e\n  FROM t;');
  assert.equal(S.format(q, { oneline: 5 }).text, 'SELECT a, b, c, d, e\n  FROM t;');
  assert.equal(S.format(q, { perline: '3', comma: 'leading' }).text, 'SELECT a, b, c\n     , d, e\n  FROM t;');
});

test('CASE · DECODE 옵션', () => {
  const q = "select case when a=1 then 'x' when a=2 then 'y' else 'z' end c, decode(a,1,'x',2,'y','z') d from t";
  const one = S.format(q, { casewhen: 'one', decodeargs: 'one', oneline: 1 }).text;
  assert.match(one, /CASE WHEN a = 1 THEN 'x' WHEN a = 2 THEN 'y' ELSE 'z' END AS c,\n {7}DECODE\(a, 1, 'x', 2, 'y', 'z'\) AS d/);
  const nxt = S.format(q, { casethen: 'next', caseend: 'when', oneline: 1 }).text;
  assert.match(nxt, /CASE WHEN a = 1\n {14}THEN 'x'\n {12}WHEN a = 2\n/);
  assert.match(nxt, /ELSE 'z'\n {12}END AS c/);
});

test('DECODE → CASE 변환은 NULL 비교 규칙을 지킨다', () => {
  const t = S.format("select decode(a,null,'N',1,'one',b,'B','other') x from t", { decode2case: true, casewhen: 'one' }).text;
  assert.match(t, /CASE WHEN a IS NULL THEN 'N' WHEN a = 1 THEN 'one' WHEN \(a = b OR a IS NULL AND b IS NULL\) THEN 'B' ELSE 'other' END AS x/);
});

test('NVL → COALESCE', () => {
  assert.match(S.format('select nvl(a,0) from t', { nvl2coal: true }).text, /COALESCE\(a, 0\)/);
});

test('스칼라 서브쿼리 · 인라인 뷰 옵션', () => {
  const q = 'select (select max(x) from u where u.k=t.k) m from t';
  assert.match(S.format(q, { scalar: 'short' }).text, /SELECT \(SELECT MAX\(x\) FROM u WHERE u\.k = t\.k\) AS m/);
  const iv = 'select * from (select a from u) v';
  assert.equal(S.format(iv, { inline: 'next' }).text, 'SELECT *\n  FROM (\n      SELECT a\n        FROM u\n  ) v;');
});

test('산술 · 연결 연산자 줄바꿈', () => {
  const q = "select a+b+c+d s, x-1 y, 'a'||b||'c'||d n, sum(a+b+c+d) t from u where k = a+b+c+d";
  const off = S.format(q).text;
  assert.match(off, /a \+ b \+ c \+ d AS s/);
  const on = S.format(q, { arithwrap: 'break', concatwrap: 'break' }).text;
  assert.match(on, /SELECT a\n {7}\+ b\n {7}\+ c\n {7}\+ d AS s,/);
  assert.match(on, /x - 1 AS y/);                         // 항이 기준(4개)보다 적으면 그대로
  assert.match(on, /'a'\n {7}\|\| b\n {7}\|\| 'c'\n {7}\|\| d AS n/);
  assert.match(on, /SUM\(a \+ b \+ c \+ d\)/);               // 함수 인자 안은 그대로
  assert.match(on, /WHERE k = a\n {11}\+ b/);               // 비교식은 오른쪽만 나눠요
  assert.match(S.format(q, { arithwrap: 'break', arithmin: 5 }).text, /a \+ b \+ c \+ d AS s/);
});

test('복잡한 식: 함수 안 연산자 · CASE 복잡하면 개행 · 단순 항목만 한 줄', () => {
  const q = "select sum(nvl(case when a = 1 then fn(b) * c end, 0) + nvl(case when a = 2 then fn(d) * c end, 0)) + 19 tot, no from t";
  const on = { arithwrap: 'break', arithmin: 2, casewhen: 'complex' };
  const t = S.format(q, on).text;
  assert.match(t, /^SELECT SUM\(NVL\(CASE WHEN a = 1 THEN fn\(b\) \* c\n {15}END,/);
  assert.match(S.format(q, Object.assign({}, on, { casethen: 'next' })).text, /^SELECT SUM\(NVL\(CASE WHEN a = 1\n {22}THEN fn\(b\) \* c\n {15}END,/);
  assert.match(t, /\n {11}\+ NVL\(CASE WHEN a = 2/);    // 함수 안에서도 + 앞에서 개행
  assert.match(t, /\n {7}\+ 19 AS tot,\n {7}no\n/);     // 복잡한 항목이 있으면 한 줄로 묶지 않음
  const off = S.format(q, Object.assign({}, on, { opinner: false })).text;
  assert.match(off, /END,\n {15}0\) \+ NVL\(/);           // 끄면 함수 안은 나누지 않음
  // 단순한 경우는 그대로
  const s = S.format("select nvl(a,0), b from t where x in (select case when y = 1 then 'Y' end from u)", on).text;
  assert.match(s, /^SELECT NVL\(a, 0\), b\n/);
  assert.match(s, /CASE WHEN y = 1 THEN 'Y' END/);
  assert.match(S.format('select sum(a+b+c+d) s, (select x+y+z from u) v from t', on).text, /SUM\(a \+ b \+ c \+ d\)/);
});

test('INTERVAL 리터럴 뒤 별칭 · 단위를 별칭으로 오해하지 않음', () => {
  const q = "select interval '1' day iv, interval '2' day from t";
  const t = S.format(q).text;
  assert.match(t, /INTERVAL '1' day AS iv,/);
  assert.match(t, /INTERVAL '2' day\n/);
  const a = S.format(q, { autoalias: true }).text;
  assert.equal(S.format(a, { autoalias: true }).text, a); // 두 번 돌려도 별칭이 늘어나지 않음
  assert.doesNotMatch(a, /day day/i);
});

test('스칼라 서브쿼리 "단순하면 한 줄"은 구조로 판단', () => {
  const q = 'select (select max(b.dt) from tb b where b.id = a.id) mx, (select count(*) from tc c, td d where c.id = d.id) cnt from ta a';
  const t = S.format(q, { scalar: 'short' }).text;
  assert.match(t, /\(SELECT MAX\(b\.dt\) FROM tb b WHERE b\.id = a\.id\) AS mx/);
  assert.match(t, /\(SELECT COUNT\(\*\)\n/); // 조인이 있으면 여러 줄
});

test('예전 옵션 값은 지금 선택지로 바뀜', () => {
  const o = S.sanitizeOpts({ casewhen: 'auto', decodeargs: 'auto', subbreak: true, perline: 7, oneline: 99, kwcase: 'xx', width: 80 });
  assert.equal(o.casewhen, 'one');
  assert.equal(o.decodeargs, 'one');
  assert.equal(o.subind, 'fixed');
  assert.equal(o.perline, '1');
  assert.equal(o.oneline, 10);
  assert.equal(o.kwcase, 'UPPER');
  assert.equal(o.width, 80); // 정의에 없는 키는 그대로 (엔진에서 무시)
});

test('IN 목록 한 줄 최대 개수', () => {
  const t = S.format('select 1 from t where a in (1,2,3,4,5,6,7)', { inmax: 3 }).text;
  assert.match(t, /IN \(1, 2, 3,\n\s+4, 5, 6,\n\s+7\)/);
});

test('주석을 보존한다', () => {
  const t = S.format(CORPUS[15]).text;
  assert.match(t, /a\.x, -- first/);
  assert.match(t, /\/\* second \*\//);
  assert.match(t, /-- cond/);
  assert.match(t, /-- table/);
  const moved = S.format(CORPUS[15], { cmtkeep: false }).text;
  assert.match(moved, /^-- first\nSELECT a\.x,/);
});

test('종결 문자 옵션', () => {
  assert.equal(S.format('select 1 from dual', { term: 'slash' }).text, 'SELECT 1\n  FROM DUAL\n/');
  assert.equal(S.format('select 1 from dual', { term: 'none' }).text, 'SELECT 1\n  FROM DUAL');
  assert.equal(S.format('select 1 from dual; select 2 from dual', { term: 'none' }).text, 'SELECT 1\n  FROM DUAL;\n\nSELECT 2\n  FROM DUAL');
});

test('해석 못 하는 문장은 원문을 지키고 오류를 알려준다', () => {
  const r = S.format('select a from (select b from t\n;\nexplain plan for x (a number)');
  assert.ok(r.errors.length >= 1);
  assert.match(r.text, /explain plan for x \(a number\)/);
  const bad = S.format('select a from t where (a = 1');
  assert.equal(bad.errors.length, 1);
  assert.equal(bad.text, 'select a from t where (a = 1');
});

test('결과에 탭을 쓰지 않는다 (문자열 값 안의 탭만 그대로)', () => {
  const src = "select a\t-- c\tx\nfrom t /*\tb\n\t\tc */ where s = 'x\ty';\nbegin\n\tnull;\t-- c\nend;\nexplain plan x (a\tnumber);";
  for (const o of [{}, { plmode: 'keep' }, { tabsize: 2 }]) {
    const r = S.format(src, o).text;
    assert.equal((r.match(/\t/g) || []).length, 1, r);
    assert.match(r, /'x\ty'/);
  }
  // 탭 간격 기준으로 바꿔서 원래 줄 맞춤을 지켜요
  assert.match(S.format('explain plan x (a\tnumber,\n\tbb\tdate);').text, /\(a   number,\n    bb  date\);/);
  assert.match(S.format('explain plan x (a\tnumber);', { tabsize: 8 }).text, /\(a       number\)/);
});

test('PL/SQL "원문 유지"면 블록을 그대로 둔다', () => {
  const src = "begin\n  update t set a = 1;\n  commit;\nend;\n/";
  const r = S.format(src, { plmode: 'keep' });
  assert.equal(r.text, src);
});

test('PL/SQL 블록: 제어문 들여쓰기 · 안쪽 SQL 정리', () => {
  const src = [
    'create or replace procedure sp_x(pi_id in varchar2 -- 아이디',
    ', po_msg out varchar2)',
    'is',
    'v_cnt number := 0;',
    'v_user_nm varchar2(100);',
    'cursor c1 is select a.id from tb_a a where a.k = pi_id;',
    'begin',
    'v_cnt := 1;',
    'po_msg := \'x\';',
    'if v_cnt = 0 then',
    'select count(*) into v_cnt from tb_a where id = pi_id;',
    'elsif v_cnt > 1 and v_cnt < 10 and pi_id is not null then',
    'for r in (select id from tb_b) loop',
    'update tb_b set k = 1 where id = r.id;',
    'end loop;',
    'else',
    'null;',
    'end if;',
    'exception',
    'when others then',
    'rollback;',
    'end;',
    '/'
  ].join('\n');
  const r = S.format(src);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.text, [
    'CREATE OR REPLACE PROCEDURE sp_x (',
    '    pi_id  IN  VARCHAR2, -- 아이디',
    '    po_msg OUT VARCHAR2',
    ')',
    'IS',
    '    v_cnt     NUMBER := 0;',
    '    v_user_nm VARCHAR2(100);',
    '    CURSOR c1 IS',
    '        SELECT a.id',
    '          FROM tb_a a',
    '         WHERE a.k = pi_id;',
    'BEGIN',
    '    v_cnt  := 1;',
    "    po_msg := 'x';",
    '    IF v_cnt = 0 THEN',
    '        SELECT COUNT(*)',
    '          INTO v_cnt',
    '          FROM tb_a',
    '         WHERE id = pi_id;',
    '    ELSIF v_cnt > 1',
    '          AND v_cnt < 10',
    '          AND pi_id IS NOT NULL THEN',
    '        FOR r IN (SELECT id',
    '                    FROM tb_b) LOOP',
    '            UPDATE tb_b',
    '               SET k = 1',
    '             WHERE id = r.id;',
    '        END LOOP;',
    '    ELSE',
    '        NULL;',
    '    END IF;',
    'EXCEPTION',
    '    WHEN OTHERS THEN',
    '        ROLLBACK;',
    'END;',
    '/'
  ].join('\n'));
  // 두 번 정리해도 같고, 쿼리 내용(토큰)은 그대로
  assert.equal(S.format(r.text).text, r.text);
  const sig = (t) => S.tokenize(t).filter((x) => !/comment/.test(x.k)).map((x) => x.v.toUpperCase()).join(' ');
  assert.equal(sig(r.text), sig(src));
  // 들여쓰기 칸 수 옵션
  assert.match(S.format(src, { plind: 2 }).text, /\nBEGIN\n {2}v_cnt  := 1;/);
});

test('PL/SQL: 패키지 · 트리거 · CASE문 · WHILE · FORALL · OPEN FOR · 중첩 블록', () => {
  const srcs = [
    'create or replace package body pkg is procedure p(a number, b varchar2) is begin null; end p; ' +
      'function f(x number) return number is v pls_integer; begin select count(*) into v from t where k = x; return v; ' +
      'exception when no_data_found then return 0; end f; end pkg;\n/',
    'create or replace trigger trg before insert on t for each row when (new.id > 0) declare v date := sysdate; ' +
      'begin :new.dt := v; if inserting then null; end if; end;\n/',
    'declare type t_ids is table of number index by pls_integer; v t_ids; c sys_refcursor; i pls_integer := 0; begin ' +
      '<<l1>> while i < 10 loop i := i + 1; case i when 1 then null; else exit l1 when i > 5; end case; end loop l1; ' +
      'for j in reverse 1..10 loop v(j) := j; end loop; forall k in 1 .. v.count insert into t (id) values (v(k)); ' +
      "open c for select id from t; execute immediate 'delete t' using i; begin commit; exception when others then rollback; end; end;"
  ];
  const sig = (t) => S.tokenize(t).filter((x) => !/comment/.test(x.k)).map((x) => x.v.toUpperCase()).join(' ');
  for (const src of srcs) {
    const r = S.format(src);
    assert.deepEqual(r.warnings, [], src);
    assert.equal(sig(r.text), sig(src));
    assert.equal(S.format(r.text).text, r.text);
  }
  const p = S.format(srcs[0]).text;
  assert.match(p, /\n {4}PROCEDURE p \(\n {8}a NUMBER,\n {8}b VARCHAR2\n {4}\)\n {4}IS\n {4}BEGIN\n/);
  assert.match(p, /\n {4}FUNCTION f \(x NUMBER\) RETURN NUMBER\n {4}IS\n {8}v PLS_INTEGER;\n {4}BEGIN\n {8}SELECT COUNT\(\*\)\n {10}INTO v\n/);
  assert.match(p, /\n {4}EXCEPTION\n {8}WHEN no_data_found THEN\n {12}RETURN 0;\n {4}END f;\nEND pkg;\n\/$/);
  const d = S.format(srcs[2]).text;
  assert.match(d, /\n {4}<<l1>>\n {4}WHILE i < 10 LOOP\n {8}i := i \+ 1;\n {8}CASE i\n {12}WHEN 1 THEN\n {16}NULL;\n {12}ELSE\n {16}EXIT l1 WHEN i > 5;\n {8}END CASE;\n {4}END LOOP l1;/);
  assert.match(d, /TYPE t_ids IS TABLE OF NUMBER INDEX BY PLS_INTEGER;/);
  assert.match(d, /\n {4}FOR j IN REVERSE 1\.\.10 LOOP\n/);
  assert.match(d, /\n {4}OPEN c FOR\n {8}SELECT id\n {10}FROM t;/);
});

test('PL/SQL: 블록 짝이 안 맞으면 원문 그대로 두고 알려준다', () => {
  const src = 'begin\n  if a = 1 then\n    null;\n  end loop;\nend;';
  const r = S.format(src);
  assert.equal(r.text, src);
  assert.ok(r.warnings.some((w) => /PL\/SQL 블록 구조/.test(w)));
});

test('PL/SQL: 해석 못 하는 문장은 그 문장만 원문', () => {
  const src = 'begin\n  x := 1;\n  insert into t values 1;\n  y := 2;\nend;';
  const r = S.format(src);
  assert.equal(r.text, 'BEGIN\n    x := 1;\n    insert into t values 1;\n    y := 2;\nEND;');
  assert.ok(r.warnings.some((w) => /해석하지 못한 문장 1개/.test(w)));
});

test('별칭 일괄 변경: 스코프를 구분하고 참조를 함께 바꾼다', () => {
  const q = 'select a.x, (select max(a.y) from u a where a.k = 1) m from t a where a.z = 2';
  const rows = S.analyzeAliases(q);
  const main = rows.find((r) => r.alias === 'a' && /메인/.test(r.scope));
  assert.ok(main);
  const out = S.format(q, { aliasRenames: { [main.id]: 'tt' }, scalar: 'short' }).text;
  assert.match(out, /SELECT tt\.x,/);
  assert.match(out, /FROM t tt/);
  assert.match(out, /WHERE tt\.z = 2/);
  // 서브쿼리의 같은 이름(a)은 자기 범위의 별칭이라 그대로
  assert.match(out, /MAX\(a\.y\) FROM u a WHERE a\.k = 1/);
});

test('별칭 변경: 바깥 참조를 서브쿼리가 가려도 안전하다', () => {
  const q = 'select a.x from t a where exists (select 1 from u b where b.k = a.k)';
  const main = S.analyzeAliases(q).find((r) => r.alias === 'a');
  const out = S.format(q, { aliasRenames: { [main.id]: 'e' } }).text;
  assert.match(out, /b\.k = e\.k/);
  // 이미 쓰는 이름으로는 못 바꾼다
  const bad = S.format(q, { aliasRenames: { [main.id]: 'b' } });
  assert.ok(bad.warnings.length >= 1);
  assert.match(bad.text, /FROM t a/);
});

test('테이블 별칭 자동 부여 (tb_emp.col 참조도 함께)', () => {
  const q = 'select tb_emp.emp_no, tb_dept.dept_nm from tb_emp, tb_dept where tb_emp.dept_no = tb_dept.dept_no';
  const out = S.format(q, { autotbl: true }).text;
  assert.match(out, /SELECT e\.emp_no,\s+d\.dept_nm/);
  assert.match(out, /FROM tb_emp {2}e,/);
  assert.match(out, /WHERE e\.dept_no = d\.dept_no/);
});

test('컬럼 별칭 자동 부여', () => {
  const q = "select a.x, nvl(c.bonus,0), count(*), 'k', a.y + 1 from t a";
  const out = S.format(q, { autoalias: true, oneline: 1 }).text;
  assert.match(out, /NVL\(c\.bonus, 0\) AS bonus,/);
  assert.match(out, /COUNT\(\*\) AS col_3,/);
  assert.match(out, /'k' AS col_4,/);
  assert.match(out, /a\.y \+ 1 AS y/);
});

test('(+) 조인을 ANSI JOIN 으로 변환', () => {
  const q = "select a.x, c.bonus from tb_emp a, tb_dept b, tb_bonus c where a.dept_no = b.dept_no and a.emp_no = c.emp_no(+) and c.yy(+) = '2026' and a.use_yn = 'Y'";
  const r = S.format(q, { join: 'ansi', oneline: 5 });
  assert.equal(r.errors.length, 0);
  assert.equal(r.warnings.length, 0, r.warnings.join(','));
  assert.equal(r.text, [
    'SELECT a.x, c.bonus',
    '  FROM tb_emp a',
    '  INNER JOIN tb_dept b',
    '    ON a.dept_no = b.dept_no',
    '  LEFT OUTER JOIN tb_bonus c',
    '    ON a.emp_no = c.emp_no',
    "   AND c.yy     = '2026'",
    " WHERE a.use_yn = 'Y';"
  ].join('\n'));
});

test('(+) 없는 콤마 조인도 INNER JOIN 으로 변환', () => {
  const r = S.format("select a.x from ta a, tb b where a.id = b.id and a.dt = :dt", { join: 'ansi' });
  assert.equal(r.warnings.length, 0, r.warnings.join(','));
  assert.equal(r.text, ['SELECT a.x', '  FROM ta a', '  INNER JOIN tb b', '    ON a.id = b.id', ' WHERE a.dt = :dt;'].join('\n'));
  // 조인 조건이 없는 테이블이 있으면 원문 유지 + 알림
  const c = S.format('select 1 from ta a, tb b, tc c where a.id = b.id', { join: 'ansi' });
  assert.ok(c.warnings.some((w) => /연결되지 않는 테이블.*c/.test(w)));
  assert.match(c.text, /FROM ta a,/);
});

test('(+) 변환이 안전하지 않으면 원문을 두고 알려준다', () => {
  const q = 'select 1 from a, b where a.x = b.x(+) or a.y = 1';
  const r = S.format(q, { join: 'ansi' });
  assert.ok(r.warnings.length >= 1);
  assert.match(r.text, /\(\+\)/);
});

test('한글 식별자와 따옴표 식별자', () => {
  const t = S.format('select a.사원명 as "사원 이름" from 사원 a where a.부서 = :dept').text;
  assert.equal(t, ['SELECT a.사원명 AS "사원 이름"', '  FROM 사원 a', ' WHERE a.부서 = :dept;'].join('\n'));
});

test('구문 강조 조각을 만든다', () => {
  const parts = S.highlight("SELECT a.x, 'k' FROM t -- c");
  assert.equal(parts.map((p) => p.t).join(''), "SELECT a.x, 'k' FROM t -- c");
  assert.ok(parts.some((p) => p.c === 'kw' && p.t === 'SELECT'));
  assert.ok(parts.some((p) => p.c === 'al' && p.t === 'a'));
  assert.ok(parts.some((p) => p.c === 'st'));
  assert.ok(parts.some((p) => p.c === 'cm'));
});

test('IF 접기: 겹친 IF · ELSIF · ELSE · 여러 줄 조건의 짝을 찾는다', () => {
  const t = [
    'BEGIN',                                   // 0
    '    IF a = 1',                            // 1
    '       AND b = 2 THEN',                   // 2
    "        x := 'END IF'; -- IF in comment", // 3
    '        IF c = 3 THEN',                   // 4
    '            y := 1;',                     // 5
    '        END IF;',                         // 6
    '    ELSIF a = 2 THEN',                    // 7
    '        z := CASE WHEN q = 1 THEN 1 ELSE 2 END;', // 8
    '    ELSE',                                // 9
    '        NULL;',                           // 10
    '    END IF;',                             // 11
    'END;'
  ].join('\n');
  const b = S.ifBlocks(t);
  assert.equal(b.length, 2);
  const [o, i] = b;
  assert.deepEqual([o.start, o.end, o.depth], [1, 11, 0]);
  assert.deepEqual([i.start, i.end, i.depth], [4, 6, 1]);
  assert.deepEqual(o.branches.map((x) => [x.kind, x.start, x.hdrEnd, x.bodyEnd]), [['IF', 1, 2, 6], ['ELSIF', 7, 7, 8], ['ELSE', 9, 9, 10]]);
  assert.equal(o.cond, 'a = 1 AND b = 2');
  assert.equal(o.rest, 'AND b = 2 THEN');
  assert.equal(o.branches[1].cond, 'a = 2');
  // 접는 범위: IF 첫 줄 끝 ~ END IF 앞
  assert.equal(t.slice(o.endPos, o.endPos + 6), 'END IF');
  assert.equal(t[o.firstLineEnd], '\n');
});

test('IF 접기: 짝이 안 맞는 IF 는 접지 않는다', () => {
  assert.equal(S.ifBlocks('BEGIN\n  IF a = 1 THEN\n    x := 1;\nEND;').length, 0);
  assert.equal(S.ifBlocks("SELECT 'IF' FROM dual").length, 0);
  // 한 줄 IF 는 접을 게 없어요
  assert.equal(S.ifBlocks('BEGIN IF a = 1 THEN x := 1; END IF; END;')[0].foldable, false);
});

test('IF 접기: 예제 프로시저의 IF 를 모두 짝지어 찾는다', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const p = path.join(__dirname, '..', 'sample_proc.sql');
  if (!fs.existsSync(p)) return;
  const text = S.format(fs.readFileSync(p, 'utf8')).text;
  const ifs = (text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'(?:[^']|'')*'|--.*$/gm, '').match(/(?<!END\s+)\bIF\b/gi) || []).length;
  const b = S.ifBlocks(text);
  assert.equal(b.length, ifs);
  b.forEach((x) => assert.ok(x.end > x.start || !x.foldable));
});

test('PL/SQL: 주석과 문장 사이의 빈 줄을 지킨다', () => {
  const q = ['BEGIN', '  /* 블록', '  주석 */', '', '  V := 1;', '  --주석', '', '  IF A = 1 THEN', '    B := 2;', '  END IF;', 'END;'].join('\n');
  const t = S.format(q).text;
  assert.match(t, /주석 \*\/\n\n {4}V := 1;/);
  assert.match(t, /--주석\n\n {4}IF A = 1 THEN/);
});

test('빈 줄 탭: 덩어리 앞뒤 · 블록 경계 규칙', () => {
  const q = ['BEGIN', "  V := '1';", '  SELECT A INTO V FROM T;', '  IF SQL%ROWCOUNT = 0 THEN', '    RAISE E;', '  ELSE', '    NULL;', '  END IF;', '  RETURN;', 'EXCEPTION', '  WHEN E THEN', '    ROLLBACK;', '  WHEN OTHERS THEN', '    ROLLBACK;', 'END;'].join('\n');
  // 기본값은 원본대로 (빈 줄 없음)
  assert.ok(!/\n\n/.test(S.format(q).text));
  const t = S.format(q, { b_sql: 'both', b_if: 'both', e_branch: 'add', e_exc: 'add', e_when: 'add' }).text;
  assert.match(t, /'1';\n\n {4}SELECT/);           // SQL 앞
  assert.match(t, /FROM T;\n\n {4}IF SQL%ROWCOUNT/); // SQL 뒤 · IF 앞 (빈 줄 한 줄만)
  assert.match(t, /RAISE E;\n\n {4}ELSE/);           // ELSE 앞
  assert.match(t, /END IF;\n\n {4}RETURN;/);          // IF 뒤
  assert.match(t, /RETURN;\n\nEXCEPTION/);           // EXCEPTION 앞
  assert.match(t, /ROLLBACK;\n\n {4}WHEN OTHERS/);   // 예외 WHEN 사이
  assert.match(t, /THEN\n {8}RAISE E;/);             // THEN 다음은 원본대로 (붙어 있음)
});

test('빈 줄 탭: 빼기 · 연속 빈 줄 최대 · 문장 사이 빈 줄', () => {
  const q = ['BEGIN', '  IF A = 1 THEN', '', '    X := 1;', '', '', '', '    Y := 2;', '', '  END IF;', 'END;'].join('\n');
  assert.match(S.format(q).text, /THEN\n\n {8}X := 1;\n\n {8}Y/);
  const trimmed = S.format(q, { e_then: 'remove', e_endif: 'remove', blankmax: 2 }).text;
  assert.match(trimmed, /THEN\n {8}X := 1;\n\n\n {8}Y := 2;\n {4}END IF;/);
  const blanks = (o) => S.format('select 1 from dual; select 2 from dual', o).text.split('\n').filter((l) => !l.trim()).length;
  assert.equal(blanks({ stmtgap: 0 }), 0);
  assert.equal(blanks({ stmtgap: 2 }), 2);
});
