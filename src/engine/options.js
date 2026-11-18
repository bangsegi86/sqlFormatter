/* 옵션 정의: UI와 엔진이 같은 정의를 공유합니다. */
(function (g) {
  'use strict';
  var S = (g.SQLF = g.SQLF || {});

  /* hint: 옵션 아래에 항상 보이는 한 줄 설명
   * tip : 라벨 옆 (?) 에 마우스를 올리면 보이는 자세한 설명 (줄바꿈 \n 가능)
   * choices 의 세 번째 값: 그 선택 버튼에 마우스를 올리면 보이는 설명
   * off(opts): true 를 돌려주면 "지금은 효과가 없는 옵션"으로 흐리게 보여요. 문자열을 돌려주면 그 이유를 같이 보여요. */
  function seg(key, label, choices, def, hint, tip, off) { return { key: key, label: label, type: 'seg', choices: choices, def: def, hint: hint, tip: tip, off: off }; }
  function sw(key, label, def, hint, tip, off) { return { key: key, label: label, type: 'switch', def: def, hint: hint, tip: tip, off: off }; }
  function num(key, label, min, max, step, unit, def, hint, tip, off) {
    return { key: key, label: label, type: 'num', min: min, max: max, step: step, unit: unit, def: def, hint: hint, tip: tip, off: off };
  }

  /* 빈 줄 탭에서 같이 쓰는 선택지 */
  function plOff(o) { return o.plmode === 'keep' && 'PL/SQL 정리를 켜면 쓸 수 있어요'; }
  var BEFORE_AFTER = [['none', '안 넣음'], ['before', '앞'], ['after', '뒤'], ['both', '앞뒤']];
  var BA_TIP = '같은 블록 안에서 앞뒤에 다른 문장이 있을 때 빈 줄을 넣어요.\n블록의 첫 문장 · 마지막 문장 자리(THEN 다음, END IF 앞 등)는\n아래 "블록 안쪽 경계" 설정을 따라요.\n문장 위에 주석이 있으면 빈 줄은 주석 위에 넣어요.\n이미 빈 줄이 있으면 더 넣지 않아요.';
  var EDGE = [['keep', '원본대로', '원본에 빈 줄이 있으면 남기고, 없으면 넣지 않아요 ("원본 빈 줄 유지"가 켜져 있을 때)'], ['add', '넣기', '원본과 상관없이 빈 줄 1줄을 넣어요'], ['remove', '빼기', '원본에 빈 줄이 있어도 지워요']];
  var EDGE_TIP = '원본대로: 원본에 빈 줄이 있으면 남겨요 ("원본 빈 줄 유지" 기준)\n넣기: 항상 빈 줄 1줄\n빼기: 원본에 있어도 지워요';

  var SPEC = [
    {
      id: 'basic', label: '기본', groups: [
        { title: '출력 형태', opts: [
          seg('kwcase', '키워드 대소문자', [['UPPER', '대문자'], ['lower', '소문자'], ['keep', '원문 유지']], 'UPPER',
            'SELECT · FROM 같은 키워드와 함수 이름에만 적용돼요',
            '테이블 · 컬럼 · 별칭 이름과 문자열은 바꾸지 않아요.\n\n대문자: SELECT NVL(a.sal, 0) FROM tb_emp a\n소문자: select nvl(a.sal, 0) from tb_emp a'),
          seg('clause', '절 정렬', [['right', '오른쪽 맞춤 (River)'], ['left', '왼쪽 맞춤']], 'right',
            'SELECT · FROM · WHERE 키워드를 어느 쪽으로 맞출지 정해요',
            '오른쪽 맞춤 (River)\nSELECT a.id\n  FROM tb a\n WHERE a.x = 1\n   AND a.y = 2\n\n왼쪽 맞춤\nSELECT a.id\nFROM tb a\nWHERE a.x = 1\n  AND a.y = 2')
        ] },
        { title: '공백 · 정렬', opts: [
          sw('opspace', '비교 · 연결 연산자 앞뒤 공백', true, '끄면 = <> || 를 붙여 써요 (a=1). + - * / 는 항상 띄워요'),
          num('tabsize', '탭 → 공백 칸 수', 1, 8, 1, '칸', 4, '결과에는 탭을 쓰지 않아요. 원본에 남은 탭은 이 간격으로 공백이 돼요',
            '정리한 줄은 처음부터 공백으로만 들여써요.\n\n원본의 탭이 남는 곳(주석 · 원문 그대로 둔 문장 · PL/SQL 원문 유지)은\n탭 간격을 이 칸 수로 보고 공백으로 바꿔서 줄 맞춤을 지켜요.\n원본을 쓰던 편집기의 탭 크기와 맞추면 모양이 그대로예요.\n\n문자열 값(\'a<탭>b\') 안의 탭은 데이터라서 바꾸지 않아요.'),
          sw('opalign', '비교 연산자 세로 정렬', true, 'WHERE · ON · SET 에서 = 위치를 세로로 맞춰요',
            '켜면\n WHERE a.dept_no = b.dept_no\n   AND a.use_yn  = \'Y\'\n\n끄면\n WHERE a.dept_no = b.dept_no\n   AND a.use_yn = \'Y\'')
        ] },
        { title: '문장', opts: [
          seg('term', '문장 끝 문자', [['semi', ';'], ['slash', '/'], ['none', '붙이지 않음']], 'semi',
            '"붙이지 않음"이어도 문장이 여러 개면 사이에는 ; 를 넣어요')
        ] }
      ]
    },
    {
      id: 'cols', label: '컬럼', groups: [
        { title: '콤마 · 줄바꿈', opts: [
          seg('comma', '콤마 위치', [['trailing', '뒤에  a,'], ['leading', '앞에  , a']], 'trailing', null,
            '뒤에\nSELECT a.id,\n       a.nm\n\n앞에\nSELECT a.id\n     , a.nm'),
          seg('perline', '한 줄당 컬럼 수', [['1', '1개'], ['2', '2개'], ['3', '3개'], ['auto', '전부', '단순한 항목은 개수와 상관없이 한 줄에 이어 써요']], '1',
            '복잡한 항목은 항상 혼자 한 줄을 써요',
            '여러 컬럼을 한 줄에 몇 개씩 묶을지 정해요.\n\n복잡한 항목(CASE · 서브쿼리가 있거나 함수 안에 함수가 있는 식)은 다른 항목과 묶지 않고 항상 따로 줄을 써요.\nNVL(A, 0) 같은 단순한 함수는 묶을 수 있어요.'),
          num('oneline', '항목이 N개 이하면 한 줄로', 1, 10, 1, '개', 2, 'SELECT 목록이 짧으면 줄바꿈 없이 써요 (단순한 항목만)',
            'SELECT 항목이 N개 이하이면 전부 한 줄로 써요.\n예) SELECT A, B FROM ...\n\n복잡한 항목(CASE · 서브쿼리가 있거나 함수 안에 함수가 있는 식)이 하나라도 있으면 묶지 않고 항목마다 줄을 바꿔요.'),
          num('insline', 'INSERT 목록이 N개 이하면 한 줄로', 1, 30, 1, '개', 5, 'INSERT 의 컬럼 · VALUES 값이 이보다 많으면 한 줄에 하나씩 써요',
            '5개 이하\nINSERT INTO tb_emp (emp_no, emp_nm, sal)\nVALUES (:no, :nm, 100);\n\n그보다 많으면\nINSERT INTO tb_emp\n       (emp_no,\n        emp_nm,\n        ...)\nVALUES (:no,\n        :nm,\n        ...);')
        ] },
        { title: '정렬 · 주석', opts: [
          sw('tblalign', 'FROM 테이블 별칭 세로 정렬', true, '테이블 이름 길이가 달라도 별칭을 같은 열에 맞춰요',
            '켜면\n  FROM tb_employee e,\n       tb_dept     d\n\n끄면\n  FROM tb_employee e,\n       tb_dept d'),
          sw('cmtkeep', '줄 끝 주석 위치 유지', true, '끄면 줄 끝 주석(-- ...)을 그 항목 윗줄로 옮겨요')
        ] }
      ]
    },
    {
      id: 'expr', label: '표현식', groups: [
        { title: 'CASE', opts: [
          seg('casewhen', 'CASE 줄바꿈', [
            ['break', 'WHEN마다', 'WHEN이 2개 이상이면 WHEN마다 줄을 바꿔요. WHEN 1개짜리는 한 줄로 둬요.'],
            ['complex', '복잡하면', '"WHEN마다"와 같고, WHEN이 1개여도 THEN/ELSE 결과에 함수 · CASE · 서브쿼리가 있으면 펼쳐요.'],
            ['one', '한 줄', 'CASE ... END 를 항상 한 줄로 써요.']
          ], 'break', 'CASE를 언제 여러 줄로 펼칠지 정해요',
            'WHEN마다: WHEN이 2개 이상일 때만 펼쳐요.\n복잡하면: WHEN이 1개여도 결과가 복잡하면 펼쳐요.\n한 줄: 항상 한 줄로 써요.\n\n예) CASE WHEN A = 1 THEN FN(B) * C END\n· WHEN마다 → 한 줄 그대로\n· 복잡하면 →\n  CASE WHEN A = 1 THEN FN(B) * C\n  END'),
          seg('casethen', 'THEN 위치', [['same', 'WHEN과 같은 줄'], ['next', '다음 줄']], 'same', '여러 줄로 펼쳐진 CASE에만 적용돼요',
            '같은 줄\nCASE WHEN a = 1 THEN \'A\'\n     WHEN a = 2 THEN \'B\'\nEND\n\n다음 줄\nCASE WHEN a = 1\n       THEN \'A\'\n     WHEN a = 2\n       THEN \'B\'\nEND\n\n한 줄로 남은 CASE에는 적용되지 않아요. WHEN이 1개인 CASE도 펼치려면 CASE 줄바꿈을 "복잡하면"으로 바꿔 보세요.',
            function (o) { return o.casewhen === 'one' && 'CASE 줄바꿈이 "한 줄"이라 쓰이지 않아요'; }),
          seg('caseend', 'END 위치', [['case', 'CASE에 맞춤'], ['when', 'WHEN에 맞춤']], 'case', null,
            'CASE에 맞춤\nCASE WHEN a = 1 THEN \'A\'\n     WHEN a = 2 THEN \'B\'\nEND\n\nWHEN에 맞춤\nCASE WHEN a = 1 THEN \'A\'\n     WHEN a = 2 THEN \'B\'\n     END',
            function (o) { return o.casewhen === 'one' && 'CASE 줄바꿈이 "한 줄"이라 쓰이지 않아요'; })
        ] },
        { title: '긴 연산식 줄바꿈', opts: [
          seg('arithwrap', '덧셈 · 뺄셈 (+ -)', [['none', '한 줄로'], ['break', '연산자 앞에서 줄바꿈']], 'none', '항이 많은 덧셈 · 뺄셈을 항마다 줄을 나눠요',
            '예) A + B + C + D AS TOT  →\n    A\n    + B\n    + C\n    + D AS TOT\n\n· 항이 아래 "N개 이상"일 때만 나눠요.\n· * / 는 나누지 않아요 (계산 순서를 잘못 읽기 쉬워서).\n· WHERE a = b + c + d 처럼 비교식이면 = 오른쪽만 나눠요.\n· BETWEEN · LIKE · IN 이 섞인 조건은 그대로 둬요.'),
          num('arithmin', '　항이 N개 이상일 때만', 2, 20, 1, '개', 4, null, 'A + B + C 는 항이 3개예요. 이 값보다 항이 적으면 한 줄로 둬요.',
            function (o) { return o.arithwrap === 'none' && '덧셈 · 뺄셈 줄바꿈을 켜면 쓸 수 있어요'; }),
          seg('concatwrap', '문자 연결 (||)', [['none', '한 줄로'], ['break', '연산자 앞에서 줄바꿈']], 'none', '항이 많은 || 연결을 항마다 줄을 나눠요',
            '예) \'A\' || B || \'-\' || C  →\n    \'A\'\n    || B\n    || \'-\'\n    || C\n\n규칙은 덧셈 · 뺄셈과 같아요.'),
          num('concatmin', '　항이 N개 이상일 때만', 2, 20, 1, '개', 4, null, '\'A\' || B || C 는 항이 3개예요. 이 값보다 항이 적으면 한 줄로 둬요.',
            function (o) { return o.concatwrap === 'none' && '문자 연결 줄바꿈을 켜면 쓸 수 있어요'; }),
          sw('opinner', '함수 안의 식에도 적용', true, '항에 함수 · CASE가 있으면 SUM( ) · NVL( ) 안에서도 나눠요',
            '끄면 맨 바깥 식만 나누고, 괄호나 함수 안의 식은 한 줄로 둬요.\n\n켜면 함수 안의 식도 나누는데, 항에 함수 · CASE · 서브쿼리가 들어 있는 복잡한 식만 나눠요.\nSUM(A + B + C + D) 같은 단순한 식은 그대로 둬요.',
            function (o) { return o.arithwrap === 'none' && o.concatwrap === 'none' && '위의 줄바꿈을 하나라도 켜면 쓸 수 있어요'; })
        ] },
        { title: 'DECODE · NVL', opts: [
          seg('decodeargs', 'DECODE 줄바꿈', [['pair', '(값, 결과) 쌍마다'], ['one', '한 줄']], 'pair', '인자가 5개 이상인 DECODE를 쌍 단위로 줄을 나눠요',
            '쌍마다\nDECODE(a.gender, \'M\', \'Male\',\n                 \'F\', \'Female\',\n                 \'Other\')\n\n한 줄\nDECODE(a.gender, \'M\', \'Male\', \'F\', \'Female\', \'Other\')'),
          sw('decode2case', 'DECODE를 CASE로 바꾸기', false, 'NULL 비교 규칙까지 맞춰서 바꿔요',
            'DECODE(a, 1, \'X\', \'Y\')\n→ CASE WHEN a = 1 THEN \'X\' ELSE \'Y\' END\n\nDECODE는 NULL끼리 같다고 보기 때문에, 검색값이 NULL이면 IS NULL 조건으로 바꿔요.\n쿼리 내용이 바뀌는 옵션이니 결과를 한 번 확인하세요.'),
          sw('nvl2coal', 'NVL을 COALESCE로 바꾸기', false, 'NVL(a, b) → COALESCE(a, b)')
        ] }
      ]
    },
    {
      id: 'struct', label: '서브쿼리', groups: [
        { title: '서브쿼리', opts: [
          seg('subind', '서브쿼리 괄호', [['paren', '괄호에 붙여서'], ['fixed', '괄호를 따로 줄에']], 'paren', null,
            '괄호에 붙여서\n   AND a.id IN (SELECT id\n                  FROM tf\n                 WHERE use_yn = \'Y\')\n\n괄호를 따로 줄에\n   AND a.id IN (\n                   SELECT id\n                     FROM tf\n                    WHERE use_yn = \'Y\'\n               )'),
          seg('inline', '인라인 뷰 괄호', [['paren', '위 설정과 같게'], ['next', '항상 따로 줄에']], 'paren', 'FROM 절의 (SELECT ...) 만 괄호를 따로 줄에 쓸 수 있어요', null,
            function (o) { return o.subind === 'fixed' && '서브쿼리 괄호가 이미 "따로 줄에"예요'; }),
          seg('scalar', '스칼라 서브쿼리', [['break', '항상 여러 줄'], ['short', '단순하면 한 줄']], 'break', 'SELECT 목록 안에 쓴 (SELECT ...) 예요',
            '"단순하면 한 줄"은 아래를 모두 만족할 때만 한 줄로 써요.\n· SELECT 항목 1개\n· 테이블 1개 (조인 없음)\n· WHERE 조건 2개 이하\n· GROUP BY · ORDER BY 없음\n\n예) (SELECT MAX(b.dt) FROM tb b WHERE b.id = a.id) AS mx')
        ] },
        { title: '조인 · IN', opts: [
          seg('join', '조인 표기', [['keep', '원문 유지'], ['ansi', 'ANSI JOIN으로 바꾸기']], 'keep', '콤마 조인을 INNER / LEFT / RIGHT JOIN 으로 바꿔요',
            'FROM a, b WHERE ... 형태의 조인을 모두 ANSI JOIN 으로 바꿔요.\n· (+) 없음 → INNER JOIN\n· a.x = b.x(+) → LEFT OUTER JOIN\n\n두 테이블을 잇는 조건과 (+) 조건은 ON 으로,\n한 테이블만 보는 조건은 WHERE 에 남겨요.\n\n안전하게 바꿀 수 없으면 원문을 두고 결과 위 알림 줄에 이유를 보여줘요.\n(WHERE 최상위 OR, 조인 조건 없는 테이블, 별칭 없는 인라인 뷰 등)\n쿼리 내용이 바뀌는 옵션이니 결과를 한 번 확인하세요.'),
          num('inmax', 'IN 목록 한 줄에 최대', 3, 20, 1, '개', 5, 'IN (...) 값이 이보다 많으면 이 개수씩 줄을 나눠요')
        ] }
      ]
    },
    {
      id: 'plsql', label: 'PL/SQL', groups: [
        { title: '프로시저 · 함수 · 블록', opts: [
          seg('plmode', 'PL/SQL 정리', [['format', '정리'], ['keep', '원문 유지']], 'format',
            'CREATE PROCEDURE · FUNCTION · PACKAGE · TRIGGER, BEGIN · DECLARE 블록',
            'BEGIN · IF · LOOP · CASE · EXCEPTION 같은 블록 안을 한 단계씩 들여쓰고,\n블록 안의 SQL(SELECT INTO · INSERT · UPDATE ...)은 다른 탭의 쿼리 옵션대로 정리해요.\n\n예)\nBEGIN\n    IF V_CNT = 0 THEN\n        UPDATE TB_A A\n           SET A.CNT = 1\n         WHERE A.ID = PI_ID;\n    END IF;\nEND;\n\n해석하지 못한 문장은 그 문장만 원문 그대로 두고 알려줘요.\n블록 짝(IF ~ END IF 등)이 맞지 않으면 블록 전체를 원문 그대로 둬요.'),
          num('plind', '들여쓰기', 2, 8, 1, '칸', 4, '블록 한 단계마다 들일 칸 수예요', null,
            function (o) { return o.plmode === 'keep' && 'PL/SQL 정리를 켜면 쓸 수 있어요'; }),
          num('plcondmin', 'IF 조건 줄바꿈', 2, 10, 1, '개 이상', 3, 'AND · OR 로 이은 조건이 이 개수 이상이면 조건마다 줄을 나눠요',
            '예) 조건 3개 (기준 3개)\nIF V_A = 1\n   AND V_B = 2\n   OR V_C IS NULL THEN\n\n조건이 이보다 적으면 한 줄로 써요.\nIF · ELSIF · WHILE · WHEN 에 적용돼요.',
            function (o) { return o.plmode === 'keep' && 'PL/SQL 정리를 켜면 쓸 수 있어요'; }),
          seg('plthen', 'THEN · LOOP 위치', [['same', '조건 끝에'], ['next', '다음 줄에']], 'same', '조건이 여러 줄로 나뉠 때만 적용돼요',
            '조건 끝에\nIF V_A = 1\n   AND V_B = 2 THEN\n\n다음 줄에\nIF V_A = 1\n   AND V_B = 2\nTHEN\n\nFOR r IN (SELECT ...) LOOP 의 LOOP 도 같은 규칙이에요.',
            function (o) { return o.plmode === 'keep' && 'PL/SQL 정리를 켜면 쓸 수 있어요'; })
        ] },
        { title: '선언 · 파라미터', opts: [
          seg('plparam', '파라미터 배치', [['each', '한 줄에 하나', '파라미터가 2개 이상(또는 주석이 있으면) 한 줄에 하나씩 써요'], ['one', '한 줄로']], 'each', '콤마 위치는 [컬럼] 탭 설정을 따라요',
            '한 줄에 하나\nCREATE OR REPLACE PROCEDURE SP_X (\n    PI_ID  IN  VARCHAR2,  -- 아이디\n    PO_MSG OUT VARCHAR2   -- 메시지\n)\nIS\n\n한 줄로\nCREATE OR REPLACE PROCEDURE SP_X (PI_ID IN VARCHAR2, PO_MSG OUT VARCHAR2)',
            function (o) { return o.plmode === 'keep' && 'PL/SQL 정리를 켜면 쓸 수 있어요'; }),
          sw('plalign', '세로 정렬', true, '이름 · IN/OUT · 타입 · := · 줄 끝 주석 위치를 맞춰요',
            '켜면\n    V_CNT      NUMBER        := 0;\n    V_USER_NM  VARCHAR2(100) := \'\';\n\n    V_STEP   := \'10\';\n    PO_RSLT  := 1;\n\n파라미터 · 변수 선언 · 레코드 필드 · 연속된 대입문(빈 줄이나 주석 전까지)에 적용돼요.',
            function (o) { return o.plmode === 'keep' && 'PL/SQL 정리를 켜면 쓸 수 있어요'; })
        ] }
      ]
    },
    {
      id: 'blank', label: '빈 줄', groups: [
        { title: '원본 빈 줄', opts: [
          sw('plblank', '원본 빈 줄 유지', true, '원본에 있던 빈 줄을 남겨요. 끄면 원본 빈 줄을 모두 지우고 아래 규칙대로만 넣어요',
            'PL/SQL 블록 안에 적용돼요.\n블록 안 SQL 문장 중간의 빈 줄은 정리하면서 없어져요.\n\n아래 "블록 안쪽 경계"를 [원본대로]로 둔 자리도 이 옵션을 따라요.', plOff),
          num('blankmax', '　연속 빈 줄 최대', 1, 5, 1, '줄', 1, '원본에 빈 줄이 여러 줄 이어져 있으면 이 줄 수까지만 남겨요',
            '1줄이면 빈 줄 2~3줄도 1줄로 줄여요.\n원본 그대로 두려면 크게 잡으세요.',
            function (o) { return plOff(o) || (!o.plblank && '원본 빈 줄 유지를 켜면 쓸 수 있어요'); }),
          num('stmtgap', '문장 사이 빈 줄', 0, 3, 1, '줄', 1, '여러 문장(쿼리 · 프로시저)을 한꺼번에 정리할 때 문장과 문장 사이',
            '0줄\nSELECT ... FROM a;\nSELECT ... FROM b;\n\n1줄\nSELECT ... FROM a;\n\nSELECT ... FROM b;')
        ] },
        { title: '덩어리 앞뒤 (PL/SQL)', opts: [
          seg('b_sql', 'SQL 문장', BEFORE_AFTER, 'none', 'SELECT INTO · INSERT · UPDATE · DELETE · MERGE · OPEN … FOR · EXECUTE IMMEDIATE',
            BA_TIP + '\n\n예) 앞뒤\n    V_STEP := \'10\';\n\n    SELECT COUNT(*)\n      INTO V_CNT\n      FROM TB_A;\n\n    IF V_CNT = 0 THEN', plOff),
          seg('b_if', 'IF 문', BEFORE_AFTER, 'none', 'IF ~ END IF 전체를 한 덩어리로 봐요 (IF SQL%ROWCOUNT 도 같아요)',
            BA_TIP + '\n\n예) 앞뒤\n    UPDATE TB_A SET ...;\n\n    IF SQL%ROWCOUNT = 0 THEN\n        RAISE USER_ERROR;\n    END IF;\n\n    V_STEP := \'20\';', plOff),
          seg('b_case', 'CASE 문', BEFORE_AFTER, 'none', 'CASE ~ END CASE (문장으로 쓴 CASE)', BA_TIP, plOff),
          seg('b_loop', '반복문', BEFORE_AFTER, 'none', 'LOOP · WHILE · FOR (커서 FOR 포함) · FORALL',
            BA_TIP + '\n\n<<라벨>> 이 붙은 반복문은 라벨 위에 빈 줄을 넣어요.', plOff),
          seg('b_block', '안쪽 BEGIN ~ END 블록', BEFORE_AFTER, 'none', '본문 안에 다시 쓴 BEGIN … EXCEPTION … END; (DECLARE 블록 포함)', BA_TIP, plOff),
          seg('b_cursor', '커서 명령', BEFORE_AFTER, 'none', 'OPEN · FETCH · CLOSE (OPEN … FOR 는 SQL 문장 규칙)',
            BA_TIP + '\n\n예) 앞뒤\n    OPEN C_WRK;\n\n    LOOP\n        FETCH C_WRK INTO R_WRK;\n        EXIT WHEN C_WRK%NOTFOUND;', plOff),
          seg('b_call', '여러 줄 프로시저 호출', BEFORE_AFTER, 'none', '인자를 여러 줄로 펼친 호출만이에요. 한 줄짜리 호출은 붙여 둬요',
            BA_TIP + '\n\n예) 앞\n    PO_CD := 1;\n\n    SP_SYS_LOG(\n        V_SP_NM,\n        \'N\'\n    );', plOff),
          seg('b_tx', 'COMMIT · ROLLBACK', BEFORE_AFTER, 'none', 'COMMIT · ROLLBACK · SAVEPOINT', BA_TIP, plOff),
          sw('b_cmt', '주석 줄 앞', false, '문장 위에 따로 쓴 주석(-- ...)이 있으면 주석 위에 빈 줄을 넣어요',
            '켜면\n    V_STEP := \'10\';\n\n    --재고 확인\n    SELECT ...\n\n주석과 그 아래 문장 사이에는 넣지 않아요.', plOff),
          sw('b_decl', '선언 종류가 바뀔 때', false, '변수 → CURSOR → TYPE → 안쪽 PROCEDURE 처럼 선언 종류가 바뀌는 자리',
            '켜면\n    V_CNT  NUMBER;\n    V_NM   VARCHAR2(100);\n\n    CURSOR C_WRK IS\n        SELECT ...;\n\n    TYPE T_REC IS RECORD (...);', plOff)
        ] },
        { title: '블록 안쪽 경계 (PL/SQL)', opts: [
          seg('e_is', 'IS · AS · DECLARE 다음', EDGE, 'keep', '첫 선언 앞', EDGE_TIP, plOff),
          seg('e_declbegin', '선언부와 BEGIN 사이', EDGE, 'keep', '마지막 선언 다음, 본문 BEGIN 앞', EDGE_TIP, plOff),
          seg('e_begin', 'BEGIN 다음', EDGE, 'keep', '블록 첫 문장 앞', EDGE_TIP, plOff),
          seg('e_then', 'THEN · ELSE 다음', EDGE, 'keep', 'IF · ELSIF · ELSE · CASE WHEN · 예외 WHEN 안 첫 문장 앞',
            EDGE_TIP + '\n\n예) 넣기\n    IF V_CNT = 0 THEN\n\n        RAISE USER_ERROR;\n    END IF;', plOff),
          seg('e_branch', 'ELSIF · ELSE 앞', EDGE, 'keep', '앞 가지의 마지막 문장 다음 (CASE 의 WHEN · ELSE 포함)', EDGE_TIP, plOff),
          seg('e_endif', 'END IF · END CASE 앞', EDGE, 'keep', 'IF · CASE 의 마지막 문장 다음', EDGE_TIP, plOff),
          seg('e_loop', 'LOOP 다음', EDGE, 'keep', '반복문 안 첫 문장 앞', EDGE_TIP, plOff),
          seg('e_endloop', 'END LOOP 앞', EDGE, 'keep', '반복문 안 마지막 문장 다음', EDGE_TIP, plOff),
          seg('e_exc', 'EXCEPTION 앞', EDGE, 'keep', '본문 마지막 문장과 EXCEPTION 사이',
            EDGE_TIP + '\n\n예) 넣기\n    RETURN;\n\nEXCEPTION\n    WHEN OTHERS THEN', plOff),
          seg('e_when', '예외 처리 WHEN 사이', EDGE, 'keep', 'WHEN USER_ERROR THEN … 과 WHEN OTHERS THEN 사이', EDGE_TIP, plOff),
          seg('e_end', '블록 END 앞', EDGE, 'keep', 'BEGIN … END; 의 마지막 문장 다음', EDGE_TIP, plOff)
        ] }
      ]
    },
    {
      id: 'alias', label: '별칭', groups: [
        { title: '컬럼 별칭', opts: [
          seg('asword', 'AS 키워드', [['always', '항상 붙임'], ['omit', '생략'], ['keep', '원문 유지']], 'always', '컬럼 별칭 앞의 AS 예요. 테이블 별칭에는 붙이지 않아요'),
          sw('autoalias', '별칭 없는 식에 별칭 붙이기', false, '함수 · CASE · 서브쿼리 · 계산식에만 붙여요. 단순 컬럼은 그대로 둬요'),
          seg('autorule', '　붙일 이름', [['name', '컬럼명에서'], ['seq', '순번 col_N']], 'name', 'NVL(c.bonus, 0) → bonus 또는 col_3', null,
            function (o) { return !o.autoalias && '위 옵션을 켜면 쓸 수 있어요'; })
        ] },
        { title: '테이블 별칭', opts: [
          sw('autotbl', '별칭 없는 테이블에 별칭 붙이기', false, 'tb_emp.col 처럼 테이블명으로 쓴 참조도 함께 바꿔요'),
          seg('tblrule', '　붙일 이름', [['first', '첫 글자', 'tb_emp → e'], ['abbr', '약어', 'tb_emp_hist → eh'], ['seq', 't1, t2']], 'first', '아래 [자동 제안]도 이 규칙을 써요')
        ] }
      ]
    }
  ];

  var defaults = {}, byKey = {};
  SPEC.forEach(function (t) { t.groups.forEach(function (gr) { gr.opts.forEach(function (o) { defaults[o.key] = o.def; byKey[o.key] = o; }); }); });

  var PRESETS = {
    '표준 (River, 콤마 뒤)': {},
    '콤마 앞': { comma: 'leading' },
    '컴팩트': { clause: 'left', perline: 'auto', oneline: 3, casewhen: 'one', decodeargs: 'one', scalar: 'short' }
  };

  /* 예전 버전에서 저장한 값 → 지금 값 (없어진 선택지 · 합쳐진 옵션) */
  var LEGACY = { casewhen: { auto: 'one' }, decodeargs: { auto: 'one' } };
  /* 옵션 값 검사: 모르는 선택지는 기본값으로, 숫자는 범위 안으로. 정의에 없는 키는 그대로 둬요. */
  function sanitizeOpts(src) {
    var o = {}, k;
    for (k in src) o[k] = src[k];
    if (o.subbreak === true) o.subind = 'fixed'; // "여는 괄호 뒤 줄바꿈"은 "서브쿼리 괄호"로 합쳤어요
    delete o.subbreak;
    Object.keys(byKey).forEach(function (key) {
      var d = byKey[key], v = o[key];
      if (v === undefined || v === null) { o[key] = d.def; return; }
      if (d.type === 'seg') {
        v = String(v);
        if (LEGACY[key] && LEGACY[key][v]) v = LEGACY[key][v];
        o[key] = d.choices.some(function (c) { return c[0] === v; }) ? v : d.def;
      } else if (d.type === 'switch') {
        o[key] = v === true || v === 'true';
      } else {
        var n = parseInt(v, 10);
        o[key] = isNaN(n) ? d.def : Math.max(d.min, Math.min(d.max, n));
      }
    });
    return o;
  }

  S.OPTION_SPEC = SPEC;
  S.DEFAULTS = defaults;
  S.BUILTIN_PRESETS = PRESETS;
  S.sanitizeOpts = sanitizeOpts;
})(typeof window !== 'undefined' ? window : globalThis);
