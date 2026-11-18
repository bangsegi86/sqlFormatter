'use strict';
/* 구조 · 설명 화면 엔진 (src/engine/blocks.js): 덩어리 찾기 · 설명 주석 넣기 · 덩어리 옮기기 */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/engine/load.js');
const BN = S.blockNotes;

const PROC = `create or replace procedure p_grade(p_id in number, p_res out varchar2) is v_cnt number; v_amt number; v_grade varchar2(10);
begin
-- 주문 건수
select count(*) into v_cnt from orders where cust_id=p_id;
select sum(amt) into v_amt from orders where cust_id=p_id;
if v_amt > 100 then v_grade := 'VIP'; elsif v_cnt > 10 then v_grade := 'GOLD'; update t set a=1 where b=2; else v_grade := 'N'; end if;
update customer set grade=v_grade where cust_id=p_id;
for r in (select id from coupon where grade=v_grade) loop insert into cc values (p_id, r.id); update coupon set cnt=cnt+1 where id=r.id; end loop;
v_cnt := 0; v_amt := 0;
commit;
p_res := 'OK';
exception when others then rollback; p_res := sqlerrm;
end p_grade;
/`;

function fmt(src) { return S.format(src, S.DEFAULTS).text; }
function applyChanges(text, changes) {
  [...changes].sort((a, b) => b.from - a.from).forEach((c) => { text = text.slice(0, c.from) + c.insert + text.slice(c.to); });
  return text;
}
function byNum(info, n) { return info.flat.find((b) => b.num === n); }
function codeSig(text) {
  return S.tokenize(text).filter((t) => t.k !== 'lcomment' && t.k !== 'bcomment').map((t) => t.v.toUpperCase()).sort().join(' ');
}

test('덩어리 찾기: 프로시저 안쪽을 번호 · 종류 · 단계로 나눈다', () => {
  const info = S.codeBlocks(fmt(PROC));
  assert.equal(info.single, true);
  assert.equal(info.tree[0].kind, 'UNIT');
  const shape = info.flat.filter((b) => b.num).map((b) => b.num + ':' + b.kind);
  assert.deepEqual(shape, [
    '1:DECL', '2:SQL', '3:SQL', '4:IF', '4.1:SET', '4.2:SET', '4.3:SQL', '4.4:SET',
    '5:SQL', '6:LOOP', '6.1:SQL', '6.2:SQL', '7:SET', '8:TX', '9:SET', '10:EXC', '10.1:TX', '10.2:SET'
  ]);
  // IF 가지마다 다른 묶음 (가지를 넘어 옮기지 않게)
  assert.deepEqual(['4.1', '4.2', '4.3', '4.4'].map((n) => byNum(info, n).group), ['b0', 'b1', 'b1', 'b2']);
  // 이어진 := 대입문 두 줄은 한 덩어리
  const set = byNum(info, '7');
  assert.equal(set.end - set.start, 1);
});

test('덩어리 바로 위 주석 한 줄을 설명으로 읽는다', () => {
  const info = S.codeBlocks(fmt(PROC));
  assert.equal(byNum(info, '2').saved, '주문 건수');
  assert.equal(byNum(info, '3').saved, null);
  assert.deepEqual(BN.parse('-- [3.1] 등급 결정'), { text: '등급 결정', num: '3.1' });
  assert.deepEqual(BN.parse('/* [2] 금액 */'), { text: '금액', num: '2' });
  assert.equal(BN.parse('-- ------------'), null); // 기호만 있는 줄은 설명이 아님
  assert.equal(BN.parse('/*+ index(a) */'), null);
});

test('설명을 주석으로 넣고, 다시 읽으면 같은 설명 · 코드는 그대로', () => {
  const text = fmt(PROC);
  const info = S.codeBlocks(text);
  const edits = {};
  edits[byNum(info, '3').key] = '주문 금액 합계';
  edits[byNum(info, '6.2').key] = '발급 수 증가';
  edits[info.tree[0].key] = '고객 등급 갱신';
  const r = BN.apply(info, edits, 'dash');
  assert.equal(r.added, 3);
  const out = applyChanges(text, r.changes);
  assert.match(out, /^-- 고객 등급 갱신\nCREATE/);
  assert.match(out, /\n    -- \[3\] 주문 금액 합계\n    SELECT SUM/);
  assert.match(out, /\n        -- \[6\.2\] 발급 수 증가\n        UPDATE coupon/);
  assert.equal(codeSig(out), codeSig(text));
  const again = S.codeBlocks(out);
  assert.equal(byNum(again, '3').saved, '주문 금액 합계');
  assert.equal(byNum(again, '6.2').saved, '발급 수 증가');
  // 아무것도 안 바꾸면 고칠 것이 없다
  assert.equal(BN.apply(again, {}, 'dash').changes.length, 0);
  // 다시 포맷해도 설명 주석은 덩어리 위에 남는다
  assert.equal(byNum(S.codeBlocks(fmt(out)), '3').saved, '주문 금액 합계');
});

