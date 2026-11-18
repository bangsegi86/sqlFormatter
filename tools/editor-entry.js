/* 화면 편집기(CodeMirror 6)에서 쓰는 것만 모아 src/vendor/codemirror.js 한 파일로 묶어요.
 * 다시 만들기: npm run build:editor  (앱은 묶인 파일만 쓰니 인터넷 없이 동작해요) */
export { EditorState, EditorSelection, StateField, StateEffect, Annotation, RangeSetBuilder, Prec } from '@codemirror/state';
export { EditorView, keymap, Decoration, ViewPlugin, WidgetType, gutter, GutterMarker, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, placeholder } from '@codemirror/view';
export { history, historyKeymap, defaultKeymap, indentMore, indentLess } from '@codemirror/commands';
export { codeFolding, foldEffect, unfoldEffect, foldedRanges, foldState, indentUnit } from '@codemirror/language';
