(function () {
  'use strict';

  const HW = window.HW;
  const { esc, HOME } = HW;
  const $ = id => document.getElementById(id);

  // ---------------------------------------------------------------------
  // バージョン表示
  // ---------------------------------------------------------------------
  const V = window.APP_VERSION || {};
  $('version-badge').textContent = `v${V.version || 'dev'}${V.commit ? ' (' + V.commit + ')' : ''} ・ ${V.deployedAt ? 'デプロイ: ' + V.deployedAt : 'ローカル版'}`;

  // ---------------------------------------------------------------------
  // 状態
  // ---------------------------------------------------------------------
  const state = {
    lang: null,
    files: new Map(), // name -> { kind: 'text'|'class'|'exec', content, program, mtime }
    tabs: [],
    active: null,
    history: [],
    histIdx: 0,
    draft: '',
    pending: '', // 改行されていない出力 (プロンプトの前に表示される)
    solved: false,
  };

  const extOf = name => (name.match(/\.([^.]+)$/) || [])[1] || '';
  const hlKeyOf = name => ({ py: 'py', java: 'java', c: 'c', h: 'c' })[extOf(name)] || null;
  const langLabelOf = name => ({ py: 'Python', java: 'Java', c: 'C', h: 'C', txt: 'プレーンテキスト', md: 'Markdown' })[extOf(name)] || 'プレーンテキスト';

  // ---------------------------------------------------------------------
  // 画面切り替え
  // ---------------------------------------------------------------------
  // タイトルをターミナルで打ち込むように表示
  function typeTitle() {
    const el = document.querySelector('#start-screen .typed');
    const text = 'HelloWorld';
    el.textContent = '';
    clearInterval(typeTitle.timer);
    let i = 0;
    setTimeout(() => {
      typeTitle.timer = setInterval(() => {
        el.textContent = text.slice(0, ++i);
        if (i >= text.length) clearInterval(typeTitle.timer);
      }, 90);
    }, 300);
  }
  typeTitle();

  // ---------------------------------------------------------------------
  // タイムアタック
  // ---------------------------------------------------------------------
  const timerEl = $('timer');
  let timerStart = 0, timerRAF = 0;
  const fmtTime = (ms, digits = 2) => {
    const m = Math.floor(ms / 60000), sec = (ms % 60000) / 1000;
    return `${String(m).padStart(2, '0')}:${sec.toFixed(digits).padStart(digits + 3, '0')}`;
  };
  function startTimer() {
    cancelAnimationFrame(timerRAF);
    timerStart = performance.now();
    timerEl.classList.remove('done');
    const tick = () => {
      timerEl.textContent = fmtTime(performance.now() - timerStart, 1);
      timerRAF = requestAnimationFrame(tick);
    };
    tick();
  }
  function stopTimer() {
    cancelAnimationFrame(timerRAF);
    const ms = performance.now() - timerStart;
    timerEl.textContent = fmtTime(ms, 2);
    timerEl.classList.add('done');
    return ms;
  }
  const BEST_KEY = 'helloworld-best';
  function loadBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveBest(best) {
    try { localStorage.setItem(BEST_KEY, JSON.stringify(best)); } catch (e) { /* 保存できなくても続行 */ }
  }
  function renderBest() {
    const best = loadBest();
    document.querySelectorAll('[data-best]').forEach(el => {
      const ms = best[el.dataset.best];
      el.textContent = ms ? `BEST ${fmtTime(ms)}` : '';
    });
  }
  renderBest();

  // ---------------------------------------------------------------------
  // チュートリアル
  // ---------------------------------------------------------------------
  $('tutorial-btn').addEventListener('click', () => { $('tutorial-body').scrollTop = 0; $('tutorial').hidden = false; });
  $('tutorial-close').addEventListener('click', () => { $('tutorial').hidden = true; });
  $('tutorial').addEventListener('click', e => { if (e.target === e.currentTarget) $('tutorial').hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('tutorial').hidden = true; });

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    document.body.classList.toggle('on-work', id === 'work-screen');
  }

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => startLang(btn.dataset.lang));
  });
  $('back-btn').addEventListener('click', goHome);
  $('again-btn').addEventListener('click', () => { hideSuccess(); startLang(state.lang); });
  $('other-btn').addEventListener('click', () => { hideSuccess(); goHome(); });
  $('success-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget || e.target.classList.contains('success-box')) hideSuccess();
  });

  function goHome() {
    cancelAnimationFrame(timerRAF);
    renderBest();
    showScreen('start-screen');
    state.lang = null;
    typeTitle();
  }

  function startLang(lang) {
    state.lang = lang;
    state.files = new Map();
    state.tabs = [];
    state.active = null;
    state.pending = '';
    state.solved = false;
    state.history = [];
    state.histIdx = 0;
    showScreen('work-screen');
    termOut.innerHTML = '';
    input.value = '';
    renderEditor();
    welcome();
    renderPrompt();
    focusTerminal();
    startTimer();
  }

  // ---------------------------------------------------------------------
  // ターミナル
  // ---------------------------------------------------------------------
  const termEl = $('terminal');
  const termOut = $('term-output');
  const input = $('term-input');
  const promptEl = $('term-prompt');
  const PROMPT_HTML = '<span class="p-user">user@helloworld</span>:<span class="p-path">~/project</span>$ ';

  function focusTerminal() {
    if (window.HW_VKBD) { window.HW_VKBD.setTarget('terminal'); return; }
    if (window.matchMedia('(pointer: coarse)').matches) return; // モバイルでは勝手にキーボードを出さない
    input.focus({ preventScroll: true });
  }

  function scrollBottom() { termEl.scrollTop = termEl.scrollHeight; }

  function commitLine(html) {
    const div = document.createElement('div');
    div.className = 'term-line';
    div.innerHTML = html || '';
    termOut.appendChild(div);
  }
  function renderPrompt() {
    promptEl.innerHTML = state.pending + PROMPT_HTML;
    if (window.HW_VKBD) window.HW_VKBD.refresh();
    scrollBottom();
  }
  // 生テキストを書き込む (html=false ならエスケープ)
  function write(text, cls) {
    const parts = String(text).split('\n');
    parts.forEach((part, i) => {
      const html = part ? (cls ? `<span class="${cls}">${esc(part)}</span>` : esc(part)) : '';
      if (i < parts.length - 1) {
        commitLine(state.pending + html);
        state.pending = '';
      } else {
        state.pending += html;
      }
    });
  }
  function writeln(text, cls) { write(text + '\n', cls); }
  function writeHTMLLine(html) { commitLine(state.pending + html); state.pending = ''; }

  // gcc 風の色付け
  function colorizeGcc(line) {
    let m;
    if ((m = /^(\S+?:\d+:\d+:) (error|warning|note|fatal error):(.*)$/.exec(line))) {
      const cls = { error: 't-err', 'fatal error': 't-err', warning: 't-warn', note: 't-note' }[m[2]];
      return `<span class="t-bold">${esc(m[1])}</span> <span class="${cls} t-bold">${esc(m[2])}:</span>${colorQuotes(m[3])}`;
    }
    if ((m = /^(\S+?:) (In function .*)$/.exec(line))) return `<span class="t-bold">${esc(m[1])}</span> ${colorQuotes(m[2])}`;
    if ((m = /^(collect2: )(error:)(.*)$/.exec(line))) return `${esc(m[1])}<span class="t-err t-bold">${m[2]}</span>${esc(m[3])}`;
    if ((m = /^(gcc: )((?:fatal )?error:)(.*)$/.exec(line))) return `${esc(m[1])}<span class="t-err t-bold">${m[2]}</span>${esc(m[3])}`;
    if ((m = /^(\s+\|\s)([\s^~]*\^[~]*)\s*$/.exec(line))) return `${esc(m[1])}<span class="t-green t-bold">${esc(m[2])}</span>`;
    return esc(line);
  }
  function colorQuotes(s) {
    return esc(s).replace(/‘([^’]*)’/g, '‘<span class="t-bold">$1</span>’');
  }
  function writeErr(text, style) {
    if (!text) return;
    if (style === 'gcc') {
      const lines = text.replace(/\n$/, '').split('\n');
      lines.forEach(l => writeHTMLLine(colorizeGcc(l)));
    } else {
      write(text);
    }
  }

  function welcome() {
    const lang = HW.langs[state.lang];
    const d = new Date(Date.now() - 3600 * 1000 * 5);
    writeln('Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-45-generic x86_64)');
    writeln('');
    writeln(`Last login: ${d.toDateString().slice(0, 10)} ${d.toTimeString().slice(0, 8)} ${d.getFullYear()} from 192.168.0.10`);
    writeln(`# ${lang.label} で Hello World を出力してみよう！ (困ったら help と入力)`, 't-hint');
  }

  // --- 入力 ---
  input.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = input.value;
      input.value = '';
      writeHTMLLine(PROMPT_HTML + esc(cmd));
      if (cmd.trim()) {
        state.history.push(cmd);
      }
      state.histIdx = state.history.length;
      state.draft = '';
      runLine(cmd);
      renderPrompt();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (state.histIdx === state.history.length) state.draft = input.value;
      if (state.histIdx > 0) { state.histIdx--; input.value = state.history[state.histIdx]; }
      moveCaretEnd();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (state.histIdx < state.history.length) {
        state.histIdx++;
        input.value = state.histIdx === state.history.length ? state.draft : state.history[state.histIdx];
      }
      moveCaretEnd();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      complete();
      return;
    }
    if (e.ctrlKey && (e.key === 'c' || e.key === 'C') && input.selectionStart === input.selectionEnd) {
      e.preventDefault();
      writeHTMLLine(PROMPT_HTML + esc(input.value) + '^C');
      input.value = '';
      renderPrompt();
      return;
    }
    if (e.ctrlKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      termOut.innerHTML = '';
      renderPrompt();
    }
  });
  function moveCaretEnd() {
    requestAnimationFrame(() => {
      input.setSelectionRange(input.value.length, input.value.length);
      if (window.HW_VKBD) window.HW_VKBD.refresh();
    });
  }

  termEl.addEventListener('mouseup', () => {
    if (!window.getSelection().toString()) input.focus({ preventScroll: true });
  });

  // --- タブ補完 ---
  const COMMAND_NAMES = ['cat', 'cd', 'clear', 'code', 'cp', 'date', 'echo', 'exit', 'gcc', 'help', 'history', 'java', 'javac', 'ls', 'mv', 'nano', 'pwd', 'python3', 'rm', 'touch', 'vim', 'whoami'];
  function complete() {
    const v = input.value.slice(0, input.selectionStart);
    const rest = input.value.slice(input.selectionStart);
    const m = /(\S*)$/.exec(v);
    const word = m[1];
    const isFirst = !v.slice(0, v.length - word.length).trim();
    let cands;
    if (isFirst && !word.startsWith('./')) cands = COMMAND_NAMES.filter(c => c.startsWith(word)).map(c => c + ' ');
    else {
      const prefix = word.startsWith('./') ? './' : '';
      const w = word.slice(prefix.length);
      cands = [...state.files.keys()].sort().filter(f => f.startsWith(w)).map(f => prefix + f + ' ');
    }
    if (!cands.length) return;
    let common = cands[0];
    for (const c of cands) { let i = 0; while (i < common.length && common[i] === c[i]) i++; common = common.slice(0, i); }
    if (common.length > word.length) {
      input.value = v.slice(0, v.length - word.length) + common + rest;
      const pos = v.length - word.length + common.length;
      input.setSelectionRange(pos, pos);
    } else if (cands.length > 1) {
      writeHTMLLine(PROMPT_HTML + esc(input.value));
      writeln(cands.map(c => c.trim()).join('  '));
      renderPrompt();
    }
  }

  // --- コマンド解析 ---
  function shellSplit(line) {
    const args = [];
    let cur = '', inArg = false, q = null;
    let redirect = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === q) q = null;
        else if (c === '\\' && q === '"' && (line[i + 1] === '"' || line[i + 1] === '\\')) { cur += line[++i]; }
        else cur += c;
        continue;
      }
      if (c === "'" || c === '"') { q = c; inArg = true; continue; }
      if (c === '\\' && i + 1 < line.length) { cur += line[++i]; inArg = true; continue; }
      if (c === ' ' || c === '\t') { if (inArg) { args.push(cur); cur = ''; inArg = false; } continue; }
      if (c === '>' && !redirect) {
        if (inArg) { args.push(cur); cur = ''; inArg = false; }
        const append = line[i + 1] === '>';
        if (append) i++;
        redirect = { append, argIndex: args.length };
        continue;
      }
      cur += c;
      inArg = true;
    }
    if (q) return { error: `bash: unexpected EOF while looking for matching \`${q}'` };
    if (inArg) args.push(cur);
    if (redirect) {
      const target = args[redirect.argIndex];
      if (target === undefined) return { error: "bash: syntax error near unexpected token `newline'" };
      args.splice(redirect.argIndex, 1);
      redirect.target = target;
    }
    return { args, redirect };
  }

  function runLine(line) {
    // ; で複数コマンド
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.includes('&&') || /;(?=(?:[^"']|"[^"]*"|'[^']*')*$)/.test(trimmed)) {
      const parts = trimmed.split(/\s*(&&|;)\s*(?=(?:[^"']|"[^"]*"|'[^']*')*$)/);
      let ok = true;
      for (let i = 0; i < parts.length; i += 2) {
        const sep = parts[i - 1];
        if (sep === '&&' && !ok) continue;
        if (parts[i].trim()) ok = runCommand(parts[i]) === 0;
      }
      return;
    }
    runCommand(trimmed);
  }

  function runCommand(line) {
    const parsed = shellSplit(line);
    if (parsed.error) { writeln(parsed.error); return 2; }
    const { args, redirect } = parsed;
    if (!args.length) return 0;
    const cmd = args[0];
    let captured = '';
    const io = {
      out: text => { if (redirect) captured += text; else write(text); },
      err: (text, style) => writeErr(text, style),
    };
    let code;
    if (cmd.startsWith('./') || cmd.startsWith('/') || cmd.startsWith('~/')) code = runPath(cmd, args.slice(1), io);
    else if (COMMANDS[cmd]) code = COMMANDS[cmd](args.slice(1), io);
    else if (/[Ａ-Ｚａ-ｚ０-９　]/.test(cmd)) { io.err(`${cmd}: command not found\n`); writeln('# 全角文字が入っています。半角で入力してください', 't-hint'); code = 127; }
    else if (cmd === 'python') {
      io.err("Command 'python' not found, did you mean:\n  command 'python3' from deb python3\n  command 'python' from deb python-is-python3\n");
      code = 127;
    } else if (state.files.has(cmd) && state.files.get(cmd).kind === 'exec') {
      io.err(`${cmd}: command not found\n`);
      writeln(`# カレントディレクトリのファイルを実行するときは ./${cmd} と書きます`, 't-hint');
      code = 127;
    } else {
      io.err(`${cmd}: command not found\n`);
      code = 127;
    }
    if (redirect) {
      const name = normPath(redirect.target);
      if (name === null) { writeln(`bash: ${redirect.target}: No such file or directory`); return 1; }
      const f = state.files.get(name);
      if (f && f.kind !== 'text') { f.kind = 'text'; f.content = ''; }
      const content = (redirect.append && f ? f.content : '') + captured;
      setFile(name, content);
    }
    return code;
  }

  function normPath(p) {
    p = p.replace(/^\.\//, '').replace(new RegExp('^' + HOME + '/'), '').replace(/^~\/project\//, '');
    if (!p || p.includes('/')) return null;
    return p;
  }

  function setFile(name, content) {
    const f = state.files.get(name);
    if (f) { f.kind = 'text'; f.content = content; f.mtime = new Date(); delete f.program; }
    else state.files.set(name, { kind: 'text', content, mtime: new Date() });
    if (state.active === name) loadActiveIntoEditor();
    renderEditor();
  }

  function createFile(name, open) {
    if (!state.files.has(name)) state.files.set(name, { kind: 'text', content: '', mtime: new Date() });
    else state.files.get(name).mtime = new Date();
    if (open) openFile(name);
    else renderEditor();
  }

  function fileSize(f) {
    if (f.kind === 'text') return new TextEncoder().encode(f.content).length;
    if (f.kind === 'class') return 415;
    return 15960;
  }

  // --- 各コマンド ---
  const COMMANDS = {
    help(args, io) {
      const lang = state.lang;
      let s = '使えるコマンド:\n';
      s += '  touch <ファイル名>        空のファイルを作る\n';
      s += '  ls                        ファイルの一覧を表示\n';
      s += '  cat <ファイル名>          ファイルの中身を表示\n';
      s += '  rm <ファイル名>           ファイルを削除\n';
      s += '  mv <元の名前> <新しい名前> ファイル名を変更\n';
      s += '  code <ファイル名>         エディタで開く\n';
      s += '  clear                     画面をきれいにする\n';
      if (lang === 'python') {
        s += '  python3 <ファイル名.py>   Python プログラムを実行\n';
      } else if (lang === 'java') {
        s += '  javac <クラス名.java>     Java ファイルをコンパイル (.class ができる)\n';
        s += '  java <クラス名>           コンパイルしたクラスを実行\n';
      } else {
        s += '  gcc <ファイル名.c>        C ファイルをコンパイル (a.out ができる)\n';
        s += '  gcc <ファイル名.c> -o <名前>  名前をつけてコンパイル\n';
        s += '  ./<実行ファイル名>        コンパイルしたプログラムを実行\n';
      }
      s += '\n手順: ターミナルでファイルを作る → エディタで書く → ターミナルで実行\n';
      io.out(s);
      return 0;
    },
    ls(args, io) {
      const flags = args.filter(a => a.startsWith('-')).join('');
      const targets = args.filter(a => !a.startsWith('-'));
      let names = [...state.files.keys()].sort((a, b) => a.localeCompare(b));
      if (targets.length) {
        const missing = targets.filter(t => !state.files.has(normPath(t) || ''));
        missing.forEach(t => io.err(`ls: cannot access '${t}': No such file or directory\n`));
        names = targets.map(normPath).filter(n => n && state.files.has(n));
        if (!names.length) return 2;
      }
      const fmtName = n => {
        const f = state.files.get(n);
        return f.kind === 'exec' ? `<span class="t-exec">${esc(n)}</span>` : esc(n);
      };
      if (flags.includes('l')) {
        if (!targets.length) writeHTMLLine(`total ${names.length * 4}`);
        const list = flags.includes('a') && !targets.length ? ['.', '..', ...names] : names;
        for (const n of list) {
          const f = state.files.get(n);
          const perm = !f ? 'drwxr-xr-x' : f.kind === 'exec' ? '-rwxr-xr-x' : '-rw-r--r--';
          const size = f ? fileSize(f) : 4096;
          const d = (f && f.mtime) || new Date();
          const mon = d.toLocaleString('en-US', { month: 'short' });
          const time = `${mon} ${String(d.getDate()).padStart(2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          const nameHTML = f ? fmtName(n) : `<span class="t-dir">${n}</span>`;
          writeHTMLLine(`${perm} 1 user user ${String(size).padStart(5)} ${time} ${nameHTML}`);
        }
        return 0;
      }
      const list = flags.includes('a') && !targets.length ? ['.', '..', ...names] : names;
      if (list.length) writeHTMLLine(list.map(n => (state.files.has(n) ? fmtName(n) : `<span class="t-dir">${n}</span>`)).join('  '));
      return 0;
    },
    touch(args, io) {
      const names = args.filter(a => !a.startsWith('-'));
      if (!names.length) { io.err("touch: missing file operand\nTry 'touch --help' for more information.\n"); return 1; }
      let code = 0;
      names.forEach((raw, i) => {
        const n = normPath(raw);
        if (n === null) { io.err(`touch: cannot touch '${raw}': No such file or directory\n`); code = 1; return; }
        createFile(n, i === names.length - 1);
      });
      return code;
    },
    cat(args, io) {
      if (!args.length) { io.err('# cat の後にファイル名を指定してください\n'); return 1; }
      let code = 0;
      for (const raw of args) {
        const n = normPath(raw);
        const f = n && state.files.get(n);
        if (!f) { io.err(`cat: ${raw}: No such file or directory\n`); code = 1; continue; }
        if (f.kind === 'text') io.out(f.content);
        else io.out(f.kind === 'class' ? '����\u0000\u0000\u0000A\u0000\u001d\n\u0000\u0002\u0000\u0003\u0007\u0000\u0004java/lang/Object<init>()V' : '\u007fELF\u0002\u0001\u0001\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0003\u0000>\u0000\u0001\u0000\u0000\u0000`\u0010\u0000\u0000@\u0000');
      }
      return code;
    },
    rm(args, io) {
      const names = args.filter(a => !a.startsWith('-'));
      if (!names.length) { io.err("rm: missing operand\nTry 'rm --help' for more information.\n"); return 1; }
      let code = 0;
      for (const raw of names) {
        const n = normPath(raw);
        if (!n || !state.files.has(n)) { io.err(`rm: cannot remove '${raw}': No such file or directory\n`); code = 1; continue; }
        state.files.delete(n);
        closeTab(n, true);
      }
      renderEditor();
      return code;
    },
    mv(args, io) {
      const a = args.filter(x => !x.startsWith('-'));
      if (a.length < 2) { io.err(a.length ? `mv: missing destination file operand after '${a[0]}'\n` : 'mv: missing file operand\n'); return 1; }
      const src = normPath(a[0]), dst = normPath(a[1]);
      if (!src || !state.files.has(src)) { io.err(`mv: cannot stat '${a[0]}': No such file or directory\n`); return 1; }
      if (!dst) { io.err(`mv: cannot move '${a[0]}' to '${a[1]}': No such file or directory\n`); return 1; }
      if (src === dst) { io.err(`mv: '${a[0]}' and '${a[1]}' are the same file\n`); return 1; }
      const f = state.files.get(src);
      state.files.delete(src);
      state.files.delete(dst);
      closeTab(dst, true);
      state.files.set(dst, f);
      state.tabs = state.tabs.map(t => (t === src ? dst : t));
      if (state.active === src) { state.active = dst; loadActiveIntoEditor(); }
      renderEditor();
      return 0;
    },
    cp(args, io) {
      const a = args.filter(x => !x.startsWith('-'));
      if (a.length < 2) { io.err('cp: missing file operand\n'); return 1; }
      const src = normPath(a[0]), dst = normPath(a[1]);
      if (!src || !state.files.has(src)) { io.err(`cp: cannot stat '${a[0]}': No such file or directory\n`); return 1; }
      if (!dst) { io.err(`cp: cannot create regular file '${a[1]}': No such file or directory\n`); return 1; }
      state.files.set(dst, { ...state.files.get(src), mtime: new Date() });
      if (state.active === dst) loadActiveIntoEditor();
      renderEditor();
      return 0;
    },
    echo(args, io) {
      let nl = true;
      if (args[0] === '-n') { nl = false; args = args.slice(1); }
      io.out(args.join(' ') + (nl ? '\n' : ''));
      return 0;
    },
    clear() { termOut.innerHTML = ''; state.pending = ''; return 0; },
    pwd(args, io) { io.out(HOME + '\n'); return 0; },
    cd(args, io) {
      const t = args[0];
      if (!t || t === '~' || t === '.' || t === HOME || t === '~/project') return 0;
      if (state.files.has(normPath(t) || '')) { io.err(`bash: cd: ${t}: Not a directory\n`); return 1; }
      io.err(`bash: cd: ${t}: No such file or directory\n`);
      writeln('# このアプリでは ~/project の中だけで作業します', 't-hint');
      return 1;
    },
    whoami(args, io) { io.out('user\n'); return 0; },
    date(args, io) { io.out(new Date().toString().replace(/ GMT.*/, '') + '\n'); return 0; },
    history(args, io) { io.out(state.history.map((h, i) => `${String(i + 1).padStart(5)}  ${h}\n`).join('')); return 0; },
    exit() { goHome(); return 0; },
    code(args, io) { return openInEditor(args, io); },
    nano(args, io) { writeln('# このアプリではエディタ画面で編集します', 't-hint'); return openInEditor(args, io); },
    vim(args, io) { writeln('# このアプリではエディタ画面で編集します', 't-hint'); return openInEditor(args, io); },
    vi(args, io) { return COMMANDS.vim(args, io); },
    uname(args, io) { io.out(args.includes('-a') ? 'Linux helloworld 6.8.0-45-generic #45-Ubuntu SMP PREEMPT_DYNAMIC x86_64 x86_64 x86_64 GNU/Linux\n' : 'Linux\n'); return 0; },
    mkdir(args, io) { io.err('# このアプリではフォルダは作らずに ~/project の中で作業しましょう\n'); return 1; },
    chmod(args, io) { return 0; },
    sudo(args, io) { io.err('[sudo] password for user: \nSorry, try again.\nsudo: 1 incorrect password attempt\n'); return 1; },

    // ---- Python ----
    python3(args, io) {
      if (args[0] === '--version' || args[0] === '-V') { io.out('Python 3.12.3\n'); return 0; }
      const file = args.find(a => !a.startsWith('-'));
      if (!file) {
        io.out('Python 3.12.3 (main, Sep 11 2024, 14:17:37) [GCC 13.2.0] on linux\nType "help", "copyright", "credits" or "license" for more information.\n');
        writeln('# このアプリでは対話モードは使えません。python3 ファイル名.py のように実行してください', 't-hint');
        return 0;
      }
      const n = normPath(file);
      const f = n && state.files.get(n);
      if (!f) { io.err(`python3: can't open file '${HOME}/${file.replace(/^\.\//, '')}': [Errno 2] No such file or directory\n`); return 2; }
      if (f.kind !== 'text') {
        io.err(`SyntaxError: source code cannot contain null bytes\n`);
        return 1;
      }
      const r = HW.pyRun(f.content, n);
      io.out(r.out);
      io.err(r.err);
      checkSuccess('python', r);
      return r.code;
    },

    // ---- Java ----
    javac(args, io) {
      const usage = 'Usage: javac <options> <source files>\nuse --help for a list of possible options\n';
      if (args[0] === '-version' || args[0] === '--version') { io.out('javac 21.0.4\n'); return 0; }
      if (!args.length) { io.err(usage); return 2; }
      for (const a of args) {
        if (a.startsWith('-')) continue;
        if (!a.endsWith('.java')) { io.err(`error: invalid flag: ${a}\n${usage}`); return 2; }
        const n = normPath(a);
        if (!n || !state.files.has(n)) { io.err(`error: file not found: ${a}\n${usage}`); return 2; }
      }
      const files = args.filter(a => !a.startsWith('-')).map(normPath);
      for (const n of files) {
        const f = state.files.get(n);
        const r = HW.javaCompile(f.kind === 'text' ? f.content : '\u0000', n);
        if (!r.ok) { io.err(r.err); return 1; }
        for (const cls of r.classes) {
          state.files.set(`${cls.name}.class`, { kind: 'class', classes: r.classes, className: cls.name, source: n, mtime: new Date() });
        }
      }
      renderEditor();
      return 0;
    },
    java(args, io) {
      if (args[0] === '-version' || args[0] === '--version') {
        io.err('openjdk version "21.0.4" 2024-07-16\nOpenJDK Runtime Environment (build 21.0.4+7-Ubuntu-1ubuntu224.04)\nOpenJDK 64-Bit Server VM (build 21.0.4+7-Ubuntu-1ubuntu224.04, mixed mode, sharing)\n');
        return 0;
      }
      const target = args.find(a => !a.startsWith('-'));
      if (!target) {
        io.err('Usage: java [options] <mainclass> [args...]\n           (to execute a class)\n   or  java [options] -jar <jarfile> [args...]\n           (to execute a jar file)\n   or  java [options] <sourcefile> [args]\n           (to execute a single source-file program)\n');
        return 1;
      }
      if (target.endsWith('.java')) {
        const n = normPath(target);
        const f = n && state.files.get(n);
        if (!f) { io.err(`error: file not found: ${target}\n`); return 1; }
        const r = HW.javaCompile(f.content, n);
        if (!r.ok) { io.err(r.err.replace(/1 error\n$/, '') + 'error: compilation failed\n'); return 1; }
        const first = r.classes[0];
        if (!first) { io.err(`error: no class declared in source file\n`); return 1; }
        const res = HW.javaRun(r.classes, first.name, n);
        io.out(res.out);
        io.err(res.err);
        checkSuccess('java', res);
        return res.code;
      }
      const clsName = target.replace(/^\.\//, '');
      const f = state.files.get(`${clsName}.class`);
      if (!f || clsName.includes('.')) {
        io.err(`Error: Could not find or load main class ${clsName}\nCaused by: java.lang.ClassNotFoundException: ${clsName}\n`);
        if (clsName.endsWith('.class')) writeln('# java コマンドには .class を付けずにクラス名だけを指定します', 't-hint');
        return 1;
      }
      const r = HW.javaRun(f.classes, clsName, f.source);
      io.out(r.out);
      io.err(r.err);
      checkSuccess('java', r);
      return r.code;
    },

    // ---- C ----
    gcc(args, io) { return compileC('gcc', args, io); },
    cc(args, io) { return compileC('cc', args, io); },
  };

  function openInEditor(args, io) {
    const raw = args.find(a => !a.startsWith('-'));
    if (!raw) { focusEditor(); return 0; }
    const n = normPath(raw);
    if (!n) { io.err(`# ${raw} は開けません\n`); return 1; }
    createFile(n, true);
    return 0;
  }

  function compileC(prog, args, io) {
    if (args[0] === '--version') {
      io.out(`${prog} (Ubuntu 13.2.0-23ubuntu4) 13.2.0\nCopyright (C) 2023 Free Software Foundation, Inc.\nThis is free software; see the source for copying conditions.  There is NO\nwarranty; not even for MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.\n`);
      return 0;
    }
    let out = 'a.out';
    const inputs = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-o') {
        if (i + 1 >= args.length) { io.err(`${prog}: error: missing filename after ‘-o’\n`, 'gcc'); return 1; }
        out = args[++i];
      } else if (a.startsWith('-o')) out = a.slice(2);
      else if (a.startsWith('-')) continue;
      else inputs.push(a);
    }
    if (!inputs.length) { io.err(`${prog}: fatal error: no input files\ncompilation terminated.\n`, 'gcc'); return 1; }
    const outName = normPath(out);
    for (const a of inputs) {
      const n = normPath(a);
      if (!n || !state.files.has(n)) {
        io.err(`${prog}: error: ${a}: No such file or directory\n${prog}: fatal error: no input files\ncompilation terminated.\n`, 'gcc');
        return 1;
      }
      if (n === outName) {
        io.err(`${prog}: fatal error: input file ‘${a}’ is the same as output file\ncompilation terminated.\n`, 'gcc');
        return 1;
      }
    }
    const src = inputs.map(normPath);
    const cFile = src.find(n => n.endsWith('.c'));
    const other = src.find(n => !n.endsWith('.c'));
    if (other) {
      const f = state.files.get(other);
      if (f.kind === 'exec') io.err(`/usr/bin/ld: ${other}: in function \`_start':\n(.text+0x0): multiple definition of \`_start'\ncollect2: error: ld returned 1 exit status\n`, 'gcc');
      else io.err(`/usr/bin/ld:${other}: file format not recognized; treating as linker script\n/usr/bin/ld:${other}:1: syntax error\ncollect2: error: ld returned 1 exit status\n`, 'gcc');
      return 1;
    }
    const f = state.files.get(cFile);
    const r = HW.cCompile(f.content, cFile);
    if (r.err) io.err(r.err, 'gcc');
    if (!r.ok) return 1;
    if (!outName) { io.err(`/usr/bin/ld: cannot open output file ${out}: No such file or directory\ncollect2: error: ld returned 1 exit status\n`, 'gcc'); return 1; }
    const existing = state.files.get(outName);
    state.files.set(outName, { kind: 'exec', program: r.program, lang: 'c', mtime: new Date() });
    if (existing && existing.kind === 'text') { closeTab(outName, true); }
    renderEditor();
    return 0;
  }

  function runPath(cmd, args, io) {
    const n = normPath(cmd);
    const f = n && state.files.get(n);
    if (!f) { io.err(`bash: ${cmd}: No such file or directory\n`); return 127; }
    if (f.kind !== 'exec') { io.err(`bash: ${cmd}: Permission denied\n`); return 126; }
    const r = HW.cRun(f.program);
    io.out(r.out);
    if (r.err) io.err(r.err);
    checkSuccess('c', r);
    return r.code;
  }

  // ---------------------------------------------------------------------
  // 正解判定
  // ---------------------------------------------------------------------
  function isHelloWorld(out) {
    const s = out.replace(/\r/g, '').trim();
    return /^hello[\s,、]*world[!！.]?$/i.test(s);
  }
  function checkSuccess(lang, r) {
    if (lang !== state.lang) return;
    if (!isHelloWorld(r.out) || /Segmentation fault|Exception/.test(r.err || '')) return;
    if (!state.solved) {
      state.solved = true;
      state.time = stopTimer();
      const best = loadBest();
      state.newRecord = !best[lang] || state.time < best[lang];
      if (state.newRecord) { best[lang] = state.time; saveBest(best); }
      state.best = best[lang];
    }
    setTimeout(() => {
      $('success-overlay').hidden = false;
      $('success-time').textContent = fmtTime(state.time);
      $('success-best').innerHTML = state.newRecord ? '<span class="new-record">NEW RECORD!</span>' : `BEST ${fmtTime(state.best)}`;
      // アニメーションを毎回再生する
      const box = document.querySelector('.success-box');
      box.replaceWith(box.cloneNode(true));
      $('again-btn').addEventListener('click', () => { hideSuccess(); startLang(state.lang); });
      $('other-btn').addEventListener('click', () => { hideSuccess(); goHome(); });
    }, 350);
  }
  function hideSuccess() { $('success-overlay').hidden = true; }

  // ---------------------------------------------------------------------
  // エディタ
  // ---------------------------------------------------------------------
  const ta = $('code-input');
  const hl = $('code-highlight');
  const gutter = $('gutter');
  const codeWrap = $('code-wrap');
  const emptyEl = $('editor-empty');

  function fileIcon(name) {
    const f = state.files.get(name);
    const ext = extOf(name);
    if (f && f.kind === 'exec') return '<span class="ficon bin">⚙</span>';
    const map = { py: ['py', 'py'], java: ['java', 'J'], c: ['c', 'C'], h: ['c', 'h'], class: ['class', '☕'] };
    const [cls, label] = map[ext] || ['txt', '≡'];
    return `<span class="ficon ${cls}">${label}</span>`;
  }

  function renderEditor() {
    // タブ
    state.tabs = state.tabs.filter(t => state.files.has(t));
    if (state.active && !state.files.has(state.active)) state.active = state.tabs[state.tabs.length - 1] || null;
    const bar = $('tab-bar');
    bar.innerHTML = '';
    state.tabs.forEach(name => {
      const tab = document.createElement('div');
      tab.className = 'tab' + (name === state.active ? ' active' : '');
      tab.innerHTML = fileIcon(name) + `<span>${esc(name)}</span><span class="close" title="閉じる">×</span>`;
      tab.addEventListener('click', e => {
        if (e.target.classList.contains('close')) { closeTab(name); return; }
        openFile(name);
      });
      bar.appendChild(tab);
    });
    $('breadcrumbs').textContent = state.active ? `project › ${state.active}` : '';
    $('editor-title').textContent = state.active ? `${state.active} - project - Visual Studio Code` : 'project - Visual Studio Code';

    const f = state.active && state.files.get(state.active);
    if (!f) {
      codeWrap.hidden = true;
      emptyEl.hidden = false;
      emptyEl.innerHTML = '<svg viewBox="0 0 24 24" width="64" height="64"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6" fill="none" stroke="currentColor" stroke-width="1"/></svg><p>ファイルが開かれていません</p><p class="dim">ターミナルでファイルを作成すると、ここに表示されます</p>';
      $('sb-pos').textContent = '';
      $('sb-lang').textContent = '';
    } else if (f.kind !== 'text') {
      codeWrap.hidden = true;
      emptyEl.hidden = false;
      emptyEl.innerHTML = '<p>このファイルはバイナリであるか、サポートされていないテキスト エンコードを使用しているため、エディターに表示されません。</p><p class="dim">(コンパイルで作られたファイルです。ターミナルから実行しましょう)</p>';
      $('sb-pos').textContent = '';
      $('sb-lang').textContent = '';
    } else {
      emptyEl.hidden = true;
      codeWrap.hidden = false;
      $('sb-lang').textContent = langLabelOf(state.active);
      updateHighlight();
      updatePos();
    }
  }

  function openFile(name) {
    if (!state.tabs.includes(name)) state.tabs.push(name);
    const changed = state.active !== name;
    state.active = name;
    if (changed) loadActiveIntoEditor();
    renderEditor();
    // スマホではファイルを開いたらエディタに入力先を切り替える
    if (window.HW_VKBD && state.files.get(name).kind === 'text') setTimeout(() => window.HW_VKBD.setTarget('editor'), 0);
  }
  function closeTab(name, silent) {
    state.tabs = state.tabs.filter(t => t !== name);
    if (state.active === name) {
      state.active = state.tabs[state.tabs.length - 1] || null;
      loadActiveIntoEditor();
    }
    if (!silent) renderEditor();
  }
  function loadActiveIntoEditor() {
    const f = state.active && state.files.get(state.active);
    ta.value = f && f.kind === 'text' ? f.content : '';
    ta.scrollTop = 0;
    ta.scrollLeft = 0;
    ta.setSelectionRange(0, 0);
    if (window.HW_VKBD) window.HW_VKBD.refresh();
  }
  function focusEditor() {
    if (window.HW_VKBD) { window.HW_VKBD.setTarget('editor'); return; }
    if (!codeWrap.hidden) ta.focus();
  }

  function updateHighlight() {
    const key = state.active ? hlKeyOf(state.active) : null;
    const code = ta.value;
    const html = key ? HW.highlight[key](code) : esc(code);
    hl.innerHTML = html + '\n';
    const lines = code.split('\n').length;
    const cur = code.slice(0, ta.selectionStart).split('\n').length;
    let g = '';
    for (let i = 1; i <= lines; i++) g += `<div${i === cur ? ' class="cur"' : ''}>${i}</div>`;
    gutter.innerHTML = g + '<div style="height:60px"></div>';
    syncScroll();
  }
  function syncScroll() {
    hl.scrollTop = ta.scrollTop;
    hl.scrollLeft = ta.scrollLeft;
    gutter.scrollTop = ta.scrollTop;
  }
  function updatePos() {
    const before = ta.value.slice(0, ta.selectionStart);
    const ln = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    $('sb-pos').textContent = `行 ${ln}、列 ${col}`;
    gutter.querySelectorAll('div').forEach((d, i) => d.classList.toggle('cur', i + 1 === ln));
  }

  ta.addEventListener('input', () => {
    const f = state.active && state.files.get(state.active);
    if (f && f.kind === 'text') { f.content = ta.value; f.mtime = new Date(); }
    updateHighlight();
    updatePos();
  });
  ta.addEventListener('scroll', syncScroll);
  ['keyup', 'click', 'select'].forEach(ev => ta.addEventListener(ev, updatePos));

  function insertText(text) { insertInto(ta, text); }
  // 指定した要素に文字を挿入する (フォーカスが別の場所にあっても対象に入る)
  function insertInto(el, text) {
    let ok = false;
    if (document.activeElement === el && !window.HW_VKBD) {
      try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
    }
    if (!ok) {
      el.setRangeText(text, el.selectionStart, el.selectionEnd, 'end');
      el.dispatchEvent(new Event('input'));
    }
  }

  const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };
  ta.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const m = /^ {1,4}|^\t/.exec(v.slice(ls));
        if (m) {
          ta.setSelectionRange(ls, ls + m[0].length);
          insertText('');
          const ns = Math.max(ls, s - m[0].length);
          ta.setSelectionRange(ns, ns);
        }
      } else insertText('    ');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const indent = /^[ \t]*/.exec(v.slice(ls, s))[0];
      const before = v.slice(ls, s).trimEnd().slice(-1);
      const after = v[en];
      const lang = hlKeyOf(state.active || '');
      const opens = before === '{' || (lang === 'py' && before === ':') || (before === '(' && after === ')');
      if (opens && PAIRS[before] && after === PAIRS[before]) {
        insertText('\n' + indent + '    \n' + indent);
        const pos = s + 1 + indent.length + 4;
        ta.setSelectionRange(pos, pos);
      } else {
        insertText('\n' + indent + (opens ? '    ' : ''));
      }
      return;
    }
    if (e.key === 'Backspace' && s === en && s > 0 && PAIRS[v[s - 1]] && v[s] === PAIRS[v[s - 1]]) {
      e.preventDefault();
      ta.setSelectionRange(s - 1, s + 1);
      insertText('');
      return;
    }
    if (e.key.length !== 1) return;
    // 閉じ括弧の上書き
    if (s === en && (e.key === ')' || e.key === ']' || e.key === '}' || e.key === '"' || e.key === "'") && v[s] === e.key) {
      e.preventDefault();
      ta.setSelectionRange(s + 1, s + 1);
      updatePos();
      return;
    }
    // } の自動インデント戻し
    if (e.key === '}') {
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const lineBefore = v.slice(ls, s);
      if (s === en && /^ {4,}$/.test(lineBefore)) {
        e.preventDefault();
        ta.setSelectionRange(s - 4, s);
        insertText('}');
        return;
      }
    }
    // 括弧・クォートの自動補完
    if (PAIRS[e.key] && s === en) {
      const next = v[s] || '';
      const prev = v[s - 1] || '';
      const isQuote = e.key === '"' || e.key === "'";
      if (/^$|[\s)\]};,]/.test(next) && !(isQuote && /[\w"']/.test(prev))) {
        e.preventDefault();
        insertText(e.key + PAIRS[e.key]);
        ta.setSelectionRange(s + 1, s + 1);
        updatePos();
      }
    }
  });

  // キーボードショートカット: Ctrl+` でターミナルへ
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === '`') { e.preventDefault(); input.focus(); }
  });

  // Service worker は使わない (常に最新版を表示するため)

  // ---------------------------------------------------------------------
  // 入力は半角英数字・記号のみ (全角や日本語入力を取り除く)
  // ---------------------------------------------------------------------
  function stripNonAscii(el) {
    if (!/[^\x00-\x7F]/.test(el.value)) return;
    const pos = el.selectionStart;
    const before = el.value.slice(0, pos).replace(/[^\x00-\x7F]/g, '');
    el.value = before + el.value.slice(pos).replace(/[^\x00-\x7F]/g, '');
    el.setSelectionRange(before.length, before.length);
    el.dispatchEvent(new Event('input'));
  }
  [ta, input].forEach(el => {
    el.addEventListener('beforeinput', e => {
      if (e.data && /[^\x00-\x7F]/.test(e.data) && e.cancelable && !e.isComposing) e.preventDefault();
    });
    el.addEventListener('compositionend', () => setTimeout(() => stripNonAscii(el), 0));
    el.addEventListener('input', e => { if (!e.isComposing) stripNonAscii(el); });
  });

  // ---------------------------------------------------------------------
  // スマホ用キーボード (タッチ端末のみ)
  // ---------------------------------------------------------------------
  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (isTouch) setupVirtualKeyboard();

  function setupVirtualKeyboard() {
    const kb = $('vkbd');
    const keysEl = $('vk-keys');
    const work = $('work-screen');
    kb.hidden = false;
    work.classList.add('has-vkbd');
    document.body.classList.add('vkbd-on');
    // OS のキーボードを出さない
    ta.setAttribute('inputmode', 'none');
    input.setAttribute('inputmode', 'none');

    let target = 'terminal';
    let layer = 'abc';
    let shift = 0; // 0: off, 1: 1文字だけ, 2: caps lock
    let lastShiftTap = 0;

    const LAYERS = {
      abc: [
        'qwertyuiop'.split(''),
        'asdfghjkl'.split(''),
        ['{shift}', ...'zxcvbnm'.split(''), '{bs}'],
        ['{123}', '{undo}', '{space}', '{redo}', '.', '{enter}'],
      ],
      '123': [
        '1234567890'.split(''),
        ['(', ')', '{', '}', '[', ']', '"', "'", ';', ':'],
        ['{sym}', '.', ',', '=', '+', '-', '*', '/', '{bs}'],
        ['{abc}', '{undo}', '{space}', '{redo}', '_', '{enter}'],
      ],
      sym: [
        ['<', '>', '\\', '|', '&', '!', '?', '%', '$', '@'],
        ['#', '^', '~', '`', '(', ')', '"', "'", ';', ':'],
        ['{123}', '.', ',', '=', '+', '-', '*', '/', '{bs}'],
        ['{abc}', '{undo}', '{space}', '{redo}', '_', '{enter}'],
      ],
    };
    const LABEL = { '{shift}': '⇧', '{bs}': '⌫', '{123}': '123', '{abc}': 'ABC', '{sym}': '#+=', '{space}': 'space', '{enter}': 'return', '{undo}': '↶', '{redo}': '↷' };

    function render() {
      keysEl.innerHTML = '';
      for (const row of LAYERS[layer]) {
        const r = document.createElement('div');
        r.className = 'vk-row';
        for (const k of row) {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'vk-key';
          b.dataset.k = k;
          if (k.length > 1 && k.startsWith('{')) {
            b.textContent = LABEL[k];
            b.classList.add(k === '{space}' ? 'space' : k === '{enter}' ? 'enter' : (k === '{undo}' || k === '{redo}') ? 'hist' : 'fn');
            if (k === '{undo}') b.setAttribute('aria-label', 'Undo');
            if (k === '{redo}') b.setAttribute('aria-label', 'Redo');
            if (k === '{shift}' && shift) b.classList.add(shift === 2 ? 'caps' : 'on');
          } else {
            b.textContent = layer === 'abc' && shift ? k.toUpperCase() : k;
          }
          r.appendChild(b);
        }
        keysEl.appendChild(r);
      }
    }

    function el() { return target === 'editor' ? ta : input; }
    // 入力先の切り替え。iOS ではプログラムからの focus が効かないことがあるため、
    // フォーカスには頼らず、キー入力は直接対象の要素に書き込む。
    function setTarget(t) {
      target = t;
      work.classList.toggle('target-editor', t === 'editor');
      work.classList.toggle('target-terminal', t === 'terminal');
      kb.querySelectorAll('.vk-tgt').forEach(b => b.classList.toggle('active', b.dataset.target === t));
      const other = t === 'editor' ? input : ta;
      if (document.activeElement === other) other.blur();
      requestAnimationFrame(() => { scrollBottom(); refreshCarets(); });
    }
    window.HW_VKBD = { setTarget, refresh: () => refreshCarets() };

    // --- 自前のカーソル表示 ---
    const mirror = document.createElement('span');
    mirror.className = 'term-mirror';
    input.parentNode.appendChild(mirror);
    const fakeCaret = document.createElement('div');
    fakeCaret.className = 'fake-caret';
    $('code-scroll').appendChild(fakeCaret);
    let charW = 0;
    function measureChar() {
      const m = document.createElement('span');
      m.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit';
      m.textContent = 'M'.repeat(20);
      codeWrap.appendChild(m);
      charW = m.getBoundingClientRect().width / 20;
      m.remove();
    }
    function refreshCarets() {
      // ターミナル
      const v = input.value, p = input.selectionStart == null ? v.length : input.selectionStart;
      const showT = target === 'terminal';
      mirror.innerHTML = esc(v.slice(0, p)) +
        (showT ? `<span class="caret-block">${esc(v[p] || ' ')}</span>` + esc(v.slice(p + 1)) : esc(v.slice(p)));
      // エディタ
      if (target === 'editor' && !codeWrap.hidden) {
        if (!charW) measureChar();
        const before = ta.value.slice(0, ta.selectionStart);
        const line = before.split('\n').length - 1;
        const col = before.length - before.lastIndexOf('\n') - 1;
        fakeCaret.style.transform = `translate(${col * charW - ta.scrollLeft}px, ${line * 20 - ta.scrollTop}px)`;
        fakeCaret.hidden = false;
        // アニメーションを先頭から
        fakeCaret.style.animation = 'none';
        void fakeCaret.offsetWidth;
        fakeCaret.style.animation = '';
      } else fakeCaret.hidden = true;
    }
    ['input', 'keyup', 'click', 'select', 'scroll'].forEach(t => ta.addEventListener(t, () => requestAnimationFrame(refreshCarets)));
    ['input', 'keyup', 'click', 'select'].forEach(t => input.addEventListener(t, () => requestAnimationFrame(refreshCarets)));
    document.addEventListener('selectionchange', () => requestAnimationFrame(refreshCarets));
    window.addEventListener('resize', () => { charW = 0; refreshCarets(); });
    function moveVertical(dir) {
      const v = ta.value, s = ta.selectionStart;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const col = s - ls;
      let pos;
      if (dir < 0) {
        if (ls === 0) pos = 0;
        else {
          const pls = v.lastIndexOf('\n', ls - 2) + 1;
          pos = Math.min(pls + col, ls - 1);
        }
      } else {
        const le = v.indexOf('\n', s);
        if (le < 0) pos = v.length;
        else {
          const nle = v.indexOf('\n', le + 1);
          pos = Math.min(le + 1 + col, nle < 0 ? v.length : nle);
        }
      }
      ta.setSelectionRange(pos, pos);
    }
    function keepCaretVisible() {
      if (target !== 'editor') return;
      const v = ta.value, s = ta.selectionStart;
      const line = v.slice(0, s).split('\n').length - 1;
      const lh = 20, top = line * lh;
      if (top < ta.scrollTop) ta.scrollTop = top;
      else if (top + lh > ta.scrollTop + ta.clientHeight - 20) ta.scrollTop = top + lh * 2 - ta.clientHeight + 20;
      const ls = v.lastIndexOf('\n', s - 1) + 1;
      const x = (s - ls) * 8.4;
      if (x < ta.scrollLeft) ta.scrollLeft = Math.max(0, x - 40);
      else if (x > ta.scrollLeft + ta.clientWidth - 30) ta.scrollLeft = x - ta.clientWidth + 60;
      syncScroll();
    }

    // キーを送る: まず既存の keydown ハンドラに渡し、処理されなければ既定動作を行う
    // --- Undo / Redo (エディタはファイルごと、ターミナルは入力行) ---
    const hist = new Map();
    let lastTyping = { key: null, at: 0 };
    const histKey = e => (e === ta ? 'file:' + state.active : 'term');
    function stacks(e) {
      const k = histKey(e);
      if (!hist.has(k)) hist.set(k, { undo: [], redo: [] });
      return hist.get(k);
    }
    const snap = e => ({ v: e.value, s: e.selectionStart, en: e.selectionEnd });
    function restore(e, st) {
      e.value = st.v;
      e.setSelectionRange(st.s, st.en);
      e.dispatchEvent(new Event('input'));
      if (e === ta) { updatePos(); keepCaretVisible(); }
      refreshCarets();
    }
    function undoRedo(which) {
      const e = el();
      if (e === ta && (codeWrap.hidden || !state.active)) return;
      const st = stacks(e);
      const from = which === 'undo' ? st.undo : st.redo;
      const to = which === 'undo' ? st.redo : st.undo;
      if (!from.length) return;
      to.push(snap(e));
      restore(e, from.pop());
      lastTyping = { key: null, at: 0 };
    }

    function press(key) {
      const e = el();
      if (e === ta && (codeWrap.hidden || !state.active)) return; // 開いているファイルが無い
      const before = snap(e);
      const beforeKey = histKey(e);
      pressRaw(e, key);
      if (e === input && key === 'Enter') { hist.delete('term'); return; }
      // 変更があれば履歴に積む (連続した英数字入力は1つにまとめる)
      if (e.value !== before.v && histKey(e) === beforeKey) {
        const st = stacks(e);
        const now = Date.now();
        const isWord = /^\w$/.test(key);
        const merge = isWord && lastTyping.key === 'word' && now - lastTyping.at < 1500 && st.undo.length;
        if (!merge) st.undo.push(before);
        if (st.undo.length > 200) st.undo.shift();
        st.redo.length = 0;
        lastTyping = { key: isWord ? 'word' : key, at: now };
      }
    }
    function pressRaw(e, key) {
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      const notHandled = e.dispatchEvent(ev);
      if (notHandled) {
        const s = e.selectionStart, en = e.selectionEnd;
        if (key.length === 1) insertInto(e, key);
        else if (key === 'Backspace') {
          if (s === en && s > 0) e.setSelectionRange(s - 1, s);
          if (e.selectionStart !== e.selectionEnd) insertInto(e, '');
        } else if (key === 'ArrowLeft') {
          const p = s === en ? Math.max(0, s - 1) : s;
          e.setSelectionRange(p, p);
        } else if (key === 'ArrowRight') {
          const p = s === en ? Math.min(e.value.length, en + 1) : en;
          e.setSelectionRange(p, p);
        } else if (key === 'ArrowUp' || key === 'ArrowDown') {
          if (e === ta) moveVertical(key === 'ArrowUp' ? -1 : 1);
        }
      }
      if (e === ta) { updatePos(); keepCaretVisible(); }
      refreshCarets();
    }

    // フォーカスを奪わないように pointerdown で処理する
    kb.addEventListener('pointerdown', ev => {
      const b = ev.target.closest('button');
      ev.preventDefault();
      if (!b) return;
      if (b.dataset.target) { setTarget(b.dataset.target); return; }
      if (b.dataset.key) { press(b.dataset.key); startRepeat(b.dataset.key); return; }
      const k = b.dataset.k;
      switch (k) {
        case '{shift}': {
          const now = Date.now();
          shift = shift === 0 ? (now - lastShiftTap < 350 ? 2 : 1) : (shift === 1 && now - lastShiftTap < 350 ? 2 : 0);
          lastShiftTap = now;
          render();
          return;
        }
        case '{123}': layer = '123'; render(); return;
        case '{sym}': layer = 'sym'; render(); return;
        case '{abc}': layer = 'abc'; render(); return;
        case '{bs}': press('Backspace'); startRepeat('Backspace'); return;
        case '{space}': press(' '); return;
        case '{enter}': press('Enter'); return;
        case '{undo}': undoRedo('undo'); return;
        case '{redo}': undoRedo('redo'); return;
      }
      const ch = layer === 'abc' && shift ? k.toUpperCase() : k;
      press(ch);
      if (shift === 1) { shift = 0; render(); }
    });
    // 長押しでリピート (矢印・削除)
    let repeatTimer = null;
    function startRepeat(key) {
      stopRepeat();
      repeatTimer = setTimeout(function tick() {
        press(key);
        repeatTimer = setTimeout(tick, 60);
      }, 450);
    }
    function stopRepeat() { clearTimeout(repeatTimer); repeatTimer = null; }
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => kb.addEventListener(t, stopRepeat));
    window.addEventListener('blur', stopRepeat);

    // 画面をタップした方を入力先にする
    $('terminal').addEventListener('pointerdown', () => setTarget('terminal'));
    $('editor-area').addEventListener('pointerdown', () => { if (!codeWrap.hidden) setTarget('editor'); });

    render();
    setTarget('terminal');
  }
})();
