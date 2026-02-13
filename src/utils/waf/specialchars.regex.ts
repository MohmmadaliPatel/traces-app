// .
export const dot =
  "(%2e|\\.|%u002e|%c0%2e|%e0%40%ae|%c0%ae|%252e|0x2e|%uff0e|%00\\.|\\.%00|%c0\\.|%25c0%25ae|%%32%{1,2}65)"
// / \
export const slash =
  "(%2f|%5C|\\\\|\\/|%u2215|%u2216|%c0%af|%e0%80%af|%c0%2f|%c0%5c|%c0%80%5c|%252f|%255c|0x2f|0x5c|%uff0f|%25c0%25af|%25c0%252f|%%32%{1,2}66|%%35%{1,2}63|%25c1%259c|%25c0%25af|%f0%80%80%af|%f8%80%80%80%af|%c1%9c|%c1%pc|%c0%9v|%c0%qf|%c1%8s|%c1%1c|%c1%af|%bg%qf|%uEFC8|%uF025|%e0%81%9c|%f0%80%81%9c)"
// (
export const brackedOpen = "(\\(|%28|&#x0{0,}28;?|&lpar;)"
// :
export const colon = "(:|%3A|\\\\u003a|\\\\x3a)"
// <
export const lT = "(<|%3C|\\+ADw-|&#0{0,}60;?|&#x0{0,}3c;?|\\\\u003c|\\\\x3c)"
// >
export const gT = "(>|%3E|\\+AD4-|&#0{0,}62;?|&#x0{0,}3e;?|\\\\u003e|\\\\x3e)"
// _
export const underscore = "(_|%5F|\\+AF8-|\\\\u005f|\\\\x0{0,}5f)"
// @
export const at = "(@|%40|\\+AEA-|\\\\u0040|\\\\x0{0,}40)"
// =
export const equals = "(=|%3D|\\+AD0-|\\\\u003d|\\\\x0{0,}3d)"
// "
export const quotationMarks = '("|%22|\\+ACI-|\\\\u0022|\\\\x0{0,}22)'
// '
// eslint-disable-next-line quotes
export const singleQuotationMarks = "('|%27|\\\\u0027|\\\\x0{0,}27)"
// &
export const and = "(&|%26|\\+ACY-|\\\\u0026|\\\\x0{0,}26)"
// |
export const or = "(\\||%7c|\\+AHw-|\\\\u007c|\\\\x0{0,}7c)"
// {
export const curlyBracketOpen = "({|%7B|\\+AHs-|\\\\u007b|\\\\x0{0,}7b)"
// [
export const squareBracketOpen = "(\\[|%5B|\\+AFs-|\\\\u005b|\\\\x0{0,}5b)"
// ]
export const squareBracketClose = "(\\]|%5D|\\+AF0-|\\\\u005d|\\\\x0{0,}5d)"
//$
export const dollar = "(\\$|%24|\\+ACQ-|\\\\u0024|\\\\x0{0,}24)"
//-
export const minus = "(-|%2D|\\\\u002d|\\\\x0{0,}2d)"
//%
export const percent = "(%|%25|\\+ACU-|\\\\u0025|\\\\x0{0,}25)"
// !
export const exclamation = "(!|%21|\\+ACE-|\\\\u0021|\\\\x0{0,}21)"

export const crlfRegex = new RegExp(
  `((\\r|%0D|%E5%98%8D|\\\\u560d|%250D)|(\\n|%0A|%E5%98%8A|\\\\u560a|%250a))(Set${minus}Cookie|Content${minus}(Length|Type|Location|Disposition|Security${minus}Policy)|X${minus}XSS${minus}Protection|Last${minus}Modified|Location|Date|Link|Refresh|${lT})`,
  "i"
)

export const sqlInjectionRegex = new RegExp(
  `('|\")?\\s*OR\\s*(1|'1'|"1")\\s*=\\s*(1|'1'|"1")|(--|#|\\/\\*|\\*\\/)|\\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|EXEC|FROM|WHERE|OR|AND|JOIN|ORDER|HAVING|LIMIT)\\b`,
  "i" // Case-insensitive flag
)

