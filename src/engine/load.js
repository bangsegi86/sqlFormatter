/* Node 에서 엔진을 불러올 때 사용: require('./src/engine/load.js') */
'use strict';
require('./options.js');
require('./tokenizer.js');
require('./parser.js');
require('./render.js');
require('./transform.js');
require('./alias.js');
require('./plsql.js');
require('./format.js');
require('./ifblocks.js');
require('./blocks.js');
module.exports = globalThis.SQLF;
