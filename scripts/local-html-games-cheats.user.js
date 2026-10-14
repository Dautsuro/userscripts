// ==UserScript==
// @name         Local HTML Games: Cheat Finder
// @namespace    userscripts.local
// @version      1.0.0
// @description  Adds a button that scans a local HTML game's code (SugarCube first) for cheat codes, shows what each one does, activates them directly, and breaks hashed code checks so a stand-in code works.
// @homepageURL  https://github.com/Dautsuro/userscripts
// @updateURL    https://raw.githubusercontent.com/Dautsuro/userscripts/main/scripts/local-html-games-cheats.user.js
// @downloadURL  https://raw.githubusercontent.com/Dautsuro/userscripts/main/scripts/local-html-games-cheats.user.js
// @match        file:///C:/Games/*
// @match        file:///c:/Games/*
// @run-at       document-idle
// @inject-into  page
// @noframes
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  'use strict';

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  // ---------------------------------------------------------------------------
  // Patterns
  // ---------------------------------------------------------------------------

  const STR = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|` + '`(?:[^`\\\\]|\\\\.)*`';
  const NUM = String.raw`-?\d+(?:\.\d+)?`;
  const OP = String.raw`===|!==|==|!=|\bis\s+not\b|\bisnot\b|\bneq\b|\bis\b|\beq\b`;
  const NEGATIVE_OP = /^(!==|!=|is\s+not|isnot|neq)$/;

  // A text box counts as a cheat input when its variable, its passage or the passage it
  // leads to mentions cheats/codes. Story puzzles ("$witchanswer", "$edenpassword") don't.
  const CHEAT = /cheat|code|redeem|promo/i;
  // Variables that hold a typed code even when the script can't see where it's typed.
  const CODE_VAR = /(?:^|[.$_])(?:cheat_?code|cheat|code|redeem_?code|promo_?code)s?$/i;
  // Built-in or engine functions that are never cheat validators.
  const NOT_VALIDATOR = /^(?:isNaN|isFinite|Number|String|Boolean|parseInt|parseFloat|Array\.isArray|Object\.\w+|Math\.\w+|JSON\.\w+|visited\w*|tags|passage|previous|either|random\w*|lastVisited|hasVisited|memorize|recall|setup\.(?:is|has|can)\w*)$/;
  // Functions that transform the input before comparing (hashes, encodings).
  const HASHY = /md5|sha\d*|hash|crypt|digest|btoa|atob|encode|cipher/i;
  // Functions that probably validate a code and return true/false.
  const VALIDATOR_NAME = /cheat|code|valid|verif|check|redeem/i;
  // Keyboard/HTTP codes, not cheat codes.
  const NOT_CHEAT_VAR = /(?:keyCode|charCode|statusCode|errorCode)$|(?:^|\.)(?:e|ev|evt|event|ke|key|keyEvent)\.code$/;
  const STRING_METHODS = /^(toLowerCase|toUpperCase|toLocaleLowerCase|toLocaleUpperCase|trim|trimStart|trimEnd|normalize|toString|valueOf|replace|replaceAll|split|reverse|join|slice|substring|substr)$/;
  const HASH_LITERAL = /^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{56}|[a-f0-9]{64}|[a-f0-9]{96}|[a-f0-9]{128})$/i;

  function unquote(lit) {
    const q = lit[0];
    const body = lit.slice(1, -1);
    if (q === '`') return body;
    try {
      return JSON.parse('"' + (q === "'" ? body.replace(/\\'/g, "'").replace(/(^|[^\\])"/g, '$1\\"') : body) + '"');
    } catch {
      return body;
    }
  }

  function lineOf(text, idx) {
    let n = 1;
    for (let i = 0; i < idx; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  }

  // ---------------------------------------------------------------------------
  // Bracket helpers (string and comment aware, for JS)
  // ---------------------------------------------------------------------------

  const PAIRS = { '(': ')', '[': ']', '{': '}' };
  const RPAIRS = { ')': '(', ']': '[', '}': '{' };

  function skipString(text, j) {
    const q = text[j];
    for (let k = j + 1; k < text.length; k++) {
      if (text[k] === '\\') { k++; continue; }
      if (text[k] === q) return k;
      if (q !== '`' && text[k] === '\n') return k;
    }
    return text.length;
  }

  // Index of the bracket closing the one at i, or -1. `strings` = treat quotes as strings.
  function matchBracket(text, i, strings = true) {
    const open = text[i], close = PAIRS[open];
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (strings && (c === '"' || c === "'" || c === '`')) { j = skipString(text, j); continue; }
      if (strings && c === '/' && text[j + 1] === '/') { j = text.indexOf('\n', j); if (j < 0) return -1; continue; }
      if (strings && c === '/' && text[j + 1] === '*') { j = text.indexOf('*/', j + 2) + 1; if (j <= 0) return -1; continue; }
      if (c === open) depth++;
      else if (c === close && --depth === 0) return j;
    }
    return -1;
  }

  function matchBack(text, i) {
    const close = text[i], open = RPAIRS[close];
    let depth = 0;
    for (let j = i; j >= 0; j--) {
      if (text[j] === close) depth++;
      else if (text[j] === open && --depth === 0) return j;
    }
    return -1;
  }

  // Expression ending right before `end`, e.g. `md5($code.trim())` in `md5($code.trim()) is "…"`.
  function exprBefore(text, end) {
    let i = end;
    while (i > 0 && /\s/.test(text[i - 1])) i--;
    const stop = i;
    while (i > 0) {
      const c = text[i - 1];
      if (/[\w$.]/.test(c)) i--;
      else if (c === ')' || c === ']') { const o = matchBack(text, i - 1); if (o < 0) break; i = o; }
      else break;
    }
    return text.slice(i, stop);
  }

  // Expression starting at `start`.
  function exprAfter(text, start) {
    let i = start;
    while (i < text.length && /\s/.test(text[i])) i++;
    const from = i;
    while (i < text.length) {
      const c = text[i];
      if (/[\w$.]/.test(c)) i++;
      else if ((c === '(' || c === '[') && i > from) { const e = matchBracket(text, i); if (e < 0) break; i = e + 1; }
      else break;
    }
    return text.slice(from, i);
  }

  // ---------------------------------------------------------------------------
  // Expression parsing: which variable, wrapped in which function, which methods
  // ---------------------------------------------------------------------------

  function normalizeVars(s) {
    return s
      .replace(/\bvariables\(\)\./g, 'State.variables.')
      .replace(/\btemporary\(\)\./g, 'State.temporary.')
      .replace(/(^|[^\w.$])V\./g, '$1State.variables.')
      .replace(/(^|[^\w.$])T\./g, '$1State.temporary.')
      .replace(/(?:SugarCube\.)?State\.variables\.([A-Za-z_]\w*)/g, '$$$1')
      .replace(/(?:SugarCube\.)?State\.temporary\.([A-Za-z_]\w*)/g, '_$1');
  }

  // "$code.toLowerCase().trim()" -> { base: '$code', methods: ['toLowerCase', 'trim'] }
  function parseVarChain(s) {
    const m = /^\s*([$_]?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/.exec(s);
    if (!m) return null;
    let path = m[1];
    let rest = s.slice(m[0].length);
    if (rest.trimStart().startsWith('(')) {
      // last segment is a method call
      const dot = path.lastIndexOf('.');
      if (dot < 0) return null; // a bare function call, not a variable
      rest = path.slice(dot) + rest;
      path = path.slice(0, dot);
    }
    const methods = [...rest.matchAll(/\.([A-Za-z_]\w*)\s*\(/g)].map((x) => x[1]);
    return { base: path, methods };
  }

  // "CryptoJS.MD5($code.trim()).toString()" -> { fn: 'CryptoJS.MD5', base: '$code', methods: ['trim'] }
  function parseExpr(expr) {
    expr = normalizeVars(expr.trim());
    const m = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/.exec(expr);
    if (m) {
      const path = m[1];
      const last = path.split('.').pop();
      const looksLikeVar = /^[$_]/.test(path) && path.includes('.');
      if (!(looksLikeVar && STRING_METHODS.test(last)) && !STRING_METHODS.test(last)) {
        const open = expr.indexOf('(', path.length);
        const close = matchBracket(expr, open);
        if (close < 0) return null;
        const inner = parseVarChain(expr.slice(open + 1, close));
        if (!inner) return null;
        return { fn: path, base: inner.base, methods: inner.methods };
      }
    }
    const v = parseVarChain(expr);
    return v && { fn: null, base: v.base, methods: v.methods };
  }

  // ---------------------------------------------------------------------------
  // Collecting the game's code
  // ---------------------------------------------------------------------------

  function unescapeTwine1(s) {
    return s.replace(/\\(n|t|s|\\)/g, (_, c) => ({ n: '\n', t: '\t', s: '\\', '\\': '\\' })[c]);
  }

  async function collectSources() {
    const sources = [];
    const notes = [];
    let engine = 'unknown';

    const data = document.querySelector('tw-storydata');
    if (data) {
      const fmt = data.getAttribute('format') || 'Twine 2';
      engine = `${fmt} ${data.getAttribute('format-version') || ''}`.trim();
      for (const p of data.querySelectorAll('tw-passagedata')) {
        const tags = (p.getAttribute('tags') || '').split(/\s+/).filter(Boolean);
        sources.push({ name: p.getAttribute('name'), text: p.textContent, js: tags.includes('script') });
      }
      for (const s of data.querySelectorAll('script')) {
        sources.push({ name: 'Story JavaScript', text: s.textContent, js: true });
      }
    } else {
      const area = document.querySelector('#store-area, #storeArea');
      if (area) {
        engine = W.SugarCube ? 'SugarCube 1' : 'Twine 1';
        for (const p of area.querySelectorAll('[tiddler]')) {
          const tags = (p.getAttribute('tags') || '').split(/\s+/).filter(Boolean);
          sources.push({ name: p.getAttribute('tiddler'), text: unescapeTwine1(p.textContent), js: tags.includes('script') });
        }
      }
    }
    if (W.SugarCube?.version) engine = `SugarCube ${W.SugarCube.version.short?.() || W.SugarCube.version.toString?.() || ''}`.trim();
    else if (W.Harlowe || /harlowe/i.test(engine)) engine = engine.includes('Harlowe') ? engine : 'Harlowe';

    let unreadable = 0;
    for (const s of document.scripts) {
      if (data?.contains(s) || s.id === 'script-sugarcube' || s.id === 'script-libraries') continue;
      if (s.src) {
        try {
          const res = await fetch(s.src);
          if (!res.ok) throw new Error(res.status);
          sources.push({ name: decodeURIComponent(s.src.split('/').pop()), text: await res.text(), js: true });
        } catch {
          unreadable++;
        }
      } else if (s.textContent.trim() && !/^(application\/json|text\/template)/.test(s.type)) {
        sources.push({ name: 'inline <script>', text: s.textContent, js: true });
      }
    }
    if (unreadable) {
      notes.push(`${unreadable} external script file(s) couldn't be read (Firefox blocks reading local files). Functions they define are still checked when the game uses them.`);
    }
    return { sources, notes, engine };
  }

  // ---------------------------------------------------------------------------
  // Where is a match? (inside a macro, a <<script>> block, a Harlowe macro, plain JS)
  // ---------------------------------------------------------------------------

  function insideSugarMacro(text, idx) {
    const open = text.lastIndexOf('<<', idx);
    return open >= 0 && text.lastIndexOf('>>', idx) < open;
  }

  function insideScriptBlock(text, idx) {
    const open = text.lastIndexOf('<<script', idx);
    return open >= 0 && text.lastIndexOf('<</script>>', idx) < open;
  }

  function harloweMacroStart(text, idx) {
    const before = text.slice(Math.max(0, idx - 400), idx);
    const re = /\(([a-z][\w-]*):/gi;
    let m, start = -1;
    while ((m = re.exec(before))) start = idx - before.length + m.index;
    if (start < 0) return -1;
    let depth = 0;
    for (let i = start; i < idx; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
    }
    return depth > 0 ? start : -1;
  }

  function codeContext(src, idx) {
    if (src.js || insideScriptBlock(src.text, idx)) return 'js';
    if (insideSugarMacro(src.text, idx)) return 'sugar';
    if (harloweMacroStart(src.text, idx) >= 0) return 'harlowe';
    return null; // story prose, not code
  }

  // ---------------------------------------------------------------------------
  // Effect extraction: the code that runs when a check passes
  // ---------------------------------------------------------------------------

  // End of a SugarCube <<if>>/<<switch>> clause starting at `from`.
  function sugarClauseEnd(text, from, family) {
    const open = family;
    const stops = family === 'if' ? ['elseif', 'else'] : ['case', 'default'];
    const re = /<<\s*(\/?)(\w+)/g;
    re.lastIndex = from;
    let depth = 0, m;
    while ((m = re.exec(text))) {
      const [, slash, name] = m;
      if (name === open || name === 'end' + open) {
        const closing = slash || name === 'end' + open;
        if (!closing) depth++;
        else if (depth === 0) return { end: m.index, next: null };
        else depth--;
      } else if (!slash && depth === 0 && stops.includes(name)) {
        return { end: m.index, next: name, nextAt: m.index };
      }
    }
    return { end: text.length, next: null };
  }

  function sugarEffect(text, idx, negative) {
    const open = text.lastIndexOf('<<', idx);
    const head = /^<<\s*(\w+)/.exec(text.slice(open));
    if (!head || !['if', 'elseif'].includes(head[1])) return null;
    const close = text.indexOf('>>', idx);
    if (close < 0) return null;
    const clause = sugarClauseEnd(text, close + 2, 'if');
    if (!negative) return text.slice(close + 2, clause.end);
    if (clause.next !== 'else') return null;
    const elseClose = text.indexOf('>>', clause.nextAt);
    return text.slice(elseClose + 2, sugarClauseEnd(text, elseClose + 2, 'if').end);
  }

  function jsBlockAt(text, i) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] === '{') {
      const e = matchBracket(text, i);
      return e < 0 ? null : { body: text.slice(i + 1, e), end: e + 1 };
    }
    const e = text.indexOf(';', i);
    return e < 0 ? null : { body: text.slice(i, e + 1), end: e + 1 };
  }

  function jsEffect(text, idx, negative) {
    const re = /\bif\s*\(/g;
    let best = null;
    const from = Math.max(0, idx - 3000);
    re.lastIndex = from;
    let m;
    while ((m = re.exec(text)) && m.index < idx) {
      const p = text.indexOf('(', m.index);
      const e = matchBracket(text, p);
      if (e > idx) best = { p, e };
    }
    if (!best) return null;
    const block = jsBlockAt(text, best.e + 1);
    if (!block) return null;
    if (!negative) return block.body;
    const rest = /^\s*else\b/.exec(text.slice(block.end));
    if (!rest) return null;
    const elseBlock = jsBlockAt(text, block.end + rest[0].length);
    return elseBlock && elseBlock.body;
  }

  function harloweEffect(text, idx) {
    const start = harloweMacroStart(text, idx);
    if (start < 0) return null;
    const close = matchBracket(text, start, false);
    if (close < 0) return null;
    let i = close + 1;
    while (/\s/.test(text[i] || '')) i++;
    if (text[i] !== '[') return null;
    const end = matchBracket(text, i, false);
    return end < 0 ? null : text.slice(i + 1, end);
  }

  function effectAt(src, idx, ctx, negative) {
    if (ctx === 'sugar') return { effect: sugarEffect(src.text, idx, negative), lang: 'sugar' };
    if (ctx === 'js') return { effect: jsEffect(src.text, idx, negative), lang: 'js' };
    if (ctx === 'harlowe') return { effect: negative ? null : harloweEffect(src.text, idx), lang: 'harlowe' };
    return { effect: null, lang: null };
  }

  // ---------------------------------------------------------------------------
  // Scanning
  // ---------------------------------------------------------------------------

  function scan(sources) {
    const findings = [];
    const inputVars = new Map(); // variable -> names around it (its passage, the passage it leads to, prompt text)
    const numericVars = new Set();
    const hashedVars = new Map(); // "_h" -> "md5" when `_h = md5($code)`

    const addInput = (v, ...names) => {
      if (!inputVars.has(v)) inputVars.set(v, []);
      inputVars.get(v).push(...names);
    };

    const isRelevantVar = (v) => {
      if (!v || NOT_CHEAT_VAR.test(v)) return false;
      if (hashedVars.has(v)) return true;
      if (inputVars.has(v)) return CHEAT.test(v) || inputVars.get(v).some((n) => CHEAT.test(n));
      return CODE_VAR.test(v);
    };

    // 1. Variables the player types into.
    for (const src of sources) {
      const t = normalizeVars(src.text);
      for (const m of t.matchAll(/<<\s*(textbox|textarea|numberbox|passwordbox|textbox2|input\w*)\s+["']([$_][\w.]+)["']([^>]*)>>/gi)) {
        const passages = [...m[3].matchAll(new RegExp(STR, 'g'))].map((x) => unquote(x[0]));
        addInput(m[2], src.name, ...passages);
        if (/number/i.test(m[1])) numericVars.add(m[2]);
      }
      for (const m of t.matchAll(/\(input-box:\s*bind\s+([$_][\w.]+)/gi)) addInput(m[1], src.name);
      for (const m of t.matchAll(/\((?:set|put):\s*([$_][\w.]+)\s+(?:to|into)\s+\(prompt:([^)]*)/gi)) addInput(m[1], src.name, m[2]);
      for (const m of t.matchAll(/(?:<<set\s+)?([$_]?[A-Za-z_][\w.]*)\s*(?:=|\bto\b)\s*(?:window\.)?prompt\s*\(([^)]*)/g)) addInput(m[1], src.name, m[2]);
      for (const m of t.matchAll(/([$_]?[A-Za-z_][\w.]*)\s*(?:=|\bto\b)\s*(?:\$|jQuery)\(([^)]*)\)\s*\.val\(\)/g)) addInput(m[1], src.name, m[2]);
    }

    // 2. Variables holding a transformed input: `<<set _h to md5($code)>>`, `const h = sha256(code)`.
    for (const src of sources) {
      const t = normalizeVars(src.text);
      for (const m of t.matchAll(/([$_]?[A-Za-z_][\w.]*)\s*(?:=|\bto\b)\s*([A-Za-z_$][\w$.]*)\s*\(/g)) {
        if (!HASHY.test(m[2])) continue;
        const open = m.index + m[0].length - 1;
        const close = matchBracket(t, open);
        if (close < 0) continue;
        const inner = parseVarChain(t.slice(open + 1, close));
        if (inner && isRelevantVar(inner.base)) hashedVars.set(m[1], m[2]);
      }
    }

    const add = (f) => findings.push(f);

    function fromComparison(src, idx, litRaw, exprText, op, isNumber) {
      const ctx = codeContext(src, idx);
      if (!ctx) return;
      const parsed = parseExpr(exprText);
      if (!parsed || !parsed.base) return;
      const hashFn = parsed.fn || hashedVars.get(parsed.base) || null;
      const relevant = isRelevantVar(parsed.base) || (parsed.fn && HASHY.test(parsed.fn) && isRelevantVar(parsed.base));
      if (!relevant) return;
      const lit = isNumber ? litRaw : unquote(litRaw);
      if (lit === '' || lit.length > 200) return;
      if (isNumber && !numericVars.has(parsed.base) && !inputVars.has(parsed.base)) return;

      const negative = NEGATIVE_OP.test(op.replace(/\s+/g, ' ').trim());
      const f = {
        source: src.name, line: lineOf(src.text, idx), var: parsed.base, notes: [],
        ...effectAt(src, idx, ctx, negative),
      };
      describeLiteral(f, lit, hashFn, parsed.methods);
      add(f);
    }

    // A cheat list only counts if the game looks the typed code up in it:
    // `list[$code]`, `list.includes($code)`, `$code in list`.
    const allCode = sources.map((s) => normalizeVars(s.text));
    const seenLists = new Set();
    const listIsChecked = (name) => {
      const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const lookups = [
        new RegExp(`(?<![\\w$.])${n}\\s*\\[([^\\]]+)\\]`, 'g'),
        new RegExp(`(?<![\\w$.])${n}\\s*\\.\\s*(?:includes|contains|hasOwnProperty|indexOf|find\\w*|some|filter)\\s*\\(([^)]*)\\)`, 'g'),
        new RegExp(`([$_]?[A-Za-z_][\\w.]*)\\s+in\\s+${n}(?![\\w$])`, 'g'),
      ];
      return allCode.some((t) => lookups.some((re) => [...t.matchAll(re)].some((m) =>
        [...m[1].matchAll(/[$_]?[A-Za-z_][\w.]*/g)].some((x) => isRelevantVar(parseVarChain(x[0])?.base)))));
    };

    for (const src of sources) {
      const text = src.text;

      // `$code is "X"` / `md5($code) === "…"` / `$code == 1234`
      for (const m of text.matchAll(new RegExp(`(${OP})\\s*(${STR}|${NUM})`, 'g'))) {
        const isNumber = !/^["'`]/.test(m[2]);
        fromComparison(src, m.index, m[2], exprBefore(text, m.index), m[1], isNumber);
      }
      // `"X" is $code`
      for (const m of text.matchAll(new RegExp(`(${STR})\\s*(${OP})`, 'g'))) {
        fromComparison(src, m.index, m[1], exprAfter(text, m.index + m[0].length), m[2], false);
      }
      // `$code is atob("…")`
      for (const m of text.matchAll(new RegExp(`(${OP})\\s*(?:window\\.)?atob\\(\\s*(${STR})\\s*\\)`, 'g'))) {
        const ctx = codeContext(src, m.index);
        const parsed = ctx && parseExpr(exprBefore(text, m.index));
        if (!parsed || !isRelevantVar(parsed.base)) continue;
        let code;
        try { code = atob(unquote(m[2])); } catch { continue; }
        add({
          source: src.name, line: lineOf(text, m.index), var: parsed.base, code, notes: ['decoded from base64'],
          ...effectAt(src, m.index, ctx, NEGATIVE_OP.test(m[1])),
        });
      }
      // `["A", "B"].includes($code)`
      for (const m of text.matchAll(new RegExp(`\\[((?:\\s*(?:${STR})\\s*,?)+)\\]\\s*\\.(?:includes|contains)\\(`, 'g'))) {
        const open = m.index + m[0].length - 1;
        const close = matchBracket(text, open);
        const parsed = close > 0 && parseExpr(text.slice(open + 1, close));
        const ctx = codeContext(src, m.index);
        if (!parsed || !ctx || !isRelevantVar(parsed.base)) continue;
        const eff = effectAt(src, m.index, ctx, false);
        for (const l of m[1].matchAll(new RegExp(STR, 'g'))) {
          const f = { source: src.name, line: lineOf(text, m.index), var: parsed.base, notes: [], ...eff };
          describeLiteral(f, unquote(l[0]), parsed.fn, parsed.methods);
          add(f);
        }
      }

      scanSugarSwitches(src, isRelevantVar, add);
      scanJsSwitches(src, isRelevantVar, add);
      scanCheatLists(src, add, listIsChecked, seenLists);
      scanValidators(src, isRelevantVar, add);
    }

    return { findings: dedupe(findings), inputVars };
  }

  function describeLiteral(f, lit, hashFn, methods) {
    methods = methods || [];
    if (hashFn && /btoa/i.test(hashFn)) {
      try { f.code = atob(lit); f.notes.push('decoded from base64'); } catch { f.hash = lit; f.hashFn = hashFn; }
    } else if (hashFn && /atob/i.test(hashFn)) {
      try { f.code = btoa(lit); f.notes.push('the game decodes it from base64'); } catch { f.hash = lit; f.hashFn = hashFn; }
    } else if (hashFn && HASHY.test(hashFn)) {
      f.hash = lit;
      f.hashFn = hashFn;
    } else if (hashFn) {
      f.code = lit;
      f.notes.push(`the input goes through ${hashFn}() first`);
    } else {
      f.code = lit;
    }
    if (f.code != null && methods.includes('reverse')) {
      f.code = [...f.code].reverse().join('');
      f.notes.push('stored reversed');
    }
    if (methods.some((x) => /lower|upper/i.test(x))) f.notes.push('upper/lower case doesn\'t matter');
    if (methods.some((x) => /trim/i.test(x))) f.notes.push('surrounding spaces are ignored');
  }

  function scanSugarSwitches(src, isRelevantVar, add) {
    if (src.js) return;
    const text = src.text;
    for (const m of text.matchAll(/<<\s*switch\s+([^>]+?)\s*>>/g)) {
      const parsed = parseExpr(m[1]);
      if (!parsed || !isRelevantVar(parsed.base)) continue;
      const end = sugarClauseEndOfSwitch(text, m.index + m[0].length);
      const re = /<<\s*(\/?)(\w+)([^>]*)>>/g;
      re.lastIndex = m.index + m[0].length;
      let depth = 0, c;
      while ((c = re.exec(text)) && c.index < end) {
        const [, slash, name, args] = c;
        if (name === 'switch') { depth += slash ? -1 : 1; continue; }
        if (depth !== 0 || slash || name !== 'case') continue;
        const bodyStart = c.index + c[0].length;
        const effect = text.slice(bodyStart, sugarClauseEnd(text, bodyStart, 'switch').end);
        for (const l of args.matchAll(new RegExp(`${STR}|${NUM}`, 'g'))) {
          const lit = /^["'`]/.test(l[0]) ? unquote(l[0]) : l[0];
          const f = { source: src.name, line: lineOf(text, c.index), var: parsed.base, notes: [], effect, lang: 'sugar' };
          describeLiteral(f, lit, parsed.fn, parsed.methods);
          add(f);
        }
      }
    }
  }

  function sugarClauseEndOfSwitch(text, from) {
    const re = /<<\s*(\/?)switch\b/g;
    re.lastIndex = from;
    let depth = 0, m;
    while ((m = re.exec(text))) {
      if (!m[1]) depth++;
      else if (depth === 0) return m.index;
      else depth--;
    }
    return text.length;
  }

  function scanJsSwitches(src, isRelevantVar, add) {
    const text = src.text;
    for (const m of text.matchAll(/\bswitch\s*\(/g)) {
      const p = m.index + m[0].length - 1;
      const pe = matchBracket(text, p);
      if (pe < 0) continue;
      const ctx = codeContext(src, m.index);
      if (ctx !== 'js') continue;
      const parsed = parseExpr(text.slice(p + 1, pe));
      if (!parsed || !isRelevantVar(parsed.base)) continue;
      const bs = text.indexOf('{', pe);
      const be = bs < 0 ? -1 : matchBracket(text, bs);
      if (be < 0) continue;
      const block = text.slice(bs + 1, be);
      const cases = [...block.matchAll(new RegExp(`\\bcase\\s+(${STR}|${NUM})\\s*:`, 'g'))];
      cases.forEach((c, i) => {
        const bodyStart = c.index + c[0].length;
        const nextCase = block.slice(bodyStart).search(/\b(?:case\s|default\s*:)/);
        const effect = block.slice(bodyStart, nextCase < 0 ? block.length : bodyStart + nextCase).replace(/\bbreak\s*;?\s*$/, '');
        const lit = /^["'`]/.test(c[1]) ? unquote(c[1]) : c[1];
        const f = { source: src.name, line: lineOf(text, bs + 1 + c.index), var: parsed.base, notes: [], effect, lang: 'js' };
        describeLiteral(f, lit, parsed.fn, parsed.methods);
        add(f);
      });
    }
  }

  // `setup.cheats = { "MONEY": …, "GOD": … }` or `[{ code: "MONEY", … }]`
  function scanCheatLists(src, add, listIsChecked, seenLists) {
    const text = src.text;
    for (const m of text.matchAll(/([\w$.]*cheat[\w$.]*)\s*(?:=|:|\bto\b)\s*([[{])/gi)) {
      const ctx = codeContext(src, m.index);
      if (!ctx) continue;
      const listName = normalizeVars(m[1]);
      if (seenLists.has(listName) || !listIsChecked(listName)) continue;
      seenLists.add(listName);
      const open = m.index + m[0].length - 1;
      const close = matchBracket(text, open);
      if (close < 0) continue;
      const block = text.slice(open, close + 1);
      const entries = m[2] === '{' ? topLevelKeys(block) : [];
      for (const e of block.matchAll(new RegExp(`\\b(?:code|password|key|cheat|passcode)\\s*:\\s*(${STR})`, 'g'))) {
        entries.push({ key: unquote(e[1]), snippet: entrySnippet(block, e.index) });
      }
      if (m[2] === '[') {
        for (const e of topLevelStrings(block)) entries.push({ key: e, snippet: '' });
      }
      for (const e of entries) {
        const f = { source: src.name, line: lineOf(text, m.index), var: null, notes: [`listed in ${m[1]}`], effect: e.snippet || null, lang: null };
        if (HASH_LITERAL.test(e.key)) { f.hash = e.key; f.hashFn = null; } else f.code = e.key;
        add(f);
      }
    }
  }

  function topLevelKeys(block) {
    const out = [];
    let depth = 0;
    for (let i = 0; i < block.length; i++) {
      const c = block[i];
      if (c === '"' || c === "'" || c === '`') {
        const e = skipString(block, i);
        if (depth === 1 && /^\s*:/.test(block.slice(e + 1))) out.push({ key: unquote(block.slice(i, e + 1)), snippet: entrySnippet(block, i) });
        i = e;
        continue;
      }
      if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') depth--;
      else if (depth === 1 && /[A-Za-z_$]/.test(c) && /[\s,{]/.test(block[i - 1])) {
        const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(block.slice(i));
        if (m) { out.push({ key: m[1], snippet: entrySnippet(block, i) }); i += m[1].length - 1; }
      }
    }
    return out;
  }

  function topLevelStrings(block) {
    const out = [];
    let depth = 0;
    for (let i = 0; i < block.length; i++) {
      const c = block[i];
      if (c === '"' || c === "'" || c === '`') {
        const e = skipString(block, i);
        if (depth === 1) out.push(unquote(block.slice(i, e + 1)));
        i = e;
      } else if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') depth--;
    }
    return out;
  }

  // The text of one object entry: from `at` to the next top-level comma.
  function entrySnippet(block, at) {
    let depth = 0;
    for (let i = at; i < block.length; i++) {
      const c = block[i];
      if (c === '"' || c === "'" || c === '`') { i = skipString(block, i); continue; }
      if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') { if (depth === 0) return block.slice(at, i); depth--; }
      else if (c === ',' && depth === 0) return block.slice(at, i);
    }
    return block.slice(at);
  }

  // `<<if setup.checkCode($code)>>` / `if (checkCheat(code)) {`
  function scanValidators(src, isRelevantVar, add) {
    const text = src.text;
    const patterns = src.js
      ? [/\bif\s*\(\s*!?\s*([A-Za-z_$][\w$.]*)\s*\(/g]
      : [/<<\s*(?:if|elseif)\s+(?:not\s+|!\s*)?([A-Za-z_$][\w$.]*)\s*\(/g, /\bif\s*\(\s*!?\s*([A-Za-z_$][\w$.]*)\s*\(/g];
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        const path = m[1];
        if (NOT_VALIDATOR.test(path)) continue;
        if (HASHY.test(path.split('.').pop()) && !VALIDATOR_NAME.test(path)) continue;
        const open = m.index + m[0].length - 1;
        const close = matchBracket(text, open);
        if (close < 0) continue;
        // `md5($code) is "…"` is a comparison, handled elsewhere.
        const after = text.slice(close + 1).replace(/^(\s*\.\s*\w+\s*\([^()]*\))*/, '');
        if (new RegExp(`^\\s*(?:${OP})`).test(after)) continue;
        const args = normalizeVars(text.slice(open + 1, close)).replace(new RegExp(STR, 'g'), '""');
        const vars = [...args.matchAll(/[$_]?[A-Za-z_][\w.]*/g)].map((x) => parseVarChain(x[0])?.base).filter(Boolean);
        const relevantVar = vars.find(isRelevantVar);
        if (!relevantVar) continue;
        const ctx = codeContext(src, m.index + m[0].length - 1);
        if (!ctx) continue;
        const negated = /(?:not\s+|!\s*)[\w$.]+\s*\($/.test(m[0]);
        add({
          source: src.name, line: lineOf(text, m.index), var: relevantVar || vars[0] || null,
          validator: path, notes: [], ...effectAt(src, m.index + m[0].length - 1, ctx, negated),
        });
      }
    }
  }

  function dedupe(findings) {
    const seen = new Map();
    for (const f of findings) {
      const key = [f.source, f.code ?? '', f.hash ?? '', f.validator ?? '', (f.effect || '').trim()].join('\u0000');
      if (!seen.has(key)) seen.set(key, f);
    }
    return [...seen.values()];
  }

  // ---------------------------------------------------------------------------
  // Runtime: resolve functions in the page, read validator code, break checks
  // ---------------------------------------------------------------------------

  function resolveParent(path) {
    const parts = path.split('.');
    let obj;
    const head = parts.shift();
    if (head === 'setup' && W.SugarCube?.setup) obj = W.SugarCube.setup;
    else if (head === 'window' || head === 'globalThis') obj = W;
    else if (head in W) obj = W[head];
    else if (head === 'SugarCube') obj = W.SugarCube;
    else return null;
    if (!parts.length) return { obj: W, key: head };
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj?.[parts[i]];
      if (obj == null) return null;
    }
    return { obj, key: parts[parts.length - 1] };
  }

  function resolveFn(path) {
    const p = resolveParent(path);
    const fn = p && p.obj?.[p.key];
    return typeof fn === 'function' ? fn : null;
  }

  const patches = new Map(); // path -> { aliases: Map(aliasLower -> result) }
  let aliasCounter = 0;

  // Wrap a page function so a stand-in code gives the result the game expects.
  function breakFunction(path, result) {
    let patch = patches.get(path);
    if (!patch) {
      const p = resolveParent(path);
      const orig = p && p.obj?.[p.key];
      if (typeof orig !== 'function') return null;
      patch = { aliases: new Map() };
      const aliases = patch.aliases;
      const wrapped = function (...args) {
        const a = typeof args[0] === 'string' ? aliases.get(args[0].trim().toLowerCase()) : undefined;
        if (a !== undefined) return a;
        return orig.apply(this, args);
      };
      try {
        Object.defineProperty(wrapped, 'name', { value: orig.name });
        p.obj[p.key] = wrapped;
      } catch {
        return null;
      }
      patches.set(path, patch);
    }
    for (const [alias, r] of patch.aliases) if (r === result) return alias.toUpperCase();
    const alias = 'UNLOCK' + ++aliasCounter;
    patch.aliases.set(alias.toLowerCase(), result);
    return alias;
  }

  function enrichAtRuntime(findings) {
    const out = [];
    for (const f of findings) {
      if (f.validator) {
        const fn = resolveFn(f.validator);
        if (!fn) {
          f.notes.push(`checked by ${f.validator}(), which the script can't reach`);
          out.push(f);
          continue;
        }
        const body = String(fn);
        const plain = new Set();
        const hashed = new Set();
        for (const m of body.matchAll(new RegExp(`(?:${OP})\\s*(${STR})|(${STR})\\s*(?:${OP})`, 'g'))) {
          const lit = unquote(m[1] || m[2]);
          if (!lit) continue;
          (HASH_LITERAL.test(lit) ? hashed : plain).add(lit);
        }
        const usesHash = HASHY.test(body.replace(/function\s*\w*/, ''));
        if (plain.size && !hashed.size && !usesHash) {
          for (const code of plain) out.push({ ...f, code, notes: [...f.notes, `checked by ${f.validator}()`] });
          continue;
        }
        f.alias = breakFunction(f.validator, true);
        f.notes.push(`checked by ${f.validator}()` + (hashed.size || usesHash ? ' using a hash' : ''));
        out.push(f);
        continue;
      }
      if (f.hash != null && f.hashFn) {
        f.alias = breakFunction(f.hashFn, f.hash);
        if (!f.alias) f.notes.push(`${f.hashFn}() can't be reached, use Activate instead`);
      }
      out.push(f);
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Activate: run the cheat's effect directly (SugarCube 2)
  // ---------------------------------------------------------------------------

  const canActivate = () => !!(W.SugarCube?.State && (W.SugarCube.Wikifier || W.jQuery?.wiki));

  function setStoryVar(SC, name, value) {
    const root = name[0] === '$' ? SC.State.variables : name[0] === '_' ? SC.State.temporary : null;
    if (!root) return;
    const parts = name.slice(1).split('.');
    let obj = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (obj[parts[i]] == null || typeof obj[parts[i]] !== 'object') obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
  }

  function activate(f) {
    const SC = W.SugarCube;
    const value = f.code ?? f.alias ?? null;
    let effect = f.effect;
    if (f.var && value != null) {
      if (/^[$_]/.test(f.var)) setStoryVar(SC, f.var, value);
      else if (f.lang === 'js' && /^[A-Za-z_]\w*$/.test(f.var)) effect = `var ${f.var} = ${JSON.stringify(value)};\n` + effect;
    }
    if (f.lang === 'js') {
      if (SC.Scripting?.evalJavaScript) SC.Scripting.evalJavaScript(effect);
      else W.jQuery.wiki(`<<script>>${effect}<</script>>`);
    } else if (SC.Wikifier?.wikifyEval) {
      SC.Wikifier.wikifyEval(effect);
    } else {
      W.jQuery.wiki(effect);
    }
    // Re-render so changed variables show up, unless the cheat moves to another passage itself.
    if (!/<<\s*(goto|include|back|return)\b|Engine\.play|\[\[/.test(effect)) {
      if (SC.Engine?.show) SC.Engine.show();
      else if (SC.Engine?.play && SC.State?.passage) SC.Engine.play(SC.State.passage, true);
    }
  }

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .btn {
      position: fixed; left: 12px; bottom: 12px; width: 40px; height: 40px; border-radius: 50%;
      border: 2px solid #ff2e88; background: #14121c; color: #fff; font: 20px/1 system-ui, sans-serif;
      cursor: pointer; opacity: .45; transition: opacity .15s, transform .15s; pointer-events: auto;
      box-shadow: 0 2px 10px rgba(0,0,0,.5);
    }
    .btn:hover { opacity: 1; transform: scale(1.08); }
    .panel {
      position: fixed; left: 12px; bottom: 62px; width: min(520px, calc(100vw - 24px)); max-height: min(78vh, 760px);
      display: flex; flex-direction: column; pointer-events: auto;
      background: #14121c; color: #ece9f5; border: 2px solid #ff2e88; border-radius: 10px;
      font: 13px/1.45 system-ui, sans-serif; box-shadow: 0 10px 40px rgba(0,0,0,.6);
    }
    .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #2c2838; }
    .head h1 { margin: 0; font-size: 15px; flex: 1; }
    .head .engine { color: #a39cb8; font-size: 12px; }
    .x { background: none; border: 0; color: #ece9f5; font-size: 20px; cursor: pointer; padding: 0 4px; }
    .body { overflow: auto; padding: 10px 12px 12px; }
    .note { color: #a39cb8; margin: 0 0 8px; font-size: 12px; }
    .card { border: 1px solid #2c2838; border-radius: 8px; padding: 9px 10px; margin-bottom: 8px; background: #1b1826; }
    .top { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .code {
      font: 600 14px ui-monospace, Consolas, monospace; background: #ff2e88; color: #fff;
      padding: 2px 8px; border-radius: 5px; cursor: pointer; word-break: break-all;
    }
    .code.hash { background: #3a3550; font-weight: 400; font-size: 12px; }
    .alias { font: 600 14px ui-monospace, Consolas, monospace; color: #7dffb0; }
    .meta { color: #a39cb8; font-size: 12px; margin-top: 4px; }
    .tags { color: #ffd479; font-size: 12px; margin-top: 2px; }
    details { margin-top: 6px; }
    summary { cursor: pointer; color: #c9c3dc; font-size: 12px; }
    pre {
      margin: 6px 0 0; padding: 8px; max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-word;
      background: #0e0c14; border-radius: 6px; font: 12px/1.4 ui-monospace, Consolas, monospace; color: #d8d3e8;
    }
    .actions { display: flex; gap: 6px; margin-left: auto; }
    .act {
      font: 600 12px system-ui, sans-serif; padding: 4px 10px; border-radius: 5px; cursor: pointer;
      border: 1px solid #ff2e88; background: transparent; color: #ff8fc0;
    }
    .act:hover { background: #ff2e88; color: #fff; }
    .act.done { border-color: #7dffb0; color: #7dffb0; background: transparent; }
    .err { color: #ff6b6b; font-size: 12px; margin-top: 4px; }
    .empty { color: #a39cb8; padding: 6px 0; }
  `;

  let host, shadow, panel;

  function mountButton() {
    host = document.createElement('lhg-cheats');
    host.style.cssText = 'position: fixed; left: 0; bottom: 0; width: 0; height: 0; z-index: 2147483646;';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);
    const btn = el('button', { class: 'btn', title: 'Find cheat codes' }, '\u{1F511}');
    btn.addEventListener('click', () => (panel ? closePanel() : openPanel()));
    shadow.appendChild(btn);
    // Keep clicks and keys inside our UI away from the game.
    for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'keydown', 'keyup', 'wheel', 'touchstart', 'touchend']) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }
    document.body.appendChild(host);
  }

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    for (const c of children) if (c != null) e.append(c);
    return e;
  }

  function closePanel() {
    panel?.remove();
    panel = null;
  }

  async function openPanel() {
    closePanel();
    panel = el('div', { class: 'panel' });
    const body = el('div', { class: 'body' }, el('div', { class: 'empty' }, 'Reading the game\u2019s code\u2026'));
    const close = el('button', { class: 'x', title: 'Close' }, '\u00D7');
    close.addEventListener('click', closePanel);
    const engineLabel = el('span', { class: 'engine' });
    panel.append(el('div', { class: 'head' }, el('h1', {}, 'Cheat finder'), engineLabel, close), body);
    shadow.appendChild(panel);

    const { sources, notes, engine } = await collectSources();
    engineLabel.textContent = engine;
    const { findings } = scan(sources);
    const results = enrichAtRuntime(findings);
    render(body, results, notes, sources.length);
  }

  function render(body, results, notes, sourceCount) {
    body.textContent = '';
    for (const n of notes) body.append(el('p', { class: 'note' }, n));
    if (!sourceCount) {
      body.append(el('div', { class: 'empty' }, 'Couldn\u2019t find any game code on this page.'));
      return;
    }
    if (!results.length) {
      body.append(el('div', { class: 'empty' }, `No cheat codes found in ${sourceCount} passages/scripts.`));
      return;
    }
    body.append(el('p', { class: 'note' }, `${results.length} found. Click a code to copy it.`));
    const activatable = canActivate();
    for (const f of results) body.append(card(f, activatable));
  }

  function card(f, activatable) {
    const top = el('div', { class: 'top' });
    if (f.code != null) {
      const chip = el('span', { class: 'code', title: 'Copy' }, f.code);
      chip.addEventListener('click', () => copy(f.code, chip));
      top.append(chip);
    } else if (f.hash != null) {
      top.append(el('span', { class: 'code hash', title: f.hash }, `hashed${f.hashFn ? ` with ${f.hashFn}()` : ''}: ${f.hash.slice(0, 16)}\u2026`));
    } else if (f.validator) {
      top.append(el('span', { class: 'code hash' }, `${f.validator}()`));
    }
    if (f.alias) {
      const a = el('span', { class: 'alias', title: 'Copy' }, `type ${f.alias}`);
      a.addEventListener('click', () => copy(f.alias, a));
      top.append(a);
    }

    const actions = el('div', { class: 'actions' });
    const err = el('div', { class: 'err' });
    if (activatable && f.effect && f.effect.trim() && (f.lang === 'sugar' || f.lang === 'js')) {
      const b = el('button', { class: 'act', title: 'Run what this cheat does, without typing the code' }, 'Activate');
      b.addEventListener('click', () => {
        err.textContent = '';
        try {
          activate(f);
          b.textContent = 'Activated';
          b.classList.add('done');
        } catch (e) {
          err.textContent = 'Failed: ' + (e && e.message ? e.message : e);
        }
      });
      actions.append(b);
    }
    top.append(actions);

    const where = `${f.source}${f.line > 1 ? `, line ${f.line}` : ''}${f.var ? ` \u00B7 ${f.var}` : ''}`;
    const out = el('div', { class: 'card' }, top, el('div', { class: 'meta' }, where));
    const tags = [...f.notes];
    if (f.alias) tags.push(f.validator ? 'check broken: the stand-in code passes it' : 'hash broken: the stand-in code passes it');
    if (tags.length) out.append(el('div', { class: 'tags' }, tags.join(' \u00B7 ')));
    if (f.effect && f.effect.trim()) {
      const effect = f.effect.trim();
      out.append(el('details', {}, el('summary', {}, 'What it does'), el('pre', {}, effect.length > 2000 ? effect.slice(0, 2000) + '\n\u2026' : effect)));
    }
    out.append(err);
    return out;
  }

  function copy(text, node) {
    try {
      if (typeof GM_setClipboard === 'function') GM_setClipboard(text, 'text');
      else navigator.clipboard.writeText(text);
      const old = node.textContent;
      node.textContent = 'copied';
      setTimeout(() => (node.textContent = old), 800);
    } catch { /* ignore */ }
  }

  mountButton();
  if (typeof GM_registerMenuCommand === 'function') GM_registerMenuCommand('Find cheat codes', openPanel);
})();
