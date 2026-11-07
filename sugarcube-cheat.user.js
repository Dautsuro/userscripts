// ==UserScript==
// @name         SugarCube Cheat
// @namespace    sugarcube-cheat
// @version      1.0.3
// @description  Local SugarCube games: edit and freeze variables, see what a link will change, jump to any passage, change log, variable watcher, unlimited undo. Alt+C opens the panel.
// @match        file:///*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @inject-into  page
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';
  // Runs in the page (inject-into page) so game objects can be read and written without Firefox's sandbox wrappers.
  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : globalThis;

  // ---------- values and paths ----------
  // A path is an array of keys: ['player', 'stats', 'str']. Stored as JSON, shown as player.stats.str.
  const isObj = (v) => v !== null && typeof v === 'object';
  const tag = (v) => Object.prototype.toString.call(v).slice(8, -1);
  const walkable = (v) => isObj(v) && (Array.isArray(v) || tag(v) === 'Object');
  const pathKey = (path) => JSON.stringify(path);
  const pathLabel = (path) => path.join('.');
  const getAt = (root, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), root);
  function setAt(root, path, value) {
    let o = root;
    path.slice(0, -1).forEach((k, i) => { if (!isObj(o[k])) o[k] = /^\d+$/.test(path[i + 1]) ? [] : {}; o = o[k]; });
    o[path[path.length - 1]] = value;
  }
  function deleteAt(root, path) {
    const o = getAt(root, path.slice(0, -1));
    if (isObj(o)) delete o[path[path.length - 1]];
  }
  // Leaves of plain objects and arrays; Map/Set/Date/class values are leaves too. Cycles are skipped.
  function flatten(obj, path = [], out = [], seen = new Set([obj])) {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'function') continue;
      const p = [...path, k];
      if (!walkable(v)) { out.push([p, v]); continue; }
      if (seen.has(v)) continue;
      seen.add(v);
      const n = out.length;
      flatten(v, p, out, seen);
      seen.delete(v);
      if (out.length === n) out.push([p, v]); // empty object or array still gets a row
    }
    return out;
  }
  function cloneVal(v) {
    if (!isObj(v)) return v;
    try { return typeof W.clone === 'function' ? W.clone(v) : structuredClone(v); } catch {
      try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
    }
  }
  const ser = (v) => {
    try { return JSON.stringify(v, (k, x) => (tag(x) === 'Map' ? ['Map', [...x]] : tag(x) === 'Set' ? ['Set', [...x]] : x)); } catch { return NaN; }
  };
  const sameValue = (a, b) => Object.is(a, b) || (isObj(a) && isObj(b) && ser(a) === ser(b));
  const snapshot = (vars) => new Map(flatten(vars).map(([p, v]) => [pathKey(p), cloneVal(v)]));
  function diff(a, b) {
    const out = [];
    for (const key of new Set([...a.keys(), ...b.keys()])) {
      if (!sameValue(a.get(key), b.get(key))) out.push({ key, path: JSON.parse(key), old: a.get(key), new: b.get(key) });
    }
    return out;
  }
  function fmt(v) {
    if (v === undefined) return '(none)';
    if (tag(v) === 'Map' || tag(v) === 'Set') return `${tag(v)}(${v.size})`;
    let s;
    try { s = JSON.stringify(v); } catch { s = undefined; }
    if (s === undefined) s = String(v);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  }

  // Short wording for the hover box: groups of values aren't spelled out.
  const count = (n, one, many, empty) => (n ? `${many} ${n} ${n === 1 ? one : `${one}s`}` : empty);
  const plain = (v) => (Array.isArray(v) ? count(v.length, 'item', 'list of', 'empty list')
    : walkable(v) ? count(Object.keys(v).length, 'value', 'group of', 'empty group') : fmt(v));

  // ---------- reading <<set>> ----------
  // Split at top level, ignoring separators inside quotes and brackets.
  // `seps` is a string of separator characters, or a sticky RegExp.
  function splitTop(src, seps) {
    const out = [];
    let depth = 0, q = '', cur = '';
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (q) {
        cur += c;
        if (c === '\\') cur += src[++i] ?? '';
        else if (c === q) q = '';
        continue;
      }
      if (c === '"' || c === "'" || c === '`') q = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (!depth && typeof seps === 'string' && seps.includes(c)) { out.push(cur.trim()); cur = ''; continue; }
      else if (!depth && typeof seps !== 'string') {
        seps.lastIndex = i;
        const m = seps.exec(src);
        if (m) { out.push(cur.trim()); cur = ''; i += m[0].length - 1; continue; }
      }
      cur += c;
    }
    out.push(cur.trim());
    return out.filter(Boolean);
  }
  const TARGET = String.raw`\$[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])*`;
  const ASSIGN_RE = new RegExp(String.raw`^(${TARGET})\s*(?:(\+\+|--)|(to\b|[-+*/]?=(?!=))\s*([\s\S]+))$`);
  function parseAssign(expr) {
    const m = expr.trim().match(ASSIGN_RE);
    if (!m) return null;
    return m[2] ? { target: m[1], op: m[2], rhs: '' } : { target: m[1], op: m[3] === '=' ? 'to' : m[3], rhs: m[4].trim() };
  }
  // '$p["a b"][0].c' → ['p', 'a b', '0', 'c']; null when a key is computed ($a[$i]).
  function targetPath(t) {
    const m = t.match(/^\$([A-Za-z_$][\w$]*)/);
    if (!m) return null;
    const path = [m[1]];
    const re = /^(?:\.([A-Za-z_$][\w$]*)|\[\s*(?:(\d+)|"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')\s*\])/;
    for (let rest = t.slice(m[0].length); rest;) {
      const s = rest.match(re);
      if (!s) return null;
      path.push(s[1] ?? s[2] ?? s[3] ?? s[4]);
      rest = rest.slice(s[0].length);
    }
    return path;
  }
  // Links inside a passage only run when clicked, so their code is skipped. <<if>>/<<switch>> become
  // control items ({ctl}) that evalChanges evaluates; loops and timers make their content "maybe".
  const SKIP_TAGS = new Set(['link', 'button', 'linkreplace', 'linkappend', 'linkprepend', 'click', 'widget', 'listbox', 'cycle']);
  const MAYBE_TAGS = new Set(['if', 'switch', 'for', 'timed', 'repeat']);
  const unquote = (s) => s.trim().replace(/^\[\[|\]\]$/g, '').replace(/^(["'])(.*)\1$/, '$2');
  function extractChanges(src) {
    const out = [], stack = [];
    src = String(src || '').replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->|\/%[\s\S]*?%\//g, '');
    // shortcut: a ">>" inside a macro's arguments ends it early; fine for real games so far.
    const re = /<<(\/?)([\w-]+)\s*([\s\S]*?)>>/g;
    for (let m; (m = re.exec(src));) {
      const [, close, name, args] = m;
      const old = !close && name.startsWith('end') && (SKIP_TAGS.has(name.slice(3)) || MAYBE_TAGS.has(name.slice(3)));
      if (close || old) {
        const i = stack.map((f) => f.name).lastIndexOf(old ? name.slice(3) : name);
        if (i >= 0) for (const f of stack.splice(i)) if (f.emitted) out.push({ ctl: 'end' });
        continue;
      }
      const skipped = stack.some((f) => SKIP_TAGS.has(f.name));
      if (SKIP_TAGS.has(name) || MAYBE_TAGS.has(name)) {
        const emitted = !skipped && MAYBE_TAGS.has(name);
        stack.push({ name, emitted });
        if (emitted) out.push(name === 'if' || name === 'switch' ? { ctl: name, expr: args.trim() } : { ctl: 'loop' });
        continue;
      }
      if (skipped) continue;
      const top = stack[stack.length - 1]?.name;
      if (name === 'elseif' && top === 'if') out.push({ ctl: 'elseif', expr: args.trim() });
      else if (name === 'else' && top === 'if') out.push({ ctl: 'else' });
      else if (name === 'case' && top === 'switch') out.push({ ctl: 'case', exprs: splitTop(args, ' \t\r\n') });
      else if (name === 'default' && top === 'switch') out.push({ ctl: 'else' });
      else if (name === 'set') {
        for (const part of splitTop(args, ',;')) { const a = parseAssign(part); if (a) out.push(a); }
      } else if (name === 'unset') {
        for (const t of splitTop(args, ',;')) if (t.startsWith('$')) out.push({ target: t, op: 'unset', rhs: '' });
      } else if (name === 'run') {
        out.push({ code: args.trim() });
      } else if (name === 'script') {
        const end = src.indexOf('<</script>>', re.lastIndex);
        out.push({ code: src.slice(re.lastIndex, end < 0 ? undefined : end).trim() });
        if (end >= 0) re.lastIndex = end + 11;
      } else if (name === 'goto') {
        out.push({ goto: unquote(args) });
      }
    }
    return out;
  }
  // Right-hand sides are only evaluated when they can't have side effects: no calls except pure Math helpers.
  function safeRhs(rhs) {
    if (rhs.includes('`')) return false; // template literals can run code inside ${…}
    const s = rhs.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""')
      .replace(/\bMath\.(?:min|max|round|floor|ceil|abs|trunc|pow|sqrt)\s*\(/g, '(')
      .replace(/\.clamp\s*\(/g, '+(');
    return !/[\w$\])]\s*\(|\+\+|--|\bdelete\b|\bnew\b|\bto\b|(^|[^=!<>])=(?!=)/.test(s);
  }
  // Evaluates a side-effect-free expression against the copies; throws when it can't.
  function evalExpr(expr, vars, temp) {
    if (!safeRhs(expr)) throw new Error('unsafe');
    const desugar = W.SugarCube?.Scripting?.desugar ?? ((s) => s.replace(/\$(?=[A-Za-z_])/g, 'State.variables.')); // fallback: self-check only
    const code = desugar(expr).replace(/\bState\.variables\b/g, '__v').replace(/\bState\.temporary\b/g, '__t');
    return new W.Function('__v', '__t', `"use strict"; return (${code});`)(vars, temp);
  }
  // A condition can't be trusted when it reads a temp variable (_x: not tracked, and cleared between
  // passages) or a variable whose predicted value is only a guess (`doubt`: paths set under "maybe").
  function doubtful(expr, doubt) {
    const s = expr.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
    if (/(^|[^\w$.])_[A-Za-z_$]/.test(s)) return true;
    if (!doubt.size) return false;
    for (const [t] of s.matchAll(new RegExp(TARGET, 'g'))) {
      const p = targetPath(t) || [t.match(/^\$([\w$]+)/)[1]]; // computed key: compare by root
      for (const d of doubt) {
        const n = Math.min(p.length, d.length);
        if (p.slice(0, n).every((k, i) => k === d[i])) return true;
      }
    }
    return false;
  }
  const evalLeaf = (expr, vars, temp, doubt) => {
    if (doubtful(expr, doubt)) throw new Error('unknown');
    return evalExpr(expr, vars, temp);
  };
  // True when `expr` is one bracketed group, like "(a || b)" but not "(a) - (b)".
  function wrapped(expr) {
    if (!expr.startsWith('(') || !expr.endsWith(')')) return false;
    let depth = 0, q = '';
    for (let i = 0; i < expr.length - 1; i++) {
      const c = expr[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
      if (c === '"' || c === "'" || c === '`') q = c;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c) && --depth === 0) return false;
    }
    return true;
  }
  // true / false, or '?' when the condition can't be worked out without running game code.
  // and/or are worked out part by part, so `gameFn() and $q is 8` is false when $q isn't 8.
  const OR_RE = /\|\||\s+or\s+/y, AND_RE = /&&|\s+and\s+/y;
  function evalCond(expr, vars, temp, doubt = new Set()) {
    expr = expr.trim();
    if (splitTop(expr, '?').length === 1) { // a top-level ?: binds weaker than and/or, so don't split those
      const ors = splitTop(expr, OR_RE);
      if (ors.length > 1) {
        const v = ors.map((e) => evalCond(e, vars, temp, doubt));
        return v.includes(true) ? true : v.includes('?') ? '?' : false;
      }
      const ands = splitTop(expr, AND_RE);
      if (ands.length > 1) {
        const v = ands.map((e) => evalCond(e, vars, temp, doubt));
        return v.includes(false) ? false : v.includes('?') ? '?' : true;
      }
    }
    if (wrapped(expr)) return evalCond(expr.slice(1, -1), vars, temp, doubt);
    try { return !!evalLeaf(expr, vars, temp, doubt); } catch { return '?'; }
  }
  // Next branch of an if/switch: `v` is this branch's condition; earlier branches may already be taken.
  function nextBranch(f, v) {
    f.cur = f.taken === true ? false : f.taken === false ? v : v === false ? false : '?';
    f.taken = f.taken === true || v === true ? true : f.taken === false && v === false ? false : '?';
  }
  // Applies the changes to `vars` (a copy) in order and returns the result per variable.
  // Conditions are evaluated where they appear, so branches that won't run are left out.
  function evalChanges(changes, vars, temp, res = new Map(), notes = []) {
    const frames = [];
    const doubt = res.doubt ??= new Set(); // paths whose predicted value is a guess; kept across calls on the same res
    for (const c of changes) {
      if (c.ctl) {
        const f = frames[frames.length - 1];
        // Later branches are checked against the values from before an earlier "maybe" branch ran.
        const sv = f?.snap?.vars ?? vars, sd = f?.snap?.doubt ?? doubt;
        const snapIfMaybe = (fr) => { if (fr.cur === '?' && !fr.snap) fr.snap = { vars: cloneVal(vars), doubt: new Set(doubt) }; };
        if (c.ctl === 'if') { const v = evalCond(c.expr, vars, temp, doubt); frames.push({ cur: v, taken: v }); snapIfMaybe(frames[frames.length - 1]); }
        else if (c.ctl === 'switch') {
          let sw = '?'; try { sw = { v: evalLeaf(c.expr, vars, temp, doubt) }; } catch { /* unknown */ }
          frames.push({ sw, cur: false, taken: false });
        } else if (c.ctl === 'loop') frames.push({ cur: '?', taken: '?' });
        else if (c.ctl === 'end') frames.pop();
        else if (f && c.ctl === 'elseif') { nextBranch(f, f.taken === true ? false : evalCond(c.expr, sv, temp, sd)); snapIfMaybe(f); }
        else if (f && c.ctl === 'else') { nextBranch(f, true); snapIfMaybe(f); }
        else if (f && c.ctl === 'case') {
          let v = false;
          for (const e of c.exprs) {
            if (f.sw === '?') { v = '?'; break; }
            try { if (evalLeaf(e, sv, temp, sd) === f.sw.v) { v = true; break; } } catch { v = '?'; }
          }
          nextBranch(f, v);
          snapIfMaybe(f);
        }
        continue;
      }
      if (frames.some((f) => f.cur === false)) continue; // this branch won't run
      const maybe = frames.some((f) => f.cur === '?');
      if (c.code) { notes.push({ code: true }); continue; }
      if (c.goto) { notes.push({ goto: c.goto, maybe }); continue; }
      const path = targetPath(c.target);
      const key = path ? pathKey(path) : c.target;
      const prev = res.get(key);
      const entry = prev || { label: path ? pathLabel(path) : c.target.slice(1), old: path ? cloneVal(getAt(vars, path)) : undefined, maybe: false };
      entry.maybe ||= maybe;
      res.set(key, entry);
      // A guessed or unknown value: later conditions that read it give '?'.
      if (maybe || !path || entry.raw) doubt.add(path || [c.target.match(/^\$([\w$]+)/)?.[1] ?? '']);
      if (!path || entry.raw) { entry.raw = `${c.op} ${c.rhs}`.trim(); continue; }
      const cur = getAt(vars, path);
      let val;
      if (c.op === '++') val = cur + 1;
      else if (c.op === '--') val = cur - 1;
      else if (c.op === 'unset') { deleteAt(vars, path); entry.new = undefined; continue; } else {
        try { val = evalExpr(c.rhs, vars, temp); } catch { entry.raw = `${c.op} ${c.rhs}`; doubt.add(path); continue; }
        if (doubtful(c.rhs, doubt)) { entry.maybe = true; doubt.add(path); } // computed from a guess
        if (c.op === '+=') val = cur + val;
        else if (c.op === '-=') val = cur - val;
        else if (c.op === '*=') val = cur * val;
        else if (c.op === '/=') val = cur / val;
      }
      setAt(vars, path, val);
      entry.new = cloneVal(val);
    }
    return { res, notes };
  }

  // ---------- game id (same as sugarcube-video-watcher) ----------
  let gid = '';
  const titleId = (t) => t.replace(/[\s(\[-]*\bv?\d+(\.\d+)+[a-z]?\b[)\]]?/gi, '').trim();
  const folderId = (url) => { try { return decodeURIComponent(url).match(/\/Games\/([^/?#]+)\//i)?.[1] || ''; } catch { return ''; } };
  const gameId = () => (gid ||= document.querySelector('tw-storydata')?.getAttribute('ifid') || folderId(location.href) || titleId(document.title));

  // ---------- the cheat ----------
  let SC = null;
  const freezes = new Map(); // pathKey → value
  const linkInfo = new WeakMap(); // link element → { dest, src, unknown }
  const log = []; // [{ passage, changes }], newest first
  let prevSnap = null, watch = null, curMarkup = null;
  const saveFreezes = () => GM_setValue(`freeze:${gameId()}`, [...freezes]);

  function applyFreezes() {
    const vars = SC.State.variables;
    for (const [k, v] of freezes) {
      const p = JSON.parse(k);
      if (!sameValue(getAt(vars, p), v)) setAt(vars, p, cloneVal(v));
    }
  }
  function applyUndo() {
    try { SC.Config.history.maxStates = 1000; } catch { /* older versions */ }
    try { SC.Config.history.controls = true; } catch { /* older versions */ }
  }
  const refreshGameUI = () => { try { SC.UIBar.update?.(); } catch { /* not every game has the bar */ } };

  function onPassageEnd() {
    applyFreezes();
    const cur = snapshot(SC.State.variables);
    if (prevSnap) {
      const changes = diff(prevSnap, cur);
      if (changes.length) { log.unshift({ passage: SC.State.passage, changes }); log.length = Math.min(log.length, 20); }
      if (watch && !watch.done) for (const d of diff(watch.prev, cur)) watch.seen.add(d.key);
    }
    prevSnap = cur;
    if (watch && !watch.done) watch.prev = cur;
    ui.refresh();
  }

  function installHooks() {
    const Wik = SC.Wikifier;
    // Wiki links [[text|dest][setter]]: links made while the link parser runs get its markup
    // (w.matchText is only "[[x"; the whole link is source[matchStart..nextMatch] once it has run).
    const lp = Wik.Parser?.get?.('link');
    if (lp) {
      const orig = lp.handler;
      lp.handler = function (w) {
        const made = curMarkup = [], start = w.matchStart;
        try { return orig.call(this, w); } finally {
          curMarkup = null;
          try {
            const mk = w.source.slice(start, w.nextMatch), i = mk.indexOf('][');
            for (const { el, passage } of made) linkInfo.set(el, { dest: passage, src: i > 0 ? `<<set ${mk.slice(i + 2, -2)}>>` : '' });
          } catch { /* never break the game */ }
        }
      };
    }
    const origLink = Wik.createInternalLink;
    Wik.createInternalLink = function (dest, passage, text, cb) {
      const el = origLink.apply(this, arguments);
      try {
        if (el && !linkInfo.has(el)) {
          if (curMarkup) curMarkup.push({ el, passage });
          else linkInfo.set(el, { dest: passage, src: '', unknown: typeof cb === 'function' });
        }
      } catch { /* never break the game */ }
      return el;
    };
    for (const name of ['link', 'button', 'linkreplace', 'linkappend', 'linkprepend']) {
      const def = SC.Macro.get(name);
      if (!def) continue;
      const orig = def.handler;
      def.handler = function () {
        const before = this.output.lastElementChild;
        const r = orig.apply(this, arguments);
        try {
          const last = this.output.lastElementChild;
          const el = last && last !== before && (last.matches('a, button') ? last : last.querySelector('a, button'));
          if (el) {
            const raw = this.args.raw || '', i = raw.indexOf('][');
            const setter = i > 0 ? `<<set ${raw.slice(i + 2, raw.lastIndexOf(']]'))}>>` : '';
            const a0 = this.args[0];
            const dest = isObj(a0) ? a0.link : name === 'link' || name === 'button' ? this.args[1] : undefined; // linkreplace's 2nd arg is a transition
            linkInfo.set(el, { dest, src: setter + (this.payload[0]?.contents || '') });
          }
        } catch { /* never break the game */ }
        return r;
      };
    }
  }

  function preview(info) {
    const vars = cloneVal(SC.State.variables), temp = cloneVal(SC.State.temporary || {});
    const out = evalChanges(extractChanges(info.src), vars, temp);
    if (info.unknown) out.notes.push({ code: true });
    if (info.dest && SC.Story.has(info.dest)) evalChanges(extractChanges(SC.Story.get(info.dest).text), vars, temp, out.res, out.notes);
    return out;
  }

  // ---------- UI ----------
  const h = (tagName, props = {}, ...kids) => {
    const e = document.createElement(tagName);
    for (const [k, v] of Object.entries(props)) if (k in e) e[k] = v; else e.setAttribute(k, v);
    e.append(...kids.filter((k) => k != null));
    return e;
  };
  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font: 13px/1.35 system-ui, sans-serif; }
    .panel { position: fixed; top: 10px; right: 10px; width: 400px; max-height: 85vh; display: flex; flex-direction: column;
      background: #1e1f24; color: #e6e6e6; border: 1px solid #555; border-radius: 6px; box-shadow: 0 4px 20px #0008; z-index: 2147483647; }
    .panel[hidden], .tip[hidden], section[hidden] { display: none; }
    header { display: flex; align-items: center; gap: 4px; padding: 6px; border-bottom: 1px solid #444; cursor: move; user-select: none; }
    header b { flex: 1; }
    nav { display: flex; gap: 2px; padding: 4px 6px; border-bottom: 1px solid #444; }
    button { background: #33353d; color: inherit; border: 1px solid #555; border-radius: 4px; padding: 2px 8px; cursor: pointer; }
    button:hover { background: #444750; } button.on { background: #3d5a99; border-color: #5b7bd5; }
    input[type=text], input:not([type]) { background: #111216; color: inherit; border: 1px solid #555; border-radius: 4px; padding: 3px 5px; }
    section { display: flex; flex-direction: column; gap: 6px; padding: 6px; overflow: auto; min-height: 0; }
    .bar { display: flex; gap: 4px; align-items: center; } .bar .q { flex: 1; }
    .row { display: flex; align-items: center; gap: 4px; padding: 2px 0; border-bottom: 1px solid #2c2d33; }
    .row .k { flex: 1 1 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9fc3ff; }
    .row .v { flex: 1 1 40%; min-width: 0; } .row .ro { color: #aaa; }
    .row button { padding: 0 6px; }
    .click { cursor: pointer; } .click:hover { background: #2a2c33; }
    .muted { color: #999; } .maybe { color: #e0b050; } .old { color: #e88; } .new { color: #8e8; }
    .entry { padding: 4px 0; border-bottom: 1px solid #333; } .entry b { color: #ccc; }
    footer { padding: 6px; border-top: 1px solid #444; }
    .tip { position: fixed; max-width: 420px; background: #1e1f24f2; color: #e6e6e6; border: 1px solid #666; border-radius: 6px;
      padding: 6px 8px; pointer-events: none; z-index: 2147483647; box-shadow: 0 2px 12px #0008; }
    .tip div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;

  const ui = {
    host: null, root: null, panel: null, tip: null, tab: 'vars', els: {},
    init() {
      this.host = h('div', { id: 'sc-cheat-host' });
      this.root = this.host.attachShadow({ mode: 'open' });
      const e = this.els;
      e.qVars = h('input', { className: 'q', placeholder: 'Search name or value' });
      e.step = h('input', { value: '1', title: 'Step for − and +', style: 'width:50px' });
      e.vars = h('div');
      e.qPass = h('input', { className: 'q', placeholder: 'Search passage name' });
      e.pass = h('div');
      e.watchBtn = h('button', { textContent: 'Start watching' });
      e.watch = h('div');
      e.log = h('div');
      e.undo = h('input', { type: 'checkbox' });
      const tabs = { vars: 'Variables', passages: 'Passages', watch: 'Watch', log: 'Log' };
      e.tabBtns = Object.entries(tabs).map(([id, name]) => h('button', { textContent: name, onclick: () => this.showTab(id) }));
      e.sections = {
        vars: h('section', {}, h('div', { className: 'bar' }, e.qVars, e.step), e.vars),
        passages: h('section', {}, h('div', { className: 'bar' }, e.qPass), e.pass),
        watch: h('section', {}, h('div', { className: 'bar' }, e.watchBtn, h('span', { className: 'muted', textContent: 'Play, then stop to see what changed.' })), e.watch),
        log: h('section', {}, e.log),
      };
      const close = h('button', { textContent: '✕', title: 'Close (Alt+C)', onclick: () => this.close() });
      const header = h('header', {}, h('b', { textContent: 'SugarCube cheat' }), close);
      this.panel = h('div', { className: 'panel', hidden: true }, header, h('nav', {}, ...e.tabBtns), ...Object.values(e.sections),
        h('footer', {}, h('label', {}, e.undo, ' Unlimited undo')));
      this.tip = h('div', { className: 'tip', hidden: true });
      this.root.append(h('style', { textContent: CSS }), this.panel, this.tip);
      // Keep the game's own key and click handlers out of the panel.
      for (const ev of ['keydown', 'keyup', 'keypress', 'click', 'mousedown', 'mouseup', 'pointerdown', 'input', 'change', 'wheel']) {
        this.host.addEventListener(ev, (x) => x.stopPropagation());
      }
      e.qVars.addEventListener('input', () => this.renderVars());
      e.qPass.addEventListener('input', () => this.renderPassages());
      e.watchBtn.addEventListener('click', () => this.toggleWatch());
      e.undo.checked = GM_getValue(`undo:${gameId()}`, false);
      e.undo.addEventListener('change', () => { GM_setValue(`undo:${gameId()}`, e.undo.checked); if (e.undo.checked) applyUndo(); });
      header.addEventListener('pointerdown', (x) => {
        if (x.target !== header && x.target.tagName !== 'B') return;
        const r = this.panel.getBoundingClientRect(), dx = x.clientX - r.left, dy = x.clientY - r.top;
        const move = (m) => Object.assign(this.panel.style, { left: `${Math.max(0, m.clientX - dx)}px`, top: `${Math.max(0, m.clientY - dy)}px`, right: 'auto' });
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
        addEventListener('pointermove', move);
        addEventListener('pointerup', up);
      });
      document.documentElement.append(this.host);
      this.showTab('vars');
    },
    open() { this.panel.hidden = false; this.refresh(); },
    close() { this.panel.hidden = true; },
    toggle() { if (this.panel.hidden) this.open(); else this.close(); },
    showTab(id) {
      this.tab = id;
      for (const [k, s] of Object.entries(this.els.sections)) s.hidden = k !== id;
      this.els.tabBtns.forEach((b, i) => b.classList.toggle('on', Object.keys(this.els.sections)[i] === id));
      this.refresh();
    },
    refresh() {
      if (!this.panel || this.panel.hidden) return;
      // Don't redraw a row the user is typing in.
      if (this.tab === 'vars' && this.root.activeElement?.closest?.('.row')) return;
      ({ vars: () => this.renderVars(), passages: () => this.renderPassages(), watch: () => this.renderWatch(), log: () => this.renderLog() })[this.tab]();
    },
    focusVar(key) {
      this.els.qVars.value = pathLabel(JSON.parse(key));
      this.showTab('vars');
    },
    renderVars() {
      const q = this.els.qVars.value.trim().toLowerCase();
      const vars = SC.State.variables;
      const rows = flatten(vars).filter(([p, v]) => !q || pathLabel(p).toLowerCase().includes(q) || fmt(v).toLowerCase().includes(q));
      const list = rows.slice(0, 300).map(([p, v]) => this.varRow(p, v));
      if (rows.length > 300) list.push(h('div', { className: 'muted', textContent: `${rows.length - 300} more, refine the search` }));
      if (!rows.length) list.push(h('div', { className: 'muted', textContent: 'No variables match.' }));
      this.els.vars.replaceChildren(...list);
    },
    varRow(path, v) {
      const key = pathKey(path);
      const row = h('div', { className: 'row' }, h('span', { className: 'k', textContent: pathLabel(path), title: pathLabel(path) }));
      if ((isObj(v) && !walkable(v)) || JSON.stringify(v) === undefined || (typeof v === 'number' && !Number.isFinite(v))) { row.append(h('span', { className: 'v ro', textContent: fmt(v), title: 'read-only' })); return row; }
      const input = h('input', { className: 'v', value: JSON.stringify(v) });
      input.addEventListener('change', () => {
        let nv;
        try { nv = JSON.parse(input.value); } catch { nv = input.value; } // not JSON → plain text
        this.write(path, nv, input);
      });
      row.append(input);
      if (typeof v === 'number') {
        const step = () => Number(this.els.step.value) || 1;
        row.append(h('button', { textContent: '−', onclick: () => this.write(path, getAt(SC.State.variables, path) - step(), input) }),
          h('button', { textContent: '+', onclick: () => this.write(path, getAt(SC.State.variables, path) + step(), input) }));
      }
      const fz = h('input', { type: 'checkbox', checked: freezes.has(key), title: 'Freeze' });
      fz.addEventListener('change', () => {
        if (fz.checked) freezes.set(key, cloneVal(getAt(SC.State.variables, path))); else freezes.delete(key);
        saveFreezes();
      });
      row.append(h('label', { title: 'Freeze' }, fz, '❄'));
      return row;
    },
    write(path, v, input) {
      setAt(SC.State.variables, path, v);
      const key = pathKey(path);
      if (freezes.has(key)) { freezes.set(key, cloneVal(v)); saveFreezes(); }
      input.value = JSON.stringify(v);
      refreshGameUI();
    },
    renderPassages() {
      const q = this.els.qPass.value.trim().toLowerCase();
      const special = /^(Story(Init|Caption|Menu|Banner|Subtitle|Author|Title|Data|Interface|Share)|Passage(Ready|Done|Header|Footer))$/;
      const hiddenTags = ['script', 'stylesheet', 'widget', 'Twine.private'];
      const all = (SC.Story.filter || SC.Story.lookupWith).call(SC.Story, (p) => !special.test(p.name) && !p.tags.some((t) => hiddenTags.includes(t)));
      const rows = all.filter((p) => !q || p.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
      const list = rows.slice(0, 300).map((p) => h('div', { className: 'row click', title: 'Go to this passage', onclick: () => SC.Engine.play(p.name) },
        h('span', { className: 'k', textContent: p.name }), p.tags.length ? h('span', { className: 'muted', textContent: p.tags.join(' ') }) : null));
      if (rows.length > 300) list.push(h('div', { className: 'muted', textContent: `${rows.length - 300} more, refine the search` }));
      this.els.pass.replaceChildren(...list);
    },
    changeLine(path, old, nw, extra) {
      return h('div', { className: 'row click', onclick: () => this.focusVar(pathKey(path)) },
        h('span', { className: 'k', textContent: pathLabel(path) }),
        h('span', {}, h('span', { className: 'old', textContent: fmt(old) }), ' → ', h('span', { className: 'new', textContent: fmt(nw) }),
          extra ? h('span', { className: 'maybe', textContent: ` ${extra}` }) : null));
    },
    renderLog() {
      if (!log.length) { this.els.log.replaceChildren(h('div', { className: 'muted', textContent: 'No changes yet. Changes show up after each passage.' })); return; }
      this.els.log.replaceChildren(...log.map((e, i) => h('div', { className: 'entry' },
        h('b', { textContent: `${i ? '' : 'Last: '}${e.passage}` }), ...e.changes.map((c) => this.changeLine(c.path, c.old, c.new)))));
    },
    toggleWatch() {
      const cur = snapshot(SC.State.variables);
      if (!watch || watch.done) {
        watch = { start: cur, prev: cur, seen: new Set(), done: false };
      } else {
        for (const d of diff(watch.prev, cur)) watch.seen.add(d.key); // changes made without a passage change
        Object.assign(watch, { prev: cur, end: cur, done: true });
      }
      this.renderWatch();
    },
    renderWatch() {
      const e = this.els;
      if (!watch) { e.watchBtn.textContent = 'Start watching'; e.watch.replaceChildren(); return; }
      if (!watch.done) {
        e.watchBtn.textContent = 'Stop';
        e.watch.replaceChildren(h('div', { className: 'muted', textContent: `Watching… ${watch.seen.size} variable(s) changed so far.` }));
        return;
      }
      e.watchBtn.textContent = 'Start watching';
      const rows = [...watch.seen].map((k) => {
        const old = watch.start.get(k), nw = watch.end.get(k);
        return this.changeLine(JSON.parse(k), old, nw, sameValue(old, nw) ? '(changed, then reverted)' : '');
      });
      e.watch.replaceChildren(...(rows.length ? rows : [h('div', { className: 'muted', textContent: 'Nothing changed.' })]));
    },
    showTip(info, x, y) {
      let out;
      try { out = preview(info); } catch { out = { res: new Map(), notes: [{ code: true }] }; }
      const lines = [];
      if (info.dest) lines.push(h('div', {}, h('b', { textContent: '→ ' }), info.dest));
      const changes = [...out.res.values()].filter((r) => r.raw != null || !sameValue(r.old, r.new)); // drop "sets it to what it already is"
      for (const r of changes.slice(0, 30)) {
        const m = r.maybe ? h('span', { className: 'maybe', textContent: ' (maybe)' }) : null;
        lines.push(r.raw != null
          ? h('div', {}, `${r.label}: `, h('span', { className: 'muted', textContent: 'changes (new value unknown)' }), m)
          : h('div', {}, `${r.label}: `, h('span', { className: 'old', textContent: plain(r.old) }), ' → ', h('span', { className: 'new', textContent: plain(r.new) }), m));
      }
      if (changes.length > 30) lines.push(h('div', { className: 'muted', textContent: `…and ${changes.length - 30} more` }));
      // Game code can't be read safely, so say so once in plain words instead of showing it.
      for (const g of new Set(out.notes.filter((n) => n.goto).map((n) => n.goto + (n.maybe ? ' (maybe)' : '')))) lines.push(h('div', { textContent: `then goes to ${g}` }));
      if (out.notes.some((n) => n.code)) lines.push(h('div', { className: 'muted', textContent: 'Also runs game code, so it may change more than shown.' }));
      if (!changes.length && !out.notes.length) lines.push(h('div', { className: 'muted', textContent: 'No variable changes found.' }));
      this.tip.replaceChildren(...lines);
      this.tip.hidden = false;
      const r = this.tip.getBoundingClientRect();
      this.tip.style.left = `${Math.min(x + 14, innerWidth - r.width - 4)}px`;
      this.tip.style.top = `${y + 18 + r.height > innerHeight ? Math.max(0, y - r.height - 8) : y + 18}px`;
    },
  };

  function linkAt(node) {
    for (let n = node; n && n.nodeType === 1 && n !== document.body; n = n.parentElement) {
      if (n === ui.host) return null;
      const info = linkInfo.get(n);
      if (info) return { el: n, info };
      // Only link-like elements: the passage box itself also carries data-passage (the current passage).
      if (n.dataset?.passage != null && n.matches('a, button, area, .link-internal, [role="link"]')) {
        return { el: n, info: { dest: n.dataset.passage, src: n.dataset.setter ? `<<set ${n.dataset.setter}>>` : '' } };
      }
    }
    return null;
  }

  function start() {
    SC = W.SugarCube;
    if (!SC?.State || !SC.Wikifier || !SC.Macro) return; // not a SugarCube 2 game
    for (const [k, v] of GM_getValue(`freeze:${gameId()}`, [])) freezes.set(k, v);
    const undo = GM_getValue(`undo:${gameId()}`, false);
    if (undo) applyUndo();
    const late = !!SC.State.passage; // the game started before us
    installHooks();
    const $ = W.jQuery;
    $(document).on(':passagestart', () => applyFreezes());
    $(document).on(':passageend', onPassageEnd);
    $(document).on(':storyready', () => { if (undo) applyUndo(); }); // the game's own script may have reset it
    ui.init();
    let hovered = null;
    document.addEventListener('mouseover', (e) => {
      const hit = linkAt(e.target);
      if (!hit) { if (hovered) { hovered = null; ui.tip.hidden = true; } return; }
      if (hit.el === hovered) return;
      hovered = hit.el;
      ui.showTip(hit.info, e.clientX, e.clientY);
    }, true);
    document.addEventListener('click', () => { hovered = null; ui.tip.hidden = true; }, true);
    addEventListener('keydown', (e) => {
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.code !== 'KeyC') return;
      const t = e.target;
      if (t !== ui.host && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      e.stopPropagation();
      ui.toggle();
    }, true);
    GM_registerMenuCommand('SugarCube cheat panel', () => ui.toggle());
    // Started before us (rare): no re-render, since replaying the passage would run its <<set>>s twice.
    // Hover info then starts at the next passage.
    if (late) prevSnap = snapshot(SC.State.variables);
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  // ---------- self-check ----------
  const fl = flatten({ a: { b: 1 }, c: [2], e: {} }).map(([p]) => pathKey(p));
  console.assert(fl.join() === '["a","b"],["c","0"],["e"]', 'scc: flatten');
  const cyc = { x: 1 }; cyc.self = cyc;
  console.assert(flatten(cyc).length === 1, 'scc: cycle skipped');
  console.assert(pathLabel(['a', 'x.y']) === 'a.x.y', 'scc: label');
  const so = {}; setAt(so, ['a', 'b'], 3);
  console.assert(so.a.b === 3 && getAt(so, ['a', 'b']) === 3, 'scc: setAt/getAt');
  const dd = diff(snapshot({ gold: 1, m: new Map([[1, 2]]) }), snapshot({ gold: 2, x: 1, m: new Map([[1, 2]]) }));
  console.assert(dd.length === 2 && dd[0].key === '["gold"]' && dd[0].old === 1 && dd[0].new === 2 && dd[1].old === undefined, 'scc: diff');
  console.assert(!sameValue(new Map([[1, 2]]), new Map([[1, 3]])), 'scc: Map compare');
  const ec = (s) => extractChanges(s);
  const c1 = ec('<<set $a to 5, $b += 2>>');
  console.assert(c1.length === 2 && c1[0].op === 'to' && c1[0].rhs === '5' && c1[1].op === '+=' && c1[1].target === '$b', 'scc: two sets');
  const c2 = ec('<<set $x to "a, b; c">>');
  console.assert(c2.length === 1 && c2[0].rhs === '"a, b; c"', 'scc: quoted separators');
  console.assert(ec('<<set $o.k to [1,2]>>')[0].target === '$o.k', 'scc: dotted target');
  console.assert(ec('<<if $q>><<set $z to 1>><</if>><<set $y = 2>>').map((c) => c.ctl || c.target).join() === 'if,$z,end,$y', 'scc: if items');
  // Conditions are evaluated (node has no desugar, so plain JS operators here).
  const ev = (src, vars) => [...evalChanges(ec(src), vars, {}).res.values()].map((r) => `${r.label}=${r.new}${r.maybe ? '?' : ''}`).join();
  const quest = '<<if $q === 0>><<set $q to 1>><<set $r to 5>><<elseif $q === 6>><<set $q to 7>><<else>><<set $z to 9>><</if>>';
  console.assert(ev(quest, { q: 0 }) === 'q=1,r=5', 'scc: if true branch, condition read before its own sets');
  console.assert(ev(quest, { q: 6 }) === 'q=7', 'scc: elseif branch');
  console.assert(ev(quest, { q: 3 }) === 'z=9', 'scc: else branch');
  console.assert(ev('<<if setup.f()>><<set $a to 1>><<else>><<set $b to 2>><</if>>', {}) === 'a=1?,b=2?', 'scc: unreadable condition stays maybe');
  console.assert(ev('<<if $q === 1>><<if $q === 2>><<set $a to 1>><</if>><<set $b to 2>><</if>>', { q: 1 }) === 'b=2', 'scc: nested if');
  console.assert(ev('<<switch $s>><<case 1 2>><<set $a to 1>><<case 3>><<set $b to 1>><<default>><<set $c to 1>><</switch>>', { s: 2 }) === 'a=1', 'scc: switch case');
  console.assert(ev('<<switch $s>><<case 1>><<set $a to 1>><<default>><<set $c to 1>><</switch>>', { s: 5 }) === 'c=1', 'scc: switch default');
  console.assert(evalCond('setup.f() && $q === 8', { q: 7 }, {}) === false && evalCond('setup.f() and $q === 8', { q: 8 }, {}) === '?', 'scc: and with unknown part');
  console.assert(evalCond('setup.f() || $q === 8', { q: 8 }, {}) === true && evalCond('$q === 1 or ($q === 2 and $r === "a or b")', { q: 2, r: 'a or b' }, {}) === true, 'scc: or, brackets, quoted or');
  console.assert(ev('<<if setup.f() && $q === 7>><<set $q to 8>><<elseif setup.f() && $q === 0>><<set $q to 1>><</if>>', { q: 0 }) === 'q=1?', 'scc: real-game style chain');
  console.assert(ev('<<if setup.f()>><<set $q to 1>><</if>><<if $q === 1>><<set $r to 5>><</if>>', { q: 0 }) === 'q=1?,r=5?', 'scc: maybe value makes later conditions maybe');
  console.assert(ev('<<if setup.f()>><<set $o.a to 1>><</if>><<if $o.b === 1>><<set $r to 5>><</if>>', { o: { a: 0, b: 1 } }) === 'o.a=1?,r=5', 'scc: other keys stay certain');
  console.assert(ev('<<if setup.f()>><<set $q to 1>><</if>><<set $n to $q + 1>>', { q: 0 }) === 'q=1?,n=2?', 'scc: value computed from a guess is maybe');
  console.assert(ev('<<set _ok to $q === 0>><<if _ok>><<set $q to 1>><</if>>', { q: 0 }) === 'q=1?', 'scc: temp variable condition is maybe');
  console.assert(evalCond('$a ? $b : $c || $d', { a: true, b: false, d: true }, {}) === false, 'scc: ternary not split');
  console.assert(evalCond('($a) && ($b)', { a: 1, b: 0 }, {}) === false && wrapped('(a || b)') && !wrapped('($a)-($b)') && !wrapped('(")")+(1)'), 'scc: brackets');
  console.assert(ev('<<if setup.f() && $q === 8>><<set $q to 9>><<elseif setup.f() && $q === 7>><<set $q to 8>><</if>>', { q: 8 }) === 'q=9?', 'scc: elseif checked against values before a maybe branch');
  console.assert(ev('<<if setup.f()>><<set $q to 2>><<elseif $q === 1>><<set $r to 1>><</if>>', { q: 1 }) === 'q=2?,r=1?', 'scc: elseif after maybe branch is maybe');
  console.assert(ev('<<for _i to 0; _i lt 3; _i++>><<set $a to 1>><</for>>', {}) === 'a=1?', 'scc: loop stays maybe');
  console.assert(ev('<<link "x">><<if $q === 0>><<set $a to 1>><</if>><</link>><<set $b to 2>>', { q: 0 }) === 'b=2', 'scc: if inside skipped link');
  console.assert(ec('<<set $n++>>')[0].op === '++', 'scc: ++');
  console.assert(ec('<<run setup.f()>>')[0].code === 'setup.f()', 'scc: run');
  console.assert(ec('<<goto "End">>')[0].goto === 'End' && ec('<<goto [[End]]>>')[0].goto === 'End', 'scc: goto');
  console.assert(ec('<<link "x">><<set $a to 1>><</link>><<set $b to 2>>').length === 1, 'scc: inner link skipped');
  console.assert(ec('/* <<set $a to 1>> */<<set $a == 1>>').length === 0, 'scc: comments and comparisons ignored');
  console.assert(ec('<<unset $a, $b>>').length === 2, 'scc: unset');
  console.assert(pathKey(targetPath('$p["a b"][0].c')) === '["p","a b","0","c"]' && targetPath('$a[$i]') === null, 'scc: targetPath');
  console.assert(safeRhs('$a + 5') && safeRhs('Math.max($a, 3)') && safeRhs('"x(y)"') && safeRhs('$a == 1'), 'scc: safe rhs');
  console.assert(!safeRhs('`a ${setup.roll()}`') && !safeRhs('setup.f`x`'), 'scc: template literals unsafe');
  const sa = {}; setAt(sa, ['inv', '0'], 'x');
  console.assert(Array.isArray(sa.inv), 'scc: setAt makes arrays for numeric keys');
  console.assert(plain([1, 2]) === 'list of 2 items' && plain({ a: 1 }) === 'group of 1 value' && plain(5) === '5' && plain([]) === 'empty list', 'scc: plain wording');
  console.assert(!safeRhs('setup.roll()') && !safeRhs('random(1, 6)') && !safeRhs('$b++') && !safeRhs('$c = 1'), 'scc: unsafe rhs');
})();
