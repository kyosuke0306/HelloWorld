/*
 * 擬似的な言語処理系。
 * 本物のインタプリタ/コンパイラではなく、Hello World 程度のプログラムを
 * それらしいエラーメッセージ付きで「実行」するための小さな実装。
 */
(function (global) {
  'use strict';

  const HOME = '/home/user/project';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  class DiagError extends Error {
    constructor(msg, pos, extra) {
      super(msg);
      this.pos = pos || { line: 1, col: 1 };
      this.extra = extra || {};
    }
  }

  function levenshtein(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return d[a.length][b.length];
  }
  function suggest(name, candidates) {
    let best = null, bestD = 3;
    for (const c of candidates) {
      const dist = c.toLowerCase() === name.toLowerCase() ? 0 : levenshtein(name, c);
      if (dist < bestD && c !== name) { best = c; bestD = dist; }
    }
    return best;
  }

  // =====================================================================
  // シンタックスハイライト
  // =====================================================================
  function highlighter(rules) {
    return function (code) {
      let out = '', i = 0;
      outer: while (i < code.length) {
        for (const r of rules) {
          r.re.lastIndex = i;
          const m = r.re.exec(code);
          if (m && m[0].length) {
            if (r.render) out += r.render(m[0]);
            else {
              const cls = typeof r.cls === 'function' ? r.cls(m[0], code, i + m[0].length) : r.cls;
              out += cls ? `<span class="${cls}">${esc(m[0])}</span>` : esc(m[0]);
            }
            i += m[0].length;
            continue outer;
          }
        }
        out += esc(code[i]);
        i++;
      }
      return out;
    };
  }
  function strSpan(tok, withFormat) {
    let h = esc(tok).replace(/\\(?:[nrt0abfv\\'"]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/g,
      m => `</span><span class="tk-esc">${m}</span><span class="tk-str">`);
    if (withFormat) {
      h = h.replace(/%[-+ 0#]*\d*(?:\.\d+)?(?:l{0,2}|h{0,2})[diouxXfFeEgGcsp%n]/g,
        m => `</span><span class="tk-var">${m}</span><span class="tk-str">`);
    }
    return `<span class="tk-str">${h}</span>`;
  }
  function identCls(sets) {
    return (w, code, end) => {
      if (sets.ctl.has(w)) return 'tk-ctl';
      if (sets.kw.has(w)) return 'tk-kw';
      if (sets.type && sets.type.has(w)) return 'tk-type';
      if (sets.upperIsType && /^[A-Z]/.test(w)) return 'tk-type';
      let j = end;
      while (code[j] === ' ' || code[j] === '\t') j++;
      if (code[j] === '(') return 'tk-fn';
      return 'tk-var';
    };
  }
  const words = s => new Set(s.split(/\s+/));

  const pyHighlight = highlighter([
    { re: /#.*/y, cls: 'tk-com' },
    { re: /[rRbBuUfF]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)/y, render: t => strSpan(t) },
    { re: /\d+(?:\.\d+)?/y, cls: 'tk-num' },
    {
      re: /[\p{L}_][\p{L}\p{N}_]*/uy, cls: identCls({
        kw: words('def class lambda None True False and or not in is global nonlocal del'),
        ctl: words('if elif else for while return import from as try except finally with pass break continue raise yield async await assert'),
        type: words('str int float bool list dict tuple set object bytes type range'),
      }),
    },
  ]);

  const javaHighlight = highlighter([
    { re: /\/\/.*/y, cls: 'tk-com' },
    { re: /\/\*[\s\S]*?(?:\*\/|$)/y, cls: 'tk-com' },
    { re: /"(?:[^"\\\n]|\\.)*"?/y, render: t => strSpan(t, true) },
    { re: /'(?:[^'\\\n]|\\.)*'?/y, render: t => strSpan(t) },
    { re: /\d+(?:\.\d+)?[fFdDlL]?/y, cls: 'tk-num' },
    { re: /@[A-Za-z_]\w*/y, cls: 'tk-type' },
    {
      re: /[A-Za-z_$][\w$]*/y, cls: identCls({
        kw: words('public private protected static final void class int double boolean char long float byte short new this super null true false abstract interface extends implements import package var enum record'),
        ctl: words('return if else for while do switch case break continue try catch finally throw throws default'),
        upperIsType: true,
      }),
    },
  ]);

  const cHighlight = highlighter([
    { re: /\/\/.*/y, cls: 'tk-com' },
    { re: /\/\*[\s\S]*?(?:\*\/|$)/y, cls: 'tk-com' },
    { re: /#\s*[A-Za-z]*/y, cls: 'tk-pre' },
    { re: /(?<=#\s*include\s*)<[^>\n]*>?/y, cls: 'tk-str' },
    { re: /"(?:[^"\\\n]|\\.)*"?/y, render: t => strSpan(t, true) },
    { re: /'(?:[^'\\\n]|\\.)*'?/y, render: t => strSpan(t) },
    { re: /\d+(?:\.\d+)?[fFlLuU]*/y, cls: 'tk-num' },
    {
      re: /[A-Za-z_]\w*/y, cls: identCls({
        kw: words('int char void double float long short unsigned signed const static struct enum union typedef sizeof extern volatile auto register inline _Bool bool'),
        ctl: words('return if else for while do switch case break continue goto default'),
      }),
    },
  ]);

  // =====================================================================
  // Python
  // =====================================================================
  class PyError extends Error {
    constructor(type, msg, line, col, colEnd, kind) {
      super(msg);
      Object.assign(this, { type, line, col, colEnd, kind: kind || 'syntax' });
    }
  }

  const PY_ESC = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', v: '\v' };
  const PY_OPS2 = ['**', '//', '==', '!=', '<=', '>=', '->', '+=', '-=', '*=', '/='];
  const PY_OPS1 = '()[]{},:.=+-*/%<>;@';
  const PY_KEYWORDS = words('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield');

  function pyTokenize(text, lineNo) {
    const toks = [];
    const brackets = [];
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === ' ' || c === '\t') { i++; continue; }
      if (c === '#') break;
      const col = i + 1;
      const sm = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(text.slice(i));
      if (sm) {
        const prefix = sm[1].toLowerCase(), q = sm[2];
        let j = i + sm[0].length, val = '';
        let closed = false;
        while (j < text.length) {
          if (text.startsWith(q, j)) { closed = true; break; }
          if (text[j] === '\\' && j + 1 < text.length && !prefix.includes('r')) {
            const e = text[j + 1];
            val += e in PY_ESC ? PY_ESC[e] : '\\' + e;
            j += 2;
          } else { val += text[j]; j++; }
        }
        if (!closed) {
          const what = q.length === 3 ? 'unterminated triple-quoted string literal' : 'unterminated string literal';
          throw new PyError('SyntaxError', `${what} (detected at line ${lineNo})`, lineNo, col, col + 1);
        }
        j += q.length;
        toks.push({ t: 'str', v: val, f: prefix.includes('f'), col, end: j + 1 });
        i = j;
        continue;
      }
      let m;
      if ((m = /^\d+(?:\.\d*)?/.exec(text.slice(i)))) {
        toks.push({ t: 'num', v: parseFloat(m[0]), isFloat: m[0].includes('.'), col, end: col + m[0].length });
        i += m[0].length;
        continue;
      }
      if ((m = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(text.slice(i)))) {
        toks.push({ t: 'name', v: m[0], col, end: col + m[0].length });
        i += m[0].length;
        continue;
      }
      const op = PY_OPS2.find(o => text.startsWith(o, i)) || (PY_OPS1.includes(c) ? c : null);
      if (op) {
        if ('([{'.includes(op)) brackets.push({ ch: op, col });
        if (')]}'.includes(op)) {
          const open = brackets.pop();
          if (!open) throw new PyError('SyntaxError', `unmatched '${op}'`, lineNo, col, col + 1);
          const pair = { '(': ')', '[': ']', '{': '}' }[open.ch];
          if (pair !== op) throw new PyError('SyntaxError', `closing parenthesis '${op}' does not match opening parenthesis '${open.ch}'`, lineNo, col, col + 1);
        }
        toks.push({ t: 'op', v: op, col, end: col + op.length });
        i += op.length;
        continue;
      }
      const cp = text.codePointAt(i);
      const hex = cp.toString(16).toUpperCase().padStart(4, '0');
      if (/\s/.test(c) || cp < 32) {
        throw new PyError('SyntaxError', `invalid non-printable character U+${hex}`, lineNo, col, col + 1);
      }
      throw new PyError('SyntaxError', `invalid character '${String.fromCodePoint(cp)}' (U+${hex})`, lineNo, col, col + 1);
    }
    if (brackets.length) {
      const b = brackets[brackets.length - 1];
      throw new PyError('SyntaxError', `'${b.ch}' was never closed`, lineNo, b.col, b.col + 1);
    }
    return toks;
  }

  function pyParseStmt(toks, line) {
    let i = 0;
    const peek = (o = 0) => toks[i + o] || { t: 'eol', v: '', col: (toks[toks.length - 1] || { end: 1 }).end, end: 0 };
    const is = (v, o = 0) => { const t = peek(o); return (t.t === 'op' || t.t === 'name') && t.v === v; };
    const next = () => toks[i++] || peek();
    const fail = (msg, t, type) => { t = t || peek(); throw new PyError(type || 'SyntaxError', msg || 'invalid syntax', line, t.col, t.end || t.col + 1); };
    const expect = (v, msg) => { if (is(v)) return next(); fail(msg || (v === ':' ? "expected ':'" : 'invalid syntax')); };

    function parseExpr() { return parseCompare(); }
    function parseCompare() {
      let a = parseAdd();
      while (['==', '!=', '<', '>', '<=', '>='].some(o => is(o))) {
        const op = next();
        a = { k: 'bin', op: op.v, a, b: parseAdd(), tok: op };
      }
      return a;
    }
    function parseAdd() {
      let a = parseMul();
      while (is('+') || is('-')) {
        const op = next();
        a = { k: 'bin', op: op.v, a, b: parseMul(), tok: op };
      }
      return a;
    }
    function parseMul() {
      let a = parseUnary();
      while (is('*') || is('/') || is('//') || is('%')) {
        const op = next();
        a = { k: 'bin', op: op.v, a, b: parseUnary(), tok: op };
      }
      return a;
    }
    function parseUnary() {
      if (is('-')) { const t = next(); return { k: 'neg', a: parseUnary(), tok: t }; }
      return parsePostfix();
    }
    function parsePostfix() {
      let e = parseAtom();
      for (;;) {
        if (is('(')) {
          const lp = next();
          const args = [], kwargs = {};
          while (!is(')')) {
            if (peek().t === 'name' && is('=', 1)) {
              const n = next(); next();
              kwargs[n.v] = parseExpr();
            } else {
              if (Object.keys(kwargs).length) fail('positional argument follows keyword argument');
              args.push(parseExpr());
            }
            if (!is(')')) {
              if (!is(',')) {
                const t = peek();
                if (t.t === 'str' || t.t === 'name' || t.t === 'num') fail('invalid syntax. Perhaps you forgot a comma?', t);
                fail();
              }
              next();
            }
          }
          next();
          e = { k: 'call', fn: e, args, kwargs, tok: e.tok, lp };
        } else if (is('.')) {
          next();
          const n = peek();
          if (n.t !== 'name') fail();
          next();
          e = { k: 'attr', obj: e, name: n.v, tok: e.tok, ntok: n };
        } else break;
      }
      return e;
    }
    function parseAtom() {
      const t = peek();
      if (t.t === 'str') {
        let v = next(), parts = [v];
        while (peek().t === 'str') parts.push(next());
        return { k: 'str', parts, tok: t };
      }
      if (t.t === 'num') { next(); return { k: 'num', v: t.v, isFloat: t.isFloat, tok: t }; }
      if (t.t === 'name') {
        if (t.v === 'True' || t.v === 'False') { next(); return { k: 'const', v: t.v === 'True', tok: t }; }
        if (t.v === 'None') { next(); return { k: 'const', v: null, tok: t }; }
        if (PY_KEYWORDS.has(t.v)) fail();
        next();
        return { k: 'name', v: t.v, tok: t };
      }
      if (is('(')) {
        next();
        const e = parseExpr();
        expect(')');
        return e;
      }
      fail();
    }
    function ensureEnd() {
      if (peek().t !== 'eol') {
        const t = peek();
        if (t.t === 'str' || t.t === 'name' || t.t === 'num') fail('invalid syntax', t);
        fail();
      }
    }

    const t0 = peek();
    if (t0.t === 'name') {
      switch (t0.v) {
        case 'def': {
          next();
          const n = peek();
          if (n.t !== 'name' || PY_KEYWORDS.has(n.v)) fail();
          next();
          expect('(', "expected '('");
          const params = [];
          while (!is(')')) {
            const p = peek();
            if (p.t !== 'name') fail();
            params.push(next().v);
            if (!is(')')) expect(',');
          }
          next();
          expect(':');
          ensureEnd();
          return { k: 'def', name: n.v, params, line, block: 'function definition' };
        }
        case 'if': case 'elif': {
          next();
          const cond = parseExpr();
          expect(':');
          ensureEnd();
          return { k: t0.v, cond, line, block: `'${t0.v}' statement` };
        }
        case 'else':
          next();
          expect(':');
          ensureEnd();
          return { k: 'else', line, block: "'else' statement" };
        case 'pass':
          next(); ensureEnd();
          return { k: 'pass', line };
        case 'return': {
          next();
          const e = peek().t === 'eol' ? null : parseExpr();
          ensureEnd();
          return { k: 'return', e, line };
        }
        case 'import': case 'from':
          return { k: 'import', line, tok: t0, toks };
        case 'print': {
          const t1 = peek(1);
          if (t1.t === 'str' || t1.t === 'num' || (t1.t === 'name' && !PY_KEYWORDS.has(t1.v))) {
            const last = toks[toks.length - 1];
            throw new PyError('SyntaxError', "Missing parentheses in call to 'print'. Did you mean print(...)?", line, t0.col, last.end);
          }
          break;
        }
        default:
          if (PY_KEYWORDS.has(t0.v) && !['True', 'False', 'None', 'not'].includes(t0.v)) fail();
      }
      if (is('=', 1)) {
        next(); next();
        const e = parseExpr();
        ensureEnd();
        return { k: 'assign', name: t0.v, e, line };
      }
    }
    const e = parseExpr();
    ensureEnd();
    return { k: 'expr', e, line };
  }

  function pyParse(src) {
    const rawLines = src.split('\n');
    const lines = [];
    rawLines.forEach((raw, idx) => {
      const lineNo = idx + 1;
      const toks = pyTokenize(raw, lineNo);
      if (!toks.length) return;
      const ws = /^[ \t]*/.exec(raw)[0];
      const indent = ws.replace(/\t/g, '        ').length;
      lines.push({ raw, lineNo, toks, indent });
    });

    let i = 0;
    function suite(indent) {
      const stmts = [];
      while (i < lines.length) {
        const ln = lines[i];
        if (ln.indent < indent) break;
        if (ln.indent > indent) {
          throw new PyError('IndentationError', 'unexpected indent', ln.lineNo, 1, 1, 'indent');
        }
        const st = pyParseStmt(ln.toks, ln.lineNo);
        i++;
        if (st.block) {
          const nx = lines[i];
          if (!nx || nx.indent <= indent) {
            const at = nx ? nx.lineNo : ln.lineNo + 1;
            throw new PyError('IndentationError', `expected an indented block after ${st.block} on line ${ln.lineNo}`, at, 1, 1, 'indent');
          }
          st.body = suite(nx.indent);
          const after = lines[i];
          if (after && after.indent > indent && after.indent < nx.indent) {
            throw new PyError('IndentationError', 'unindent does not match any outer indentation level', after.lineNo, 1, 1, 'indent');
          }
        }
        if (st.k === 'elif' || st.k === 'else') {
          const prev = stmts[stmts.length - 1];
          let tail = prev && (prev.k === 'if') ? prev : null;
          while (tail && tail.orelse) tail = tail.orelse.k === 'elif' ? tail.orelse : null;
          if (!tail) throw new PyError('SyntaxError', 'invalid syntax', ln.lineNo, ln.toks[0].col, ln.toks[0].end);
          tail.orelse = st;
          continue;
        }
        stmts.push(st);
      }
      return stmts;
    }
    return suite(0);
  }

  function pyTypeName(v) {
    if (v === null) return 'NoneType';
    if (typeof v === 'string') return 'str';
    if (typeof v === 'boolean') return 'bool';
    if (v instanceof PyFloat) return 'float';
    if (typeof v === 'number') return 'int';
    if (v && v.pyfunc) return 'function';
    if (v && v.builtin) return 'builtin_function_or_method';
    return 'object';
  }
  class PyFloat { constructor(v) { this.v = v; } }
  const num = v => (v instanceof PyFloat ? v.v : v);
  function pyStr(v) {
    if (v === null) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    if (v instanceof PyFloat) {
      if (!isFinite(v.v)) return v.v > 0 ? 'inf' : v.v < 0 ? '-inf' : 'nan';
      return Number.isInteger(v.v) ? v.v.toFixed(1) : String(v.v);
    }
    if (v && v.pyfunc) return `<function ${v.def.name} at 0x7f3a2c1b8e00>`;
    if (v && v.builtin) return `<built-in function ${v.name}>`;
    return String(v);
  }
  function pyRepr(v) {
    if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'";
    return pyStr(v);
  }

  function pyRun(src, file) {
    const path = `${HOME}/${file}`;
    const srcLines = src.split('\n');
    let stdout = '';
    const fmtSyntax = e => {
      const raw = srcLines[e.line - 1] || '';
      const lead = raw.length - raw.trimStart().length;
      let s = `  File "${path}", line ${e.line}\n`;
      if (raw.trim()) {
        s += `    ${raw.trim()}\n`;
        if (e.kind !== 'indent') {
          const from = Math.max(0, e.col - 1 - lead);
          const len = Math.max(1, (e.colEnd || e.col + 1) - e.col);
          s += '    ' + ' '.repeat(from) + '^'.repeat(len) + '\n';
        }
      }
      return s + `${e.type}: ${e.message}\n`;
    };

    let program;
    try {
      program = pyParse(src);
    } catch (e) {
      if (e instanceof PyError) return { out: '', err: fmtSyntax(e), code: 1 };
      throw e;
    }

    const frames = [];
    const globals = new Map([['__name__', '__main__']]);
    const builtins = {
      print: { builtin: true, name: 'print' },
      str: { builtin: true, name: 'str' },
      len: { builtin: true, name: 'len' },
      input: { builtin: true, name: 'input' },
    };
    class Return { constructor(v) { this.v = v; } }
    const runtimeErr = (type, msg, line) => { const e = new PyError(type, msg, line, 1, 1, 'runtime'); throw e; };

    function lookup(name, scope, line) {
      if (scope && scope.has(name)) return scope.get(name);
      if (globals.has(name)) return globals.get(name);
      if (name in builtins) return builtins[name];
      const cand = [...Object.keys(builtins), ...globals.keys(), ...(scope ? scope.keys() : [])];
      const s = suggest(name, cand);
      runtimeErr('NameError', `name '${name}' is not defined${s ? `. Did you mean: '${s}'?` : ''}`, line);
    }

    function evalExpr(e, scope, line) {
      switch (e.k) {
        case 'str': {
          let s = '';
          for (const p of e.parts) {
            s += p.f ? p.v.replace(/\{([^{}]*)\}/g, (m, name) => {
              name = name.trim();
              if (!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(name)) return m;
              return pyStr(lookup(name, scope, line));
            }) : p.v;
          }
          return s;
        }
        case 'num': return e.isFloat ? new PyFloat(e.v) : e.v;
        case 'const': return e.v;
        case 'name': return lookup(e.v, scope, line);
        case 'neg': {
          const v = evalExpr(e.a, scope, line);
          if (typeof v === 'number') return -v;
          if (v instanceof PyFloat) return new PyFloat(-v.v);
          runtimeErr('TypeError', `bad operand type for unary -: '${pyTypeName(v)}'`, line);
        }
        // fallthrough
        case 'bin': {
          const a = evalExpr(e.a, scope, line), b = evalExpr(e.b, scope, line);
          const isNum = v => typeof v === 'number' || v instanceof PyFloat || typeof v === 'boolean';
          const anyFloat = a instanceof PyFloat || b instanceof PyFloat;
          const wrap = r => (anyFloat ? new PyFloat(r) : r);
          switch (e.op) {
            case '+':
              if (typeof a === 'string' && typeof b === 'string') return a + b;
              if (isNum(a) && isNum(b)) return wrap(num(a) + num(b));
              if (typeof a === 'string') runtimeErr('TypeError', `can only concatenate str (not "${pyTypeName(b)}") to str`, line);
              runtimeErr('TypeError', `unsupported operand type(s) for +: '${pyTypeName(a)}' and '${pyTypeName(b)}'`, line);
            // fallthrough
            case '*':
              if (typeof a === 'string' && typeof b === 'number') return a.repeat(Math.max(0, b));
              if (typeof b === 'string' && typeof a === 'number') return b.repeat(Math.max(0, a));
              if (isNum(a) && isNum(b)) return wrap(num(a) * num(b));
              runtimeErr('TypeError', `can't multiply sequence by non-int of type '${pyTypeName(typeof a === 'string' ? b : a)}'`, line);
            // fallthrough
            case '-': case '/': case '//': case '%':
              if (isNum(a) && isNum(b)) {
                if ((e.op !== '-') && num(b) === 0) runtimeErr('ZeroDivisionError', e.op === '%' ? 'integer modulo by zero' : 'division by zero', line);
                if (e.op === '-') return wrap(num(a) - num(b));
                if (e.op === '/') return new PyFloat(num(a) / num(b));
                if (e.op === '//') return wrap(Math.floor(num(a) / num(b)));
                return wrap(((num(a) % num(b)) + num(b)) % num(b));
              }
              if (e.op === '%' && typeof a === 'string') return a.replace('%s', pyStr(b));
              runtimeErr('TypeError', `unsupported operand type(s) for ${e.op}: '${pyTypeName(a)}' and '${pyTypeName(b)}'`, line);
            // fallthrough
            case '==': return pyEq(a, b);
            case '!=': return !pyEq(a, b);
            default: {
              if (!(isNum(a) && isNum(b)) && !(typeof a === 'string' && typeof b === 'string')) {
                runtimeErr('TypeError', `'${e.op}' not supported between instances of '${pyTypeName(a)}' and '${pyTypeName(b)}'`, line);
              }
              const x = typeof a === 'string' ? a : num(a), y = typeof b === 'string' ? b : num(b);
              return { '<': x < y, '>': x > y, '<=': x <= y, '>=': x >= y }[e.op];
            }
          }
        }
        case 'attr': {
          const o = evalExpr(e.obj, scope, line);
          if (typeof o === 'string') {
            const methods = { upper: s => s.toUpperCase(), lower: s => s.toLowerCase(), strip: s => s.trim(), title: s => s.replace(/\b\w/g, c => c.toUpperCase()) };
            if (e.name in methods) return { builtin: true, name: e.name, bound: () => methods[e.name](o) };
          }
          runtimeErr('AttributeError', `'${pyTypeName(o)}' object has no attribute '${e.name}'`, line);
        }
        // fallthrough
        case 'call': {
          const fn = evalExpr(e.fn, scope, line);
          const args = e.args.map(a => evalExpr(a, scope, line));
          const kw = {};
          for (const k in e.kwargs) kw[k] = evalExpr(e.kwargs[k], scope, line);
          if (fn && fn.builtin) {
            if (fn.bound) return fn.bound();
            if (fn.name === 'print') {
              for (const k in kw) if (!['sep', 'end', 'flush', 'file'].includes(k)) runtimeErr('TypeError', `'${k}' is an invalid keyword argument for print()`, line);
              const sep = 'sep' in kw && kw.sep !== null ? pyStr(kw.sep) : ' ';
              const end = 'end' in kw && kw.end !== null ? pyStr(kw.end) : '\n';
              stdout += args.map(pyStr).join(sep) + end;
              if (stdout.length > 100000) runtimeErr('MemoryError', '', line);
              return null;
            }
            if (fn.name === 'str') return args.length ? pyStr(args[0]) : '';
            if (fn.name === 'len') {
              if (typeof args[0] === 'string') return [...args[0]].length;
              runtimeErr('TypeError', `object of type '${pyTypeName(args[0])}' has no len()`, line);
            }
            if (fn.name === 'input') {
              if (args.length) stdout += pyStr(args[0]);
              runtimeErr('EOFError', 'EOF when reading a line', line);
            }
          }
          if (fn && fn.pyfunc) {
            const d = fn.def;
            if (args.length !== d.params.length) {
              const need = d.params.length;
              if (args.length < need) {
                const missing = d.params.slice(args.length).map(p => `'${p}'`);
                runtimeErr('TypeError', `${d.name}() missing ${missing.length} required positional argument${missing.length > 1 ? 's' : ''}: ${missing.join(' and ')}`, line);
              }
              runtimeErr('TypeError', `${d.name}() takes ${need} positional argument${need === 1 ? '' : 's'} but ${args.length} ${args.length === 1 ? 'was' : 'were'} given`, line);
            }
            if (frames.length > 900) runtimeErr('RecursionError', 'maximum recursion depth exceeded', line);
            const local = new Map();
            d.params.forEach((p, idx) => local.set(p, args[idx]));
            frames.push({ name: d.name, line: d.line });
            try {
              execBlock(d.body, local);
            } catch (r) {
              if (r instanceof Return) { frames.pop(); return r.v; }
              throw r;
            }
            frames.pop();
            return null;
          }
          runtimeErr('TypeError', `'${pyTypeName(fn)}' object is not callable`, line);
        }
      }
      return null;
    }
    function pyEq(a, b) {
      const x = a instanceof PyFloat ? a.v : a, y = b instanceof PyFloat ? b.v : b;
      return x === y;
    }
    function truthy(v) {
      if (v instanceof PyFloat) return v.v !== 0;
      return !(v === null || v === false || v === 0 || v === '');
    }

    function execBlock(stmts, scope) {
      for (const st of stmts) {
        frames[frames.length - 1].line = st.line;
        switch (st.k) {
          case 'expr': evalExpr(st.e, scope, st.line); break;
          case 'assign': (scope || globals).set(st.name, evalExpr(st.e, scope, st.line)); break;
          case 'def': (scope || globals).set(st.name, { pyfunc: true, def: st }); break;
          case 'if': {
            let cur = st;
            while (cur) {
              if (cur.k === 'else' || truthy(evalExpr(cur.cond, scope, cur.line))) { execBlock(cur.body, scope); break; }
              cur = cur.orelse;
            }
            break;
          }
          case 'return': throw new Return(st.e ? evalExpr(st.e, scope, st.line) : null);
          case 'import': {
            const nameTok = st.toks[1];
            const mod = nameTok ? nameTok.v : '';
            if (!['sys', 'os', 'math', 'random', 'time', 'datetime', 're', 'json'].includes(mod)) {
              runtimeErr('ModuleNotFoundError', `No module named '${mod}'`, st.line);
            }
            if (st.toks[0].v === 'import') globals.set(mod, { module: mod });
            break;
          }
          case 'pass': break;
        }
      }
    }

    frames.push({ name: '<module>', line: 1 });
    try {
      execBlock(program, null);
    } catch (e) {
      if (e instanceof PyError) {
        let s = 'Traceback (most recent call last):\n';
        for (const f of frames) {
          s += `  File "${path}", line ${f.line}, in ${f.name}\n`;
          const raw = srcLines[f.line - 1];
          if (raw && raw.trim()) s += `    ${raw.trim()}\n`;
        }
        s += `${e.type}${e.message ? ': ' + e.message : ''}\n`;
        return { out: stdout, err: s, code: 1 };
      }
      if (e instanceof Return) return { out: stdout, err: '', code: 0 };
      throw e;
    }
    return { out: stdout, err: '', code: 0 };
  }

  // =====================================================================
  // C 系 (Java / C) の字句解析
  // =====================================================================
  const MULTI_OPS = ['>>=', '<<=', '...', '->', '++', '--', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '<<', '>>', '::'];
  const C_ESC = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'", a: '\x07', b: '\b', f: '\f', v: '\v', '?': '?' };

  function clex(src, lang) {
    const toks = [];
    const singles = lang === 'java' ? '{}()[];,.=+-*/%<>!&|^~?:@' : '{}()[];,.=+-*/%<>!&|^~?:';
    let i = 0, line = 1, col = 1;
    const pos = () => ({ line, col });
    const adv = n => { while (n-- > 0) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };
    const err = (msg, p, extra) => { throw new DiagError(msg, p, extra); };
    while (i < src.length) {
      const c = src[i];
      if (c === '\n' || c === ' ' || c === '\t' || c === '\r' || c === '\f') { adv(1); continue; }
      if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') adv(1); continue; }
      if (src.startsWith('/*', i)) {
        const p = pos();
        const e = src.indexOf('*/', i + 2);
        if (e < 0) err(lang === 'java' ? 'unclosed comment' : 'unterminated comment', p, { len: 2 });
        adv(e + 2 - i);
        continue;
      }
      const start = pos();
      if (c === '"' || c === "'") {
        let j = i + 1, val = '';
        while (j < src.length && src[j] !== c && src[j] !== '\n') {
          if (src[j] === '\\' && j + 1 < src.length && src[j + 1] !== '\n') {
            const e = src[j + 1];
            if (e in C_ESC) val += C_ESC[e];
            else if (lang === 'java') err('illegal escape character', { line, col: col + (j - i) + 1 });
            else val += e;
            j += 2;
          } else { val += src[j]; j++; }
        }
        if (src[j] !== c) {
          if (c === '"') err(lang === 'java' ? 'unclosed string literal' : 'missing terminating " character', start, { len: j - i });
          else err(lang === 'java' ? 'unclosed character literal' : "missing terminating ' character", start, { len: j - i });
        }
        if (c === "'") {
          if (lang === 'java') {
            if (val.length === 0) err('empty character literal', start);
            if ([...val].length > 1) err('unclosed character literal', start);
          } else if (val.length === 0) err('empty character constant', start, { len: 2 });
        }
        const raw = src.slice(i, j + 1);
        adv(j + 1 - i);
        toks.push({ t: c === '"' ? 'str' : 'chr', v: val, raw, multi: c === "'" && val.length > 1, ...start, end: pos() });
        continue;
      }
      let m;
      if ((m = /^\d+(?:\.\d+)?[fFdDlLuU]*/.exec(src.slice(i, i + 64)))) {
        adv(m[0].length);
        toks.push({ t: 'num', v: parseFloat(m[0]), isFloat: /[.fFdD]/.test(m[0]) && !/^\d+[lLuU]*$/.test(m[0]), raw: m[0], ...start, end: pos() });
        continue;
      }
      if ((m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i, i + 256)))) {
        adv(m[0].length);
        toks.push({ t: 'id', v: m[0], raw: m[0], ...start, end: pos() });
        continue;
      }
      const op = MULTI_OPS.find(o => src.startsWith(o, i)) || (singles.includes(c) ? c : null);
      if (op) {
        adv(op.length);
        toks.push({ t: 'op', v: op, raw: op, ...start, end: pos() });
        continue;
      }
      const cp = src.codePointAt(i);
      if (lang === 'java') {
        const unit = src.charCodeAt(i);
        const shown = cp >= 0x21 && cp < 0x7f ? c : '\\u' + unit.toString(16).padStart(4, '0');
        err(`illegal character: '${shown}'`, start);
      }
      if (cp >= 0x21 && cp < 0x7f) err(`stray '${c}' in program`, start);
      const b = new TextEncoder().encode(String.fromCodePoint(cp))[0];
      err(`stray '\\${b.toString(8)}' in program`, start);
    }
    toks.push({ t: 'eof', v: '', raw: '', line, col, end: pos() });
    return toks;
  }

  class TP {
    constructor(toks) { this.t = toks; this.i = 0; }
    peek(o = 0) { return this.t[Math.min(this.i + o, this.t.length - 1)]; }
    next() { const t = this.t[this.i]; if (this.i < this.t.length - 1) this.i++; return t; }
    get prev() { return this.t[Math.max(this.i - 1, 0)]; }
    is(v, o = 0) { const t = this.peek(o); return (t.t === 'op' || t.t === 'id') && t.v === v; }
    eat(v) { return this.is(v) ? this.next() : null; }
    atEOF() { return this.peek().t === 'eof'; }
    afterPrev() { const p = this.prev; return p.end ? { line: p.end.line, col: p.end.col } : { line: 1, col: 1 }; }
  }

  function caretLine(srcLine, col, len) {
    const prefix = (srcLine || '').slice(0, col - 1).replace(/[^\t]/g, ' ');
    return prefix + '^' + '~'.repeat(Math.max(0, (len || 1) - 1));
  }

  // =====================================================================
  // Java
  // =====================================================================
  const JAVA_MODS = words('public private protected static final abstract synchronized native strictfp transient volatile default');
  const JAVA_PRIMS = words('int double boolean char long float short byte void var');
  const JAVA_RESERVED = words('abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while true false null');
  const JAVA_KNOWN_TYPES = words('String Object Integer Double Boolean Character Long System Math StringBuilder');

  function javaParse(src) {
    const toks = clex(src, 'java');
    const p = new TP(toks);
    const E = (msg, pos, extra) => { throw new DiagError(msg, pos, extra); };
    const eofErr = () => E('reached end of file while parsing', { line: p.prev.line, col: p.prev.col });
    const expect = v => {
      if (p.is(v)) return p.next();
      if (p.atEOF()) eofErr();
      E(`'${v}' expected`, p.afterPrev());
    };
    const isName = t => t.t === 'id' && !JAVA_RESERVED.has(t.v);

    function parseMods() {
      const mods = new Set();
      for (;;) {
        const t = p.peek();
        if (t.t === 'id' && JAVA_MODS.has(t.v)) { mods.add(t.v); p.next(); continue; }
        if (p.is('@') && p.peek(1).t === 'id') { p.next(); p.next(); continue; }
        break;
      }
      return mods;
    }
    function parseType() {
      const t = p.peek();
      if (t.t !== 'id' || (JAVA_RESERVED.has(t.v) && !JAVA_PRIMS.has(t.v))) return null;
      p.next();
      let name = t.v;
      while (p.is('.') && p.peek(1).t === 'id') { p.next(); name += '.' + p.next().v; }
      let dims = 0;
      while (p.is('[') && p.is(']', 1)) { p.next(); p.next(); dims++; }
      let varargs = false;
      if (p.is('...')) { p.next(); dims++; varargs = true; }
      return { name, dims, varargs, tok: t };
    }
    function parseBlock() {
      if (!p.is('{')) {
        if (p.atEOF()) eofErr();
        E("'{' expected", p.afterPrev());
      }
      const open = p.next();
      const body = [];
      while (!p.is('}')) {
        if (p.atEOF()) eofErr();
        body.push(parseStmt());
      }
      p.next();
      return { k: 'block', body, tok: open };
    }
    function looksLikeDecl() {
      const a = p.peek(), b = p.peek(1);
      if (a.t !== 'id' || (JAVA_RESERVED.has(a.v) && !JAVA_PRIMS.has(a.v))) return false;
      if (JAVA_PRIMS.has(a.v)) return true;
      if (isName(b)) return true;
      if (b.v === '[' && p.peek(2).v === ']') return true;
      return false;
    }
    function parseStmt() {
      const t = p.peek();
      if (p.is('{')) return parseBlock();
      if (p.eat(';')) return { k: 'empty', tok: t };
      if (p.is('return')) {
        p.next();
        const e = p.is(';') ? null : parseExpr();
        expect(';');
        return { k: 'return', e, tok: t };
      }
      if (p.is('if')) {
        p.next();
        expect('(');
        const c = parseExpr();
        expect(')');
        const th = parseStmt();
        const el = p.eat('else') ? parseStmt() : null;
        return { k: 'if', c, th, el, tok: t };
      }
      if (looksLikeDecl()) {
        const type = parseType();
        const decls = [];
        do {
          const n = p.peek();
          if (!isName(n)) E('<identifier> expected', p.afterPrev());
          p.next();
          const init = p.eat('=') ? parseExpr() : null;
          decls.push({ name: n.v, tok: n, init });
        } while (p.eat(','));
        expect(';');
        return { k: 'var', type, decls, tok: t };
      }
      if (t.t === 'id' && JAVA_RESERVED.has(t.v) && !['true', 'false', 'null', 'this', 'new', 'super'].includes(t.v)) {
        E('illegal start of expression', t);
      }
      const e = parseExpr();
      if (!['call', 'assign'].includes(e.k)) E('not a statement', e.tok);
      expect(';');
      return { k: 'expr', e, tok: t };
    }
    function parseExpr() {
      const lhs = parseCmp();
      if (p.is('=') || p.is('+=') || p.is('-=')) {
        const op = p.next();
        const rhs = parseExpr();
        return { k: 'assign', op: op.v, target: lhs, value: rhs, tok: lhs.tok, opTok: op };
      }
      return lhs;
    }
    function parseCmp() {
      let a = parseAdd();
      while (['==', '!=', '<', '>', '<=', '>='].some(o => p.is(o))) {
        const op = p.next();
        a = { k: 'bin', op: op.v, a, b: parseAdd(), tok: a.tok, opTok: op };
      }
      return a;
    }
    function parseAdd() {
      let a = parseMul();
      while (p.is('+') || p.is('-')) {
        const op = p.next();
        a = { k: 'bin', op: op.v, a, b: parseMul(), tok: a.tok, opTok: op };
      }
      return a;
    }
    function parseMul() {
      let a = parseUnary();
      while (p.is('*') || p.is('/') || p.is('%')) {
        const op = p.next();
        a = { k: 'bin', op: op.v, a, b: parseUnary(), tok: a.tok, opTok: op };
      }
      return a;
    }
    function parseUnary() {
      if (p.is('-') || p.is('!')) {
        const t = p.next();
        return { k: 'unary', op: t.v, a: parseUnary(), tok: t };
      }
      return parsePostfix();
    }
    function parsePostfix() {
      let e = parsePrimary();
      for (;;) {
        if (p.is('.')) {
          const dot = p.next();
          const n = p.peek();
          if (!isName(n)) E('<identifier> expected', p.afterPrev());
          p.next();
          e = { k: 'field', obj: e, name: n.v, tok: e.tok, dot, ntok: n };
          continue;
        }
        if (p.is('(')) {
          const lp = p.next();
          const args = [];
          if (!p.is(')')) {
            do { args.push(parseExpr()); } while (p.eat(','));
          }
          if (!p.is(')')) {
            if (p.atEOF()) eofErr();
            E("')' expected", p.afterPrev());
          }
          p.next();
          e = { k: 'call', callee: e, args, tok: e.tok, lp };
          continue;
        }
        break;
      }
      return e;
    }
    function parsePrimary() {
      const t = p.peek();
      if (t.t === 'str') { p.next(); return { k: 'lit', type: 'String', v: t.v, tok: t }; }
      if (t.t === 'chr') { p.next(); return { k: 'lit', type: 'char', v: t.v, tok: t }; }
      if (t.t === 'num') { p.next(); return { k: 'lit', type: t.isFloat ? 'double' : 'int', v: t.v, tok: t }; }
      if (t.t === 'id') {
        if (t.v === 'true' || t.v === 'false') { p.next(); return { k: 'lit', type: 'boolean', v: t.v === 'true', tok: t }; }
        if (t.v === 'null') { p.next(); return { k: 'lit', type: 'null', v: null, tok: t }; }
        if (isName(t)) { p.next(); return { k: 'name', v: t.v, tok: t }; }
      }
      if (p.is('(')) {
        p.next();
        const e = parseExpr();
        expect(')');
        return e;
      }
      if (p.atEOF()) eofErr();
      E('illegal start of expression', t);
    }

    // --- compilation unit ---
    while (p.is('import') || p.is('package')) {
      p.next();
      while (!p.is(';') && !p.atEOF()) p.next();
      expect(';');
    }
    const classes = [];
    while (!p.atEOF()) {
      if (p.eat(';')) continue;
      const mods = parseMods();
      if (!p.is('class')) E('class, interface, enum, or record expected', p.peek());
      p.next();
      const nameTok = p.peek();
      if (!isName(nameTok)) E('<identifier> expected', p.afterPrev());
      p.next();
      if (!p.is('{')) {
        if (p.atEOF()) eofErr();
        E("'{' expected", p.afterPrev());
      }
      p.next();
      const cls = { name: nameTok.v, nameTok, mods, methods: {}, fields: {}, fieldOrder: [] };
      while (!p.is('}')) {
        if (p.atEOF()) eofErr();
        if (p.eat(';')) continue;
        const mmods = parseMods();
        const first = p.peek();
        if (first.t === 'id' && p.is('(', 1) && !JAVA_RESERVED.has(first.v)) {
          E('invalid method declaration; return type required', first);
        }
        const type = parseType();
        if (!type) E('<identifier> expected', first.t === 'eof' ? p.afterPrev() : first);
        const n = p.peek();
        if (!isName(n)) E('<identifier> expected', p.afterPrev());
        p.next();
        if (p.is('(')) {
          p.next();
          const params = [];
          if (!p.is(')')) {
            do {
              parseMods();
              const pt = parseType();
              if (!pt) E('<identifier> expected', p.peek());
              const pn = p.peek();
              if (!isName(pn)) E('<identifier> expected', p.afterPrev());
              p.next();
              while (p.is('[') && p.is(']', 1)) { p.next(); p.next(); pt.dims++; }
              params.push({ type: pt, name: pn.v, tok: pn });
            } while (p.eat(','));
          }
          expect(')');
          if (p.is('throws')) { p.next(); do { parseType(); } while (p.eat(',')); }
          const body = parseBlock();
          if (cls.methods[n.v]) E(`method ${n.v}(${params.map(x => typeStr(x.type)).join(',')}) is already defined in class ${cls.name}`, n);
          cls.methods[n.v] = { name: n.v, mods: mmods, ret: type, params, body, tok: n };
        } else {
          const decls = [{ n, init: p.eat('=') ? parseExpr() : null }];
          while (p.eat(',')) {
            const n2 = p.peek();
            if (!isName(n2)) E('<identifier> expected', p.afterPrev());
            p.next();
            decls.push({ n: n2, init: p.eat('=') ? parseExpr() : null });
          }
          expect(';');
          for (const d of decls) {
            cls.fields[d.n.v] = { name: d.n.v, mods: mmods, type, init: d.init, tok: d.n };
            cls.fieldOrder.push(d.n.v);
          }
        }
      }
      p.next();
      classes.push(cls);
    }
    return classes;
  }

  function typeStr(t) {
    if (!t) return '?';
    return t.name.replace(/^java\.lang\./, '') + '[]'.repeat(t.varargs ? t.dims - 1 : t.dims) + (t.varargs ? '...' : '');
  }
  function paramTypesStr(m) {
    return m.params.map(x => typeStr(x.type).replace('...', '[]')).join(',');
  }
  const NUMERIC = words('int long short byte char double float');
  const isNumeric = t => NUMERIC.has(t);
  function javaAssignable(to, from) {
    if (to === from) return true;
    if (to === 'var') return from !== 'void' && from !== 'null';
    if (from === 'null') return !JAVA_PRIMS.has(to);
    if (to === 'Object') return from !== 'void';
    const widen = { double: ['int', 'long', 'float', 'char', 'short', 'byte'], float: ['int', 'long', 'char', 'short', 'byte'], long: ['int', 'char', 'short', 'byte'], int: ['char', 'short', 'byte'] };
    return (widen[to] || []).includes(from);
  }

  function javaCheck(classes, file) {
    const E = (msg, pos, extra) => { throw new DiagError(msg, pos, extra); };
    const seen = new Set();
    for (const c of classes) {
      if (seen.has(c.name)) E(`duplicate class: ${c.name}`, c.nameTok);
      seen.add(c.name);
      if (c.mods.has('public') && `${c.name}.java` !== file) {
        E(`class ${c.name} is public, should be declared in a file named ${c.name}.java`, c.nameTok);
      }
    }
    const classNames = new Set(classes.map(c => c.name));

    function resolveType(t, cls) {
      if (!t) return 'void';
      const base = t.name.replace(/^java\.lang\./, '');
      if (!JAVA_PRIMS.has(base) && !JAVA_KNOWN_TYPES.has(base) && !classNames.has(base)) {
        E('cannot find symbol', t.tok, { lines: [`  symbol:   class ${base}`, `  location: class ${cls.name}`] });
      }
      return base + '[]'.repeat(t.dims);
    }

    for (const cls of classes) {
      const ctx = { cls, scopes: [], isStatic: true, method: null };
      const lookupVar = n => {
        for (let i = ctx.scopes.length - 1; i >= 0; i--) if (ctx.scopes[i].has(n)) return ctx.scopes[i].get(n);
        return null;
      };

      const checkExpr = e => {
        switch (e.k) {
          case 'lit': return e.type;
          case 'name': {
            const v = lookupVar(e.v);
            if (v) return v;
            const f = cls.fields[e.v];
            if (f) {
              if (ctx.isStatic && !f.mods.has('static')) E(`non-static variable ${e.v} cannot be referenced from a static context`, e.tok);
              return resolveType(f.type, cls);
            }
            E('cannot find symbol', e.tok, { lines: [`  symbol:   variable ${e.v}`, `  location: class ${cls.name}`] });
          }
          // fallthrough
          case 'field': {
            if (e.obj.k === 'name' && !lookupVar(e.obj.v) && !cls.fields[e.obj.v]) {
              const n = e.obj.v;
              if (n === 'System') {
                if (e.name === 'out' || e.name === 'err') return 'PrintStream';
                E('cannot find symbol', e.dot, { lines: [`  symbol:   variable ${e.name}`, '  location: class System'] });
              }
              if (classNames.has(n)) {
                const oc = classes.find(c => c.name === n);
                const f = oc.fields[e.name];
                if (f && f.mods.has('static')) return resolveType(f.type, oc);
                E('cannot find symbol', e.dot, { lines: [`  symbol:   variable ${e.name}`, `  location: class ${n}`] });
              }
              E(`package ${n} does not exist`, e.dot);
            }
            const ot = checkExpr(e.obj);
            if (ot === 'String[]' && e.name === 'length') return 'int';
            E('cannot find symbol', e.dot, { lines: [`  symbol:   variable ${e.name}`, `  location: class ${ot}`] });
          }
          // fallthrough
          case 'call': {
            const argTypes = () => e.args.map(a => {
              const t = checkExpr(a);
              if (t === 'void') E("'void' type not allowed here", a.tok);
              return t;
            });
            const c = e.callee;
            if (c.k === 'field') {
              if (c.obj.k === 'name' && c.obj.v === 'System' && !lookupVar('System')) {
                const at = argTypes();
                E('cannot find symbol', c.dot, { lines: [`  symbol:   method ${c.name}(${at.join(',')})`, '  location: class System'] });
              }
              const ot = checkExpr(c.obj);
              const at = argTypes();
              if (ot === 'PrintStream') {
                const varName = c.obj.k === 'field' ? c.obj.name : 'out';
                if (c.name === 'println' || c.name === 'print') {
                  if (at.length > 1 || (c.name === 'print' && at.length === 0)) {
                    E(`no suitable method found for ${c.name}(${at.join(',') || 'no arguments'})`, c.dot);
                  }
                  return 'void';
                }
                if (c.name === 'printf' || c.name === 'format') {
                  if (!at.length || at[0] !== 'String') E(`no suitable method found for ${c.name}(${at.join(',') || 'no arguments'})`, c.dot);
                  return 'PrintStream';
                }
                E('cannot find symbol', c.dot, { lines: [`  symbol:   method ${c.name}(${at.join(',')})`, `  location: variable ${varName} of type PrintStream`] });
              }
              if (ot === 'String') {
                const sm = { length: 'int', toUpperCase: 'String', toLowerCase: 'String', trim: 'String' };
                if (c.name in sm && at.length === 0) return sm[c.name];
              }
              E('cannot find symbol', c.dot, { lines: [`  symbol:   method ${c.name}(${at.join(',')})`, `  location: class ${ot}`] });
            }
            if (c.k === 'name') {
              const at = argTypes();
              const m = cls.methods[c.v];
              if (!m) E('cannot find symbol', c.tok, { lines: [`  symbol:   method ${c.v}(${at.join(',')})`, `  location: class ${cls.name}`] });
              if (ctx.isStatic && !m.mods.has('static')) {
                E(`non-static method ${m.name}(${paramTypesStr(m)}) cannot be referenced from a static context`, c.tok);
              }
              const pts = m.params.map(x => resolveType(x.type, cls));
              if (pts.length !== at.length || pts.some((pt, i) => !javaAssignable(pt, at[i]))) {
                E(`method ${m.name} in class ${cls.name} cannot be applied to given types;`, c.tok, {
                  lines: [
                    `  required: ${pts.join(',') || 'no arguments'}`,
                    `  found:    ${at.join(',') || 'no arguments'}`,
                    `  reason: ${pts.length !== at.length ? 'actual and formal argument lists differ in length' : 'argument mismatch'}`,
                  ],
                });
              }
              return resolveType(m.ret, cls);
            }
            E('not a statement', e.tok);
          }
          // fallthrough
          case 'unary': {
            const t = checkExpr(e.a);
            if (e.op === '-' && !isNumeric(t)) E(`bad operand type ${t} for unary operator '-'`, e.tok);
            if (e.op === '!' && t !== 'boolean') E(`bad operand type ${t} for unary operator '!'`, e.tok);
            return e.op === '!' ? 'boolean' : t;
          }
          case 'bin': {
            const a = checkExpr(e.a), b = checkExpr(e.b);
            const bad = () => E(`bad operand types for binary operator '${e.op}'`, e.opTok, { lines: [`  first type:  ${a}`, `  second type: ${b}`] });
            if (a === 'void' || b === 'void') E("'void' type not allowed here", a === 'void' ? e.a.tok : e.b.tok);
            if (e.op === '+' && (a === 'String' || b === 'String')) return 'String';
            if (['==', '!='].includes(e.op)) return 'boolean';
            if (!isNumeric(a) || !isNumeric(b)) bad();
            if (['<', '>', '<=', '>='].includes(e.op)) return 'boolean';
            return a === 'double' || b === 'double' ? 'double' : 'int';
          }
          case 'assign': {
            if (e.target.k !== 'name') E('unexpected type', e.opTok, { lines: ['  required: variable', '  found:    value'] });
            const tt = checkExpr(e.target), vt = checkExpr(e.value);
            if (e.op === '=' && !javaAssignable(tt, vt)) E(`incompatible types: ${vt} cannot be converted to ${tt}`, e.value.tok);
            return tt;
          }
        }
        return 'void';
      };

      const checkStmt = s => {
        switch (s.k) {
          case 'block':
            ctx.scopes.push(new Map());
            s.body.forEach(checkStmt);
            ctx.scopes.pop();
            break;
          case 'expr': checkExpr(s.e); break;
          case 'if': {
            const t = checkExpr(s.c);
            if (t !== 'boolean') E(`incompatible types: ${t} cannot be converted to boolean`, s.c.tok);
            checkStmt(s.th);
            if (s.el) checkStmt(s.el);
            break;
          }
          case 'return': {
            const rt = resolveType(ctx.method.ret, cls);
            if (s.e) {
              const t = checkExpr(s.e);
              if (rt === 'void') E('incompatible types: unexpected return value', s.e.tok);
              if (!javaAssignable(rt, t)) E(`incompatible types: ${t} cannot be converted to ${rt}`, s.e.tok);
            } else if (rt !== 'void') E('missing return value', s.tok);
            break;
          }
          case 'var': {
            let t = resolveType(s.type, cls);
            if (t === 'void') E("'void' type not allowed here", s.type.tok);
            for (const d of s.decls) {
              if (lookupVar(d.name)) {
                E(`variable ${d.name} is already defined in method ${ctx.method.name}(${paramTypesStr(ctx.method)})`, d.tok);
              }
              let vt = t;
              if (d.init) {
                const it = checkExpr(d.init);
                if (it === 'void') E("'void' type not allowed here", d.init.tok);
                if (!javaAssignable(t, it)) E(`incompatible types: ${it} cannot be converted to ${t}`, d.init.tok);
                if (t === 'var') vt = it;
              } else if (t === 'var') {
                E("cannot infer type for local variable " + d.name, d.tok, { lines: ['  (cannot use \'var\' on variable without initializer)'] });
              }
              ctx.scopes[ctx.scopes.length - 1].set(d.name, vt);
            }
            break;
          }
        }
      };

      for (const fname of cls.fieldOrder) {
        const f = cls.fields[fname];
        const t = resolveType(f.type, cls);
        if (f.init) {
          ctx.isStatic = f.mods.has('static');
          const it = checkExpr(f.init);
          if (!javaAssignable(t, it)) E(`incompatible types: ${it} cannot be converted to ${t}`, f.init.tok);
        }
      }
      for (const m of Object.values(cls.methods)) {
        ctx.method = m;
        ctx.isStatic = m.mods.has('static');
        ctx.scopes = [new Map(m.params.map(x => [x.name, resolveType(x.type, cls)]))];
        resolveType(m.ret, cls);
        checkStmt(m.body);
        const rt = resolveType(m.ret, cls);
        if (rt !== 'void' && !m.body.body.some(s => s.k === 'return')) {
          E('missing return statement', { line: m.body.tok.line, col: m.body.tok.col });
        }
      }
    }
  }

  function javacFormat(file, src, d) {
    const srcLine = src.split('\n')[d.pos.line - 1] || '';
    let s = `${file}:${d.pos.line}: error: ${d.message}\n${srcLine}\n${caretLine(srcLine, d.pos.col)}\n`;
    if (d.extra.lines) s += d.extra.lines.join('\n') + '\n';
    return s;
  }

  function javaCompile(src, file) {
    try {
      const classes = javaParse(src);
      javaCheck(classes, file);
      return { ok: true, classes };
    } catch (e) {
      if (e instanceof DiagError) return { ok: false, err: javacFormat(file, src, e) + '1 error\n' };
      throw e;
    }
  }

  function javaFindMainError(classes, className) {
    const cls = classes.find(c => c.name === className);
    const how = '   public static void main(String[] args)';
    const m = cls && cls.methods.main;
    const okParams = m && m.params.length === 1 && typeStr(m.params[0].type).replace('...', '[]') === 'String[]';
    if (!m || !okParams || !m.mods.has('public')) {
      return `Error: Main method not found in class ${className}, please define the main method as:\n${how}\nor a JavaFX application class must extend javafx.application.Application\n`;
    }
    if (!m.mods.has('static')) return `Error: Main method is not static in class ${className}, please define the main method as:\n${how}\n`;
    if (m.ret.name !== 'void') return `Error: Main method must return a value of type void in class ${className}, please\ndefine the main method as:\n${how}\n`;
    return null;
  }

  function javaRun(classes, className, file) {
    let stdout = '', stderr = '';
    const mainErr = javaFindMainError(classes, className);
    if (mainErr) return { out: '', err: mainErr, code: 1 };
    const statics = new Map();
    class JavaThrow { constructor(name, msg, line) { this.name = name; this.msg = msg; this.line = line; } }
    class Ret { constructor(v) { this.v = v; } }
    const stack = [];
    const jstr = v => {
      if (v.t === 'null' || v.v === null) return 'null';
      if (v.t === 'double' || v.t === 'float') {
        if (Number.isNaN(v.v)) return 'NaN';
        if (!isFinite(v.v)) return v.v > 0 ? 'Infinity' : '-Infinity';
        return Number.isInteger(v.v) ? v.v.toFixed(1) : String(v.v);
      }
      return String(v.v);
    };
    const javaFormat = (fmt, args) => {
      let ai = 0;
      return fmt.replace(/%([-+ 0#,]*)(\d*)(?:\.(\d+))?([sdfnc%bxS])/g, (m, flags, width, prec, conv) => {
        if (conv === 'n') return '\n';
        if (conv === '%') return '%';
        const a = args[ai++];
        if (!a) throw new JavaThrow('java.util.MissingFormatArgumentException', `Format specifier '${m}'`);
        let s;
        if (conv === 'd') s = String(Math.trunc(a.v));
        else if (conv === 'f') s = Number(a.v).toFixed(prec === undefined ? 6 : +prec);
        else if (conv === 'x') s = Math.trunc(a.v).toString(16);
        else s = jstr(a);
        if (conv === 'S') s = s.toUpperCase();
        if (width) s = flags.includes('-') ? s.padEnd(+width) : s.padStart(+width, flags.includes('0') ? '0' : ' ');
        return s;
      });
    };

    function evalE(e, cls, env) {
      switch (e.k) {
        case 'lit': return { t: e.type, v: e.v };
        case 'name': {
          for (let i = env.length - 1; i >= 0; i--) if (env[i].has(e.v)) return env[i].get(e.v);
          return statics.get(cls.name + '.' + e.v) || { t: 'null', v: null };
        }
        case 'field': {
          if (e.obj.k === 'name' && e.obj.v === 'System') return { t: 'PrintStream', v: e.name };
          if (e.obj.k === 'name' && statics.has(e.obj.v + '.' + e.name)) return statics.get(e.obj.v + '.' + e.name);
          const o = evalE(e.obj, cls, env);
          if (e.name === 'length') return { t: 'int', v: o.v.length };
          return { t: 'null', v: null };
        }
        case 'unary': {
          const a = evalE(e.a, cls, env);
          return e.op === '-' ? { t: a.t, v: -a.v } : { t: 'boolean', v: !a.v };
        }
        case 'bin': {
          const a = evalE(e.a, cls, env), b = evalE(e.b, cls, env);
          if (e.op === '+' && (a.t === 'String' || b.t === 'String')) return { t: 'String', v: jstr(a) + jstr(b) };
          const av = a.t === 'char' ? a.v.charCodeAt(0) : a.v, bv = b.t === 'char' ? b.v.charCodeAt(0) : b.v;
          const isD = a.t === 'double' || b.t === 'double';
          const t = isD ? 'double' : 'int';
          const intify = x => (isD ? x : (x | 0));
          switch (e.op) {
            case '+': return { t, v: intify(av + bv) };
            case '-': return { t, v: intify(av - bv) };
            case '*': return { t, v: isD ? av * bv : Math.imul(av, bv) };
            case '/':
              if (!isD && bv === 0) throw new JavaThrow('java.lang.ArithmeticException', '/ by zero', e.opTok.line);
              return { t, v: isD ? av / bv : Math.trunc(av / bv) };
            case '%':
              if (!isD && bv === 0) throw new JavaThrow('java.lang.ArithmeticException', '/ by zero', e.opTok.line);
              return { t, v: av % bv };
            case '==': return { t: 'boolean', v: av === bv };
            case '!=': return { t: 'boolean', v: av !== bv };
            case '<': return { t: 'boolean', v: av < bv };
            case '>': return { t: 'boolean', v: av > bv };
            case '<=': return { t: 'boolean', v: av <= bv };
            case '>=': return { t: 'boolean', v: av >= bv };
          }
          return { t: 'null', v: null };
        }
        case 'assign': {
          let v = evalE(e.value, cls, env);
          const n = e.target.v;
          let holder = null;
          for (let i = env.length - 1; i >= 0; i--) if (env[i].has(n)) { holder = env[i]; break; }
          const cur = holder ? holder.get(n) : statics.get(cls.name + '.' + n);
          if (e.op !== '=') {
            const op = e.op[0];
            v = evalE({ k: 'bin', op, a: { k: 'lit', type: cur.t, v: cur.v }, b: { k: 'lit', type: v.t, v: v.v }, opTok: e.opTok }, cls, env);
          }
          if (cur && cur.t === 'double' && v.t === 'int') v = { t: 'double', v: v.v };
          if (holder) holder.set(n, v); else statics.set(cls.name + '.' + n, v);
          return v;
        }
        case 'call': {
          const c = e.callee;
          const args = e.args.map(a => evalE(a, cls, env));
          if (c.k === 'field') {
            const o = evalE(c.obj, cls, env);
            if (o.t === 'PrintStream') {
              let text = '';
              if (c.name === 'println') text = (args.length ? jstr(args[0]) : '') + '\n';
              else if (c.name === 'print') text = jstr(args[0]);
              else text = javaFormat(args[0].v, args.slice(1));
              if (o.v === 'err') stderr += text; else stdout += text;
              if (stdout.length > 100000) throw new JavaThrow('java.lang.OutOfMemoryError', 'Java heap space', c.dot.line);
              return { t: 'void', v: null };
            }
            if (o.t === 'String') {
              if (o.v === null) throw new JavaThrow('java.lang.NullPointerException', `Cannot invoke "String.${c.name}()" because value is null`, c.dot.line);
              const f = { length: s => ({ t: 'int', v: s.length }), toUpperCase: s => ({ t: 'String', v: s.toUpperCase() }), toLowerCase: s => ({ t: 'String', v: s.toLowerCase() }), trim: s => ({ t: 'String', v: s.trim() }) };
              return f[c.name](o.v);
            }
          }
          if (c.k === 'name') return callMethod(cls, cls.methods[c.v], args, c.tok.line);
          return { t: 'void', v: null };
        }
      }
      return { t: 'void', v: null };
    }
    function execS(s, cls, env) {
      stack[stack.length - 1].line = s.tok ? s.tok.line : stack[stack.length - 1].line;
      switch (s.k) {
        case 'block':
          env.push(new Map());
          try { s.body.forEach(x => execS(x, cls, env)); } finally { env.pop(); }
          break;
        case 'expr': evalE(s.e, cls, env); break;
        case 'if':
          if (evalE(s.c, cls, env).v) execS(s.th, cls, env);
          else if (s.el) execS(s.el, cls, env);
          break;
        case 'return': throw new Ret(s.e ? evalE(s.e, cls, env) : { t: 'void', v: null });
        case 'var':
          for (const d of s.decls) {
            let v = d.init ? evalE(d.init, cls, env) : { t: s.type.name, v: null };
            if (s.type.name === 'double' && v.t === 'int') v = { t: 'double', v: v.v };
            env[env.length - 1].set(d.name, v);
          }
          break;
      }
    }
    function callMethod(cls, m, args, callLine) {
      if (stack.length > 1000) throw new JavaThrow('java.lang.StackOverflowError', '', callLine);
      stack.push({ cls: cls.name, method: m.name, line: m.tok.line });
      const env = [new Map(m.params.map((p, i) => [p.name, args[i] || { t: 'String[]', v: [] }]))];
      try {
        execS(m.body, cls, env);
      } catch (r) {
        if (r instanceof Ret) { stack.pop(); return r.v; }
        throw r;
      }
      stack.pop();
      return { t: 'void', v: null };
    }

    try {
      for (const c of classes) {
        stack.push({ cls: c.name, method: '<clinit>', line: 1 });
        for (const fname of c.fieldOrder) {
          const f = c.fields[fname];
          if (f.mods.has('static')) {
            let v = f.init ? evalE(f.init, c, []) : { t: f.type.name, v: null };
            if (f.type.name === 'double' && v.t === 'int') v = { t: 'double', v: v.v };
            statics.set(c.name + '.' + fname, v);
          }
        }
        stack.pop();
      }
      const cls = classes.find(c => c.name === className);
      callMethod(cls, cls.methods.main, [{ t: 'String[]', v: [] }], 1);
    } catch (ex) {
      if (ex instanceof JavaThrow) {
        let s = `Exception in thread "main" ${ex.name}${ex.msg ? ': ' + ex.msg : ''}\n`;
        const frames = stack.slice().reverse().slice(0, 10);
        frames.forEach((f, i) => { s += `\tat ${f.cls}.${f.method}(${file}:${i === 0 && ex.line ? ex.line : f.line})\n`; });
        return { out: stdout, err: stderr + s, code: 1 };
      }
      throw ex;
    }
    return { out: stdout, err: stderr, code: 0 };
  }

  // =====================================================================
  // C
  // =====================================================================
  const C_TYPE_KW = words('int char void double float long short unsigned signed const static extern volatile register auto _Bool bool inline');
  const C_KEYWORDS = new Set([...C_TYPE_KW, ...words('return if else for while do switch case default break continue goto sizeof struct union enum typedef')]);
  const KNOWN_HEADERS = words('stdio.h stdlib.h string.h math.h stdbool.h stdint.h ctype.h time.h limits.h stddef.h unistd.h');
  const LIBC = { printf: 'stdio.h', puts: 'stdio.h', putchar: 'stdio.h' };

  function cPreprocess(src) {
    const lines = src.split('\n');
    const includes = new Set();
    lines.forEach((ln, idx) => {
      const m = /^(\s*)#\s*(\w*)(.*)$/.exec(ln);
      if (!m) return;
      const dir = m[2];
      const hashCol = m[1].length + 1;
      if (dir === 'include') {
        const rest = m[3];
        const restStart = ln.length - rest.length;
        const lead = rest.length - rest.trimStart().length;
        const col = restStart + lead + 1;
        const hm = /^([<"])([^>"]*)([>"])?/.exec(rest.trimStart());
        if (!hm) throw new DiagError('#include expects "FILENAME" or <FILENAME>', { line: idx + 1, col }, { fatal: false });
        if (!hm[3]) throw new DiagError(`missing terminating ${hm[1] === '<' ? '>' : '"'} character`, { line: idx + 1, col }, { len: hm[0].length });
        const h = hm[2].trim();
        if (!KNOWN_HEADERS.has(h)) throw new DiagError(`${h}: No such file or directory`, { line: idx + 1, col }, { fatal: true, len: hm[0].length });
        includes.add(h);
      } else if (!words('define undef ifdef ifndef if else elif endif pragma error warning line').has(dir) && dir !== '') {
        throw new DiagError(`invalid preprocessing directive #${dir}`, { line: idx + 1, col: hashCol + 1 }, { len: dir.length });
      }
      lines[idx] = '';
    });
    return { code: lines.join('\n'), includes };
  }

  function cTokDesc(t) {
    if (t.t === 'eof') return null;
    if (t.t === 'str') return 'string constant';
    if (t.t === 'num') return 'numeric constant';
    if (t.t === 'chr') return 'character constant';
    if (t.t === 'id') return `‘${t.v}’`;
    return `‘${t.v}’ token`;
  }

  function cParse(code) {
    const toks = clex(code, 'c');
    const p = new TP(toks);
    const E = (msg, pos, extra) => { throw new DiagError(msg, pos, extra); };
    let curFn = null;
    const Ef = (msg, pos, extra) => E(msg, pos, { fn: curFn, ...(extra || {}) });
    const expected = (what, at) => {
      const t = p.peek();
      const d = cTokDesc(t);
      if (!d) Ef(`expected ${what} at end of input`, at || p.afterPrev());
      Ef(`expected ${what} before ${d}`, at || p.afterPrev());
    };
    const expect = v => { if (p.is(v)) return p.next(); expected(`‘${v}’`); };
    const isTypeStart = () => p.peek().t === 'id' && C_TYPE_KW.has(p.peek().v);

    function parseSpec() {
      const parts = [];
      const tok = p.peek();
      while (isTypeStart()) parts.push(p.next().v);
      if (!parts.length) return null;
      const core = parts.filter(x => !words('const static extern volatile register auto inline unsigned signed').has(x));
      let base = core.includes('double') ? 'double' : core.includes('float') ? 'double' : core.includes('char') ? 'char' : core.includes('void') ? 'void' : 'int';
      return { base, tok, parts };
    }
    function parseDeclarator(spec) {
      let ptr = 0;
      while (p.is('*')) { p.next(); ptr++; while (p.is('const')) p.next(); }
      const n = p.peek();
      if (n.t !== 'id' || C_KEYWORDS.has(n.v)) return { ptr, name: null, tok: n };
      p.next();
      let arr = false;
      while (p.is('[')) {
        p.next();
        if (!p.is(']')) parseExpr();
        expect(']');
        arr = true;
      }
      let type = spec.base + '*'.repeat(ptr);
      if (arr) type += '*';
      return { ptr, name: n.v, tok: n, type };
    }

    function parseBlock() {
      const open = p.next();
      const body = [];
      while (!p.is('}')) {
        if (p.atEOF()) Ef('expected declaration or statement at end of input', { line: p.prev.line, col: p.prev.col });
        body.push(parseStmt());
      }
      p.next();
      return { k: 'block', body, tok: open };
    }
    function parseStmt() {
      const t = p.peek();
      if (p.is('{')) return parseBlock();
      if (p.eat(';')) return { k: 'empty', tok: t };
      if (p.is('return')) {
        p.next();
        const e = p.is(';') ? null : parseExpr();
        expect(';');
        return { k: 'return', e, tok: t };
      }
      if (p.is('if')) {
        p.next();
        expect('(');
        const c = parseExpr();
        expect(')');
        const th = parseStmt();
        const el = p.eat('else') ? parseStmt() : null;
        return { k: 'if', c, th, el, tok: t };
      }
      if (isTypeStart()) {
        const spec = parseSpec();
        const decls = [];
        do {
          const d = parseDeclarator(spec);
          if (!d.name) expected('identifier or ‘(’');
          d.init = p.eat('=') ? parseAssign() : null;
          decls.push(d);
        } while (p.eat(','));
        expect(';');
        return { k: 'var', decls, tok: t };
      }
      if (t.t === 'id' && !C_KEYWORDS.has(t.v) && p.peek(1).t === 'id' && !C_KEYWORDS.has(p.peek(1).v)) {
        Ef(`unknown type name ‘${t.v}’`, t, { len: t.v.length });
      }
      if (t.t === 'id' && C_KEYWORDS.has(t.v)) Ef(`expected expression before ‘${t.v}’`, t, { len: t.v.length });
      const e = parseExpr();
      expect(';');
      return { k: 'expr', e, tok: t };
    }
    function parseExpr() { return parseAssign(); }
    function parseAssign() {
      const lhs = parseCmp();
      if (p.is('=') || p.is('+=') || p.is('-=')) {
        const op = p.next();
        return { k: 'assign', op: op.v, target: lhs, value: parseAssign(), tok: lhs.tok, opTok: op };
      }
      return lhs;
    }
    function parseCmp() {
      let a = parseAdd();
      while (['==', '!=', '<', '>', '<=', '>='].some(o => p.is(o))) {
        const op = p.next();
        a = { k: 'bin', op: op.v, a, b: parseAdd(), tok: a.tok, opTok: op };
      }
      return a;
    }
    function parseAdd() {
      let a = parseMul();
      while (p.is('+') || p.is('-')) {
        const op = p.next();
        a = { k: 'bin', op: op.v, a, b: parseMul(), tok: a.tok, opTok: op };
      }
      return a;
    }
    function parseMul() {
      let a = parseUnary();
      while (p.is('*') || p.is('/') || p.is('%')) {
        const op = p.next();
        a = { k: 'bin', op: op.v, a, b: parseUnary(), tok: a.tok, opTok: op };
      }
      return a;
    }
    function parseUnary() {
      if (p.is('-') || p.is('!') || p.is('*') || p.is('&')) {
        const t = p.next();
        return { k: 'unary', op: t.v, a: parseUnary(), tok: t };
      }
      return parsePostfix();
    }
    function parsePostfix() {
      let e = parsePrimary();
      for (;;) {
        if (p.is('(')) {
          const lp = p.next();
          const args = [];
          if (!p.is(')')) {
            do { args.push(parseAssign()); } while (p.eat(','));
          }
          if (!p.is(')')) expected('‘)’');
          p.next();
          e = { k: 'call', callee: e, args, tok: e.tok, lp };
          continue;
        }
        if (p.is('[')) {
          const lb = p.next();
          const idx = parseExpr();
          expect(']');
          e = { k: 'index', a: e, idx, tok: e.tok, lb };
          continue;
        }
        break;
      }
      return e;
    }
    function parsePrimary() {
      const t = p.peek();
      if (t.t === 'str') {
        p.next();
        let v = t.v;
        while (p.peek().t === 'str') v += p.next().v;
        return { k: 'lit', type: 'char*', v, tok: t, len: t.raw.length };
      }
      if (t.t === 'chr') { p.next(); return { k: 'lit', type: 'int', v: t.v.charCodeAt(t.v.length - 1) || 0, tok: t, multi: t.multi, len: t.raw.length }; }
      if (t.t === 'num') { p.next(); return { k: 'lit', type: t.isFloat ? 'double' : 'int', v: t.v, tok: t, len: t.raw.length }; }
      if (t.t === 'id' && !C_KEYWORDS.has(t.v)) { p.next(); return { k: 'name', v: t.v, tok: t, len: t.v.length }; }
      if (p.is('(')) {
        p.next();
        const e = parseExpr();
        expect(')');
        return e;
      }
      expected('expression', t.t === 'eof' ? p.afterPrev() : { line: t.line, col: t.col });
    }

    const funcs = {};
    const globals = [];
    const warnings = [];
    while (!p.atEOF()) {
      if (p.eat(';')) continue;
      const startTok = p.peek();
      let spec = parseSpec();
      if (!spec) {
        if (startTok.t === 'id' && p.is('(', 1)) {
          spec = { base: 'int', tok: startTok, implicit: true };
          warnings.push({ msg: 'return type defaults to ‘int’ [-Wimplicit-int]', pos: startTok, len: startTok.v.length });
        } else if (startTok.t === 'id' && p.peek(1).t === 'id') {
          E(`unknown type name ‘${startTok.v}’`, startTok, { len: startTok.v.length });
        } else {
          const d = cTokDesc(startTok);
          E(`expected identifier or ‘(’ before ${d}`, startTok);
        }
      }
      const d = parseDeclarator(spec);
      if (!d.name) expected('identifier or ‘(’');
      if (p.is('(')) {
        p.next();
        const params = [];
        let variadic = false;
        if (p.is('void') && p.is(')', 1)) p.next();
        else if (!p.is(')')) {
          do {
            if (p.is('...')) { p.next(); variadic = true; break; }
            const ps = parseSpec();
            if (!ps) {
              const t = p.peek();
              if (t.t === 'id') E(`unknown type name ‘${t.v}’`, t, { len: t.v.length });
              expected('declaration specifiers or ‘...’');
            }
            const pd = parseDeclarator(ps);
            params.push({ name: pd.name, type: pd.type || ps.base });
          } while (p.eat(','));
        }
        expect(')');
        const fn = { name: d.name, ret: d.type, params, variadic, tok: d.tok, implicitInt: !!spec.implicit };
        if (p.is(';')) {
          p.next();
          if (!funcs[d.name]) funcs[d.name] = { ...fn, body: null };
          continue;
        }
        if (!p.is('{')) expected('‘=’, ‘,’, ‘;’, ‘asm’ or ‘__attribute__’');
        curFn = d.name;
        if (funcs[d.name] && funcs[d.name].body) E(`redefinition of ‘${d.name}’`, d.tok, { fn: d.name, len: d.name.length });
        fn.body = parseBlock();
        curFn = null;
        funcs[d.name] = fn;
      } else {
        const decls = [d];
        d.init = p.eat('=') ? parseAssign() : null;
        while (p.eat(',')) {
          const d2 = parseDeclarator(spec);
          if (!d2.name) expected('identifier or ‘(’');
          d2.init = p.eat('=') ? parseAssign() : null;
          decls.push(d2);
        }
        if (!p.is(';')) expected('‘=’, ‘,’, ‘;’, ‘asm’ or ‘__attribute__’');
        p.next();
        globals.push(...decls);
      }
    }
    return { funcs, globals, warnings };
  }

  function cTypeName(t) {
    return t.replace(/\*+$/, m => ' ' + m);
  }

  function cCheck(prog, includes) {
    const warnings = prog.warnings.slice();
    const undefinedRefs = new Map();
    const E = (msg, pos, extra) => { throw new DiagError(msg, pos, extra); };
    const globalTypes = new Map(prog.globals.map(g => [g.name, g.type]));
    const implicitSeen = new Set();

    for (const fn of Object.values(prog.funcs)) {
      if (!fn.body) continue;
      const scopes = [globalTypes, new Map(fn.params.filter(x => x.name).map(x => [x.name, x.type]))];
      const undeclaredSeen = new Set();
      const lookup = n => { for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(n)) return scopes[i].get(n); return null; };
      const W = (msg, tok, len, extra) => warnings.push({ msg, pos: tok, len, fn: fn.name, ...(extra || {}) });

      const check = e => {
        switch (e.k) {
          case 'lit':
            if (e.multi) W('multi-character character constant [-Wmultichar]', e.tok, e.len);
            return e.type;
          case 'name': {
            const t = lookup(e.v);
            if (t) return t;
            if (prog.funcs[e.v]) return 'fn';
            if (!undeclaredSeen.has(e.v)) {
              E(`‘${e.v}’ undeclared (first use in this function)`, e.tok, {
                fn: fn.name, len: e.v.length,
                notes: [{ pos: e.tok, msg: 'each undeclared identifier is reported only once for each function it appears in' }],
              });
            }
            return 'int';
          }
          case 'unary': {
            const t = check(e.a);
            if (e.op === '*') {
              if (!t.endsWith('*')) E('invalid type argument of unary ‘*’ (have ‘int’)', e.tok, { fn: fn.name });
              return t.slice(0, -1);
            }
            if (e.op === '&') return t + '*';
            return t;
          }
          case 'bin': {
            const a = check(e.a), b = check(e.b);
            const pa = a.endsWith('*'), pb = b.endsWith('*');
            if (e.op === '+' && pa && pb) {
              E(`invalid operands to binary + (have ‘${cTypeName(a)}’ and ‘${cTypeName(b)}’)`, e.opTok, { fn: fn.name });
            }
            if (['*', '/', '%'].includes(e.op) && (pa || pb)) {
              E(`invalid operands to binary ${e.op} (have ‘${cTypeName(a)}’ and ‘${cTypeName(b)}’)`, e.opTok, { fn: fn.name });
            }
            if (['==', '!=', '<', '>', '<=', '>='].includes(e.op)) return 'int';
            if (pa) return a;
            if (pb) return b;
            return a === 'double' || b === 'double' ? 'double' : 'int';
          }
          case 'index': {
            const a = check(e.a);
            check(e.idx);
            if (!a.endsWith('*')) E('subscripted value is neither array nor pointer nor vector', e.lb, { fn: fn.name });
            return a.slice(0, -1);
          }
          case 'assign': {
            if (e.target.k !== 'name' && e.target.k !== 'index' && !(e.target.k === 'unary' && e.target.op === '*')) {
              E('lvalue required as left operand of assignment', e.opTok, { fn: fn.name });
            }
            const t = check(e.target);
            check(e.value);
            return t;
          }
          case 'call': {
            const c = e.callee;
            if (c.k !== 'name') E('called object is not a function or function pointer', e.lp, { fn: fn.name });
            const n = c.v;
            const argT = e.args.map(check);
            const def = prog.funcs[n];
            if (lookup(n) && !def) E(`called object ‘${n}’ is not a function or function pointer`, c.tok, { fn: fn.name, len: n.length });
            if (def) {
              const need = def.params.length;
              if (argT.length < need) E(`too few arguments to function ‘${n}’`, c.tok, { fn: fn.name, len: n.length });
              if (argT.length > need && !def.variadic) E(`too many arguments to function ‘${n}’`, c.tok, { fn: fn.name, len: n.length });
              if (!def.body) undefinedRefs.set(n, fn.name);
              return def.ret;
            }
            if (LIBC[n]) {
              if (!includes.has(LIBC[n]) && !implicitSeen.has(n)) {
                implicitSeen.add(n);
                W(`implicit declaration of function ‘${n}’ [-Wimplicit-function-declaration]`, c.tok, n.length, {
                  notes: [{ pos: { line: 1, col: 1 }, msg: `include ‘<${LIBC[n]}>’ or provide a declaration of ‘${n}’`, noSnippet: true }],
                });
              }
              if (!argT.length) E(`too few arguments to function ‘${n}’`, c.tok, { fn: fn.name, len: n.length });
              if (n === 'putchar') return 'int';
              if (!argT[0].endsWith('*')) {
                W(`passing argument 1 of ‘${n}’ makes pointer from integer without a cast [-Wint-conversion]`, e.args[0].tok, e.args[0].len || 1);
              }
              if (n === 'puts' && argT.length > 1) E(`too many arguments to function ‘puts’`, c.tok, { fn: fn.name, len: 4 });
              return 'int';
            }
            if (!implicitSeen.has(n)) {
              implicitSeen.add(n);
              const s = suggest(n, [...Object.keys(LIBC), ...Object.keys(prog.funcs)]);
              W(`implicit declaration of function ‘${n}’${s ? `; did you mean ‘${s}’?` : ''} [-Wimplicit-function-declaration]`, c.tok, n.length);
            }
            if (!undefinedRefs.has(n)) undefinedRefs.set(n, fn.name);
            return 'int';
          }
        }
        return 'int';
      };
      const stmt = s => {
        switch (s.k) {
          case 'block':
            scopes.push(new Map());
            s.body.forEach(stmt);
            scopes.pop();
            break;
          case 'expr': check(s.e); break;
          case 'if': check(s.c); stmt(s.th); if (s.el) stmt(s.el); break;
          case 'return':
            if (s.e) {
              check(s.e);
              if (fn.ret === 'void') W('‘return’ with a value, in function returning void', s.tok, 6);
            }
            break;
          case 'var':
            for (const d of s.decls) {
              if (scopes[scopes.length - 1].has(d.name)) E(`redeclaration of ‘${d.name}’ with no linkage`, d.tok, { fn: fn.name, len: d.name.length });
              if (d.init) {
                const it = check(d.init);
                if (d.type.endsWith('*') && !it.endsWith('*') && !(d.init.k === 'lit' && d.init.v === 0)) {
                  W(`initialization of ‘${cTypeName(d.type)}’ from ‘${it}’ makes pointer from integer without a cast [-Wint-conversion]`, d.init.tok, d.init.len || 1);
                }
              }
              scopes[scopes.length - 1].set(d.name, d.type);
            }
            break;
        }
      };
      stmt(fn.body);
    }
    return { warnings, undefinedRefs };
  }

  function gccFormat(file, src, list) {
    const srcLines = src.split('\n');
    let out = '', lastFn;
    for (const d of list) {
      if (d.fn && d.fn !== lastFn) out += `${file}: In function ‘${d.fn}’:\n`;
      lastFn = d.fn;
      out += `${file}:${d.pos.line}:${d.pos.col}: ${d.kind}: ${d.msg}\n`;
      const ln = srcLines[d.pos.line - 1];
      if (ln !== undefined && !d.noSnippet) {
        out += `${String(d.pos.line).padStart(5)} | ${ln}\n      | ${caretLine(ln, d.pos.col, d.len)}\n`;
      }
      for (const n of d.notes || []) {
        out += `${file}:${n.pos.line}:${n.pos.col}: note: ${n.msg}\n`;
      }
    }
    return out;
  }

  function cCompile(src, file) {
    const diags = [];
    let pre, prog, checked;
    try {
      pre = cPreprocess(src);
      prog = cParse(pre.code);
      checked = cCheck(prog, pre.includes);
    } catch (e) {
      if (!(e instanceof DiagError)) throw e;
      const before = checked ? checked.warnings : (prog ? prog.warnings : []);
      const ws = before.map(w => ({ kind: 'warning', ...w }));
      const err = { kind: e.extra.fatal ? 'fatal error' : 'error', msg: e.message, pos: e.pos, len: e.extra.len, fn: e.extra.fn, notes: e.extra.notes };
      let out = gccFormat(file, src, [...ws, err]);
      if (e.extra.fatal) out += 'compilation terminated.\n';
      return { ok: false, err: out };
    }
    diags.push(...checked.warnings.map(w => ({ kind: 'warning', ...w })));
    let out = gccFormat(file, src, diags);
    // リンク
    const linkErrs = [];
    if (!prog.funcs.main || !prog.funcs.main.body) {
      linkErrs.push('/usr/bin/ld: /usr/lib/gcc/x86_64-linux-gnu/13/../../../x86_64-linux-gnu/Scrt1.o: in function `_start\':\n(.text+0x1b): undefined reference to `main\'');
    }
    for (const [n, from] of checked.undefinedRefs) {
      linkErrs.push(`/usr/bin/ld: /tmp/ccR2kXqS.o: in function \`${from}':\n${file}:(.text+0x${(0x13 + linkErrs.length * 0x1a).toString(16)}): undefined reference to \`${n}'`);
    }
    if (linkErrs.length) {
      out += linkErrs.join('\n') + '\ncollect2: error: ld returned 1 exit status\n';
      return { ok: false, err: out };
    }
    return { ok: true, err: out, program: prog };
  }

  function cFormat(fmt, args) {
    let ai = 0;
    return fmt.replace(/%([-+ 0#]*)(\d*)(?:\.(\d+))?(?:ll|l|hh|h|z)?([diouxXfFeEgGcsp%])/g, (m, flags, width, prec, conv) => {
      if (conv === '%') return '%';
      const a = args[ai++] || { t: 'int', v: 0 };
      let s;
      switch (conv) {
        case 'd': case 'i': case 'u': s = String(Math.trunc(typeof a.v === 'number' ? a.v : 0)); break;
        case 'x': s = (Math.trunc(a.v) >>> 0).toString(16); break;
        case 'X': s = (Math.trunc(a.v) >>> 0).toString(16).toUpperCase(); break;
        case 'o': s = (Math.trunc(a.v) >>> 0).toString(8); break;
        case 'f': case 'F': s = Number(a.v).toFixed(prec === undefined ? 6 : +prec); break;
        case 'e': case 'E': s = Number(a.v).toExponential(prec === undefined ? 6 : +prec); break;
        case 'g': case 'G': s = String(Number(a.v)); break;
        case 'c': s = String.fromCharCode(a.v); break;
        case 's':
          if (a.t !== 'char*') throw new CSegv();
          s = a.v === null ? '(null)' : a.v;
          if (prec !== undefined) s = s.slice(0, +prec);
          break;
        case 'p': s = '0x7ffd5e8a3c40'; break;
      }
      if (width) s = flags.includes('-') ? s.padEnd(+width) : s.padStart(+width, flags.includes('0') ? '0' : ' ');
      return s;
    });
  }
  class CSegv { }
  class CFpe { }

  function cRun(prog) {
    let stdout = '';
    class Ret { constructor(v) { this.v = v; } }
    const globals = new Map();
    let depth = 0;
    const cstr = v => { const i = v.indexOf('\0'); return i >= 0 ? v.slice(0, i) : v; };

    function evalE(e, env) {
      switch (e.k) {
        case 'lit': return { t: e.type, v: e.v };
        case 'name': {
          for (let i = env.length - 1; i >= 0; i--) if (env[i].has(e.v)) return env[i].get(e.v);
          if (globals.has(e.v)) return globals.get(e.v);
          return { t: 'int', v: 0 };
        }
        case 'unary': {
          const a = evalE(e.a, env);
          if (e.op === '-') return { t: a.t, v: -a.v };
          if (e.op === '!') return { t: 'int', v: a.v ? 0 : 1 };
          if (e.op === '*') {
            if (!a.t.endsWith('*') || a.v === null) throw new CSegv();
            return { t: a.t.slice(0, -1), v: a.v.charCodeAt(0) || 0 };
          }
          return { t: a.t + '*', v: a.v };
        }
        case 'index': {
          const a = evalE(e.a, env), i = evalE(e.idx, env);
          if (a.v === null || typeof a.v !== 'string') throw new CSegv();
          return { t: 'char', v: a.v.charCodeAt(i.v) || 0 };
        }
        case 'bin': {
          const a = evalE(e.a, env), b = evalE(e.b, env);
          const pa = a.t.endsWith('*'), pb = b.t.endsWith('*');
          if (e.op === '+' && (pa || pb)) {
            const ptr = pa ? a : b, off = pa ? b.v : a.v;
            return { t: ptr.t, v: ptr.v.slice(off) };
          }
          if (e.op === '-' && pa && !pb) return { t: a.t, v: a.v };
          const isD = a.t === 'double' || b.t === 'double';
          const t = isD ? 'double' : 'int';
          switch (e.op) {
            case '+': return { t, v: isD ? a.v + b.v : (a.v + b.v) | 0 };
            case '-': return { t, v: isD ? a.v - b.v : (a.v - b.v) | 0 };
            case '*': return { t, v: isD ? a.v * b.v : Math.imul(a.v, b.v) };
            case '/':
              if (!isD && b.v === 0) throw new CFpe();
              return { t, v: isD ? a.v / b.v : Math.trunc(a.v / b.v) };
            case '%':
              if (!isD && b.v === 0) throw new CFpe();
              return { t, v: a.v % b.v };
            case '==': return { t: 'int', v: +(a.v === b.v) };
            case '!=': return { t: 'int', v: +(a.v !== b.v) };
            case '<': return { t: 'int', v: +(a.v < b.v) };
            case '>': return { t: 'int', v: +(a.v > b.v) };
            case '<=': return { t: 'int', v: +(a.v <= b.v) };
            case '>=': return { t: 'int', v: +(a.v >= b.v) };
          }
          return { t: 'int', v: 0 };
        }
        case 'assign': {
          let v = evalE(e.value, env);
          if (e.target.k !== 'name') return v;
          const n = e.target.v;
          let holder = globals;
          for (let i = env.length - 1; i >= 0; i--) if (env[i].has(n)) { holder = env[i]; break; }
          const cur = holder.get(n) || { t: 'int', v: 0 };
          if (e.op !== '=') v = evalE({ k: 'bin', op: e.op[0], a: { k: 'lit', type: cur.t, v: cur.v }, b: { k: 'lit', type: v.t, v: v.v } }, env);
          v = { t: cur.t, v: cur.t === 'int' && typeof v.v === 'number' ? Math.trunc(v.v) : v.v };
          holder.set(n, v);
          return v;
        }
        case 'call': {
          const n = e.callee.v;
          const args = e.args.map(a => evalE(a, env));
          if (prog.funcs[n]) return callFn(prog.funcs[n], args);
          if (n === 'printf') {
            if (args[0].t !== 'char*') throw new CSegv();
            const s = cFormat(cstr(args[0].v), args.slice(1));
            stdout += s;
            return { t: 'int', v: s.length };
          }
          if (n === 'puts') {
            if (args[0].t !== 'char*') throw new CSegv();
            stdout += cstr(args[0].v) + '\n';
            return { t: 'int', v: 1 };
          }
          if (n === 'putchar') {
            stdout += String.fromCharCode(args[0].v & 0xff);
            return { t: 'int', v: args[0].v };
          }
          return { t: 'int', v: 0 };
        }
      }
      return { t: 'int', v: 0 };
    }
    function exec(s, env) {
      switch (s.k) {
        case 'block':
          env.push(new Map());
          try { s.body.forEach(x => exec(x, env)); } finally { env.pop(); }
          break;
        case 'expr': evalE(s.e, env); break;
        case 'if':
          if (evalE(s.c, env).v) exec(s.th, env);
          else if (s.el) exec(s.el, env);
          break;
        case 'return': throw new Ret(s.e ? evalE(s.e, env) : { t: 'int', v: 0 });
        case 'var':
          for (const d of s.decls) {
            let v = d.init ? evalE(d.init, env) : { t: d.type, v: d.type.endsWith('*') ? null : 0 };
            v = { t: d.type, v: d.type === 'int' && typeof v.v === 'number' ? Math.trunc(v.v) : v.v };
            env[env.length - 1].set(d.name, v);
          }
          break;
      }
      if (stdout.length > 100000) throw new CSegv();
    }
    function callFn(fn, args) {
      if (++depth > 5000) throw new CSegv();
      const env = [new Map(fn.params.filter(x => x.name).map((x, i) => [x.name, args[i] ? { t: x.type, v: args[i].v } : { t: x.type, v: 0 }]))];
      try {
        exec(fn.body, env);
      } catch (r) {
        if (r instanceof Ret) { depth--; return r.v; }
        throw r;
      }
      depth--;
      return { t: fn.ret, v: fn.name === 'main' ? 0 : 0 };
    }
    try {
      for (const g of prog.globals) globals.set(g.name, g.init ? { t: g.type, v: evalE(g.init, []).v } : { t: g.type, v: g.type.endsWith('*') ? null : 0 });
      const main = prog.funcs.main;
      const r = callFn(main, [{ t: 'int', v: 1 }, { t: 'char**', v: null }]);
      const code = main.ret === 'void' ? 0 : ((r.v | 0) & 0xff);
      return { out: stdout, err: '', code };
    } catch (e) {
      if (e instanceof CSegv) return { out: stdout, err: 'Segmentation fault (core dumped)\n', code: 139 };
      if (e instanceof CFpe) return { out: stdout, err: 'Floating point exception (core dumped)\n', code: 136 };
      throw e;
    }
  }

  // =====================================================================
  // 公開 API
  // =====================================================================
  global.HW = {
    HOME,
    esc,
    suggest,
    langs: {
      python: { id: 'python', label: 'Python', ext: '.py', sample: 'hello.py', statusName: 'Python' },
      java: { id: 'java', label: 'Java', ext: '.java', sample: 'Hello.java', statusName: 'Java' },
      c: { id: 'c', label: 'C', ext: '.c', sample: 'hello.c', statusName: 'C' },
    },
    highlight: { py: pyHighlight, java: javaHighlight, c: cHighlight },
    pyRun,
    javaCompile,
    javaRun,
    cCompile,
    cRun,
    // 他の言語の実装 (languages-more.js) から使う内部ヘルパー
    _: { DiagError, clex, TP, caretLine, gccFormat, highlighter, identCls, strSpan, words, cFormat, levenshtein },
  };
})(window);