test('주석 모양 · 설명 고치기 · 지우기', () => {
  const text = fmt(PROC);
  const info = S.codeBlocks(text);
  const k = byNum(info, '5').key;
  const out = applyChanges(text, BN.apply(info, { [k]: '등급 반영' }, 'block').changes);
  assert.match(out, /\/\* \[5\] 등급 반영 \*\/\n    UPDATE customer/);
  const i2 = S.codeBlocks(out);
  const out2 = applyChanges(out, BN.apply(i2, { [byNum(i2, '5').key]: '고객 등급 저장' }, 'plain').changes);
  assert.match(out2, /-- 고객 등급 저장\n    UPDATE customer/);
  assert.doesNotMatch(out2, /등급 반영/);
  const i3 = S.codeBlocks(out2);
  const out3 = applyChanges(out2, BN.apply(i3, { [byNum(i3, '5').key]: '' }, 'dash').changes);
  assert.doesNotMatch(out3, /고객 등급 저장/);
  assert.equal(out3, text);
});

test('덩어리 옮기기: 주석과 함께 같은 단계 안에서만, 값 순서 경고', () => {
  const text = fmt(PROC);
  const info = S.codeBlocks(text);
  const upd = byNum(info, '5');
  const sib = BN.siblings(info, upd);
  const m = BN.move(info, upd.key, sib.indexOf(byNum(info, '4')));
  assert.ok(m.change);
  assert.deepEqual(m.warnings.map((w) => w.v), ['v_grade']);
  const out = applyChanges(text, [m.change]);
  assert.ok(out.indexOf('UPDATE customer') < out.indexOf('IF v_amt'));
  assert.equal(codeSig(out), codeSig(text));
  // 위 주석은 덩어리를 따라간다
  const sel = byNum(info, '2');
  const m2 = BN.move(info, sel.key, sib.length);
  const out2 = applyChanges(text, [m2.change]);
  assert.match(out2, /    p_res := 'OK';\n    -- 주문 건수\n    SELECT COUNT\(\*\)\n[\s\S]*?;\nEXCEPTION/);
  // 선언부 · EXCEPTION · 혼자 있는 가지 덩어리는 못 옮긴다
  assert.ok(BN.move(info, byNum(info, '1').key, 3).error);
  assert.ok(BN.move(info, byNum(info, '10').key, 0).error);
  assert.ok(BN.move(info, byNum(info, '4.1').key, 0).error);
  // 같은 가지 안에서는 옮길 수 있다
  const g = byNum(info, '4.3');
  const m3 = BN.move(info, g.key, BN.siblings(info, g).indexOf(byNum(info, '4.2')));
  const out3 = applyChanges(text, [m3.change]);
  assert.ok(out3.indexOf('UPDATE t') < out3.indexOf("v_grade := 'GOLD'"));
});

test('패키지 본문 · 익명 블록 · 일반 SQL 여러 문장', () => {
  const pkg = fmt("create or replace package body pk is procedure a is begin update t set x=1; commit; end a; function f return number is begin return 1; end f; end pk;\n/");
  const pi = S.codeBlocks(pkg);
  assert.deepEqual(pi.flat.filter((b) => b.num).map((b) => b.num + ':' + b.kind), ['1:PROC', '1.1:SQL', '1.2:TX', '2:PROC', '2.1:CTRL']);
  const anon = S.codeBlocks(fmt('declare v number; begin select 1 into v from dual; if v = 1 then null; end if; end;'));
  assert.equal(anon.tree[0].kind, 'BLOCK');
  assert.deepEqual(anon.flat.map((b) => b.kind), ['BLOCK', 'DECL', 'SQL', 'IF', 'CTRL']);
  const multi = S.codeBlocks(fmt('select 1 from dual; update t set a=1; delete from u;'));
  assert.deepEqual(multi.flat.map((b) => b.num + ':' + b.kind), ['1:SQL', '2:SQL', '3:SQL']);
});

test('몇천 줄도 빠르게', () => {
  let body = '';
  for (let k = 0; k < 300; k++) body += `select a, b into v1, v2 from t${k} where x = ${k};\nif v1 > ${k} then update t set a = ${k} where b = 2; v2 := v2 + 1; end if;\n`;
  const text = fmt('create procedure q is v1 number; v2 number; begin ' + body + ' end;');
  const t0 = Date.now();
  const info = S.codeBlocks(text);
  assert.ok(text.split('\n').length > 3000);
  assert.equal(info.flat.length, 1 + 1 + 300 * 4);
  assert.ok(Date.now() - t0 < 1000);
});
