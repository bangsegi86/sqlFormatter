'use strict';
/* DDL(객체 생성 스크립트) 정리 (src/engine/ddl.js) */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/engine/load.js');

// DB 도구에서 복사한 모양 그대로: 앞뒤 따옴표, CREATE TABLE 끝에 ; 없음, 탭 들여쓰기
const EXPORTED = `"
  CREATE TABLE "WMSSJ"."CS_KPI"
   (	"WRK_DATE" VARCHAR2(8) NOT NULL ENABLE,
	"WRK_SEQ" NUMBER(10,0) NOT NULL ENABLE,
	"ASRS_PLT_SKU" NUMBER(11,0) DEFAULT 0,
	"INS_DT" DATE,
	 CONSTRAINT "CS_KPI_PK" PRIMARY KEY ("WRK_DATE", "WRK_SEQ")
  USING INDEX PCTFREE 10 INITRANS 2 MAXTRANS 255 COMPUTE STATISTICS
  STORAGE(INITIAL 65536 NEXT 1048576 MINEXTENTS 1 MAXEXTENTS 2147483645
  BUFFER_POOL DEFAULT FLASH_CACHE DEFAULT CELL_FLASH_CACHE DEFAULT)
  TABLESPACE "TS_DATA"  ENABLE
   ) SEGMENT CREATION IMMEDIATE
  PCTFREE 10 PCTUSED 0 INITRANS 1 MAXTRANS 255
 NOCOMPRESS LOGGING
  STORAGE(INITIAL 1048576 NEXT 5242880)
  TABLESPACE "TS_DATA" "
COMMENT ON TABLE "WMSSJ"."CS_KPI" IS '창고별 물동량 통계';
COMMENT ON COLUMN "WMSSJ"."CS_KPI"."INS_DT" IS '입력_일시';
COMMENT ON COLUMN "WMSSJ"."CS_KPI"."WRK_SEQ" IS '작업_차수';`;

// 비교용: 주석 · ; · 컬럼 별칭 앞 AS(쿼리 옵션이 붙여요)는 빼요
function codeSig(text) {
  return S.tokenize(text).filter((t) => !/comment/.test(t.k) && !(t.k === 'punct' && t.v === ';') && t.v.toUpperCase() !== 'AS')
    .map((t) => t.v.toUpperCase()).join(' ');
}

test('DB 도구에서 복사한 CREATE TABLE + COMMENT: 따옴표 정리 · 문장 나누기 · 컬럼 정렬', () => {
  const r = S.format(EXPORTED);
  assert.equal(r.errors.length, 0);
  assert.match(r.warnings.join(), /따옴표/);
  assert.equal(r.text, `CREATE TABLE "WMSSJ"."CS_KPI" (
    "WRK_DATE"     VARCHAR2(8)  NOT NULL ENABLE,
    "WRK_SEQ"      NUMBER(10,0) NOT NULL ENABLE,
    "ASRS_PLT_SKU" NUMBER(11,0) DEFAULT 0,
    "INS_DT"       DATE,
    CONSTRAINT "CS_KPI_PK" PRIMARY KEY ("WRK_DATE", "WRK_SEQ")
        USING INDEX PCTFREE 10 INITRANS 2 MAXTRANS 255 COMPUTE STATISTICS
        STORAGE(INITIAL 65536 NEXT 1048576 MINEXTENTS 1 MAXEXTENTS 2147483645 BUFFER_POOL DEFAULT FLASH_CACHE DEFAULT CELL_FLASH_CACHE DEFAULT)
        TABLESPACE "TS_DATA" ENABLE
)
SEGMENT CREATION IMMEDIATE
PCTFREE 10 PCTUSED 0 INITRANS 1 MAXTRANS 255
NOCOMPRESS LOGGING
STORAGE(INITIAL 1048576 NEXT 5242880)
TABLESPACE "TS_DATA";

COMMENT ON TABLE "WMSSJ"."CS_KPI"            IS '창고별 물동량 통계';
COMMENT ON COLUMN "WMSSJ"."CS_KPI"."INS_DT"  IS '입력_일시';
COMMENT ON COLUMN "WMSSJ"."CS_KPI"."WRK_SEQ" IS '작업_차수';`);
});

