/*
 * 追加の言語: C++ / JavaScript (Node.js) / Ruby / Go / Rust / PHP
 * languages.js と同じく、Hello World 程度のプログラムを
 * それらしいエラーメッセージ付きで「実行」する擬似処理系。
 */
(function (global) {
  'use strict';

  const HW = global.HW;
  const { HOME, suggest } = HW;
  const { DiagError, clex, TP, caretLine, gccFormat, highlighter, identCls, strSpan, words, cFormat } = HW._;

  const srcLineOf = (src, line) => src.split('\n')[line - 1] || '';
  const hex4 = n => n.toString(16).toUpperCase().padStart(4, '0');

  // =====================================================================
  // 汎用の字句解析 (JS / Go / Rust / PHP)
  // =====================================================================
  const G_OPS = ['===', '!==', '...', '**=', '<<=', '>>=', '=>', ':=', '==', '!=', '<=', '>=', '&&', '||', '++', '--',
    '+=', '-=', '*=', '/=', '.=', '::', '->', '<<', '>>', '**', '??', '..'];
  const G_SINGLES = '{}()[];,.=+-*/%<>!&|^~?:@#';

  function glex(src, o) {
    const toks = [];
    let i = 0, line = 1, col = 1, nl = false;
    const pos = () => ({ line, col });
    const adv = n => { while (n-- > 0) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };
    const fail = (kind, msg, p, extra) => { const e = new DiagError(msg, p, extra); e.kind = kind; throw e; };
    const push = t => { t.nl = nl; nl = false; toks.push(t); };
    let html = !!o.php; // PHP: <?php の外側は HTML (そのまま出力)
    while (i < src.length) {
      if (html) {
        const m = /<\?(php\b|=)?/.exec(src.slice(i));
        const end = m ? i + m.index : src.length;
        if (end > i) push({ t: 'inline', v: src.slice(i, end), ...pos(), end: pos() });
        adv(end - i);
        if (!m) break;
        const start = pos();
        adv(m[0].length);
        if (m[1] === '=') push({ t: 'id', v: 'echo', ...start, end: pos() });
        html = false;
        continue;
      }
      const c = src[i];
      if (c === '\n') { nl = true; adv(1); continue; }
      if (c === ' ' || c === '\t' || c === '\r') { adv(1); continue; }
      if (o.php && src.startsWith('?>', i)) {
        push({ t: 'op', v: ';', virtual: true, ...pos(), end: pos() });
        adv(2);
        if (src[i] === '\n') adv(1);
        html = true;
        continue;
      }
      if (src.startsWith('//', i) || (o.hashComment && c === '#' && src[i + 1] !== '[')) {
        while (i < src.length && src[i] !== '\n' && !(o.php && src.startsWith('?>', i))) adv(1);
        continue;
      }
      if (o.attributes && c === '#' && (src[i + 1] === '[' || src[i + 1] === '!')) {
        while (i < src.length && src[i] !== '\n') adv(1);
        continue;
      }
      if (src.startsWith('/*', i)) {
        const p = pos();
        const e = src.indexOf('*/', i + 2);
        if (e < 0) fail('comment', 'unterminated comment', p);
        for (let k = i; k < e + 2; k++) if (src[k] === '\n') nl = true;
        adv(e + 2 - i);
        continue;
      }
      const start = pos();
      if ((o.quotes || '').includes(c)) {
        const raw = (o.raw || '').includes(c);
        const multi = (o.multiline || '').includes(c);
        const tmpl = o.template === c;
        const sqOnly = o.php && c === "'";
        let j = i + 1, val = '', parts = [], cur = '';
        while (j < src.length && src[j] !== c && (multi || src[j] !== '\n')) {
          if (tmpl && src[j] === '$' && src[j + 1] === '{') {
            const close = src.indexOf('}', j);
            if (close < 0) break;
            parts.push({ s: cur }); cur = '';
            parts.push({ e: src.slice(j + 2, close).trim() });
            j = close + 1;
            continue;
          }
          if (src[j] === '\\' && !raw && j + 1 < src.length) {
            const e = src[j + 1];
            let ch;
            if (sqOnly) ch = (e === "'" || e === '\\') ? e : '\\' + e;
            else ch = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'", '`': '`', $: '$', e: '\x1b' }[e];
            if (ch === undefined) ch = o.keepUnknownEscape ? '\\' + e : e;
            val += ch; cur += ch;
            j += 2;
            continue;
          }
          val += src[j]; cur += src[j];
          j++;
        }
        if (src[j] !== c) fail('unterminated', 'unterminated string', start, { len: Math.max(1, j - i) });
        const text = src.slice(i, j + 1);
        adv(j + 1 - i);
        if (tmpl) { parts.push({ s: cur }); push({ t: 'tmpl', parts, raw: text, ...start, end: pos() }); }
        else push({ t: c === "'" && o.charQuote ? 'chr' : 'str', v: val, q: c, raw: text, ...start, end: pos() });
        continue;
      }
      let m;
      if ((m = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[a-z0-9_]*/.exec(src.slice(i, i + 64)))) {
        adv(m[0].length);
        push({ t: 'num', v: parseFloat(m[0]), isFloat: /[.eE]/.test(m[0]), raw: m[0], ...start, end: pos() });
        continue;
      }
      if (o.php && c === '$' && /[A-Za-z_]/.test(src[i + 1] || '')) {
        m = /^\$[A-Za-z_]\w*/.exec(src.slice(i));
        adv(m[0].length);
        push({ t: 'var', v: m[0].slice(1), raw: m[0], ...start, end: pos() });
        continue;
      }
      if ((m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 256)))) {
        if (o.php && m[0].includes('$')) m = /^[A-Za-z_]\w*/.exec(m[0]);
        adv(m[0].length);
        push({ t: 'id', v: m[0], raw: m[0], ...start, end: pos() });
        continue;
      }
      const op = G_OPS.find(x => src.startsWith(x, i)) || (G_SINGLES.includes(c) ? c : null);
      if (op) {
        adv(op.length);
        push({ t: 'op', v: op, raw: op, ...start, end: pos() });
        continue;
      }
      fail('illegal', `illegal character '${String.fromCodePoint(src.codePointAt(i))}'`, start, { ch: String.fromCodePoint(src.codePointAt(i)) });
    }
    toks.push({ t: 'eof', v: '', raw: '', nl: true, line, col, end: pos() });
    return toks;
  }

  // =====================================================================
  // シンタックスハイライト
  // =====================================================================
  const commonTail = sets => [
    { re: /\d+(?:\.\d+)?/y, cls: 'tk-num' },
    { re: /[A-Za-z_$][\w$]*[!?]?/y, cls: identCls(sets) },
  ];
  const hlCpp = highlighter([
    { re: /\/\/.*/y, cls: 'tk-com' },
    { re: /\/\*[\s\S]*?(?:\*\/|$)/y, cls: 'tk-com' },
    { re: /#\s*[A-Za-z]*/y, cls: 'tk-pre' },
    { re: /(?<=#\s*include\s*)<[^>\n]*>?/y, cls: 'tk-str' },
    { re: /"(?:[^"\\\n]|\\.)*"?/y, render: t => strSpan(t, true) },
    { re: /'(?:[^'\\\n]|\\.)*'?/y, render: t => strSpan(t) },
    ...commonTail({
      kw: words('int char void double float long short unsigned signed const static struct class enum union typedef sizeof bool auto namespace using public private protected virtual template typename new delete this true false nullptr constexpr inline'),
      ctl: words('return if else for while do switch case break continue goto default try catch throw'),
      type: words('string cout cin cerr endl std vector'),
    }),
  ]);
  const hlJs = highlighter([
    { re: /\/\/.*/y, cls: 'tk-com' },
    { re: /\/\*[\s\S]*?(?:\*\/|$)/y, cls: 'tk-com' },
    { re: /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?/y, render: t => strSpan(t) },
    ...commonTail({
      kw: words('const let var function class new this typeof instanceof true false null undefined async await of in delete void'),
      ctl: words('return if else for while do switch case break continue try catch finally throw default import export from'),
      type: words('console process Math String Number Object Array JSON'),
    }),
  ]);
  const hlRuby = highlighter([
    { re: /#.*/y, cls: 'tk-com' },
    { re: /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?/y, render: t => strSpan(t) },
    { re: /:[A-Za-z_]\w*/y, cls: 'tk-str' },
    ...commonTail({
      kw: words('def class module self nil true false and or not'),
      ctl: words('if elsif else unless end do while until for in return then begin rescue ensure yield case when break next'),
      type: words('puts print p require'),
    }),
  ]);
  const hlGo = highlighter([
    { re: /\/\/.*/y, cls: 'tk-com' },
    { re: /\/\*[\s\S]*?(?:\*\/|$)/y, cls: 'tk-com' },
    { re: /"(?:[^"\\\n]|\\.)*"?|`[^`]*`?|'(?:[^'\\\n]|\\.)*'?/y, render: t => strSpan(t, true) },
    ...commonTail({
      kw: words('package import func var const type struct interface map chan go defer true false nil'),
      ctl: words('return if else for range switch case break continue default select goto fallthrough'),
      type: words('string int int64 float64 bool byte rune error fmt'),
    }),
  ]);
  const hlRust = highlighter([
    { re: /\/\/.*/y, cls: 'tk-com' },
    { re: /\/\*[\s\S]*?(?:\*\/|$)/y, cls: 'tk-com' },
    { re: /#!?\[[^\]\n]*\]?/y, cls: 'tk-pre' },
    { re: /"(?:[^"\\]|\\.)*"?/y, render: t => strSpan(t) },
    { re: /[A-Za-z_]\w*!/y, cls: 'tk-fn' },
    ...commonTail({
      kw: words('fn let mut const static struct enum impl trait pub use mod crate self super as ref true false where dyn move unsafe'),
      ctl: words('return if else for while loop match break continue in'),
      type: words('String str i32 i64 u32 u64 f64 bool usize char Vec Option Result'),
    }),
  ]);
  const hlPhp = highlighter([
    { re: /<\?php|<\?=|\?>/y, cls: 'tk-pre' },
    { re: /\/\/.*|#.*/y, cls: 'tk-com' },
    { re: /\/\*[\s\S]*?(?:\*\/|$)/y, cls: 'tk-com' },
    { re: /"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?/y, render: t => strSpan(t) },
    { re: /\$[A-Za-z_]\w*/y, cls: 'tk-var' },
    ...commonTail({
      kw: words('function echo print class new public private protected static const true false null array fn'),
      ctl: words('return if else elseif for foreach while do switch case break continue default'),
      type: words('PHP_EOL'),
    }),
  ]);

  // 値の文字列表現 (各言語で少しずつ違う)
  const numStr = v => (Number.isInteger(v) ? String(v) : String(v));

  // =====================================================================
  // JavaScript (Node.js)
  // =====================================================================
  const JS_RESERVED = words('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof new return super switch this throw try typeof var void while with let yield await');
  const NODE_VERSION = 'v20.12.2';
  class JsThrow { constructor(name, msg, tok) { this.name = name; this.msg = msg; this.tok = tok; } }

  function jsParse(src) {
    let toks;
    try {
      toks = glex(src, { quotes: '"\'`', template: '`', multiline: '`' });
    } catch (e) {
      if (e.kind === 'unterminated' || e.kind === 'illegal') throw new JsThrow('SyntaxError', 'Invalid or unexpected token', { line: e.pos.line, col: e.pos.col, len: e.extra.len || 1 });
      if (e.kind === 'comment') throw new JsThrow('SyntaxError', 'Invalid or unexpected token', { line: e.pos.line, col: e.pos.col, len: 2 });
      throw e;
    }
    const p = new TP(toks);
    const tlen = t => Math.max(1, (t.raw || t.v || ' ').length);
    const syn = (msg, t) => { throw new JsThrow('SyntaxError', msg, { line: t.line, col: t.col, len: tlen(t) }); };
    const unexpected = t => {
      if (t.t === 'eof') syn('Unexpected end of input', t);
      if (t.t === 'str' || t.t === 'tmpl') syn('Unexpected string', t);
      if (t.t === 'num') syn('Unexpected number', t);
      if (t.t === 'id') syn(JS_RESERVED.has(t.v) || ['true', 'false', 'null'].includes(t.v) ? `Unexpected token '${t.v}'` : `Unexpected identifier '${t.v}'`, t);
      syn(`Unexpected token '${t.v}'`, t);
    };
    const endStmt = () => {
      if (p.eat(';')) return;
      const t = p.peek();
      if (t.t === 'eof' || p.is('}') || t.nl) return;
      unexpected(t);
    };
    function block() {
      const open = p.next();
      const body = [];
      while (!p.is('}')) { if (p.atEOF()) unexpected(p.peek()); body.push(stmt()); }
      p.next();
      return { k: 'block', body, tok: open };
    }
    function stmt() {
      const t = p.peek();
      if (p.is('{')) return block();
      if (p.eat(';')) return { k: 'empty' };
      if (t.t === 'id' && ['let', 'const', 'var'].includes(t.v)) {
        p.next();
        const decls = [];
        do {
          const n = p.peek();
          if (n.t !== 'id' || JS_RESERVED.has(n.v)) unexpected(n);
          p.next();
          let init = null;
          if (p.eat('=')) init = expr();
          else if (t.v === 'const') syn('Missing initializer in const declaration', n);
          decls.push({ name: n.v, init, tok: n });
        } while (p.eat(','));
        endStmt();
        return { k: 'decl', kind: t.v, decls, tok: t };
      }
      if (p.is('function')) {
        p.next();
        const n = p.peek();
        if (n.t !== 'id') unexpected(n);
        p.next();
        if (!p.eat('(')) unexpected(p.peek());
        const params = [];
        while (!p.is(')')) {
          const a = p.peek();
          if (a.t !== 'id') unexpected(a);
          params.push(p.next().v);
          if (!p.is(')') && !p.eat(',')) unexpected(p.peek());
        }
        p.next();
        if (!p.is('{')) unexpected(p.peek());
        return { k: 'func', name: n.v, params, body: block(), tok: n };
      }
      if (p.is('return')) {
        p.next();
        const e = (p.is(';') || p.is('}') || p.peek().nl || p.atEOF()) ? null : expr();
        endStmt();
        return { k: 'return', e, tok: t };
      }
      if (p.is('if')) {
        p.next();
        if (!p.eat('(')) unexpected(p.peek());
        const c = expr();
        if (!p.eat(')')) unexpected(p.peek());
        const th = stmt();
        const el = p.eat('else') ? stmt() : null;
        return { k: 'if', c, th, el, tok: t };
      }
      if (t.t === 'id' && JS_RESERVED.has(t.v) && !['this', 'typeof', 'new', 'void', 'delete'].includes(t.v)) unexpected(t);
      const e = expr();
      endStmt();
      return { k: 'expr', e, tok: t };
    }
    function expr() {
      const lhs = cond();
      if (p.is('=') || p.is('+=') || p.is('-=')) {
        const op = p.next();
        if (lhs.k !== 'name' && lhs.k !== 'member') syn('Invalid left-hand side in assignment', lhs.tok);
        return { k: 'assign', op: op.v, target: lhs, value: expr(), tok: lhs.tok };
      }
      return lhs;
    }
    function cond() {
      let a = add();
      while (['===', '!==', '==', '!=', '<', '>', '<=', '>='].some(o => p.is(o))) {
        const op = p.next();
        a = { k: 'bin', op: op.v, a, b: add(), tok: a.tok };
      }
      return a;
    }
    function add() {
      let a = mul();
      while (p.is('+') || p.is('-')) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: mul(), tok: a.tok }; }
      return a;
    }
    function mul() {
      let a = unary();
      while (p.is('*') || p.is('/') || p.is('%')) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: unary(), tok: a.tok }; }
      return a;
    }
    function unary() {
      if (p.is('-') || p.is('!') || p.is('typeof')) { const t = p.next(); return { k: 'unary', op: t.v, a: unary(), tok: t }; }
      return postfix();
    }
    function postfix() {
      let e = primary();
      for (;;) {
        if (p.is('.')) {
          p.next();
          const n = p.peek();
          if (n.t !== 'id') unexpected(n);
          p.next();
          e = { k: 'member', obj: e, name: n.v, tok: e.tok, ntok: n };
          continue;
        }
        if (p.is('(')) {
          const lp = p.next();
          const args = [];
          while (!p.is(')')) {
            if (p.atEOF()) syn('missing ) after argument list', p.peek());
            args.push(expr());
            if (!p.is(')')) {
              if (!p.is(',')) syn('missing ) after argument list', p.peek());
              p.next();
            }
          }
          p.next();
          e = { k: 'call', callee: e, args, tok: e.tok, lp };
          continue;
        }
        break;
      }
      return e;
    }
    function primary() {
      const t = p.peek();
      if (t.t === 'str') { p.next(); return { k: 'lit', v: t.v, tok: t }; }
      if (t.t === 'num') { p.next(); return { k: 'lit', v: t.v, tok: t }; }
      if (t.t === 'tmpl') {
        p.next();
        const parts = t.parts.map(x => (x.e !== undefined ? { e: parseSub(x.e, t) } : x));
        return { k: 'tmpl', parts, tok: t };
      }
      if (t.t === 'id') {
        const lits = { true: true, false: false, null: null, undefined };
        if (t.v in lits) { p.next(); return { k: 'lit', v: lits[t.v], tok: t }; }
        if (!JS_RESERVED.has(t.v) || t.v === 'this') { p.next(); return { k: 'name', v: t.v, tok: t }; }
      }
      if (p.is('(')) {
        p.next();
        const e = expr();
        if (!p.eat(')')) unexpected(p.peek());
        return e;
      }
      unexpected(t);
    }
    function parseSub(code, t) {
      try {
        const sub = jsParse(code);
        if (sub.length === 1 && sub[0].k === 'expr') return sub[0].e;
      } catch (e) { /* fallthrough */ }
      syn('Unexpected token', t);
    }
    const prog = [];
    while (!p.atEOF()) prog.push(stmt());
    return prog;
  }

  function jsInspect(v, top) {
    if (typeof v === 'string') return top ? v : `'${v}'`;
    if (v === undefined) return 'undefined';
    if (v === null) return 'null';
    if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (typeof v === 'boolean') return String(v);
    if (v && v.jsfn) return `[Function: ${v.name}]`;
    if (v && v.native) return `[Function: ${v.name}]`;
    if (v && typeof v === 'object') return '{ ' + Object.keys(v).map(k => `${k}: ${jsInspect(v[k])}`).join(', ') + ' }';
    return String(v);
  }
  function jsToStr(v) {
    if (v && v.jsfn) return `function ${v.name}() { [code] }`;
    if (v && typeof v === 'object' && v !== null && !v.native) return '[object Object]';
    return String(v);
  }

  function jsRun(src, file) {
    const path = `${HOME}/${file}`;
    let stdout = '', stderr = '';
    const fmtErr = (ex, isSyntax) => {
      const ln = ex.tok ? ex.tok.line : 1, col = ex.tok ? ex.tok.col : 1;
      const srcLine = srcLineOf(src, ln);
      let s = `${path}:${ln}\n${srcLine}\n${caretLine(srcLine, col, isSyntax ? (ex.tok.len || 1) : 1).replace(/~/g, '^')}\n\n${ex.name}: ${ex.msg}\n`;
      s += isSyntax
        ? '    at wrapSafe (node:internal/modules/cjs/loader:1281:20)\n    at Module._compile (node:internal/modules/cjs/loader:1321:27)\n    at Module._extensions..js (node:internal/modules/cjs/loader:1416:10)\n    at Module.load (node:internal/modules/cjs/loader:1208:32)\n    at Module._load (node:internal/modules/cjs/loader:1024:12)\n    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:174:12)\n    at node:internal/main/run_main_module:28:49\n'
        : `    at Object.<anonymous> (${path}:${ln}:${col})\n    at Module._compile (node:internal/modules/cjs/loader:1358:14)\n    at Module._extensions..js (node:internal/modules/cjs/loader:1416:10)\n    at Module.load (node:internal/modules/cjs/loader:1208:32)\n    at Module._load (node:internal/modules/cjs/loader:1024:12)\n    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:174:12)\n    at node:internal/main/run_main_module:28:49\n`;
      return s + `\nNode.js ${NODE_VERSION}\n`;
    };
    let prog;
    try { prog = jsParse(src); } catch (e) {
      if (e instanceof JsThrow) return { out: '', err: fmtErr(e, true), code: 1 };
      throw e;
    }
    const logTo = which => ({ native: true, name: 'log', fn: args => { const s = args.map(a => jsInspect(a, true)).join(' ') + '\n'; if (which === 'err') stderr += s; else stdout += s; } });
    const consoleObj = { log: logTo('out'), info: logTo('out'), debug: logTo('out'), error: logTo('err'), warn: logTo('err') };
    const globalEnv = new Map([
      ['console', { v: consoleObj, c: true }],
      ['process', { v: { stdout: { write: { native: true, name: 'write', fn: a => { stdout += jsToStr(a[0]); return true; } } } }, c: true }],
      ['String', { v: { native: true, name: 'String', fn: a => jsToStr(a[0]) }, c: true }],
    ]);
    class Ret { constructor(v) { this.v = v; } }
    const exprText = e => (e.k === 'name' ? e.v : e.k === 'member' ? `${exprText(e.obj)}.${e.name}` : e.k === 'call' ? `${exprText(e.callee)}(...)` : '(intermediate value)');
    let depth = 0;

    function lookup(name, scopes, tok) {
      for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(name)) {
        const b = scopes[i].get(name);
        if (b.tdz) throw new JsThrow('ReferenceError', `Cannot access '${name}' before initialization`, tok);
        return b;
      }
      throw new JsThrow('ReferenceError', `${name} is not defined`, tok);
    }
    function ev(e, sc) {
      switch (e.k) {
        case 'lit': return e.v;
        case 'tmpl': return e.parts.map(x => (x.e ? jsToStr(ev(x.e, sc)) : x.s)).join('');
        case 'name': return lookup(e.v, sc, e.tok).v;
        case 'unary': {
          const a = ev(e.a, sc);
          return e.op === '-' ? -a : e.op === '!' ? !a : (a && a.jsfn ? 'function' : typeof a);
        }
        case 'bin': {
          const a = ev(e.a, sc), b = ev(e.b, sc);
          switch (e.op) {
            case '+': return (typeof a === 'string' || typeof b === 'string') ? jsToStr(a) + jsToStr(b) : a + b;
            case '-': return a - b;
            case '*': return a * b;
            case '/': return a / b;
            case '%': return a % b;
            case '===': return a === b;
            case '!==': return a !== b;
            // eslint-disable-next-line eqeqeq
            case '==': return a == b;
            // eslint-disable-next-line eqeqeq
            case '!=': return a != b;
            case '<': return a < b;
            case '>': return a > b;
            case '<=': return a <= b;
            case '>=': return a >= b;
          }
          return undefined;
        }
        case 'member': {
          const o = ev(e.obj, sc);
          if (o === undefined || o === null) throw new JsThrow('TypeError', `Cannot read properties of ${o} (reading '${e.name}')`, e.ntok);
          if (typeof o === 'string') {
            const sm = { length: o.length, toUpperCase: { native: true, name: 'toUpperCase', fn: () => o.toUpperCase() }, toLowerCase: { native: true, name: 'toLowerCase', fn: () => o.toLowerCase() } };
            return sm[e.name];
          }
          return typeof o === 'object' ? o[e.name] : undefined;
        }
        case 'assign': {
          const v = ev(e.value, sc);
          if (e.target.k === 'name') {
            const b = lookup(e.target.v, sc, e.target.tok);
            if (b.c) throw new JsThrow('TypeError', 'Assignment to constant variable.', e.tok);
            b.v = e.op === '=' ? v : e.op === '+=' ? ev({ k: 'bin', op: '+', a: { k: 'lit', v: b.v }, b: { k: 'lit', v } }, sc) : b.v - v;
            return b.v;
          }
          const o = ev(e.target.obj, sc);
          if (o && typeof o === 'object') o[e.target.name] = v;
          return v;
        }
        case 'call': {
          const f = ev(e.callee, sc);
          const args = e.args.map(a => ev(a, sc));
          if (f && f.native) return f.fn(args);
          if (f && f.jsfn) {
            if (++depth > 2000) throw new JsThrow('RangeError', 'Maximum call stack size exceeded', e.tok);
            const local = new Map(f.params.map((pn, i) => [pn, { v: args[i] }]));
            try { execBlock(f.body.body, [...f.scope, local]); } catch (r) { if (r instanceof Ret) { depth--; return r.v; } throw r; }
            depth--;
            return undefined;
          }
          throw new JsThrow('TypeError', `${exprText(e.callee)} is not a function`, e.callee.k === 'member' ? e.callee.ntok : e.tok);
        }
      }
      return undefined;
    }
    function hoist(stmts, scope, sc) {
      for (const s of stmts) {
        if (s.k === 'func') scope.set(s.name, { v: { jsfn: true, name: s.name, params: s.params, body: s.body, scope: sc } });
        if (s.k === 'decl' && s.kind !== 'var') for (const d of s.decls) scope.set(d.name, { tdz: true });
        if (s.k === 'decl' && s.kind === 'var') for (const d of s.decls) if (!scope.has(d.name)) scope.set(d.name, { v: undefined });
      }
    }
    function execBlock(stmts, sc) {
      const scope = sc[sc.length - 1];
      hoist(stmts, scope, sc);
      for (const s of stmts) exec(s, sc);
    }
    function exec(s, sc) {
      switch (s.k) {
        case 'block': { const inner = [...sc, new Map()]; execBlock(s.body, inner); break; }
        case 'expr': ev(s.e, sc); break;
        case 'decl':
          for (const d of s.decls) sc[sc.length - 1].set(d.name, { v: d.init ? ev(d.init, sc) : undefined, c: s.kind === 'const' });
          break;
        case 'if': if (ev(s.c, sc)) exec(s.th, sc); else if (s.el) exec(s.el, sc); break;
        case 'return': throw new Ret(s.e ? ev(s.e, sc) : undefined);
      }
      if (stdout.length > 100000) throw new JsThrow('RangeError', 'Invalid string length', s.tok);
    }
    try {
      execBlock(prog, [globalEnv, new Map()]);
    } catch (e) {
      if (e instanceof JsThrow) return { out: stdout, err: stderr + fmtErr(e, false), code: 1 };
      if (e instanceof Ret) return { out: stdout, err: stderr, code: 0 };
      throw e;
    }
    return { out: stdout, err: stderr, code: 0 };
  }

  // =====================================================================
  // Ruby
  // =====================================================================
  class RbErr { constructor(type, msg, line, col, len, hint) { Object.assign(this, { type, msg, line, col, len, hint }); } }

  function rbLex(src) {
    const toks = [];
    let i = 0, line = 1, col = 1, space = false;
    const adv = n => { while (n-- > 0) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };
    while (i < src.length) {
      const c = src[i];
      if (c === '\n' || c === ';') { toks.push({ t: 'nl', v: c, line, col }); adv(1); space = false; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { adv(1); space = true; continue; }
      if (c === '#') { while (i < src.length && src[i] !== '\n') adv(1); continue; }
      const start = { line, col };
      if (c === '"' || c === "'") {
        let j = i + 1, parts = [], cur = '';
        while (j < src.length && src[j] !== c) {
          if (c === '"' && src[j] === '#' && src[j + 1] === '{') {
            const close = src.indexOf('}', j);
            if (close < 0) break;
            parts.push({ s: cur }); cur = '';
            parts.push({ e: src.slice(j + 2, close) });
            j = close + 1;
            continue;
          }
          if (src[j] === '\\' && j + 1 < src.length) {
            const e = src[j + 1];
            if (c === "'") cur += (e === "'" || e === '\\') ? e : '\\' + e;
            else cur += { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', e: '\x1b', s: ' ' }[e] ?? e;
            j += 2;
            continue;
          }
          cur += src[j];
          j++;
        }
        if (src[j] !== c) throw new RbErr('SyntaxError', 'unterminated string meets end of file', line, col, 1);
        parts.push({ s: cur });
        const raw = src.slice(i, j + 1);
        adv(j + 1 - i);
        toks.push({ t: 'str', parts, raw, ...start, space, len: raw.length });
        space = false;
        continue;
      }
      let m;
      if ((m = /^\d+(?:\.\d+)?/.exec(src.slice(i)))) { adv(m[0].length); toks.push({ t: 'num', v: parseFloat(m[0]), isFloat: m[0].includes('.'), ...start, space, len: m[0].length }); space = false; continue; }
      if ((m = /^[A-Za-z_]\w*[?!]?/.exec(src.slice(i)))) { adv(m[0].length); toks.push({ t: 'id', v: m[0], ...start, space, len: m[0].length }); space = false; continue; }
      if ((m = /^:[A-Za-z_]\w*/.exec(src.slice(i)))) { adv(m[0].length); toks.push({ t: 'sym', v: m[0].slice(1), ...start, space, len: m[0].length }); space = false; continue; }
      const op = ['==', '!=', '<=', '>=', '+=', '-=', '**', '&&', '||', '<<'].find(o => src.startsWith(o, i)) || ('(){}[],.=+-*/%<>!&|?:'.includes(c) ? c : null);
      if (op) { adv(op.length); toks.push({ t: 'op', v: op, ...start, space, len: op.length }); space = false; continue; }
      throw new RbErr('SyntaxError', `Invalid char '\\x${src.charCodeAt(i).toString(16).toUpperCase()}' in expression`, line, col, 1);
    }
    toks.push({ t: 'nl', v: '', line, col, eof: true });
    return toks;
  }

  function rbRun(src, file) {
    let stdout = '';
    const srcLines = src.split('\n');
    const fmt = e => {
      if (e.type === 'SyntaxError') return `${file}:${e.line}: ${e.msg} (SyntaxError)\n`;
      const raw = srcLines[e.line - 1] || '';
      let s = `${file}:${e.line}:in \`${e.where || '<main>'}': ${e.msg} (${e.type})\n\n${raw}\n${caretLine(raw, e.col, e.len).replace(/~/g, '^')}\n`;
      if (e.hint) s += `Did you mean?  ${e.hint}\n`;
      return s;
    };
    let toks;
    try { toks = rbLex(src); } catch (e) { if (e instanceof RbErr) return { out: '', err: fmt(e), code: 1 }; throw e; }
    const p = new TP(toks);
    const syn = (msg, t) => { throw new RbErr('SyntaxError', msg, t.line, t.col, 1); };
    const tdesc = t => (t.eof ? 'end-of-input' : t.t === 'nl' ? "'\\n'" : t.t === 'str' ? 'string literal' : t.t === 'num' ? 'integer literal' : t.t === 'id' ? (t.v === 'end' ? '`end\'' : `local variable or method`) : `'${t.v}'`);
    const skipNl = () => { while (p.peek().t === 'nl' && !p.peek().eof) p.next(); };
    const canStartArg = t => t.t === 'str' || t.t === 'num' || t.t === 'sym' || (t.t === 'id' && !['end', 'do', 'then', 'if', 'unless', 'else', 'elsif'].includes(t.v)) || (t.t === 'op' && (t.v === '(' || t.v === '[' || (t.v === '-' && !p.peek(1).space)));

    function body(stops) {
      const stmts = [];
      skipNl();
      while (!(p.peek().t === 'id' && stops.includes(p.peek().v))) {
        if (p.peek().eof) syn(`syntax error, unexpected end-of-input, expecting \`end'`, p.peek());
        stmts.push(stmt());
        skipNl();
      }
      return stmts;
    }
    function stmt() {
      const t = p.peek();
      if (t.t === 'id' && t.v === 'def') {
        p.next();
        const n = p.peek();
        if (n.t !== 'id') syn(`syntax error, unexpected ${tdesc(n)}`, n);
        p.next();
        const params = [];
        if (p.eat('(')) {
          while (!p.is(')')) { const a = p.next(); if (a.t !== 'id') syn(`syntax error, unexpected ${tdesc(a)}`, a); params.push(a.v); p.eat(','); }
          p.next();
        } else while (p.peek().t === 'id') { params.push(p.next().v); if (!p.eat(',')) break; }
        const b = body(['end']);
        p.next();
        return { k: 'def', name: n.v, params, body: b, line: t.line };
      }
      if (t.t === 'id' && (t.v === 'if' || t.v === 'unless')) {
        p.next();
        const c = expr();
        p.eat('then');
        const th = body(['else', 'end']);
        let el = [];
        if (p.eat('else')) el = body(['end']);
        p.next();
        return { k: 'if', neg: t.v === 'unless', c, th, el, line: t.line };
      }
      if (t.t === 'id' && t.v === 'end') syn("syntax error, unexpected `end'", t);
      if (t.t === 'id' && t.v === 'return') { p.next(); const e = p.peek().t === 'nl' ? null : expr(); return { k: 'return', e, line: t.line }; }
      if (t.t === 'id' && p.is('=', 1) && /^[a-z_]/.test(t.v)) {
        p.next(); p.next();
        return { k: 'assign', name: t.v, e: expr(), line: t.line };
      }
      const e = expr();
      const after = p.peek();
      if (after.t !== 'nl' && !(after.t === 'id' && ['end', 'else'].includes(after.v))) syn(`syntax error, unexpected ${tdesc(after)}, expecting end-of-input`, after);
      return { k: 'expr', e, line: t.line };
    }
    function expr() {
      let a = cmp();
      while (p.is('&&') || p.is('||')) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: cmp(), tok: op }; }
      return a;
    }
    function cmp() {
      let a = add();
      while (['==', '!=', '<', '>', '<=', '>='].some(o => p.is(o))) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: add(), tok: op }; }
      return a;
    }
    function add() {
      let a = mul();
      while (p.is('+') || p.is('-')) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: mul(), tok: op }; }
      return a;
    }
    function mul() {
      let a = postfix();
      while (p.is('*') || p.is('/') || p.is('%')) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: postfix(), tok: op }; }
      return a;
    }
    function args(paren) {
      const list = [];
      if (paren) {
        p.next();
        while (!p.is(')')) {
          if (p.peek().eof) syn("syntax error, unexpected end-of-input, expecting ')'", p.peek());
          list.push(expr());
          if (!p.is(')')) { if (!p.eat(',')) syn(`syntax error, unexpected ${tdesc(p.peek())}, expecting ')'`, p.peek()); }
        }
        p.next();
      } else {
        list.push(expr());
        while (p.eat(',')) { skipNl(); list.push(expr()); }
      }
      return list;
    }
    function postfix() {
      let e = primary();
      while (p.is('.')) {
        p.next();
        const n = p.next();
        if (n.t !== 'id') syn(`syntax error, unexpected ${tdesc(n)}`, n);
        const a = (p.is('(') && !p.peek().space) ? args(true) : [];
        e = { k: 'send', recv: e, name: n.v, args: a, tok: n };
      }
      return e;
    }
    function primary() {
      const t = p.peek();
      if (t.t === 'str') {
        p.next();
        return { k: 'str', parts: t.parts.map(x => (x.e !== undefined ? { e: subExpr(x.e, t) } : x)), tok: t };
      }
      if (t.t === 'num') { p.next(); return { k: 'lit', v: t.isFloat ? { f: t.v } : t.v, tok: t }; }
      if (t.t === 'sym') { p.next(); return { k: 'lit', v: { sym: t.v }, tok: t }; }
      if (t.t === 'id') {
        const lits = { nil: null, true: true, false: false };
        if (t.v in lits) { p.next(); return { k: 'lit', v: lits[t.v], tok: t }; }
        p.next();
        const nx = p.peek();
        if (nx.t === 'op' && nx.v === '(' && !nx.space) return { k: 'call', name: t.v, args: args(true), tok: t };
        if (nx.space && canStartArg(nx) && !(nx.t === 'op' && nx.v === '[')) return { k: 'call', name: t.v, args: args(false), tok: t, command: true };
        return { k: 'ident', name: t.v, tok: t };
      }
      if (p.is('(')) { p.next(); const e = expr(); if (!p.eat(')')) syn(`syntax error, unexpected ${tdesc(p.peek())}, expecting ')'`, p.peek()); return e; }
      if (p.is('-')) { p.next(); return { k: 'neg', a: primary(), tok: t }; }
      syn(`syntax error, unexpected ${tdesc(t)}`, t);
    }
    function subExpr(code, t) {
      const r = rbParseExpr(code);
      if (!r) syn('syntax error, unexpected end-of-input', t);
      return r;
    }

    let prog;
    try {
      prog = [];
      skipNl();
      while (!p.peek().eof) { prog.push(stmt()); skipNl(); }
    } catch (e) { if (e instanceof RbErr) return { out: '', err: fmt(e), code: 1 }; throw e; }

    // 実行
    const methods = new Map();
    const BUILTINS = ['puts', 'print', 'p', 'require', 'gets', 'format', 'sprintf', 'printf'];
    class Ret { constructor(v) { this.v = v; } }
    const cls = v => (v === null ? 'NilClass' : v === true ? 'TrueClass' : v === false ? 'FalseClass' : typeof v === 'string' ? 'String' : typeof v === 'number' ? 'Integer' : v && v.f !== undefined ? 'Float' : v && v.sym ? 'Symbol' : 'Object');
    const toS = v => (v === null ? '' : v === true ? 'true' : v === false ? 'false' : v && v.f !== undefined ? (Number.isInteger(v.f) ? v.f.toFixed(1) : String(v.f)) : v && v.sym ? v.sym : String(v));
    const inspect = v => (typeof v === 'string' ? JSON.stringify(v) : v === null ? 'nil' : v && v.sym ? ':' + v.sym : toS(v));
    const num = v => (v && v.f !== undefined ? v.f : v);
    let where = '<main>';
    const rt = (type, msg, tok, hint) => { const e = new RbErr(type, msg, tok.line, tok.col, tok.len || 1, hint); e.where = where; throw e; };

    function ev(e, sc) {
      switch (e.k) {
        case 'lit': return e.v;
        case 'str': return e.parts.map(x => (x.e ? toS(ev(x.e, sc)) : x.s)).join('');
        case 'neg': { const v = ev(e.a, sc); return typeof v === 'number' ? -v : { f: -num(v) }; }
        case 'ident':
          if (sc.has(e.name)) return sc.get(e.name);
          if (methods.has(e.name) || BUILTINS.includes(e.name)) return call(e.name, [], e.tok, sc);
          rt('NameError', `undefined local variable or method \`${e.name}' for main:Object`, e.tok, suggest(e.name, [...sc.keys(), ...methods.keys(), ...BUILTINS]));
        // fallthrough
        case 'call': return call(e.name, e.args.map(a => ev(a, sc)), e.tok, sc);
        case 'send': {
          const r = ev(e.recv, sc);
          const m = { upcase: s => s.toUpperCase(), downcase: s => s.toLowerCase(), length: s => s.length, size: s => s.length, reverse: s => [...s].reverse().join(''), strip: s => s.trim() };
          if (typeof r === 'string' && m[e.name]) return m[e.name](r);
          if (e.name === 'to_s') return toS(r);
          if (e.name === 'to_i') return parseInt(toS(r), 10) || 0;
          if (e.name === 'inspect') return inspect(r);
          rt('NoMethodError', `undefined method \`${e.name}' for ${r === null ? 'nil' : `an instance of ${cls(r)}`}`, e.tok);
        }
        // fallthrough
        case 'bin': {
          const a = ev(e.a, sc);
          if (e.op === '&&') return a !== null && a !== false ? ev(e.b, sc) : a;
          if (e.op === '||') return a !== null && a !== false ? a : ev(e.b, sc);
          const b = ev(e.b, sc);
          if (e.op === '==') return toS(a) === toS(b) && cls(a) === cls(b);
          if (e.op === '!=') return !(toS(a) === toS(b) && cls(a) === cls(b));
          if (typeof a === 'string') {
            if (e.op === '+') { if (typeof b !== 'string') rt('TypeError', `no implicit conversion of ${cls(b)} into String`, e.tok); return a + b; }
            if (e.op === '*') return a.repeat(num(b));
            rt('NoMethodError', `undefined method \`${e.op}' for an instance of String`, e.tok);
          }
          if (typeof b === 'string') rt('TypeError', `String can't be coerced into ${cls(a)}`, e.tok);
          if (a === null) rt('NoMethodError', `undefined method \`${e.op}' for nil`, e.tok);
          const x = num(a), y = num(b), fl = cls(a) === 'Float' || cls(b) === 'Float';
          if (e.op === '/' && !fl && y === 0) rt('ZeroDivisionError', 'divided by 0', e.tok);
          const r = { '+': x + y, '-': x - y, '*': x * y, '/': fl ? x / y : Math.floor(x / y), '%': x % y, '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y }[e.op];
          return typeof r === 'number' && fl ? { f: r } : r;
        }
      }
      return null;
    }
    function call(name, args, tok, sc) {
      if (methods.has(name)) {
        const d = methods.get(name);
        if (args.length !== d.params.length) rt('ArgumentError', `wrong number of arguments (given ${args.length}, expected ${d.params.length})`, tok);
        const local = new Map(d.params.map((pn, i) => [pn, args[i]]));
        const prev = where;
        where = `Object#${name}`;
        try { run(d.body, local); } catch (r) { if (r instanceof Ret) { where = prev; return r.v; } throw r; }
        where = prev;
        return null;
      }
      switch (name) {
        case 'puts': stdout += args.length ? args.map(a => { const s = toS(a); return s.endsWith('\n') ? s : s + '\n'; }).join('') : '\n'; return null;
        case 'print': stdout += args.map(toS).join(''); return null;
        case 'p': stdout += args.map(a => inspect(a) + '\n').join(''); return args.length === 1 ? args[0] : args;
        case 'require': return true;
        case 'format': case 'sprintf': return cFormat(toS(args[0]), args.slice(1).map(a => ({ t: typeof a === 'string' ? 'char*' : 'int', v: typeof a === 'string' ? a : num(a) })));
        case 'printf': stdout += cFormat(toS(args[0]), args.slice(1).map(a => ({ t: typeof a === 'string' ? 'char*' : 'int', v: typeof a === 'string' ? a : num(a) }))); return null;
      }
      rt('NoMethodError', `undefined method \`${name}' for main:Object`, tok, suggest(name, [...methods.keys(), ...BUILTINS]));
    }
    function run(stmts, sc) {
      for (const s of stmts) {
        switch (s.k) {
          case 'def': methods.set(s.name, s); break;
          case 'assign': sc.set(s.name, ev(s.e, sc)); break;
          case 'expr': ev(s.e, sc); break;
          case 'if': { const c = ev(s.c, sc); const truthy = c !== null && c !== false; run((truthy !== s.neg) ? s.th : s.el, sc); break; }
          case 'return': throw new Ret(s.e ? ev(s.e, sc) : null);
        }
        if (stdout.length > 100000) throw new RbErr('NoMemoryError', 'failed to allocate memory', s.line, 1, 1);
      }
    }
    try { run(prog, new Map()); } catch (e) {
      if (e instanceof RbErr) return { out: stdout, err: fmt(e), code: 1 };
      if (e instanceof Ret) return { out: stdout, err: '', code: 0 };
      throw e;
    }
    return { out: stdout, err: '', code: 0 };
  }
  // #{...} の中身を式として解析する (変数・数値・文字列、および + による連結のみ)
  function rbParseExpr(code) {
    let toks;
    try { toks = rbLex(code); } catch (e) { return null; }
    toks = toks.filter(t => t.t !== 'nl');
    if (!toks.length) return { k: 'lit', v: '', tok: { line: 1, col: 1 } };
    const prim = t => (t.t === 'id' ? { k: 'ident', name: t.v, tok: t } : t.t === 'num' ? { k: 'lit', v: t.v, tok: t } : t.t === 'str' ? { k: 'str', parts: t.parts, tok: t } : null);
    let e = prim(toks[0]);
    for (let i = 1; e && i < toks.length; i += 2) {
      const op = toks[i], rhs = toks[i + 1] && prim(toks[i + 1]);
      if (!op || op.t !== 'op' || !['+', '-', '*'].includes(op.v) || !rhs) return null;
      e = { k: 'bin', op: op.v, a: e, b: rhs, tok: op };
    }
    return e;
  }

  // =====================================================================
  // Go
  // =====================================================================
  const GO_ASI_END = t => t.t === 'id' || t.t === 'num' || t.t === 'str' || t.t === 'chr' || (t.t === 'op' && [')', ']', '}', '++', '--'].includes(t.v));
  const GO_KEYWORDS = words('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var');
  const GO_FMT = words('Println Print Printf Sprintf Sprint Sprintln Errorf Fprintln Fprint Fprintf');
  const GO_STD = words('fmt os strings strconv math time errors io bufio sort');

  function goDesc(t) {
    if (t.t === 'eof') return 'EOF';
    if (t.t === 'id') return GO_KEYWORDS.has(t.v) ? `keyword ${t.v}` : `name ${t.v}`;
    if (t.t === 'str') return `literal ${t.raw}`;
    if (t.t === 'num') return `literal ${t.raw}`;
    if (t.nlBeforeSemi) return 'newline';
    return t.v;
  }

  function goCompile(src, file) {
    const shown = `./${file}`;
    const errs = [];
    const E = (msg, t) => { throw new DiagError(msg, { line: t.line, col: t.col }); };
    let toks;
    try {
      toks = glex(src, { quotes: '"`\'', raw: '`', multiline: '`', charQuote: true });
    } catch (e) {
      if (e.kind === 'unterminated') return { ok: false, err: `# command-line-arguments\n${shown}:${e.pos.line}:${e.pos.col}: string literal not terminated\n` };
      if (e.kind === 'illegal') return { ok: false, err: `# command-line-arguments\n${shown}:${e.pos.line}:${e.pos.col}: invalid character U+${hex4(e.extra.ch.codePointAt(0))} '${e.extra.ch}'\n` };
      return { ok: false, err: `# command-line-arguments\n${shown}:${e.pos.line}:${e.pos.col}: comment not terminated\n` };
    }
    const p = new TP(toks);
    // Go の自動セミコロン挿入
    const atStmtEnd = () => p.is(';') || p.is('}') || p.atEOF() || (p.peek().nl && GO_ASI_END(p.prev));
    const endStmt = () => {
      if (p.eat(';')) return;
      if (atStmtEnd()) return;
      E(`syntax error: unexpected ${goDesc(p.peek())} at end of statement`, p.peek());
    };
    const syntaxUnexpected = (t, ctx) => E(`syntax error: unexpected ${goDesc(t)}${ctx ? ', ' + ctx : ''}`, t);

    let pkg, imports = [], funcs = {}, mainFn = null;
    try {
      const first = p.peek();
      if (!p.is('package')) {
        return { ok: false, err: `${file}:${first.line}:${first.col}: expected 'package', found ${first.t === 'eof' ? 'EOF' : first.t === 'id' && GO_KEYWORDS.has(first.v) ? `'${first.v}'` : first.v}\n` };
      }
      p.next();
      const pn = p.peek();
      if (pn.t !== 'id') return { ok: false, err: `${file}:${pn.line}:${pn.col}: expected 'IDENT', found ${goDesc(pn)}\n` };
      pkg = p.next().v;
      endStmt();
      while (p.is('import')) {
        p.next();
        const one = () => {
          const t = p.peek();
          if (t.t !== 'str') syntaxUnexpected(t, 'expected import path');
          p.next();
          imports.push({ path: t.v, tok: t, used: false });
        };
        if (p.eat('(')) { while (!p.is(')')) { one(); p.eat(';'); } p.next(); } else one();
        endStmt();
      }
      while (!p.atEOF()) {
        const t = p.peek();
        if (p.is('func')) {
          p.next();
          const n = p.peek();
          if (n.t !== 'id') syntaxUnexpected(n, 'expected name or (');
          p.next();
          if (!p.eat('(')) syntaxUnexpected(p.peek(), 'expected (');
          const params = [];
          while (!p.is(')')) {
            const a = p.next();
            if (a.t !== 'id') syntaxUnexpected(a, 'expected )');
            params.push(a.v);
            while (!p.is(',') && !p.is(')')) p.next();
            p.eat(',');
          }
          p.next();
          while (p.peek().t === 'id' && !p.peek().nl) p.next(); // 戻り値の型
          if (!p.is('{')) {
            if (p.peek().nl || p.is(';')) {
              if (p.is('{', 0) || p.peek(p.is(';') ? 1 : 0).v === '{') E('syntax error: unexpected semicolon or newline before {', p.peek());
              E('missing function body', n);
            }
            syntaxUnexpected(p.peek(), 'expected {');
          }
          if (p.peek().nl) E('syntax error: unexpected semicolon or newline before {', p.peek());
          const body = block();
          funcs[n.v] = { name: n.v, params, body, tok: n };
          if (n.v === 'main') mainFn = funcs[n.v];
          endStmt();
          continue;
        }
        if (p.is('import')) E('syntax error: imports must appear before other declarations', t);
        if (p.is('var') || p.is('const')) { const s = varDecl(); s.global = true; funcs['$global$' + s.name] = s; continue; }
        E('syntax error: non-declaration statement outside function body', t);
      }
    } catch (e) {
      if (e instanceof DiagError) return { ok: false, err: `# command-line-arguments\n${shown}:${e.pos.line}:${e.pos.col}: ${e.message}\n` };
      throw e;
    }

    function block() {
      const open = p.next();
      const body = [];
      while (!p.is('}')) {
        if (p.atEOF()) syntaxUnexpected(p.peek(), 'expected }');
        if (p.eat(';')) continue;
        body.push(stmt());
      }
      p.next();
      return { k: 'block', body, tok: open };
    }
    function varDecl() {
      const kw = p.next();
      const n = p.peek();
      if (n.t !== 'id') syntaxUnexpected(n, 'expected name');
      p.next();
      let type = null;
      if (p.peek().t === 'id') type = p.next().v;
      let init = null;
      if (p.eat('=')) init = expr();
      endStmt();
      return { k: 'var', name: n.v, type, init, tok: n, isConst: kw.v === 'const' };
    }
    function stmt() {
      const t = p.peek();
      if (p.is('{')) return block();
      if (p.is('var') || p.is('const')) return varDecl();
      if (p.is('return')) { p.next(); const e = atStmtEnd() ? null : expr(); endStmt(); return { k: 'return', e, tok: t }; }
      if (p.is('if')) {
        p.next();
        const c = expr();
        if (!p.is('{')) syntaxUnexpected(p.peek(), 'expected {');
        const th = block();
        let el = null;
        if (p.eat('else')) el = p.is('if') ? stmt() : block();
        endStmt();
        return { k: 'if', c, th, el, tok: t };
      }
      const e = expr();
      if (p.is(':=') || p.is('=')) {
        const op = p.next();
        if (e.k !== 'name') E(`non-name ${exprStr(e)} on left side of ${op.v}`, e.tok);
        const v = expr();
        endStmt();
        return { k: op.v === ':=' ? 'short' : 'assign', name: e.v, value: v, tok: e.tok };
      }
      endStmt();
      return { k: 'expr', e, tok: t };
    }
    function expr() {
      let a = add();
      while (['==', '!=', '<', '>', '<=', '>='].some(o => p.is(o))) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: add(), tok: a.tok, opTok: op }; }
      return a;
    }
    function add() {
      let a = mul();
      while (p.is('+') || p.is('-')) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: mul(), tok: a.tok, opTok: op }; }
      return a;
    }
    function mul() {
      let a = postfix();
      while (p.is('*') || p.is('/') || p.is('%')) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: postfix(), tok: a.tok, opTok: op }; }
      return a;
    }
    function postfix() {
      let e = primary();
      for (;;) {
        if (p.is('.')) {
          p.next();
          const n = p.peek();
          if (n.t !== 'id') syntaxUnexpected(n, 'expected name or (');
          p.next();
          e = { k: 'sel', obj: e, name: n.v, tok: e.tok, ntok: n };
          continue;
        }
        if (p.is('(')) {
          p.next();
          const args = [];
          while (!p.is(')')) {
            if (p.atEOF()) syntaxUnexpected(p.peek(), 'expected )');
            args.push(expr());
            if (!p.is(')')) {
              if (!p.is(',')) syntaxUnexpected(p.peek(), 'expected comma or )');
              p.next();
            }
          }
          p.next();
          e = { k: 'call', callee: e, args, tok: e.tok };
          continue;
        }
        break;
      }
      return e;
    }
    function primary() {
      const t = p.peek();
      if (t.t === 'str') { p.next(); return { k: 'lit', type: 'string', v: t.v, tok: t }; }
      if (t.t === 'chr') { p.next(); return { k: 'lit', type: 'rune', v: t.v.codePointAt(0) || 0, tok: t }; }
      if (t.t === 'num') { p.next(); return { k: 'lit', type: t.isFloat ? 'float64' : 'int', v: t.v, tok: t }; }
      if (t.t === 'id' && !GO_KEYWORDS.has(t.v)) {
        p.next();
        if (t.v === 'true' || t.v === 'false') return { k: 'lit', type: 'bool', v: t.v === 'true', tok: t };
        return { k: 'name', v: t.v, tok: t };
      }
      if (p.is('(')) { p.next(); const e = expr(); if (!p.eat(')')) syntaxUnexpected(p.peek(), 'expected )'); return e; }
      if (p.is('-') || p.is('!')) { p.next(); return { k: 'unary', op: t.v, a: primary(), tok: t }; }
      syntaxUnexpected(t, 'expected expression');
    }
    const exprStr = e => (e.k === 'name' ? e.v : e.k === 'sel' ? `${exprStr(e.obj)}.${e.name}` : e.k === 'lit' ? (e.type === 'string' ? JSON.stringify(e.v) : String(e.v)) : e.k === 'call' ? `${exprStr(e.callee)}()` : '(expr)');

    // 型チェック (簡易)
    const importOf = n => imports.find(im => im.path.split('/').pop() === n);
    const Ec = (msg, t) => errs.push({ msg, t });
    function check(e, sc) {
      switch (e.k) {
        case 'lit': return e.type;
        case 'unary': return check(e.a, sc);
        case 'name': {
          for (let i = sc.length - 1; i >= 0; i--) if (sc[i].has(e.v)) { const b = sc[i].get(e.v); b.used = true; return b.type; }
          if (funcs[e.v]) return 'func';
          if (['println', 'print', 'len', 'string', 'int'].includes(e.v)) return 'builtin';
          if (importOf(e.v)) { Ec(`use of package ${e.v} without selector`, e.tok); return 'invalid'; }
          Ec(`undefined: ${e.v}`, e.tok);
          return 'invalid';
        }
        case 'sel': {
          if (e.obj.k === 'name' && !sc.some(s => s.has(e.obj.v))) {
            const im = importOf(e.obj.v);
            if (!im) { Ec(`undefined: ${e.obj.v}`, e.obj.tok); return 'invalid'; }
            im.used = true;
            if (im.path === 'fmt') {
              if (/^[a-z]/.test(e.name)) { Ec(`name ${e.name} not exported by package fmt`, e.ntok); return 'invalid'; }
              if (!GO_FMT.has(e.name)) { Ec(`undefined: fmt.${e.name}`, e.ntok); return 'invalid'; }
              return 'fmt.' + e.name;
            }
            if (im.path === 'strings' && ['ToUpper', 'ToLower', 'Repeat', 'TrimSpace'].includes(e.name)) return 'strings.' + e.name;
            Ec(`undefined: ${e.obj.v}.${e.name}`, e.ntok);
            return 'invalid';
          }
          check(e.obj, sc);
          Ec(`${exprStr(e.obj)}.${e.name} undefined`, e.ntok);
          return 'invalid';
        }
        case 'call': {
          const ct = check(e.callee, sc);
          const at = e.args.map(a => check(a, sc));
          if (ct === 'fmt.Printf' || ct === 'fmt.Sprintf') { if (at[0] && at[0] !== 'string' && at[0] !== 'invalid') Ec(`cannot use ${exprStr(e.args[0])} as string value in argument to ${exprStr(e.callee)}`, e.args[0].tok); }
          if (ct === 'fmt.Sprintf' || ct === 'fmt.Sprint' || ct === 'fmt.Sprintln' || (ct && ct.startsWith('strings.'))) return 'string';
          if (ct === 'func') {
            const f = funcs[e.callee.v];
            if (f.params.length !== e.args.length) Ec(`${e.args.length < f.params.length ? 'not enough' : 'too many'} arguments in call to ${f.name}`, e.tok);
          }
          if (ct === 'string' || ct === 'int') Ec(`invalid operation: cannot call non-function ${exprStr(e.callee)} (variable of type ${ct})`, e.tok);
          return 'void';
        }
        case 'bin': {
          const a = check(e.a, sc), b = check(e.b, sc);
          if (a !== 'invalid' && b !== 'invalid' && a !== b && !(isNumT(a) && isNumT(b) && (e.a.k === 'lit' || e.b.k === 'lit'))) {
            Ec(`invalid operation: ${exprStr(e.a)} ${e.op} ${exprStr(e.b)} (mismatched types ${untyped(e.a, a)} and ${untyped(e.b, b)})`, e.opTok);
            return 'invalid';
          }
          return ['==', '!=', '<', '>', '<=', '>='].includes(e.op) ? 'bool' : a;
        }
      }
      return 'invalid';
    }
    const isNumT = t => t === 'int' || t === 'float64' || t === 'rune';
    const untyped = (e, t) => (e.k === 'lit' ? `untyped ${t}` : t);
    function checkStmt(s, sc) {
      switch (s.k) {
        case 'block': { const inner = new Map(); sc.push(inner); s.body.forEach(x => checkStmt(x, sc)); sc.pop(); unusedIn(inner); break; }
        case 'var': case 'short': {
          const t = s.k === 'var' ? (s.init ? check(s.init, sc) : s.type) : check(s.value, sc);
          const top = sc[sc.length - 1];
          if (s.k === 'short' && top.has(s.name)) Ec('no new variables on left side of :=', s.tok);
          top.set(s.name, { type: s.type || (t && t.startsWith('untyped') ? t.slice(8) : t), used: false, tok: s.tok });
          break;
        }
        case 'assign': {
          let found = false;
          for (let i = sc.length - 1; i >= 0; i--) if (sc[i].has(s.name)) found = true;
          if (!found) Ec(`undefined: ${s.name}`, s.tok);
          check(s.value, sc);
          break;
        }
        case 'expr': {
          const t = check(s.e, sc);
          if (s.e.k !== 'call' && t !== 'invalid') Ec(`${exprStr(s.e)} (${s.e.k === 'lit' ? 'untyped ' + t + ' constant' : 'value of type ' + t}) is not used`, s.e.tok);
          break;
        }
        case 'if': check(s.c, sc); checkStmt(s.th, sc); if (s.el) checkStmt(s.el, sc); break;
        case 'return': if (s.e) check(s.e, sc); break;
      }
    }
    function unusedIn(scope) { for (const [n, b] of scope) if (!b.used && b.tok) Ec(`declared and not used: ${n}`, b.tok); }
    const globalsScope = new Map();
    for (const k of Object.keys(funcs)) if (k.startsWith('$global$')) { const g = funcs[k]; globalsScope.set(g.name, { type: g.type || (g.init ? check(g.init, [globalsScope]) : 'int'), used: true }); delete funcs[k]; }
    for (const f of Object.values(funcs)) {
      const params = new Map(f.params.map(pn => [pn, { type: 'string', used: true }]));
      checkStmt(f.body, [globalsScope, params]);
    }
    for (const im of imports) {
      if (!GO_STD.has(im.path)) errs.unshift({ msg: `package ${im.path} is not in std (/usr/lib/go-1.22/src/${im.path})`, t: im.tok, noHeader: true });
      else if (!im.used) Ec(`"${im.path}" imported and not used`, im.tok);
    }
    errs.sort((a, b) => a.t.line - b.t.line || a.t.col - b.t.col);
    if (errs.length) {
      if (errs[0].noHeader) return { ok: false, err: `${file}:${errs[0].t.line}:${errs[0].t.col}: ${errs[0].msg}\n` };
      return { ok: false, err: '# command-line-arguments\n' + errs.slice(0, 10).map(x => `${shown}:${x.t.line}:${x.t.col}: ${x.msg}\n`).join('') };
    }
    if (pkg !== 'main') return { ok: false, err: `package command-line-arguments is not a main package\n`, notMain: true };
    if (!mainFn) return { ok: false, err: '# command-line-arguments\nruntime.main_main·f: function main is undeclared in the main package\n' };
    return { ok: true, program: { funcs, globals: globalsScope } };
  }

  function goRun(prog) {
    let stdout = '', stderr = '';
    class Ret { constructor(v) { this.v = v; } }
    class Panic { constructor(msg) { this.msg = msg; } }
    const vstr = v => (typeof v === 'number' ? numStr(v) : String(v));
    const goFormat = (f, args) => {
      let ai = 0;
      return f.replace(/%([-+ 0#]*)(\d*)(?:\.(\d+))?([vsdqfgtcxT%])/g, (m, fl, w, pr, c) => {
        if (c === '%') return '%';
        if (ai >= args.length) return `%!${c}(MISSING)`;
        const a = args[ai++];
        let s;
        if (c === 'q') s = JSON.stringify(String(a));
        else if (c === 'd') s = String(Math.trunc(a));
        else if (c === 'f') s = Number(a).toFixed(pr === undefined ? 6 : +pr);
        else if (c === 'T') s = typeof a === 'string' ? 'string' : Number.isInteger(a) ? 'int' : 'float64';
        else if (c === 'c') s = String.fromCodePoint(a);
        else if (c === 'x') s = typeof a === 'string' ? [...a].map(ch => ch.charCodeAt(0).toString(16)).join('') : a.toString(16);
        else s = vstr(a);
        if (w) s = fl.includes('-') ? s.padEnd(+w) : s.padStart(+w, fl.includes('0') ? '0' : ' ');
        return s;
      }) + (ai < args.length ? `%!(EXTRA ${args.slice(ai).map(a => `${typeof a === 'string' ? 'string' : 'int'}=${vstr(a)}`).join(', ')})` : '');
    };
    function ev(e, sc) {
      switch (e.k) {
        case 'lit': return e.v;
        case 'unary': { const v = ev(e.a, sc); return e.op === '-' ? -v : !v; }
        case 'name': for (let i = sc.length - 1; i >= 0; i--) if (sc[i].has(e.v)) return sc[i].get(e.v); return undefined;
        case 'bin': {
          const a = ev(e.a, sc), b = ev(e.b, sc);
          switch (e.op) {
            case '+': return a + b;
            case '-': return a - b;
            case '*': return a * b;
            case '/': if (b === 0 && Number.isInteger(a)) throw new Panic('runtime error: integer divide by zero'); return Number.isInteger(a) && Number.isInteger(b) ? Math.trunc(a / b) : a / b;
            case '%': return a % b;
            case '==': return a === b;
            case '!=': return a !== b;
            case '<': return a < b;
            case '>': return a > b;
            case '<=': return a <= b;
            case '>=': return a >= b;
          }
          return undefined;
        }
        case 'call': {
          const c = e.callee;
          const args = e.args.map(a => ev(a, sc));
          if (c.k === 'sel' && c.obj.k === 'name') {
            const f = `${c.obj.v}.${c.name}`;
            switch (f) {
              case 'fmt.Println': stdout += args.map(vstr).join(' ') + '\n'; return null;
              case 'fmt.Print': stdout += args.map((a, i) => (i > 0 && typeof a !== 'string' && typeof args[i - 1] !== 'string' ? ' ' : '') + vstr(a)).join(''); return null;
              case 'fmt.Printf': stdout += goFormat(String(args[0]), args.slice(1)); return null;
              case 'fmt.Sprintf': return goFormat(String(args[0]), args.slice(1));
              case 'fmt.Sprint': return args.map(vstr).join('');
              case 'fmt.Sprintln': return args.map(vstr).join(' ') + '\n';
              case 'strings.ToUpper': return String(args[0]).toUpperCase();
              case 'strings.ToLower': return String(args[0]).toLowerCase();
              case 'strings.Repeat': return String(args[0]).repeat(args[1]);
              case 'strings.TrimSpace': return String(args[0]).trim();
            }
            return null;
          }
          if (c.k === 'name') {
            if (prog.funcs[c.v]) return callFn(prog.funcs[c.v], args);
            if (c.v === 'println') { stderr += args.map(vstr).join(' ') + '\n'; return null; }
            if (c.v === 'print') { stderr += args.map(vstr).join(''); return null; }
            if (c.v === 'len') return String(args[0]).length;
          }
          return null;
        }
      }
      return null;
    }
    let depth = 0;
    function callFn(f, args) {
      if (++depth > 10000) throw new Panic('stack overflow');
      const local = new Map(f.params.map((pn, i) => [pn, args[i]]));
      try { exec(f.body, [prog.globals, local]); } catch (r) { if (r instanceof Ret) { depth--; return r.v; } throw r; }
      depth--;
      return null;
    }
    function exec(s, sc) {
      switch (s.k) {
        case 'block': { sc.push(new Map()); try { s.body.forEach(x => exec(x, sc)); } finally { sc.pop(); } break; }
        case 'var': sc[sc.length - 1].set(s.name, s.init ? ev(s.init, sc) : (s.type === 'string' ? '' : 0)); break;
        case 'short': sc[sc.length - 1].set(s.name, ev(s.value, sc)); break;
        case 'assign': { const v = ev(s.value, sc); for (let i = sc.length - 1; i >= 0; i--) if (sc[i].has(s.name)) { sc[i].set(s.name, v); break; } break; }
        case 'expr': ev(s.e, sc); break;
        case 'if': if (ev(s.c, sc)) exec(s.th, sc); else if (s.el) exec(s.el, sc); break;
        case 'return': throw new Ret(s.e ? ev(s.e, sc) : null);
      }
      if (stdout.length > 100000) throw new Panic('runtime: out of memory');
    }
    try { callFn(prog.funcs.main, []); } catch (e) {
      if (e instanceof Panic) return { out: stdout, err: stderr + `panic: ${e.msg}\n\ngoroutine 1 [running]:\nmain.main()\n\t${HOME}/main.go\nexit status 2\n`, code: 2 };
      throw e;
    }
    return { out: stdout, err: stderr, code: 0 };
  }

  // =====================================================================
  // Rust
  // =====================================================================
  const RS_KEYWORDS = words('as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while');
  const RS_MACROS = words('println print eprintln eprint format panic vec assert assert_eq dbg todo');
  function rustDesc(t) {
    if (t.t === 'eof') return '`<eof>`';
    if (t.t === 'str') return 'literal';
    return `\`${t.raw || t.v}\``;
  }

  function rustCompile(src, file) {
    const crate = file.replace(/\.rs$/, '').replace(/[^A-Za-z0-9_]/g, '_');
    const diags = [];
    const D = (level, code, msg, t, label, extra) => ({ level, code, msg, line: t.line, col: t.col, len: t.len || Math.max(1, (t.raw || t.v || ' ').length), label, ...(extra || {}) });
    const fatal = d => { const e = new DiagError(d.msg, { line: d.line, col: d.col }); e.diag = d; throw e; };
    let toks;
    try {
      toks = glex(src, { quotes: '"\'', multiline: '"', charQuote: true, attributes: true });
    } catch (e) {
      if (e.kind === 'unterminated') return { ok: false, err: rustFormat(file, src, [D('error', 'E0765', 'unterminated double quote string', { line: e.pos.line, col: e.pos.col, len: 1 })]) };
      if (e.kind === 'illegal') return { ok: false, err: rustFormat(file, src, [D('error', null, `unknown start of token: ${e.extra.ch}`, { line: e.pos.line, col: e.pos.col, len: 1 })]) };
      return { ok: false, err: rustFormat(file, src, [D('error', 'E0758', 'unterminated block comment', { line: e.pos.line, col: e.pos.col, len: 2 })]) };
    }
    const p = new TP(toks);
    const expected = (what, t) => fatal(D('error', null, `expected ${what}, found ${rustDesc(t)}`, t, `expected ${what}`));
    const fns = {};
    function block() {
      const open = p.next();
      const body = [];
      let tail = null;
      while (!p.is('}')) {
        if (p.atEOF()) fatal(D('error', null, 'this file contains an unclosed delimiter', p.prev, 'unclosed delimiter'));
        if (p.eat(';')) continue;
        const t = p.peek();
        if (p.is('let')) {
          p.next();
          const mut = !!p.eat('mut');
          const n = p.peek();
          if (n.t !== 'id') expected('identifier', n);
          p.next();
          if (p.eat(':')) { p.next(); if (p.eat('<')) { while (!p.is('>')) p.next(); p.next(); } }
          const init = p.eat('=') ? expr() : null;
          if (!p.eat(';')) fatal(D('error', null, `expected \`;\`, found ${rustDesc(p.peek())}`, p.prev.end ? { line: p.prev.end.line, col: p.prev.end.col, len: 1 } : p.peek(), 'help: add `;` here'));
          body.push({ k: 'let', name: n.v, mut, init, tok: n });
          continue;
        }
        const e = expr();
        if (p.eat(';')) { body.push({ k: 'expr', e, tok: t }); continue; }
        if (p.is('}')) { tail = e; body.push({ k: 'expr', e, tok: t, tail: true }); continue; }
        const nx = p.peek();
        fatal(D('error', null, `expected \`;\`, found ${rustDesc(nx)}`, { line: p.prev.end.line, col: p.prev.end.col, len: 1 }, 'help: add `;` here', { second: { line: nx.line, col: nx.col, len: (nx.raw || nx.v || ' ').length, label: 'unexpected token' } }));
      }
      p.next();
      return { k: 'block', body, tail, tok: open };
    }
    function expr() {
      let a = add();
      while (['==', '!=', '<', '>', '<=', '>='].some(o => p.is(o))) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: add(), tok: a.tok, opTok: op }; }
      return a;
    }
    function add() {
      let a = mul();
      while (p.is('+') || p.is('-')) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: mul(), tok: a.tok, opTok: op }; }
      return a;
    }
    function mul() {
      let a = unary();
      while (p.is('*') || p.is('/') || p.is('%')) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: unary(), tok: a.tok, opTok: op }; }
      return a;
    }
    function unary() {
      if (p.is('&') || p.is('-') || p.is('!')) { const t = p.next(); return { k: 'unary', op: t.v, a: unary(), tok: t }; }
      return postfix();
    }
    function args(close) {
      const list = [];
      while (!p.is(close)) {
        if (p.atEOF()) fatal(D('error', null, 'this file contains an unclosed delimiter', p.prev, 'unclosed delimiter'));
        list.push(expr());
        if (!p.is(close)) { if (!p.is(',')) expected(`one of \`${close === ')' ? ')' : ']'}\`, \`,\`, \`.\`, \`?\`, or an operator`, p.peek()); p.next(); }
      }
      p.next();
      return list;
    }
    function postfix() {
      let e = primary();
      for (;;) {
        if (p.is('.')) {
          p.next();
          const n = p.next();
          const a = p.is('(') ? (p.next(), args(')')) : null;
          e = { k: 'method', obj: e, name: n.v, args: a, tok: e.tok, ntok: n };
          continue;
        }
        break;
      }
      return e;
    }
    function primary() {
      const t = p.peek();
      if (t.t === 'str') { p.next(); return { k: 'lit', type: '&str', v: t.v, tok: t }; }
      if (t.t === 'num') { p.next(); return { k: 'lit', type: t.isFloat ? 'f64' : 'i32', v: t.v, tok: t }; }
      if (t.t === 'id') {
        p.next();
        if (t.v === 'true' || t.v === 'false') return { k: 'lit', type: 'bool', v: t.v === 'true', tok: t };
        let path = t.v;
        while (p.is('::')) { p.next(); path += '::' + p.next().v; }
        if (p.is('!')) {
          p.next();
          const open = p.peek();
          const close = { '(': ')', '[': ']', '{': '}' }[open.v];
          if (!close) expected('one of `(`, `[`, or `{`', open);
          p.next();
          return { k: 'macro', name: path, args: args(close), tok: t, open };
        }
        if (p.is('(')) { p.next(); return { k: 'call', name: path, args: args(')'), tok: t }; }
        return { k: 'name', v: path, tok: t };
      }
      if (p.is('(')) { p.next(); const e = expr(); if (!p.eat(')')) expected('`)`', p.peek()); return e; }
      expected('expression', t);
    }

    try {
      while (!p.atEOF()) {
        const t = p.peek();
        if (p.is('use')) { while (!p.is(';') && !p.atEOF()) p.next(); p.eat(';'); continue; }
        if (p.is('pub')) p.next();
        if (p.is('fn')) {
          p.next();
          const n = p.peek();
          if (n.t !== 'id') expected('identifier', n);
          p.next();
          if (!p.eat('(')) expected('one of `(` or `<`', p.peek());
          const params = [];
          while (!p.is(')')) {
            const a = p.next();
            if (a.t !== 'id') expected('identifier', a);
            if (!p.eat(':')) expected('one of `:`, `@`, or `|`', p.peek());
            let depth = 0;
            while (!(depth === 0 && (p.is(',') || p.is(')')))) { if (p.is('<')) depth++; if (p.is('>')) depth--; p.next(); }
            params.push(a.v);
            p.eat(',');
          }
          p.next();
          if (p.eat('->')) { while (!p.is('{') && !p.atEOF()) p.next(); }
          if (!p.is('{')) expected('one of `->`, `where`, or `{`', p.peek());
          fns[n.v] = { name: n.v, params, body: block(), tok: n };
          continue;
        }
        if (t.t === 'id' && p.is('(', 1)) fatal(D('error', null, `missing \`fn\` for function definition`, t, null));
        expected('item', t);
      }
    } catch (e) {
      if (e instanceof DiagError && e.diag) return { ok: false, err: rustFormat(file, src, [e.diag]) };
      throw e;
    }

    // 名前解決・マクロの検査
    const fnNames = Object.keys(fns);
    function checkE(e, sc) {
      switch (e.k) {
        case 'lit': return;
        case 'unary': checkE(e.a, sc); return;
        case 'bin': checkE(e.a, sc); checkE(e.b, sc); return;
        case 'method': checkE(e.obj, sc); (e.args || []).forEach(a => checkE(a, sc)); return;
        case 'name': {
          for (let i = sc.length - 1; i >= 0; i--) if (sc[i].has(e.v)) { sc[i].get(e.v).used = true; return; }
          if (RS_MACROS.has(e.v)) { diags.push(D('error', 'E0423', `expected value, found macro \`${e.v}\``, e.tok, 'not a value')); return; }
          const s = suggest(e.v, [...sc.flatMap(m => [...m.keys()])]);
          diags.push(D('error', 'E0425', `cannot find value \`${e.v}\` in this scope`, e.tok, s ? `help: a local variable with a similar name exists: \`${s}\`` : 'not found in this scope'));
          return;
        }
        case 'call': {
          e.args.forEach(a => checkE(a, sc));
          if (fns[e.name]) {
            if (fns[e.name].params.length !== e.args.length) diags.push(D('error', 'E0061', `this function takes ${fns[e.name].params.length} argument${fns[e.name].params.length === 1 ? '' : 's'} but ${e.args.length} argument${e.args.length === 1 ? ' was' : 's were'} supplied`, e.tok, null));
            return;
          }
          if (RS_MACROS.has(e.name)) {
            diags.push(D('error', 'E0423', `expected function, found macro \`${e.name}\``, e.tok, 'not a function', { help: `use \`!\` to invoke the macro: \`${e.name}!\`` }));
            return;
          }
          const s = suggest(e.name, fnNames);
          diags.push(D('error', 'E0425', `cannot find function \`${e.name}\` in this scope`, e.tok, s ? `help: a function with a similar name exists: \`${s}\`` : 'not found in this scope'));
          return;
        }
        case 'macro': {
          if (!RS_MACROS.has(e.name)) {
            const s = suggest(e.name, [...RS_MACROS]);
            diags.push(D('error', null, `cannot find macro \`${e.name}\` in this scope`, e.tok, s ? `help: a macro with a similar name exists: \`${s}\`` : null));
            return;
          }
          if (['println', 'print', 'eprintln', 'eprint', 'format', 'panic'].includes(e.name)) {
            if (!e.args.length) {
              if (e.name === 'println' || e.name === 'eprintln' || e.name === 'panic') return;
              diags.push(D('error', null, 'requires at least a format string argument', e.tok, null));
              return;
            }
            const f = e.args[0];
            if (f.k !== 'lit' || f.type !== '&str') {
              f.args = undefined;
              diags.push(D('error', null, 'format argument must be a string literal', f.tok, null, { help: `you might be missing a string literal to format with: \`"{}", \`` }));
              e.args.slice(1).forEach(a => checkE(a, sc));
              return;
            }
            const holes = [...f.v.replace(/\{\{|\}\}/g, '').matchAll(/\{([A-Za-z_]\w*)?(?::[^}]*)?\}/g)];
            let positional = 0;
            for (const h of holes) {
              if (h[1]) checkE({ k: 'name', v: h[1], tok: f.tok }, sc);
              else positional++;
            }
            const given = e.args.length - 1;
            e.args.slice(1).forEach(a => checkE(a, sc));
            if (positional > given) diags.push(D('error', null, `${positional} positional argument${positional === 1 ? '' : 's'} in format string, but ${given === 0 ? 'no arguments were given' : `there ${given === 1 ? 'is' : 'are'} ${given} argument${given === 1 ? '' : 's'}`}`, f.tok, null));
            else if (positional < given) diags.push(D('error', null, given - positional === 1 ? 'argument never used' : 'multiple unused formatting arguments', e.args[positional + 1].tok, 'argument never used'));
            return;
          }
          e.args.forEach(a => checkE(a, sc));
          return;
        }
      }
    }
    function checkBlock(b, sc) {
      const scope = new Map();
      sc.push(scope);
      for (const s of b.body) {
        if (s.k === 'let') {
          if (s.init) checkE(s.init, sc);
          scope.set(s.name, { used: false, tok: s.tok, mut: s.mut });
        } else checkE(s.e, sc);
      }
      sc.pop();
      for (const [n, v] of scope) {
        if (!v.used && !n.startsWith('_')) diags.push(D('warning', null, `unused variable: \`${n}\``, v.tok, `help: if this is intentional, prefix it with an underscore: \`_${n}\``, { note: '`#[warn(unused_variables)]` on by default' }));
      }
    }
    for (const f of Object.values(fns)) checkBlock(f.body, [new Map(f.params.map(x => [x, { used: true }]))]);
    if (!fns.main) diags.push({ level: 'error', code: 'E0601', msg: `\`main\` function not found in crate \`${crate}\``, line: srcLineOf(src, 1) !== undefined ? src.split('\n').length : 1, col: 1, len: 0, label: null, noteText: `consider adding a \`main\` function to \`${file}\`` });
    const errors = diags.filter(d => d.level === 'error');
    diags.sort((a, b) => (a.level === b.level ? 0 : a.level === 'warning' ? -1 : 1) || a.line - b.line || a.col - b.col);
    const out = rustFormat(file, src, diags);
    if (errors.length) return { ok: false, err: out };
    return { ok: true, err: out, program: { fns } };
  }

  function rustFormat(file, src, diags) {
    const lines = src.split('\n');
    let s = '';
    const errs = diags.filter(d => d.level === 'error');
    for (const d of diags) {
      const w = String(Math.max(d.line, d.second ? d.second.line : 0)).length;
      const pad = ' '.repeat(w);
      s += `${d.level}${d.code ? `[${d.code}]` : ''}: ${d.msg}\n${pad}--> ${file}:${d.line}:${d.col}\n`;
      if (d.len > 0) {
        const ln = lines[d.line - 1] || '';
        s += `${pad} |\n${String(d.line).padStart(w)} | ${ln}\n${pad} | ${caretLine(ln, d.col, d.len).replace(/~/g, '^')}${d.label ? ' ' + d.label : ''}\n`;
        if (d.second) {
          const l2 = lines[d.second.line - 1] || '';
          s += `${String(d.second.line).padStart(w)} | ${l2}\n${pad} | ${caretLine(l2, d.second.col, d.second.len).replace(/[\^~]/g, '-')} ${d.second.label}\n`;
        }
        s += `${pad} |\n`;
      }
      if (d.help) s += `${pad} = help: ${d.help}\n`;
      if (d.note) s += `${pad} = note: ${d.note}\n`;
      if (d.noteText) s += `${pad} = note: ${d.noteText}\n`;
      s += '\n';
    }
    if (errs.length) {
      s += `error: aborting due to ${errs.length === 1 ? '1 previous error' : `${errs.length} previous errors`}`;
      const warns = diags.length - errs.length;
      if (warns) s += `; ${warns} warning${warns === 1 ? '' : 's'} emitted`;
      s += '\n\n';
      const codes = [...new Set(errs.map(e => e.code).filter(Boolean))];
      if (codes.length === 1) s += `For more information about this error, try \`rustc --explain ${codes[0]}\`.\n`;
      else if (codes.length > 1) s += `Some errors have detailed explanations: ${codes.join(', ')}.\nFor more information about an error, try \`rustc --explain ${codes[0]}\`.\n`;
    } else if (diags.length) {
      s += `warning: ${diags.length} warning${diags.length === 1 ? '' : 's'} emitted\n\n`;
    }
    return s;
  }

  function rustRun(prog) {
    let stdout = '', stderr = '';
    class Ret { constructor(v) { this.v = v; } }
    class Panic { constructor(msg) { this.msg = msg; } }
    const disp = v => (typeof v === 'number' ? numStr(v) : String(v));
    const debug = v => (typeof v === 'string' ? JSON.stringify(v) : disp(v));
    function fmt(f, args, sc) {
      let ai = 0;
      return f.replace(/\{\{|\}\}|\{([A-Za-z_]\w*)?(?::([^}]*))?\}/g, (m, name, spec) => {
        if (m === '{{') return '{';
        if (m === '}}') return '}';
        const v = name ? lookup(name, sc) : args[ai++];
        return spec && spec.includes('?') ? debug(v) : disp(v);
      });
    }
    function lookup(n, sc) { for (let i = sc.length - 1; i >= 0; i--) if (sc[i].has(n)) return sc[i].get(n); return undefined; }
    function ev(e, sc) {
      switch (e.k) {
        case 'lit': return e.v;
        case 'name': return lookup(e.v, sc);
        case 'unary': { const v = ev(e.a, sc); return e.op === '-' ? -v : e.op === '!' ? !v : v; }
        case 'bin': {
          const a = ev(e.a, sc), b = ev(e.b, sc);
          switch (e.op) {
            case '+': return a + b;
            case '-': return a - b;
            case '*': return a * b;
            case '/': if (b === 0 && Number.isInteger(a)) throw new Panic('attempt to divide by zero'); return Number.isInteger(a) && Number.isInteger(b) ? Math.trunc(a / b) : a / b;
            case '%': return a % b;
            case '==': return a === b;
            case '!=': return a !== b;
            case '<': return a < b;
            case '>': return a > b;
            case '<=': return a <= b;
            case '>=': return a >= b;
          }
          return undefined;
        }
        case 'method': {
          const o = ev(e.obj, sc);
          const m = { to_string: () => disp(o), to_uppercase: () => String(o).toUpperCase(), to_lowercase: () => String(o).toLowerCase(), len: () => String(o).length, trim: () => String(o).trim() };
          return m[e.name] ? m[e.name]() : o;
        }
        case 'call': {
          const f = prog.fns[e.name];
          if (f) return callFn(f, e.args.map(a => ev(a, sc)));
          if (e.name === 'String::from') return String(ev(e.args[0], sc));
          return undefined;
        }
        case 'macro': {
          const args = e.args.map(a => ev(a, sc));
          const text = () => (args.length ? fmt(String(args[0]), args.slice(1), sc) : '');
          switch (e.name) {
            case 'println': stdout += text() + '\n'; return undefined;
            case 'print': stdout += text(); return undefined;
            case 'eprintln': stderr += text() + '\n'; return undefined;
            case 'eprint': stderr += text(); return undefined;
            case 'format': return text();
            case 'panic': throw new Panic(text() || 'explicit panic');
            case 'todo': throw new Panic('not yet implemented');
          }
          return undefined;
        }
      }
      return undefined;
    }
    let depth = 0;
    function callFn(f, args) {
      if (++depth > 10000) throw new Panic('stack overflow');
      const sc = [new Map(f.params.map((pn, i) => [pn, args[i]]))];
      const r = execBlock(f.body, sc);
      depth--;
      return r;
    }
    function execBlock(b, sc) {
      sc.push(new Map());
      let last;
      for (const s of b.body) {
        if (s.k === 'let') sc[sc.length - 1].set(s.name, s.init ? ev(s.init, sc) : undefined);
        else last = ev(s.e, sc);
        if (stdout.length > 100000) throw new Panic('capacity overflow');
      }
      sc.pop();
      return b.tail ? last : undefined;
    }
    try { callFn(prog.fns.main, []); } catch (e) {
      if (e instanceof Panic) return { out: stdout, err: stderr + `thread 'main' panicked at src/main.rs:\n${e.msg}\nnote: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace\n`, code: 101 };
      if (e instanceof Ret) return { out: stdout, err: stderr, code: 0 };
      throw e;
    }
    return { out: stdout, err: stderr, code: 0 };
  }

  // =====================================================================
  // PHP
  // =====================================================================
  const PHP_KEYWORDS = words('echo print function return if else elseif while for foreach as new class true false null and or');
  class PhpErr { constructor(kind, msg, line) { Object.assign(this, { kind, msg, line }); } }

  function phpRun(src, file) {
    const path = `${HOME}/${file}`;
    let stdout = '', stderr = '';
    let toks;
    const parseErr = (msg, line) => new PhpErr('parse', msg, line);
    try {
      toks = glex(src, { php: true, quotes: '"\'', multiline: '"\'', hashComment: true, keepUnknownEscape: true });
    } catch (e) {
      if (e.kind === 'unterminated') return { out: '', err: `PHP Parse error:  syntax error, unexpected end of file, expecting variable or "\${" or "{$" in ${path} on line ${src.split('\n').length}\n`, code: 255 };
      if (e.kind === 'illegal') return { out: '', err: `PHP Parse error:  syntax error, unexpected character 0x${e.extra.ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')} in ${path} on line ${e.pos.line}\n`, code: 255 };
      throw e;
    }
    const p = new TP(toks);
    const desc = t => {
      if (t.t === 'eof') return 'end of file';
      if (t.t === 'str') return t.q === '"' ? `double-quoted string "${t.v}"` : `single-quoted string "${t.v}"`;
      if (t.t === 'var') return `variable "$${t.v}"`;
      if (t.t === 'num') return `integer "${t.raw}"`;
      if (t.t === 'id') return PHP_KEYWORDS.has(t.v.toLowerCase()) ? `token "${t.v}"` : `identifier "${t.v}"`;
      if (t.t === 'inline') return 'inline html';
      return `token "${t.v}"`;
    };
    const unexpected = (t, expecting) => { throw parseErr(`syntax error, unexpected ${desc(t)}${expecting ? `, expecting ${expecting}` : ''}`, t.t === 'eof' ? src.split('\n').length : t.line); };
    const endStmt = () => { if (!p.eat(';')) unexpected(p.peek(), '"," or ";"'); };
    function block() {
      if (!p.eat('{')) unexpected(p.peek(), '"{"');
      const body = [];
      while (!p.is('}')) { if (p.atEOF()) unexpected(p.peek()); body.push(stmt()); }
      p.next();
      return body;
    }
    function stmt() {
      const t = p.peek();
      if (t.t === 'inline') { p.next(); return { k: 'inline', v: t.v }; }
      if (p.eat(';')) return { k: 'empty' };
      const kw = t.t === 'id' ? t.v.toLowerCase() : '';
      if (kw === 'echo') {
        p.next();
        const list = [expr()];
        while (p.eat(',')) list.push(expr());
        endStmt();
        return { k: 'echo', list, line: t.line };
      }
      if (kw === 'function') {
        p.next();
        const n = p.next();
        if (n.t !== 'id') unexpected(n, '"("');
        if (!p.eat('(')) unexpected(p.peek(), '"("');
        const params = [];
        while (!p.is(')')) { const a = p.next(); if (a.t !== 'var') unexpected(a, 'variable'); params.push(a.v); p.eat(','); }
        p.next();
        return { k: 'func', name: n.v.toLowerCase(), params, body: block(), line: t.line };
      }
      if (kw === 'return') { p.next(); const e = p.is(';') ? null : expr(); endStmt(); return { k: 'return', e, line: t.line }; }
      if (kw === 'if') {
        p.next();
        if (!p.eat('(')) unexpected(p.peek(), '"("');
        const c = expr();
        if (!p.eat(')')) unexpected(p.peek(), '")"');
        const th = p.is('{') ? block() : [stmt()];
        let el = [];
        if (p.is('else')) { p.next(); el = p.is('{') ? block() : [stmt()]; }
        return { k: 'if', c, th, el, line: t.line };
      }
      const e = expr();
      endStmt();
      return { k: 'expr', e, line: t.line };
    }
    function expr() {
      const lhs = cmp();
      if (p.is('=') || p.is('.=') || p.is('+=')) {
        const op = p.next();
        if (lhs.k !== 'var') unexpected(op);
        return { k: 'assign', op: op.v, name: lhs.name, value: expr(), line: op.line };
      }
      return lhs;
    }
    function cmp() {
      let a = concat();
      while (['===', '!==', '==', '!=', '<', '>', '<=', '>='].some(o => p.is(o))) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: concat(), line: op.line }; }
      return a;
    }
    function concat() {
      let a = mul();
      while (p.is('.') || p.is('+') || p.is('-')) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: mul(), line: op.line }; }
      return a;
    }
    function mul() {
      let a = unary();
      while (p.is('*') || p.is('/') || p.is('%')) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: unary(), line: op.line }; }
      return a;
    }
    function unary() {
      if (p.is('-') || p.is('!')) { const t = p.next(); return { k: 'unary', op: t.v, a: unary(), line: t.line }; }
      const t = p.peek();
      if (t.t === 'id' && t.v.toLowerCase() === 'print') { p.next(); return { k: 'print', a: expr(), line: t.line }; }
      return primary();
    }
    function primary() {
      const t = p.peek();
      if (t.t === 'str') { p.next(); return { k: 'str', v: t.v, interp: t.q === '"', line: t.line }; }
      if (t.t === 'num') { p.next(); return { k: 'lit', v: t.v, line: t.line }; }
      if (t.t === 'var') { p.next(); return { k: 'var', name: t.v, line: t.line }; }
      if (t.t === 'id') {
        p.next();
        const lc = t.v.toLowerCase();
        if (lc === 'true' || lc === 'false') return { k: 'lit', v: lc === 'true', line: t.line };
        if (lc === 'null') return { k: 'lit', v: null, line: t.line };
        if (p.is('(')) {
          p.next();
          const args = [];
          while (!p.is(')')) {
            if (p.atEOF()) unexpected(p.peek());
            args.push(expr());
            if (!p.is(')') && !p.eat(',')) unexpected(p.peek(), '")"');
          }
          p.next();
          return { k: 'call', name: t.v, args, line: t.line };
        }
        return { k: 'const', name: t.v, line: t.line };
      }
      if (p.is('(')) { p.next(); const e = expr(); if (!p.eat(')')) unexpected(p.peek(), '")"'); return e; }
      unexpected(t);
    }

    let prog;
    try {
      prog = [];
      while (!p.atEOF()) prog.push(stmt());
    } catch (e) {
      if (e instanceof PhpErr) return { out: '', err: `PHP Parse error:  ${e.msg} in ${path} on line ${e.line}\n`, code: 255 };
      throw e;
    }

    // 実行
    const vars = [new Map()];
    const funcs = new Map();
    class Ret { constructor(v) { this.v = v; } }
    const toStr = v => (v === null || v === false ? '' : v === true ? '1' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(v)) : String(v));
    const toNum = (v, line) => {
      if (typeof v === 'number') return v;
      if (v === null || v === false) return 0;
      if (v === true) return 1;
      const n = parseFloat(v);
      if (Number.isNaN(n)) throw new PhpErr('fatal', `Uncaught TypeError: Unsupported operand types: string + int`, line);
      return n;
    };
    const warn = (msg, line) => { stderr += `PHP Warning:  ${msg} in ${path} on line ${line}\n`; };
    const getVar = (n, line) => {
      const sc = vars[vars.length - 1];
      if (sc.has(n)) return sc.get(n);
      warn(`Undefined variable $${n}`, line);
      return null;
    };
    const interp = (s, line) => s.replace(/\{\$([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (m, a, b) => toStr(getVar(a || b, line)));
    const BUILTIN = {
      strtoupper: a => toStr(a[0]).toUpperCase(),
      strtolower: a => toStr(a[0]).toLowerCase(),
      strlen: a => toStr(a[0]).length,
      str_repeat: a => toStr(a[0]).repeat(a[1]),
      ucfirst: a => { const s = toStr(a[0]); return s.charAt(0).toUpperCase() + s.slice(1); },
      trim: a => toStr(a[0]).trim(),
      printf: a => { const s = cFormat(toStr(a[0]), a.slice(1).map(x => ({ t: typeof x === 'string' ? 'char*' : 'int', v: x }))); stdout += s; return s.length; },
      sprintf: a => cFormat(toStr(a[0]), a.slice(1).map(x => ({ t: typeof x === 'string' ? 'char*' : 'int', v: x }))),
      var_dump: a => { a.forEach(x => { stdout += typeof x === 'string' ? `string(${x.length}) "${x}"\n` : typeof x === 'number' ? `${Number.isInteger(x) ? 'int' : 'float'}(${x})\n` : typeof x === 'boolean' ? `bool(${x})\n` : 'NULL\n'; }); return null; },
      print_r: a => { stdout += toStr(a[0]); return true; },
    };
    function ev(e) {
      switch (e.k) {
        case 'lit': return e.v;
        case 'str': return e.interp ? interp(e.v, e.line) : e.v;
        case 'var': return getVar(e.name, e.line);
        case 'const':
          if (e.name === 'PHP_EOL') return '\n';
          throw new PhpErr('fatal', `Uncaught Error: Undefined constant "${e.name}"`, e.line);
        case 'print': stdout += toStr(ev(e.a)); return 1;
        case 'unary': { const v = ev(e.a); return e.op === '-' ? -toNum(v, e.line) : !v; }
        case 'assign': {
          let v = ev(e.value);
          const sc = vars[vars.length - 1];
          if (e.op === '.=') v = toStr(sc.get(e.name)) + toStr(v);
          if (e.op === '+=') v = toNum(sc.get(e.name), e.line) + toNum(v, e.line);
          sc.set(e.name, v);
          return v;
        }
        case 'bin': {
          const a = ev(e.a), b = ev(e.b);
          switch (e.op) {
            case '.': return toStr(a) + toStr(b);
            case '+':
              if (typeof a === 'string' && Number.isNaN(parseFloat(a)) || typeof b === 'string' && Number.isNaN(parseFloat(b))) {
                throw new PhpErr('fatal', `Uncaught TypeError: Unsupported operand types: ${typeof a === 'string' ? 'string' : 'int'} + ${typeof b === 'string' ? 'string' : 'int'}`, e.line);
              }
              return toNum(a) + toNum(b);
            case '-': return toNum(a, e.line) - toNum(b, e.line);
            case '*': return toNum(a, e.line) * toNum(b, e.line);
            case '/': if (toNum(b) === 0) throw new PhpErr('fatal', 'Uncaught DivisionByZeroError: Division by zero', e.line); return toNum(a) / toNum(b);
            case '%': return toNum(a) % toNum(b);
            case '===': return a === b;
            case '!==': return a !== b;
            // eslint-disable-next-line eqeqeq
            case '==': return a == b;
            // eslint-disable-next-line eqeqeq
            case '!=': return a != b;
            case '<': return a < b;
            case '>': return a > b;
            case '<=': return a <= b;
            case '>=': return a >= b;
          }
          return null;
        }
        case 'call': {
          const lc = e.name.toLowerCase();
          const args = e.args.map(ev);
          if (funcs.has(lc)) {
            const f = funcs.get(lc);
            if (args.length < f.params.length) throw new PhpErr('fatal', `Uncaught ArgumentCountError: Too few arguments to function ${f.name}(), ${args.length} passed in ${path} on line ${e.line} and exactly ${f.params.length} expected`, f.line);
            vars.push(new Map(f.params.map((pn, i) => [pn, args[i]])));
            try { run(f.body); } catch (r) { vars.pop(); if (r instanceof Ret) return r.v; throw r; }
            vars.pop();
            return null;
          }
          if (BUILTIN[lc]) return BUILTIN[lc](args);
          throw new PhpErr('fatal', `Uncaught Error: Call to undefined function ${e.name}()`, e.line);
        }
      }
      return null;
    }
    function run(stmts) {
      for (const s of stmts) if (s.k === 'func') funcs.set(s.name, s);
      for (const s of stmts) {
        switch (s.k) {
          case 'inline': stdout += s.v; break;
          case 'echo': stdout += s.list.map(x => toStr(ev(x))).join(''); break;
          case 'expr': ev(s.e); break;
          case 'if': run(ev(s.c) ? s.th : s.el); break;
          case 'return': throw new Ret(s.e ? ev(s.e) : null);
        }
        if (stdout.length > 100000) throw new PhpErr('fatal', 'Allowed memory size of 134217728 bytes exhausted', s.line || 1);
      }
    }
    try { run(prog); } catch (e) {
      if (e instanceof PhpErr) return { out: stdout, err: stderr + `PHP Fatal error:  ${e.msg} in ${path}:${e.line}\nStack trace:\n#0 {main}\n  thrown in ${path} on line ${e.line}\n`, code: 255 };
      if (e instanceof Ret) return { out: stdout, err: stderr, code: 0 };
      throw e;
    }
    return { out: stdout, err: stderr, code: 0 };
  }

  // =====================================================================
  // C++ (g++)
  // =====================================================================
  const CPP_HEADERS = words('iostream string cstdio cstdlib cmath vector map algorithm iomanip sstream fstream stdio.h stdlib.h string.h math.h bits/stdc++.h');
  const CPP_TYPES = words('int char void double float long short unsigned signed const static bool auto string std size_t');
  const CPP_STD_MEMBERS = { cout: 'iostream', cerr: 'iostream', endl: 'iostream', string: 'string', printf: 'cstdio', puts: 'cstdio', to_string: 'string' };

  function cppCompile(src, file) {
    const lines = src.split('\n');
    const includes = new Set();
    try {
      lines.forEach((ln, idx) => {
        const m = /^(\s*)#\s*(\w*)(.*)$/.exec(ln);
        if (!m) return;
        if (m[2] === 'include') {
          const rest = m[3];
          const col = ln.length - rest.length + (rest.length - rest.trimStart().length) + 1;
          const hm = /^([<"])([^>"]*)([>"])?/.exec(rest.trimStart());
          if (!hm) throw new DiagError('#include expects "FILENAME" or <FILENAME>', { line: idx + 1, col });
          const h = hm[2].trim();
          if (!CPP_HEADERS.has(h)) throw new DiagError(`${h}: No such file or directory`, { line: idx + 1, col }, { fatal: true, len: hm[0].length });
          includes.add(h);
        } else if (m[2] && !words('define undef ifdef ifndef if else elif endif pragma').has(m[2])) {
          throw new DiagError(`invalid preprocessing directive #${m[2]}`, { line: idx + 1, col: m[1].length + 2 }, { len: m[2].length });
        }
        lines[idx] = '';
      });
    } catch (e) {
      if (!(e instanceof DiagError)) throw e;
      let out = gccFormat(file, src, [{ kind: e.extra.fatal ? 'fatal error' : 'error', msg: e.message, pos: e.pos, len: e.extra.len }]);
      if (e.extra.fatal) out += 'compilation terminated.\n';
      return { ok: false, err: out };
    }
    const all = includes.has('bits/stdc++.h');
    const has = h => all || includes.has(h) || (h === 'cstdio' && (includes.has('stdio.h') || includes.has('iostream'))) || (h === 'string' && includes.has('iostream'));
    let usingStd = false;
    const funcs = {};
    const warnings = [];
    let curFn = null;
    const fnSig = f => `${f.ret} ${f.name}(${f.params.join(', ')})`;
    const E = (msg, t, extra) => { throw new DiagError(msg, { line: t.line, col: t.col }, { fn: curFn ? fnSig(curFn) : undefined, len: extra && extra.len !== undefined ? extra.len : (t.raw || t.v || ' ').length, ...(extra || {}) }); };
    const desc = t => (t.t === 'eof' ? null : t.t === 'str' ? 'string constant' : t.t === 'num' ? 'numeric constant' : t.t === 'id' ? `‘${t.v}’` : `‘${t.v}’ token`);

    let toks;
    try { toks = clex(lines.join('\n'), 'c'); } catch (e) {
      if (!(e instanceof DiagError)) throw e;
      return { ok: false, err: gccFormat(file, src, [{ kind: 'error', msg: e.message, pos: e.pos, len: e.extra.len }]) };
    }
    const p = new TP(toks);
    const expected = (what, at) => {
      const t = p.peek();
      const d = desc(t);
      E(d ? `expected ${what} before ${d}` : `expected ${what} at end of input`, at || p.afterPrev(), { len: 1 });
    };
    const isType = () => p.peek().t === 'id' && (CPP_TYPES.has(p.peek().v) || (p.peek().v === 'std' && p.is('::', 1)));

    function parseType() {
      let name = '';
      while (p.peek().t === 'id' && CPP_TYPES.has(p.peek().v) && p.peek().v !== 'std') {
        name += (name ? ' ' : '') + p.next().v;
      }
      if (p.is('std') && p.is('::', 1)) { p.next(); p.next(); name += (name ? ' ' : '') + 'std::' + p.next().v; }
      while (p.is('*') || p.is('&')) name += p.next().v;
      return name;
    }
    function block() {
      p.next();
      const body = [];
      while (!p.is('}')) {
        if (p.atEOF()) E('expected ‘}’ at end of input', { line: p.prev.end.line, col: p.prev.end.col }, { len: 1 });
        body.push(stmt());
      }
      p.next();
      return { k: 'block', body };
    }
    function stmt() {
      const t = p.peek();
      if (p.is('{')) return block();
      if (p.eat(';')) return { k: 'empty' };
      if (p.is('return')) { p.next(); const e = p.is(';') ? null : expr(); if (!p.eat(';')) expected('‘;’'); return { k: 'return', e, tok: t }; }
      if (isType() && (!p.is('std') || ['string', 'size_t'].includes(p.peek(2).v))) {
        const type = parseType();
        const decls = [];
        do {
          const n = p.peek();
          if (n.t !== 'id') expected('unqualified-id');
          p.next();
          let init = null;
          if (p.eat('=')) init = expr();
          else if (p.is('(') || p.is('{')) { const close = p.next().v === '(' ? ')' : '}'; init = p.is(close) ? null : expr(); if (!p.eat(close)) expected(`‘${close}’`); }
          decls.push({ name: n.v, init, tok: n });
        } while (p.eat(','));
        if (!p.eat(';')) expected('‘;’');
        return { k: 'var', type, decls, tok: t };
      }
      if (t.t === 'id' && p.peek(1).t === 'id' && !CPP_TYPES.has(t.v)) E(`‘${t.v}’ was not declared in this scope`, t);
      const e = expr();
      if (!p.eat(';')) expected('‘;’');
      return { k: 'expr', e, tok: t };
    }
    function expr() {
      const lhs = shift();
      if (p.is('=') || p.is('+=')) { const op = p.next(); return { k: 'assign', op: op.v, target: lhs, value: expr(), tok: lhs.tok }; }
      return lhs;
    }
    function shift() {
      let a = cmp();
      while (p.is('<<') || p.is('>>')) { const op = p.next(); a = { k: 'shift', op: op.v, a, b: cmp(), tok: a.tok, opTok: op }; }
      return a;
    }
    function cmp() {
      let a = add();
      while (['==', '!=', '<', '>', '<=', '>='].some(o => p.is(o))) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: add(), tok: a.tok, opTok: op }; }
      return a;
    }
    function add() {
      let a = mul();
      while (p.is('+') || p.is('-')) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: mul(), tok: a.tok, opTok: op }; }
      return a;
    }
    function mul() {
      let a = postfix();
      while (p.is('*') || p.is('/') || p.is('%')) { const op = p.next(); a = { k: 'bin', op: op.v, a, b: postfix(), tok: a.tok, opTok: op }; }
      return a;
    }
    function postfix() {
      let e = primary();
      for (;;) {
        if (p.is('(')) {
          p.next();
          const args = [];
          while (!p.is(')')) { if (p.atEOF()) expected('‘)’'); args.push(expr()); if (!p.is(')') && !p.eat(',')) expected('‘)’'); }
          p.next();
          e = { k: 'call', callee: e, args, tok: e.tok };
          continue;
        }
        if (p.is('.')) { p.next(); const n = p.next(); e = { k: 'member', obj: e, name: n.v, tok: e.tok, ntok: n }; continue; }
        break;
      }
      return e;
    }
    function primary() {
      const t = p.peek();
      if (t.t === 'str') { p.next(); let v = t.v; while (p.peek().t === 'str') v += p.next().v; return { k: 'lit', type: `const char [${v.length + 1}]`, v, tok: t }; }
      if (t.t === 'chr') { p.next(); return { k: 'lit', type: 'char', v: t.v, tok: t }; }
      if (t.t === 'num') { p.next(); return { k: 'lit', type: t.isFloat ? 'double' : 'int', v: t.v, tok: t }; }
      if (t.t === 'id') {
        p.next();
        if (t.v === 'true' || t.v === 'false') return { k: 'lit', type: 'bool', v: t.v === 'true', tok: t };
        if (p.is('::')) { p.next(); const n = p.next(); return { k: 'qname', ns: t.v, v: n.v, tok: t, ntok: n }; }
        return { k: 'name', v: t.v, tok: t };
      }
      if (p.is('::')) { p.next(); const n = p.next(); return { k: 'name', v: n.v, tok: n }; }
      if (p.is('(')) { p.next(); const e = expr(); if (!p.eat(')')) expected('‘)’'); return e; }
      expected('primary-expression', { line: t.line, col: t.col });
    }

    try {
      while (!p.atEOF()) {
        if (p.eat(';')) continue;
        const t = p.peek();
        if (p.is('using')) {
          p.next();
          if (!p.eat('namespace')) expected('‘namespace’');
          const n = p.next();
          if (n.v !== 'std') E(`‘${n.v}’ is not a namespace-name`, n);
          if (!has('iostream') && !has('string') && !all && includes.size === 0) { /* std は空でも宣言可能 */ }
          usingStd = true;
          if (!p.eat(';')) expected('‘;’');
          continue;
        }
        if (!isType()) {
          if (t.t === 'id' && p.is('(', 1)) E(`ISO C++ forbids declaration of ‘${t.v}’ with no type [-fpermissive]`, t);
          if (t.t === 'id') E(`‘${t.v}’ does not name a type`, t);
          E(`expected unqualified-id before ${desc(t)}`, t);
        }
        const ret = parseType();
        const n = p.peek();
        if (n.t !== 'id') expected('unqualified-id');
        p.next();
        if (!p.eat('(')) {
          // グローバル変数
          let init = null;
          if (p.eat('=')) init = expr();
          if (!p.eat(';')) expected('‘;’');
          funcs['$g$' + n.v] = { global: true, name: n.v, type: ret, init, tok: n };
          continue;
        }
        const params = [];
        while (!p.is(')')) {
          if (p.is('void') && p.is(')', 1)) { p.next(); break; }
          const pt = parseType();
          let pn = '';
          if (p.peek().t === 'id') pn = p.next().v;
          while (p.is('[')) { p.next(); p.eat(']'); }
          params.push(pt + (pn ? ' ' + pn : ''));
          if (!p.is(')') && !p.eat(',')) expected('‘)’');
        }
        p.next();
        const f = { name: n.v, ret, params: params.map(x => x.replace(/ \w+$/, '')), paramNames: params.map(x => (/ (\w+)$/.exec(x) || [])[1]), tok: n };
        if (p.eat(';')) { if (!funcs[n.v]) funcs[n.v] = { ...f, body: null }; continue; }
        if (!p.is('{')) expected('‘{’');
        curFn = f;
        f.body = block();
        curFn = null;
        funcs[n.v] = f;
      }
    } catch (e) {
      if (!(e instanceof DiagError)) throw e;
      return { ok: false, err: gccFormat(file, src, [{ kind: 'error', msg: e.message, pos: e.pos, len: e.extra.len, fn: e.extra.fn }]) };
    }

    // 名前解決
    const globals = new Map();
    for (const k of Object.keys(funcs)) if (k.startsWith('$g$')) { globals.set(funcs[k].name, funcs[k].type); }
    const linkRefs = new Set();
    function stdRef(name, tok, qualified, fnSigText) {
      const hdr = CPP_STD_MEMBERS[name];
      if (!qualified && !usingStd) {
        if (hdr) E(`‘${name}’ was not declared in this scope; did you mean ‘std::${name}’?`, tok, { fn: fnSigText, notes: has(hdr) ? [] : [{ pos: { line: 1, col: 1 }, msg: `‘std::${name}’ is defined in header ‘<${hdr}>’; this is probably fixable by adding ‘#include <${hdr}>’`, noSnippet: true }] });
        return false;
      }
      if (!hdr) return false;
      if (!has(hdr)) {
        E(qualified ? `‘${name}’ is not a member of ‘std’` : `‘${name}’ was not declared in this scope`, qualified && tok.ntok ? tok.ntok : tok, {
          fn: fnSigText,
          notes: [{ pos: { line: 1, col: 1 }, msg: `‘std::${name}’ is defined in header ‘<${hdr}>’; this is probably fixable by adding ‘#include <${hdr}>’`, noSnippet: true }],
        });
      }
      return true;
    }
    for (const f of Object.values(funcs)) {
      if (f.global || !f.body) continue;
      const sig = fnSig(f);
      const scopes = [globals, new Map(f.paramNames.filter(Boolean).map((pn, i) => [pn, f.params[i]]))];
      const lookup = n => { for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(n)) return scopes[i].get(n); return null; };
      const check = e => {
        switch (e.k) {
          case 'lit': return e.type;
          case 'name': {
            const t = lookup(e.v);
            if (t) return t;
            if (funcs[e.v]) return 'fn';
            if (CPP_STD_MEMBERS[e.v] || ['printf', 'puts'].includes(e.v)) {
              if (['printf', 'puts'].includes(e.v)) {
                if (!has('cstdio')) E(`‘${e.v}’ was not declared in this scope`, e.tok, { fn: sig, notes: [{ pos: { line: 1, col: 1 }, msg: `‘${e.v}’ is defined in header ‘<cstdio>’; this is probably fixable by adding ‘#include <cstdio>’`, noSnippet: true }] });
                return 'fn';
              }
              stdRef(e.v, e.tok, false, sig);
              return e.v === 'endl' ? 'endl' : e.v === 'string' ? 'type' : 'ostream';
            }
            const s = suggest(e.v, ['cout', 'endl', 'printf', ...Object.keys(funcs), ...scopes.flatMap(m => [...m.keys()])]);
            E(`‘${e.v}’ was not declared in this scope${s ? `; did you mean ‘${s}’?` : ''}`, e.tok, { fn: sig });
          }
          // fallthrough
          case 'qname': {
            if (e.ns !== 'std') E(`‘${e.ns}’ has not been declared`, e.tok, { fn: sig });
            if (!CPP_STD_MEMBERS[e.v]) {
              const s = suggest(e.v, Object.keys(CPP_STD_MEMBERS));
              E(`‘${e.v}’ is not a member of ‘std’${s ? `; did you mean ‘${s}’?` : ''}`, e.ntok, { fn: sig });
            }
            stdRef(e.v, e, true, sig);
            return e.v === 'endl' ? 'endl' : ['printf', 'puts', 'to_string'].includes(e.v) ? 'fn' : 'ostream';
          }
          case 'shift': {
            const a = check(e.a), b = check(e.b);
            if (a === 'ostream' && e.op === '<<') return 'ostream';
            if (a === 'ostream' && e.op === '>>') E(`no match for ‘operator>>’ (operand types are ‘std::ostream’ {aka ‘std::basic_ostream<char>’} and ‘${b}’)`, e.opTok, { fn: sig, len: 2 });
            if (b === 'ostream') E(`invalid operands of types ‘${a}’ and ‘std::ostream’ {aka ‘std::basic_ostream<char>’} to binary ‘operator${e.op}’`, e.opTok, { fn: sig, len: 2 });
            if (a === 'endl' || b === 'endl') E(`invalid operands of types ‘${a}’ and ‘<unresolved overloaded function type>’ to binary ‘operator${e.op}’`, e.opTok, { fn: sig, len: 2 });
            return 'int';
          }
          case 'bin': {
            const a = check(e.a), b = check(e.b);
            if (e.op === '+' && a.startsWith('const char') && b.startsWith('const char')) E(`invalid operands of types ‘${a}’ and ‘${b}’ to binary ‘operator+’`, e.opTok, { fn: sig });
            if (a === 'std::string' || a === 'string' || b === 'std::string' || b === 'string') return 'std::string';
            return a;
          }
          case 'assign': check(e.value); return check(e.target);
          case 'member': check(e.obj); return 'int';
          case 'call': {
            const t = check(e.callee);
            e.args.forEach(check);
            if (e.callee.k === 'name' && funcs[e.callee.v] && !funcs[e.callee.v].body) linkRefs.add(e.callee.v);
            if (t !== 'fn') E(`‘${e.callee.v || 'expression'}’ cannot be used as a function`, e.tok, { fn: sig });
            if (['printf', 'puts'].includes(e.callee.v) && e.args[0] && !String(check(e.args[0])).startsWith('const char') && !['char*', 'const char*'].includes(check(e.args[0]))) {
              warnings.push({ kind: 'warning', msg: 'format not a string literal and no format arguments [-Wformat-security]', pos: e.args[0].tok, len: 1, fn: sig });
            }
            return 'int';
          }
        }
        return 'int';
      };
      const run = s => {
        switch (s.k) {
          case 'block': scopes.push(new Map()); s.body.forEach(run); scopes.pop(); break;
          case 'expr': check(s.e); break;
          case 'return': if (s.e) check(s.e); break;
          case 'var': {
            if (/\bstring\b/.test(s.type)) {
              if (s.type.includes('std::')) { if (!has('string')) stdRef('string', s.tok, true, sig); } else if (!usingStd) E(`‘string’ was not declared in this scope; did you mean ‘std::string’?`, s.tok, { fn: sig });
            }
            for (const d of s.decls) { if (d.init) check(d.init); scopes[scopes.length - 1].set(d.name, s.type.includes('string') ? 'std::string' : s.type === 'auto' && d.init && d.init.k === 'lit' ? 'const char*' : s.type); }
            break;
          }
        }
      };
      try { run(f.body); } catch (e) {
        if (!(e instanceof DiagError)) throw e;
        return { ok: false, err: gccFormat(file, src, [...warnings, { kind: 'error', msg: e.message, pos: e.pos, len: e.extra.len, fn: e.extra.fn, notes: e.extra.notes }]) };
      }
    }
    let out = gccFormat(file, src, warnings);
    const linkErrs = [];
    if (!funcs.main || !funcs.main.body) linkErrs.push('/usr/bin/ld: /usr/lib/gcc/x86_64-linux-gnu/13/../../../x86_64-linux-gnu/Scrt1.o: in function `_start\':\n(.text+0x1b): undefined reference to `main\'');
    for (const n of linkRefs) linkErrs.push(`/usr/bin/ld: /tmp/ccV3pQd1.o: in function \`main':\n${file}:(.text+0x9): undefined reference to \`${n}()'`);
    if (linkErrs.length) return { ok: false, err: out + linkErrs.join('\n') + '\ncollect2: error: ld returned 1 exit status\n' };
    return { ok: true, err: out, program: { funcs, globals } };
  }

  function cppRun(prog) {
    let stdout = '', stderr = '';
    class Ret { constructor(v) { this.v = v; } }
    const OUT = { stream: 'out' }, ERR = { stream: 'err' }, ENDL = { endl: true };
    const str = v => (typeof v === 'boolean' ? (v ? '1' : '0') : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(+v.toPrecision(6))) : String(v));
    function ev(e, sc) {
      switch (e.k) {
        case 'lit': return e.v;
        case 'name': case 'qname': {
          if (e.v === 'cout') return OUT;
          if (e.v === 'cerr') return ERR;
          if (e.v === 'endl') return ENDL;
          for (let i = sc.length - 1; i >= 0; i--) if (sc[i].has(e.v)) return sc[i].get(e.v);
          return e.v;
        }
        case 'shift': {
          const a = ev(e.a, sc), b = ev(e.b, sc);
          if (a === OUT || a === ERR) {
            const s = b === ENDL ? '\n' : str(b);
            if (a === OUT) stdout += s; else stderr += s;
            return a;
          }
          return e.op === '<<' ? a << b : a >> b;
        }
        case 'bin': {
          const a = ev(e.a, sc), b = ev(e.b, sc);
          switch (e.op) {
            case '+': return a + b;
            case '-': return a - b;
            case '*': return a * b;
            case '/': return Number.isInteger(a) && Number.isInteger(b) ? Math.trunc(a / b) : a / b;
            case '%': return a % b;
            case '==': return a === b;
            case '!=': return a !== b;
            case '<': return a < b;
            case '>': return a > b;
            case '<=': return a <= b;
            case '>=': return a >= b;
          }
          return 0;
        }
        case 'assign': {
          const v = ev(e.value, sc);
          for (let i = sc.length - 1; i >= 0; i--) if (sc[i].has(e.target.v)) { sc[i].set(e.target.v, e.op === '+=' ? sc[i].get(e.target.v) + v : v); break; }
          return v;
        }
        case 'member': { const o = ev(e.obj, sc); return e.name === 'size' || e.name === 'length' ? () => String(o).length : o; }
        case 'call': {
          const args = e.args.map(a => ev(a, sc));
          const n = e.callee.v;
          if (e.callee.k === 'member') { const f = ev(e.callee, sc); return typeof f === 'function' ? f() : 0; }
          if (n === 'printf') { const s = cFormat(String(args[0]), args.slice(1).map(a => ({ t: typeof a === 'string' ? 'char*' : 'int', v: a }))); stdout += s; return s.length; }
          if (n === 'puts') { stdout += String(args[0]) + '\n'; return 1; }
          if (n === 'to_string') return str(args[0]);
          const f = prog.funcs[n];
          if (f && f.body) {
            const local = new Map(f.paramNames.map((pn, i) => [pn, args[i]]));
            try { exec(f.body, [prog.globalVals, local]); } catch (r) { if (r instanceof Ret) return r.v; throw r; }
          }
          return 0;
        }
      }
      return 0;
    }
    function exec(s, sc) {
      switch (s.k) {
        case 'block': sc.push(new Map()); try { s.body.forEach(x => exec(x, sc)); } finally { sc.pop(); } break;
        case 'expr': ev(s.e, sc); break;
        case 'var': for (const d of s.decls) sc[sc.length - 1].set(d.name, d.init ? ev(d.init, sc) : (s.type.includes('string') ? '' : 0)); break;
        case 'return': throw new Ret(s.e ? ev(s.e, sc) : 0);
      }
      if (stdout.length > 100000) throw new Ret(0);
    }
    prog.globalVals = new Map();
    for (const f of Object.values(prog.funcs)) if (f.global) prog.globalVals.set(f.name, f.init ? ev(f.init, [prog.globalVals]) : 0);
    let code = 0;
    try { exec(prog.funcs.main.body, [prog.globalVals, new Map()]); } catch (r) { if (r instanceof Ret) code = (r.v | 0) & 0xff; else throw r; }
    return { out: stdout, err: stderr, code };
  }

  // =====================================================================
  // 登録
  // =====================================================================
  Object.assign(HW.langs, {
    cpp: { id: 'cpp', label: 'C++', ext: '.cpp', sample: 'hello.cpp', statusName: 'C++' },
    javascript: { id: 'javascript', label: 'JavaScript', ext: '.js', sample: 'hello.js', statusName: 'JavaScript' },
    ruby: { id: 'ruby', label: 'Ruby', ext: '.rb', sample: 'hello.rb', statusName: 'Ruby' },
    go: { id: 'go', label: 'Go', ext: '.go', sample: 'hello.go', statusName: 'Go' },
    rust: { id: 'rust', label: 'Rust', ext: '.rs', sample: 'hello.rs', statusName: 'Rust' },
    php: { id: 'php', label: 'PHP', ext: '.php', sample: 'hello.php', statusName: 'PHP' },
  });
  Object.assign(HW.highlight, { cpp: hlCpp, js: hlJs, rb: hlRuby, go: hlGo, rs: hlRust, php: hlPhp });
  Object.assign(HW, { jsRun, rbRun, goCompile, goRun, rustCompile, rustRun, phpRun, cppCompile, cppRun });
})(window);
