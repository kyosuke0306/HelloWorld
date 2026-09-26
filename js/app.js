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
  const hlKeyOf = name => ({ py: 'py', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', js: 'js', mjs: 'js', rb: 'rb', go: 'go', rs: 'rs', php: 'php' })[extOf(name)] || null;
  const langLabelOf = name => ({ py: 'Python', java: 'Java', c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', js: 'JavaScript', mjs: 'JavaScript', rb: 'Ruby', go: 'Go', rs: 'Rust', php: 'PHP', txt: 'プレーンテキスト', md: 'Markdown' })[extOf(name)] || 'プレーンテキスト';

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
    timerEl.classList.remove('done', 'retired');
    if (typeof resetRetire === 'function') resetRetire();
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
  // スライド形式
  const tutBody = $('tutorial-body');
  const slides = [...tutBody.querySelectorAll('section')];
  const dotsEl = $('tut-dots');
  let slideIdx = 0;
  slides.forEach((sec, i) => {
    sec.classList.add('slide');
    const d = document.createElement('button');
    d.className = 'tut-dot';
    d.setAttribute('aria-label', `${i + 1}`);
    d.addEventListener('click', () => goSlide(i));
    dotsEl.appendChild(d);
  });
  function goSlide(i, dir) {
    i = Math.max(0, Math.min(slides.length - 1, i));
    const from = slideIdx;
    slideIdx = i;
    slides.forEach((sec, k) => {
      sec.classList.toggle('active', k === i);
      sec.classList.remove('in-left', 'in-right');
    });
    if (dir !== 0 && from !== i) slides[i].classList.add(i > from ? 'in-right' : 'in-left');
    [...dotsEl.children].forEach((d, k) => d.classList.toggle('active', k === i));
    $('tut-prev').disabled = i === 0;
    $('tut-next').textContent = i === slides.length - 1 ? 'Close' : 'Next';
    tutBody.scrollTop = 0;
  }
  const closeTutorial = () => { $('tutorial').hidden = true; };
  $('tut-prev').addEventListener('click', () => goSlide(slideIdx - 1));
  $('tut-next').addEventListener('click', () => (slideIdx === slides.length - 1 ? closeTutorial() : goSlide(slideIdx + 1)));
  // スワイプ
  let swipeX = null, swipeY = 0;
  tutBody.addEventListener('pointerdown', e => { swipeX = e.clientX; swipeY = e.clientY; });
  tutBody.addEventListener('pointerup', e => {
    if (swipeX === null) return;
    const dx = e.clientX - swipeX, dy = e.clientY - swipeY;
    swipeX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) goSlide(slideIdx + (dx < 0 ? 1 : -1));
  });
  tutBody.addEventListener('pointercancel', () => { swipeX = null; });
  document.addEventListener('keydown', e => {
    if ($('tutorial').hidden) return;
    if (e.key === 'ArrowRight') goSlide(slideIdx + 1);
    if (e.key === 'ArrowLeft') goSlide(slideIdx - 1);
  });
  $('tutorial-btn').addEventListener('click', () => { goSlide(0, 0); $('tutorial').hidden = false; });
  $('tutorial-close').addEventListener('click', closeTutorial);
  $('tutorial').addEventListener('click', e => { if (e.target === e.currentTarget) closeTutorial(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $('tutorial').hidden = true; });

  // ---------------------------------------------------------------------
  // リタイア (答えを表示)
  // ---------------------------------------------------------------------
  const ANSWERS = {
    python: [
      ['term', 'ファイルを作る', 'touch hello.py'],
      ['code', 'エディタで hello.py に書く', 'print("Hello World")'],
      ['term', '実行する', 'python3 hello.py'],
    ],
    java: [
      ['term', 'ファイルを作る (ファイル名とクラス名を同じにする)', 'touch Hello.java'],
      ['code', 'エディタで Hello.java に書く', 'public class Hello {\n    public static void main(String[] args) {\n        System.out.println("Hello World");\n    }\n}'],
      ['term', 'コンパイルする (Hello.class ができる)', 'javac Hello.java'],
      ['term', '実行する (.class は付けない)', 'java Hello'],
    ],
    c: [
      ['term', 'ファイルを作る', 'touch hello.c'],
      ['code', 'エディタで hello.c に書く', '#include <stdio.h>\n\nint main(void) {\n    printf("Hello World\\n");\n    return 0;\n}'],
      ['term', 'コンパイルする (a.out ができる)', 'gcc hello.c'],
      ['term', '実行する (./ を付ける)', './a.out'],
    ],
    cpp: [
      ['term', 'ファイルを作る', 'touch hello.cpp'],
      ['code', 'エディタで hello.cpp に書く', '#include <iostream>\n\nint main() {\n    std::cout << "Hello World" << std::endl;\n    return 0;\n}'],
      ['term', 'コンパイルする (a.out ができる)', 'g++ hello.cpp'],
      ['term', '実行する (./ を付ける)', './a.out'],
    ],
    javascript: [
      ['term', 'ファイルを作る', 'touch hello.js'],
      ['code', 'エディタで hello.js に書く', 'console.log("Hello World");'],
      ['term', 'Node.js で実行する', 'node hello.js'],
    ],
    ruby: [
      ['term', 'ファイルを作る', 'touch hello.rb'],
      ['code', 'エディタで hello.rb に書く', 'puts "Hello World"'],
      ['term', '実行する', 'ruby hello.rb'],
    ],
    go: [
      ['term', 'ファイルを作る', 'touch hello.go'],
      ['code', 'エディタで hello.go に書く', 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello World")\n}'],
      ['term', 'コンパイルして実行する', 'go run hello.go'],
    ],
    rust: [
      ['term', 'ファイルを作る', 'touch hello.rs'],
      ['code', 'エディタで hello.rs に書く', 'fn main() {\n    println!("Hello World");\n}'],
      ['term', 'コンパイルする (hello ができる)', 'rustc hello.rs'],
      ['term', '実行する (./ を付ける)', './hello'],
    ],
    php: [
      ['term', 'ファイルを作る', 'touch hello.php'],
      ['code', 'エディタで hello.php に書く (<?php から始める)', '<?php\necho "Hello World\\n";'],
      ['term', '実行する', 'php hello.php'],
    ],
  };
  const retireBtn = $('retire-btn');
  let retireArmTimer = 0;
  function resetRetire() {
    clearTimeout(retireArmTimer);
    retireBtn.classList.remove('armed');
    retireBtn.textContent = 'Retire';
  }
  retireBtn.addEventListener('pointerdown', e => e.preventDefault()); // 入力先のフォーカスを奪わない
  retireBtn.addEventListener('click', () => {
    if (state.solved) return;
    if (!retireBtn.classList.contains('armed')) {
      retireBtn.classList.add('armed');
      retireBtn.textContent = 'Sure?';
      retireArmTimer = setTimeout(resetRetire, 3000);
      return;
    }
    resetRetire();
    retire();
  });
  function retire() {
    state.solved = true; // 以降は記録しない
    cancelAnimationFrame(timerRAF);
    timerEl.classList.add('retired');
    const lang = state.lang;
    const hlKey = { python: 'py', java: 'java', c: 'c', cpp: 'cpp', javascript: 'js', ruby: 'rb', go: 'go', rust: 'rs', php: 'php' }[lang];
    $('answer-lang').textContent = HW.langs[lang].label;
    $('answer-body').innerHTML = '<ol class="answer-steps">' + ANSWERS[lang].map(([kind, label, code]) => {
      const where = kind === 'code' ? '<span class="flow-where e">Editor</span>' : '<span class="flow-where t">Terminal</span>';
      const body = kind === 'code' ? HW.highlight[hlKey](code) : `<span class="p-user">$</span> ${esc(code)}`;
      return `<li><div class="answer-step-head">${where}<span>${esc(label)}</span></div><pre class="${kind === 'code' ? 'tut-editor' : 'tut-term'}">${body}</pre></li>`;
    }).join('') + '</ol>';
    $('answer-body').scrollTop = 0;
    $('answer-overlay').hidden = false;
  }
  $('answer-again').addEventListener('click', () => { $('answer-overlay').hidden = true; startLang(state.lang); });
  $('answer-home').addEventListener('click', () => { $('answer-overlay').hidden = true; goHome(); });

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
    document.body.classList.toggle('on-work', id === 'work-screen');
  }

  // 言語をタップ → 説明のポップアップ → Start
  //   項目: 左右の端をタップ / 左右にスワイプ
  //   言語: 上下にスワイプ
  const LANG_ORDER = [...document.querySelectorAll('.lang-btn')].map(b => b.dataset.lang);
  let infoLang = null, infoItem = 0;
  const split = (t, sep) => t.split(sep).map(x => x.trim()).filter(Boolean);
  function infoSlides(lang) {
    const info = window.HW_LANG_INFO[lang];
    const list = (items, cls) => `<ul class="li-list ${cls || ''}">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
    return [
      { en: 'PROFILE', ja: 'プロフィール', html:
        `<div class="li-year">${esc(info.year)}</div>` +
        `<dl class="li-prof"><dt>国</dt><dd>${esc(info.country)}</dd><dt>作者</dt><dd>${esc(info.creator)}</dd>` +
        `<dt>タイプ</dt><dd>${esc(info.type)}</dd><dt>拡張子</dt><dd class="ext">${esc(HW.langs[lang].ext)}</dd></dl>` },
      { en: 'STRENGTHS', ja: '強み', html: list(split(info.strengths, /[・、]/), 'big') },
      { en: 'USE CASES', ja: '使われる場面', html: list(split(info.uses, '、'), 'chips') },
      { en: 'SYNTAX', ja: '書き方の特徴', html: list(split(info.style, '、'), 'big') },
      { en: 'TRIVIA', ja: '豆知識', html: `<p class="li-trivia">${esc(info.trivia)}</p>` },
    ];
  }
  function renderInfo(anim) {
    const slides = infoSlides(infoLang);
    const sl = slides[infoItem];
    $('li-stage').innerHTML = `<div class="li-slide ${anim || ''}"><p class="li-label"><span>${sl.en}</span>${sl.ja}</p>${sl.html}</div>`;
    $('li-progress').innerHTML = slides.map((_, i) => `<i class="${i < infoItem ? 'done' : i === infoItem ? 'on' : ''}"></i>`).join('');
  }
  function showLangInfo(lang, item, anim) {
    if (!(window.HW_LANG_INFO || {})[lang]) { startLang(lang); return; }
    const changedLang = lang !== infoLang || $('lang-info').hidden;
    infoLang = lang;
    infoItem = item || 0;
    if (changedLang) {
      const btn = document.querySelector(`.lang-btn[data-lang="${lang}"]`);
      $('li-logo').src = btn.querySelector('.lang-logo').getAttribute('src');
      $('li-name').textContent = HW.langs[lang].label;
      $('li-langdots').innerHTML = LANG_ORDER.map(l => `<i${l === lang ? ' class="on"' : ''}></i>`).join('');
      $('li-panel').style.setProperty('--glow', getComputedStyle(btn).getPropertyValue('--glow'));
      const best = loadBest()[lang];
      $('li-best').textContent = best ? fmtTime(best) : '--:--.--';
      $('li-best').classList.toggle('none', !best);
      const head = document.querySelector('.li-head');
      head.classList.remove('in-up', 'in-down');
      if (anim === 'in-up' || anim === 'in-down') { void head.offsetWidth; head.classList.add(anim); }
    }
    renderInfo(anim);
    $('lang-info').hidden = false;
  }
  function stepItem(d) {
    const n = infoSlides(infoLang).length;
    const next = infoItem + d;
    if (next < 0 || next >= n) { bump(d > 0 ? 'bump-r' : 'bump-l'); return; }
    infoItem = next;
    renderInfo(d > 0 ? 'in-right' : 'in-left');
  }
  function stepLang(d) {
    const i = LANG_ORDER.indexOf(infoLang);
    showLangInfo(LANG_ORDER[(i + d + LANG_ORDER.length) % LANG_ORDER.length], 0, d > 0 ? 'in-up' : 'in-down');
  }
  function bump(cls) {
    const st = $('li-stage');
    st.classList.remove('bump-l', 'bump-r');
    void st.offsetWidth;
    st.classList.add(cls);
  }
  const hideLangInfo = () => { $('lang-info').hidden = true; };
  document.querySelectorAll('.lang-btn').forEach((btn, i) => {
    btn.style.setProperty('--i', i);
    btn.addEventListener('click', () => {
      if (btn.classList.contains('pressed')) return;
      btn.classList.add('pressed');
      setTimeout(() => { btn.classList.remove('pressed'); showLangInfo(btn.dataset.lang, 0); }, 280);
    });
  });
  $('li-start').addEventListener('click', () => { hideLangInfo(); startLang(infoLang); });
  $('li-close').addEventListener('click', hideLangInfo);
  $('li-close-bottom').addEventListener('click', hideLangInfo);
  $('lang-info').addEventListener('click', e => { if (e.target === e.currentTarget) hideLangInfo(); });
  {
    const panel = $('li-panel');
    let sx = null, sy = 0;
    panel.addEventListener('pointerdown', e => { sx = e.clientX; sy = e.clientY; });
    panel.addEventListener('pointerup', e => {
      if (sx === null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      sx = null;
      if (e.target.closest('button') || e.target.closest('.li-foot')) return;
      if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(dx) * 1.2) { stepLang(dy < 0 ? 1 : -1); return; }
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) { stepItem(dx < 0 ? 1 : -1); return; }
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
        const r = panel.getBoundingClientRect();
        stepItem(e.clientX < r.left + r.width * 0.35 ? -1 : 1);
      }
    });
    panel.addEventListener('pointercancel', () => { sx = null; });
  }
  document.addEventListener('keydown', e => {
    if ($('lang-info').hidden) return;
    if (e.key === 'Escape') hideLangInfo();
    if (e.key === 'ArrowRight') stepItem(1);
    if (e.key === 'ArrowLeft') stepItem(-1);
    if (e.key === 'ArrowDown') stepLang(1);
    if (e.key === 'ArrowUp') stepLang(-1);
    if (e.key === 'Enter') { hideLangInfo(); startLang(infoLang); }
  });
  $('back-btn').addEventListener('click', goHome);
  $('again-btn').addEventListener('click', () => { hideSuccess(); startLang(state.lang); });
  $('other-btn').addEventListener('click', () => { hideSuccess(); goHome(); });
  $('success-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget || e.target.classList.contains('success-box')) hideSuccess();
  });

  function goHome() {
    const list = document.querySelector('.lang-list');
    list.classList.remove('enter'); void list.offsetWidth; list.classList.add('enter');
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
  function colorizeRust(line) {
    let m;
    if ((m = /^(error(?:\[E\d+\])?)(:.*)$/.exec(line))) return `<span class="t-err t-bold">${esc(m[1])}</span><span class="t-bold">${esc(m[2])}</span>`;
    if ((m = /^(warning)(:.*)$/.exec(line))) return `<span class="t-yellow t-bold">${esc(m[1])}</span><span class="t-bold">${esc(m[2])}</span>`;
    if ((m = /^(\s*)(-->)(.*)$/.exec(line))) return `${m[1]}<span class="t-blue t-bold">${m[2]}</span>${esc(m[3])}`;
    if ((m = /^(\s*\d*\s*\|)(.*)$/.exec(line))) {
      // 波線・注釈の行だけ色を付ける (ソースコードの行はそのまま)
      const isMark = /^\s*[\^-]/.test(m[2]);
      const rest = isMark ? esc(m[2]).replace(/^(\s*)(\^+)(.*)$/, '$1<span class="t-err t-bold">$2$3</span>').replace(/^(\s*)(-+)(.*)$/, '$1<span class="t-blue t-bold">$2$3</span>') : esc(m[2]);
      return `<span class="t-blue t-bold">${esc(m[1])}</span>${rest}`;
    }
    if ((m = /^(\s*=\s)(help|note)(:.*)$/.exec(line))) return `<span class="t-blue t-bold">${esc(m[1])}</span><span class="t-bold">${m[2]}</span>${esc(m[3])}`;
    return esc(line);
  }
  function writeErr(text, style) {
    if (!text) return;
    if (style === 'rust') {
      text.replace(/\n$/, '').split('\n').forEach(l => writeHTMLLine(colorizeRust(l)));
      return;
    }
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
  const COMMAND_NAMES = ['cat', 'cd', 'clear', 'code', 'cp', 'date', 'echo', 'exit', 'g++', 'gcc', 'go', 'help', 'history', 'java', 'javac', 'ls', 'mv', 'nano', 'node', 'php', 'pwd', 'python3', 'rm', 'ruby', 'rustc', 'touch', 'vim', 'whoami'];
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
      const HELP = {
        python: ['  python3 <ファイル名.py>   Python プログラムを実行'],
        java: ['  javac <クラス名.java>     Java ファイルをコンパイル (.class ができる)', '  java <クラス名>           コンパイルしたクラスを実行'],
        c: ['  gcc <ファイル名.c>        C ファイルをコンパイル (a.out ができる)', '  gcc <ファイル名.c> -o <名前>  名前をつけてコンパイル', '  ./<実行ファイル名>        コンパイルしたプログラムを実行'],
        cpp: ['  g++ <ファイル名.cpp>      C++ ファイルをコンパイル (a.out ができる)', '  g++ <ファイル名.cpp> -o <名前>  名前をつけてコンパイル', '  ./<実行ファイル名>        コンパイルしたプログラムを実行'],
        javascript: ['  node <ファイル名.js>      JavaScript プログラムを実行'],
        ruby: ['  ruby <ファイル名.rb>      Ruby プログラムを実行'],
        go: ['  go run <ファイル名.go>    Go プログラムをコンパイルして実行', '  go build <ファイル名.go>  実行ファイルを作る'],
        rust: ['  rustc <ファイル名.rs>     Rust ファイルをコンパイル (実行ファイルができる)', '  ./<実行ファイル名>        コンパイルしたプログラムを実行'],
        php: ['  php <ファイル名.php>      PHP プログラムを実行'],
      };
      s += (HELP[lang] || []).map(l => l + '\n').join('');
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
    'g++'(args, io) { return compileC('g++', args, io); },
    'c++'(args, io) { return compileC('c++', args, io); },
    clang(args, io) { return compileC('gcc', args, io); },

    // ---- JavaScript ----
    node(args, io) {
      if (args[0] === '-v' || args[0] === '--version') { io.out('v20.12.2\n'); return 0; }
      const file = args.find(a => !a.startsWith('-'));
      if (!file) {
        io.out('Welcome to Node.js v20.12.2.\nType ".help" for more information.\n');
        writeln('# このアプリでは対話モードは使えません。node ファイル名.js のように実行してください', 't-hint');
        return 0;
      }
      const n = normPath(file);
      const f = n && state.files.get(n);
      if (!f) {
        io.err(`node:internal/modules/cjs/loader:1146\n  throw err;\n  ^\n\nError: Cannot find module '${HOME}/${file.replace(/^\.\//, '')}'\n    at Module._resolveFilename (node:internal/modules/cjs/loader:1143:15)\n    at Module._load (node:internal/modules/cjs/loader:984:27)\n    at Function.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:174:12)\n    at node:internal/main/run_main_module:28:49 {\n  code: 'MODULE_NOT_FOUND',\n  requireStack: []\n}\n\nNode.js v20.12.2\n`);
        return 1;
      }
      return runScript('javascript', HW.jsRun, f, n, io);
    },

    // ---- Ruby ----
    ruby(args, io) {
      if (args[0] === '-v' || args[0] === '--version') { io.out('ruby 3.2.3 (2024-01-18 revision 52bb2ac0a6) [x86_64-linux-gnu]\n'); return 0; }
      const file = args.find(a => !a.startsWith('-'));
      if (!file) { writeln('# このアプリでは標準入力からの実行は使えません。ruby ファイル名.rb のように実行してください', 't-hint'); return 0; }
      const n = normPath(file);
      const f = n && state.files.get(n);
      if (!f) { io.err(`ruby: No such file or directory -- ${file} (LoadError)\n`); return 1; }
      return runScript('ruby', HW.rbRun, f, n, io);
    },

    // ---- PHP ----
    php(args, io) {
      if (args[0] === '-v' || args[0] === '--version') { io.out('PHP 8.3.6 (cli) (built: Apr 15 2024 19:21:47) (NTS)\nCopyright (c) The PHP Group\nZend Engine v4.3.6, Copyright (c) Zend Technologies\n'); return 0; }
      const file = args.find(a => !a.startsWith('-'));
      if (!file) { writeln('# このアプリでは対話モードは使えません。php ファイル名.php のように実行してください', 't-hint'); return 0; }
      const n = normPath(file);
      const f = n && state.files.get(n);
      if (!f) { io.err(`Could not open input file: ${file}\n`); return 1; }
      return runScript('php', HW.phpRun, f, n, io);
    },

    // ---- Go ----
    go(args, io) {
      const sub = args[0];
      if (!sub || sub === 'help') {
        io.err('Go is a tool for managing Go source code.\n\nUsage:\n\n\tgo <command> [arguments]\n\nThe commands are:\n\n\tbuild       compile packages and dependencies\n\trun         compile and run Go program\n\tversion     print Go version\n');
        return sub ? 0 : 2;
      }
      if (sub === 'version') { io.out('go version go1.22.2 linux/amd64\n'); return 0; }
      if (sub !== 'run' && sub !== 'build') { io.err(`go ${sub}: unknown command\nRun 'go help' for usage.\n`); return 2; }
      let out = null;
      const files = [];
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '-o') out = args[++i];
        else if (!args[i].startsWith('-')) files.push(args[i]);
      }
      if (!files.length) {
        io.err(sub === 'run' ? 'go: no go files listed\n' : `no Go files in ${HOME}\n`);
        return 1;
      }
      const n = normPath(files[0]);
      if (!n || !n.endsWith('.go')) {
        io.err(sub === 'run' ? `package ${files[0]} is not in std (/usr/lib/go-1.22/src/${files[0]})\n` : `no Go files in ${HOME}\n`);
        return 1;
      }
      const f = state.files.get(n);
      if (!f) { io.err(`stat ${files[0]}: no such file or directory\n`); return 1; }
      const r = HW.goCompile(f.kind === 'text' ? f.content : '', n);
      if (!r.ok) { io.err(r.err); return 1; }
      if (sub === 'build') {
        const exe = normPath(out || n.replace(/\.go$/, ''));
        state.files.set(exe, { kind: 'exec', program: r.program, lang: 'go', mtime: new Date() });
        renderEditor();
        return 0;
      }
      const res = HW.goRun(r.program);
      io.out(res.out);
      if (res.err) io.err(res.err);
      checkSuccess('go', res);
      return res.code === 0 ? 0 : 1;
    },

    // ---- Rust ----
    rustc(args, io) {
      if (args[0] === '-V' || args[0] === '--version') { io.out('rustc 1.75.0 (82e1608df 2023-12-21) (built from a source tarball)\n'); return 0; }
      let out = null;
      const files = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '-o') out = args[++i];
        else if (!args[i].startsWith('-')) files.push(args[i]);
      }
      if (!files.length) { io.err('Usage: rustc [OPTIONS] INPUT\n\nOptions:\n    -o FILENAME         Write output to <filename>\n    -V, --version       Print version info and exit\n', 'rust'); return 1; }
      const n = normPath(files[0]);
      const f = n && state.files.get(n);
      if (!f) { io.err(`error: couldn't read \`${files[0]}\`: No such file or directory (os error 2)\n\nerror: aborting due to 1 previous error\n\n`, 'rust'); return 1; }
      const r = HW.rustCompile(f.kind === 'text' ? f.content : '', n);
      if (r.err) io.err(r.err, 'rust');
      if (!r.ok) return 1;
      const exe = normPath(out || n.replace(/\.rs$/, ''));
      state.files.set(exe, { kind: 'exec', program: r.program, lang: 'rust', mtime: new Date() });
      renderEditor();
      return 0;
    },
    cargo(args, io) { io.err(`error: could not find \`Cargo.toml\` in \`${HOME}\` or any parent directory\n`, 'rust'); return 101; },
  };

  function openInEditor(args, io) {
    const raw = args.find(a => !a.startsWith('-'));
    if (!raw) { focusEditor(); return 0; }
    const n = normPath(raw);
    if (!n) { io.err(`# ${raw} は開けません\n`); return 1; }
    createFile(n, true);
    return 0;
  }

  function runScript(lang, runner, f, n, io) {
    if (f.kind !== 'text') { io.err(`# ${n} はテキストファイルではありません\n`); return 1; }
    const r = runner(f.content, n);
    io.out(r.out);
    if (r.err) io.err(r.err);
    checkSuccess(lang, r);
    return r.code;
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
    const isCpp = n => /\.(cpp|cc|cxx|C)$/.test(n);
    const cFile = src.find(n => n.endsWith('.c') || isCpp(n));
    const other = src.find(n => !(n.endsWith('.c') || isCpp(n)));
    if (other) {
      const f = state.files.get(other);
      if (f.kind === 'exec') io.err(`/usr/bin/ld: ${other}: in function \`_start':\n(.text+0x0): multiple definition of \`_start'\ncollect2: error: ld returned 1 exit status\n`, 'gcc');
      else io.err(`/usr/bin/ld:${other}: file format not recognized; treating as linker script\n/usr/bin/ld:${other}:1: syntax error\ncollect2: error: ld returned 1 exit status\n`, 'gcc');
      return 1;
    }
    const f = state.files.get(cFile);
    const asCpp = isCpp(cFile) || prog === 'g++' || prog === 'c++';
    const r = asCpp ? HW.cppCompile(f.content, cFile) : HW.cCompile(f.content, cFile);
    if (r.err) io.err(r.err, 'gcc');
    if (!r.ok) return 1;
    if (!outName) { io.err(`/usr/bin/ld: cannot open output file ${out}: No such file or directory\ncollect2: error: ld returned 1 exit status\n`, 'gcc'); return 1; }
    const existing = state.files.get(outName);
    state.files.set(outName, { kind: 'exec', program: r.program, lang: asCpp ? 'cpp' : 'c', mtime: new Date() });
    if (existing && existing.kind === 'text') { closeTab(outName, true); }
    renderEditor();
    return 0;
  }

  function runPath(cmd, args, io) {
    const n = normPath(cmd);
    const f = n && state.files.get(n);
    if (!f) { io.err(`bash: ${cmd}: No such file or directory\n`); return 127; }
    if (f.kind !== 'exec') { io.err(`bash: ${cmd}: Permission denied\n`); return 126; }
    const runner = { c: HW.cRun, cpp: HW.cppRun, go: HW.goRun, rust: HW.rustRun }[f.lang] || HW.cRun;
    const r = runner(f.program);
    io.out(r.out);
    if (r.err) io.err(r.err);
    checkSuccess(f.lang || 'c', r);
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
    if (f && f.kind === 'exec') return '<span class="ficon bin">$</span>';
    const map = { py: ['py', 'py'], java: ['java', 'J'], c: ['c', 'C'], h: ['c', 'h'], class: ['class', 'J'], cpp: ['cpp', 'C+'], cc: ['cpp', 'C+'], js: ['js', 'JS'], rb: ['rb', 'rb'], go: ['go', 'go'], rs: ['rs', 'rs'], php: ['php', 'php'] };
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