test('DDL 정리는 토큰을 바꾸지 않고, 두 번 정리해도 같다', () => {
  const src = [
    EXPORTED.replace(/^"\n/, '').replace('"TS_DATA" "\n', '"TS_DATA";\n'),
    'CREATE UNIQUE INDEX "S"."IX1" ON "S"."T" ("A", "B") PCTFREE 10 INITRANS 2 STORAGE(INITIAL 65536) TABLESPACE "TS_IDX";',
    'create or replace force view v_x (a, b) as select a, count(*) b from t where c = 1 group by a with read only;',
    'CREATE SEQUENCE "S"."SEQ1" MINVALUE 1 MAXVALUE 999 INCREMENT BY 1 START WITH 1 CACHE 20 NOORDER NOCYCLE;',
    'alter table t add (memo varchar2(200) default \'x\', reg_dt date);',
    'ALTER TABLE "S"."T" ADD CONSTRAINT "FK1" FOREIGN KEY ("A") REFERENCES "S"."P" ("A") ENABLE;',
    'create table t2 as select a, b from t where 1 = 0;',
    'grant select, insert on s.t to app_user;',
    'drop table t2 purge;'
  ].join('\n');
  const r = S.format(src);
  assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
  assert.equal(codeSig(r.text), codeSig(src));
  assert.equal(S.format(r.text).text, r.text);
});

test('종류별 모양: 인덱스 · 뷰 · 시퀀스 · ALTER · 파티션 · 임시 테이블', () => {
  const t = (s, o) => S.format(s, o).text;
  assert.equal(t('CREATE INDEX ix ON t (a) PCTFREE 10 TABLESPACE ts;'), 'CREATE INDEX ix ON t (a)\nPCTFREE 10\nTABLESPACE ts;');
  assert.equal(t('create view v as select a from t with check option;'), 'CREATE VIEW v\nAS\nSELECT a\n  FROM t\nWITH CHECK OPTION;');
  assert.equal(t('create sequence s1 start with 1 increment by 1 nocache;'), 'CREATE SEQUENCE s1\n    START WITH 1\n    INCREMENT BY 1\n    NOCACHE;');
  assert.equal(t('alter table t add (a number, -- 메모\nbb date);'), 'ALTER TABLE t ADD (\n    a  NUMBER, -- 메모\n    bb DATE\n);');
  assert.equal(t('alter table t add constraint pk primary key (a) using index tablespace ts;'),
    'ALTER TABLE t\n    ADD CONSTRAINT pk PRIMARY KEY (a)\n        USING INDEX\n        TABLESPACE ts;');
  assert.equal(t('create table p (id number, dt date) partition by range (dt) (partition p1 values less than (maxvalue) tablespace ts1, partition p2 values less than (maxvalue)) enable row movement;'),
    'CREATE TABLE p (\n    id NUMBER,\n    dt DATE\n)\nPARTITION BY RANGE (dt) (\n    PARTITION p1 VALUES LESS THAN (MAXVALUE) TABLESPACE ts1,\n    PARTITION p2 VALUES LESS THAN (MAXVALUE)\n)\nENABLE ROW MOVEMENT;');
  assert.equal(t('create global temporary table g (a varchar2(10 byte), ts timestamp(6) with time zone) on commit preserve rows;'),
    'CREATE GLOBAL TEMPORARY TABLE g (\n    a  VARCHAR2(10 BYTE),\n    ts TIMESTAMP(6) WITH TIME ZONE\n)\nON COMMIT PRESERVE ROWS;');
  // 키워드 소문자 · 앞 콤마 옵션
  assert.equal(t('create table x (a number, bb date);', { kwcase: 'lower', comma: 'leading' }), 'create table x (\n      a  number\n    , bb date\n);');
});

test('DDL 뒤에 ; 없이 프로시저가 와도 나눠서 각각 정리', () => {
  const r = S.format('create table x (a number)\ncreate or replace procedure p is begin null; end;\n/');
  assert.equal(r.errors.length, 0);
  assert.match(r.text, /^CREATE TABLE x \(\n    a NUMBER\n\);\n\nCREATE OR REPLACE PROCEDURE p/);
  // GRANT 목록 안의 CREATE 는 새 문장이 아니에요
  assert.equal(S.format('grant\ncreate session to u;').errors.length, 0);
  assert.match(S.format('grant\ncreate session to u;').text, /^GRANT CREATE SESSION TO u;?$/);
});