export const XMLRegex = new RegExp(
  `(${lT}${exclamation}ENTITY.*(SYSTEM|PUBLIC).*(${quotationMarks}|${singleQuotationMarks})\\w+${colon}\/\/|${lT}xi${colon}include|${lT}xsl${colon}(value-of|copy-of).*(${quotationMarks}|${singleQuotationMarks})(system-property|document)${brackedOpen}|${lT}msxsl${colon}script)`,
  "i"
)

//Regex build with data of https://github.com/swisskyrepo/PayloadsAllTheThings/tree/master/XSS%20Injection
const htmlTags =
  "(a|abbr|acronym|address|applet|area|article|aside|audio|b|base|basefont|bdi|bdo|big|blockquote|body|br|button|canvas|caption|center|cite|code|col|colgroup|command|data|datalist|dd|del|details|dfn|dir|div|dl|dt|em|embed|fieldset|figcaption|figure|font|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|i|iframe|img|input|ins|kbd|keygen|label|layer|legend|li|line|link|listing|main|map|mark|marquee|math|menu|menuitem|meta|meter|nav|nobr|noembed|noframes|nolayer|noscript|object|ol|optgroup|option|output|p|param|plaintext|pre|progress|q|rp|rt|ruby|s|samp|script|section|select|small|source|span|strike|strong|style|sub|summary|sup|svg|t|table|tbody|td|template|textarea|tfoot|th|thead|time|title|tr|track|tt|u|ul|var|video|wbr|xmp|foreignObject)"
const jsEvents =
  "(onAbort|onActivate|onAfterPrint|onAfterUpdate|onBeforeActivate|onBeforeCopy|onBeforeCut|onBeforeDeactivate|onBeforeEditFocus|onBeforePaste|onBeforePrint|onBeforeUnload|onBeforeUpdate|onBegin|onBlur|onBounce|onCellChange|onChange|onClick|onContextMenu|onControlSelect|onCopy|onCut|onDataAvailable|onDataSetChanged|onDataSetComplete|onDblClick|onDeactivate|onDrag|onDragDrop|onDragEnd|onDragEnter|onDragLeave|onDragOver|onDragStart|onDrop|onEnd|onError|onErrorUpdate|onFilterChange|onFinish|onFocus|onFocusIn|onFocusOut|onHashChange|onHelp|onInput|onKeyDown|onKeyPress|onKeyUp|onLayoutComplete|onLoad|onLoseCapture|onMediaComplete|onMediaError|onMessage|onMouseDown|onMouseEnter|onMouseLeave|onMouseMove|onMouseOut|onMouseOver|onMouseUp|onMouseWheel|onMove|onMoveEnd|onMoveStart|onOffline|onOnline|onOutOfSync|onPaste|onPause|onPopState|onProgress|onPropertyChange|onReadyStateChange|onRedo|onRepeat|onReset|onResize|onResizeEnd|onResizeStart|onResume|onReverse|onRowDelete|onRowExit|onRowInserted|onRowsEnter|onScroll|onSeek|onSelect|onSelectStart|onSelectionChange|onStart|onStop|onStorage|onSubmit|onSyncRestored|onTimeError|onTrackChange|onURLFlip|onUndo|onUnload|seekSegmentTime)"
const functions = `(alert|call|confirm|console${dot}[a-zA-Z]{1,}|eval|fetch|prompt|setTimeout|setInterval|toString|url)`

export const xssRegex = new RegExp(
  `(${lT}${slash}?(java)?script|${lT}${slash}?${htmlTags}|${functions}(${brackedOpen}|\`|(\\\\){1,2}x28)|(${brackedOpen}|${equals})${functions}|javascript${colon}|${lT}xss|${lT}${slash}?(\\\?|%3F)?xml|${lT}${slash}?dialog|(navigator|document|localStorage|process)${dot}\\\S|${jsEvents}${equals}|${lT}\\\??import|top\\[|${dot}(inner|outer)HTML|response${dot}write${brackedOpen})`,
  "i"
)
