// ==UserScript==
// @name         WTR-LAB AI Term Ranker
// @namespace    wtr-lab-ai-term-ranker
// @version      1.0.0
// @description  Adds an "AI Rank" button to the term tooltip that asks an AI to score translation candidates (and propose new ones).
// @match        https://wtr-lab.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      api.anthropic.com
// @connect      api.openai.com
// @connect      openrouter.ai
// @connect      generativelanguage.googleapis.com
// @connect      api.groq.com
// @connect      api.x.ai
// @connect      api.deepseek.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------- providers ----------
  // Order matters: first matching key pattern wins (DeepSeek keys look like legacy OpenAI keys).
  const PROVIDERS = [
    { id: 'anthropic', name: 'Anthropic', re: /^sk-ant-/ },
    { id: 'openrouter', name: 'OpenRouter', re: /^sk-or-/, base: 'https://openrouter.ai/api/v1' },
    { id: 'groq', name: 'Groq', re: /^gsk_/, base: 'https://api.groq.com/openai/v1' },
    { id: 'xai', name: 'xAI', re: /^xai-/, base: 'https://api.x.ai/v1' },
    { id: 'gemini', name: 'Google Gemini', re: /^AIza/ },
    { id: 'deepseek', name: 'DeepSeek', re: /^sk-[a-f0-9]{32}$/, base: 'https://api.deepseek.com' },
    { id: 'openai', name: 'OpenAI', re: /^sk-/, base: 'https://api.openai.com/v1' },
  ];
  const detectProvider = (key) => PROVIDERS.find((p) => p.re.test((key || '').trim())) || null;

  const NON_TEXT = /embed|whisper|tts|dall-e|imagen|image|veo|moderation|audio|realtime|transcribe|sora|guard|davinci|babbage|aqa/i;
  const LIKELY_TEXT = /gpt|^o\d|chat|llama|mixtral|mistral|gemma|qwen|grok|deepseek|kimi|claude|gemini|reasoner|compound/i;

  function gm(method, url, headers = {}, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url, timeout: 180000,
        headers: body ? { 'Content-Type': 'application/json', ...headers } : headers,
        data: body ? JSON.stringify(body) : undefined,
        onload: (r) => {
          let json = null;
          try { json = JSON.parse(r.responseText); } catch (_) { /* non-JSON body */ }
          if (r.status >= 400) {
            const e = json && (json.error || json);
            return reject(new Error(`HTTP ${r.status}: ${(e && (e.message || JSON.stringify(e))) || r.responseText.slice(0, 300)}`));
          }
          json ? resolve(json) : reject(new Error('Invalid JSON response'));
        },
        onerror: () => reject(new Error('Network error')),
        ontimeout: () => reject(new Error('Request timed out')),
      });
    });
  }

  const bearer = (key) => ({ Authorization: `Bearer ${key}` });
  const anthropicHeaders = (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
  const byCreatedDesc = (a, b) => (b.created || 0) - (a.created || 0);

  // Returns [{ id, label, warn }] sorted costly -> cheap, else newest -> oldest.
  async function listModels(key) {
    const p = detectProvider(key);
    if (!p) throw new Error('Unrecognized key format');
    let models;
    if (p.id === 'anthropic') {
      const r = await gm('GET', 'https://api.anthropic.com/v1/models?limit=1000', anthropicHeaders(key));
      models = r.data.map((m) => ({ id: m.id, label: m.display_name || m.id, created: Date.parse(m.created_at) || 0 })).sort(byCreatedDesc);
    } else if (p.id === 'gemini') {
      const r = await gm('GET', `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`);
      // No price or date in this API: version-aware name sort approximates newest first.
      models = (r.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && !NON_TEXT.test(m.name))
        .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }))
        .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
    } else if (p.id === 'openrouter') {
      const r = await gm('GET', `${p.base}/models`, bearer(key));
      models = r.data
        .filter((m) => {
          const out = m.architecture && (m.architecture.output_modalities || [String(m.architecture.modality || '').split('->')[1]]);
          return out ? out.some((x) => String(x).includes('text')) : true;
        })
        .map((m) => {
          const inP = +m.pricing?.prompt, outP = +m.pricing?.completion;
          const cost = inP >= 0 && outP >= 0 ? inP + outP : -1; // negative = variable/router pricing
          const price = cost >= 0 ? ` — $${(inP * 1e6).toFixed(2)}/$${(outP * 1e6).toFixed(2)} per M` : '';
          return { id: m.id, label: `${m.id}${price}`, cost, created: m.created || 0 };
        })
        .sort((a, b) => b.cost - a.cost || byCreatedDesc(a, b));
    } else {
      // OpenAI-compatible list has no price or modality: filter by name, warn when unsure.
      const r = await gm('GET', `${p.base}/models`, bearer(key));
      models = r.data
        .filter((m) => !NON_TEXT.test(m.id))
        .map((m) => ({ id: m.id, label: m.id, created: m.created || 0, warn: !LIKELY_TEXT.test(m.id) }))
        .sort(byCreatedDesc);
    }
    return models;
  }

  async function chat(cfg, system, user) {
    const p = detectProvider(cfg.key);
    if (!p) throw new Error('Unrecognized key format');
    if (p.id === 'anthropic') {
      const r = await gm('POST', 'https://api.anthropic.com/v1/messages', anthropicHeaders(cfg.key), {
        model: cfg.model, max_tokens: 4096, system, messages: [{ role: 'user', content: user }],
      });
      return r.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
    }
    if (p.id === 'gemini') {
      const r = await gm('POST', `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.key)}`, {}, {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json' },
      });
      return (r.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
    }
    const r = await gm('POST', `${p.base}/chat/completions`, bearer(cfg.key), {
      model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    });
    return r.choices?.[0]?.message?.content || '';
  }

  // ---------- ranking logic ----------
  function parseRanking(text) {
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s < 0 || e < s) throw new Error('AI did not return JSON');
    const list = JSON.parse(text.slice(s, e + 1)).ranking;
    if (!Array.isArray(list)) throw new Error('AI JSON has no "ranking" array');
    return list
      .filter((x) => x && typeof x.term === 'string' && x.term.trim())
      .map((x) => ({ term: x.term.trim(), score: Math.max(0, +x.score || 0), isNew: !!x.new, reason: String(x.reason || '') }));
  }

  // Scale scores to integers summing to 100 (AI arithmetic drifts); all-zero stays all-zero.
  function normalize(list) {
    const total = list.reduce((a, x) => a + x.score, 0);
    const out = list.map((x) => ({ ...x, score: total ? Math.round((x.score * 100) / total) : 0 })).sort((a, b) => b.score - a.score);
    if (total && out.length) out[0].score += 100 - out.reduce((a, x) => a + x.score, 0);
    return out;
  }

  function savedTerms() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem('user_terms_v2') || '[]'); } catch (_) { raw = []; }
    const serie = (location.pathname.match(/\/novel\/(\d+)/) || [])[1];
    return (Array.isArray(raw) ? raw : [])
      .map((t) => (Array.isArray(t) ? { to: t[1], from: t[2], filter: t[4] } : t))
      .filter((t) => t && t.from && t.to && (!t.filter?.serie_id || String(t.filter.serie_id) === serie));
  }

  const SYSTEM = `You judge English translations of one term from a Chinese web novel and produce a scored tier list.
Respond with JSON only, no prose: {"ranking":[{"term":string,"score":number,"new":boolean,"reason":string}]}
Rules:
- "score" is a percentage. All scores together must sum to 100.
- 0 is always allowed: give 0 to candidates that are wrong, irrelevant or clearly worse. Never spread points just to be fair.
- You are not limited to the listed candidates. If a better or competitive rendering exists, add it with "new": true and score it by exactly the same standard as listed ones.
- Include every listed candidate exactly as written (with "new": false).
- Consistency: the user's SAVED TERMS define the naming conventions to follow (how names, titles, ranks, sects, techniques are rendered). Other translated terms that appear in the CONTEXT but are not in SAVED TERMS are unverified machine output and must have NO weight in your decision.
- Judge accuracy to the source meaning, fit with the context, consistency with SAVED TERMS, and naturalness in English.
- "reason": one short sentence explaining why this term got this position and score.
- Order the array from highest to lowest score.`;

  function buildPrompt(d) {
    const saved = d.saved.length ? d.saved.map((t) => `${t.from} → ${t.to}`).join('\n') : '(none)';
    return `SOURCE TERM: ${d.source || '(unknown)'}
CURRENTLY SHOWN AS: ${d.current || '(unknown)'}

CANDIDATES:
${d.candidates.map((c) => `- ${c}`).join('\n') || '(none, propose your own)'}

CONTEXT:
${d.context || '(none)'}

SAVED TERMS (source → translation):
${saved}`;
  }

  // ---------- page integration ----------
  let lastClicked = null;
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.chapter-body')) lastClicked = e.target;
  }, true);

  function contextAround(el, radius = 2) {
    const line = el && el.closest('.wtr-line');
    if (!line) return '';
    const lines = [line];
    for (let i = 0, p = line; i < radius && (p = p.previousElementSibling); i++) lines.unshift(p);
    for (let i = 0, n = line; i < radius && (n = n.nextElementSibling); i++) lines.push(n);
    return lines.map((l) => (l === line ? `>>> ${l.textContent.trim()} <<<` : l.textContent.trim())).join('\n');
  }

  const exactText = (root, txt) => [...root.querySelectorAll('div,span,label')].find((x) => x.textContent.trim() === txt);

  function readTooltip(root, toLabel) {
    const source = ((root.innerText || '').match(/From\s+([^\n]+)/) || [])[1]?.trim() || '';
    // Alternatives list is rendered next to the column holding the "To" label.
    const alts = toLabel.parentElement?.nextElementSibling;
    const chips = alts ? [...(alts.querySelectorAll('button,[role="button"]').length ? alts.querySelectorAll('button,[role="button"]') : alts.children)] : [];
    const current = lastClicked ? lastClicked.textContent.trim() : '';
    const chipText = (c) => {
      const clone = c.cloneNode(true); // drop the vote-count element ("99+", "96") so it doesn't glue to the term
      clone.querySelectorAll('*').forEach((e) => !e.children.length && /^\d+\+?$/.test(e.textContent.trim()) && e.remove());
      return clone.textContent.replace(/\s+/g, ' ').trim().replace(/^\d+\+?\s+/, '');
    };
    const candidates = [...new Set([
      ...chips.map(chipText),
      current,
    ].filter(Boolean))];
    return { source, current, candidates, context: contextAround(lastClicked), saved: savedTerms() };
  }

  function scan() {
    for (const btn of document.querySelectorAll('button')) {
      const label = btn.textContent.trim();
      if ((label !== 'Term' && label !== 'Edit') || btn.dataset.wtrrank) continue;
      btn.dataset.wtrrank = '1';
      // Walk up to the tooltip root: the ancestor holding both "From" and "To" labels.
      let root = btn.parentElement, toLabel = null;
      for (let i = 0; root && i < 6; i++, root = root.parentElement) {
        toLabel = exactText(root, 'To');
        if (toLabel && exactText(root, 'From')) break;
        toLabel = null;
      }
      if (!toLabel) continue;
      const ours = document.createElement('button');
      ours.type = 'button';
      ours.className = btn.className;
      ours.classList.add('wtrrank-btn');
      ours.textContent = '🏆 AI Rank';
      ours.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        runRanking(readTooltip(root, toLabel));
      });
      btn.after(ours);
    }
  }
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; scan(); }, 50);
  }).observe(document.body, { childList: true, subtree: true });

  // ---------- UI ----------
  GM_addStyle(`
    .wtrrank-btn { margin-top: 4px !important; white-space: nowrap; }
    .wtrrank-overlay { position: fixed; inset: 0; z-index: 2147483000; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box; }
    .wtrrank-panel { background: #1f2125; color: #e6e6e6; border: 1px solid #3a3d42; border-radius: 10px; width: 100%; max-width: 480px; max-height: 90vh; display: flex; flex-direction: column; font: 14px/1.4 system-ui, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.5); }
    .wtrrank-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #3a3d42; }
    .wtrrank-head b { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .wtrrank-icon { background: none; border: 0; color: #bbb; font-size: 18px; cursor: pointer; padding: 4px 8px; min-width: 36px; min-height: 36px; }
    .wtrrank-body { overflow-y: auto; padding: 8px 12px 12px; }
    .wtrrank-row { padding: 8px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; margin-bottom: 6px; background: #26292e; }
    .wtrrank-row:hover, .wtrrank-row:focus { border-color: #4a7bd0; outline: none; }
    .wtrrank-top { display: flex; align-items: center; gap: 8px; }
    .wtrrank-score { font-weight: 700; min-width: 44px; text-align: right; }
    .wtrrank-term { font-weight: 600; flex: 1; word-break: break-word; }
    .wtrrank-tag { font-size: 11px; background: #1e7e34; color: #fff; border-radius: 4px; padding: 1px 5px; }
    .wtrrank-bar { height: 4px; background: #3a3d42; border-radius: 2px; margin: 6px 0 4px; overflow: hidden; }
    .wtrrank-bar > div { height: 100%; background: #4a7bd0; }
    .wtrrank-reason { color: #aab; font-size: 12.5px; }
    .wtrrank-copied { color: #6c6; font-size: 12px; }
    .wtrrank-muted { color: #999; font-size: 12.5px; }
    .wtrrank-err { color: #f77; white-space: pre-wrap; word-break: break-word; }
    .wtrrank-field { display: block; margin: 10px 0 4px; font-size: 12.5px; color: #bbb; }
    .wtrrank-input { width: 100%; box-sizing: border-box; background: #15171a; color: #eee; border: 1px solid #3a3d42; border-radius: 6px; padding: 8px; font-size: 14px; }
    .wtrrank-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
    .wtrrank-action { background: #2f6fde; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-size: 14px; cursor: pointer; }
    .wtrrank-action.secondary { background: #3a3d42; }
  `);

  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k);
    return el;
  }

  function openPanel(title, onSettings) {
    document.querySelector('.wtrrank-overlay')?.remove();
    const body = h('div', { class: 'wtrrank-body' });
    const overlay = h('div', { class: 'wtrrank-overlay', onclick: (e) => e.target === overlay && overlay.remove() },
      h('div', { class: 'wtrrank-panel', role: 'dialog', 'aria-label': title },
        h('div', { class: 'wtrrank-head' },
          h('b', {}, title),
          onSettings && h('button', { class: 'wtrrank-icon', title: 'API settings', 'aria-label': 'API settings', onclick: onSettings }, '⚙'),
          h('button', { class: 'wtrrank-icon', title: 'Close', 'aria-label': 'Close', onclick: () => overlay.remove() }, '✕')),
        body));
    document.body.append(overlay);
    return body;
  }

  const getCfg = () => ({ key: GM_getValue('apiKey', ''), model: GM_getValue('model', '') });

  async function runRanking(data) {
    const cfg = getCfg();
    if (!cfg.key || !cfg.model) return openConfig(() => runRanking(data));
    const body = openPanel(`Tier list: ${data.source || data.current}`, () => openConfig(() => runRanking(data)));
    body.append(h('div', { class: 'wtrrank-muted' }, `Asking ${cfg.model}…`));
    try {
      const list = normalize(parseRanking(await chat(cfg, SYSTEM, buildPrompt(data))));
      body.replaceChildren(h('div', { class: 'wtrrank-muted', style: 'margin-bottom:8px' }, 'Tap a term to copy it.'));
      list.forEach((x, i) => {
        const note = h('span', { class: 'wtrrank-copied' });
        const row = h('div', { class: 'wtrrank-row', tabindex: '0', role: 'button' },
          h('div', { class: 'wtrrank-top' },
            h('span', { class: 'wtrrank-muted' }, `#${i + 1}`),
            h('span', { class: 'wtrrank-term' }, x.term),
            x.isNew && h('span', { class: 'wtrrank-tag', title: 'Proposed by the AI' }, 'NEW'),
            note,
            h('span', { class: 'wtrrank-score' }, `${x.score}%`)),
          h('div', { class: 'wtrrank-bar' }, h('div', { style: `width:${x.score}%` })),
          h('div', { class: 'wtrrank-reason' }, x.reason));
        const copy = () => { GM_setClipboard(x.term, 'text'); note.textContent = 'Copied'; setTimeout(() => (note.textContent = ''), 1200); };
        row.addEventListener('click', copy);
        row.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), copy()));
        body.append(row);
      });
    } catch (err) {
      body.replaceChildren(h('div', { class: 'wtrrank-err' }, String(err.message || err)));
    }
  }

  function openConfig(after) {
    const cfg = getCfg();
    const body = openPanel('AI Term Ranker — API settings');
    const keyIn = h('input', { class: 'wtrrank-input', type: 'password', autocomplete: 'off', placeholder: 'sk-ant-… / sk-… / sk-or-… / AIza… / gsk_… / xai-…' });
    keyIn.value = cfg.key;
    const status = h('div', { class: 'wtrrank-muted' });
    const select = h('select', { class: 'wtrrank-input' });
    const manual = h('input', { class: 'wtrrank-input', placeholder: 'Model name (used if not empty)' });
    manual.value = cfg.model;

    async function load() {
      const p = detectProvider(keyIn.value);
      select.replaceChildren();
      if (!p) { status.textContent = keyIn.value ? 'Unrecognized key format.' : ''; return; }
      status.textContent = `Detected ${p.name}. Loading models…`;
      try {
        const models = await listModels(keyIn.value.trim());
        select.append(h('option', { value: '' }, '— choose a model —'));
        for (const m of models) {
          const o = h('option', { value: m.id }, `${m.warn ? '⚠ ' : ''}${m.label}`);
          if (m.warn) o.title = 'Could not confirm this is a text model';
          select.append(o);
        }
        if (models.some((m) => m.id === cfg.model)) { select.value = cfg.model; manual.value = ''; }
        status.textContent = `Detected ${p.name}: ${models.length} models${models.some((m) => m.warn) ? ' (⚠ = not confirmed as a text model)' : ''}.`;
      } catch (err) {
        status.textContent = `Detected ${p.name}. Could not list models (${err.message}). Type the model name below.`;
      }
    }
    select.addEventListener('change', () => { if (select.value) manual.value = ''; });
    keyIn.addEventListener('change', load);

    body.append(
      h('label', { class: 'wtrrank-field' }, 'API key'), keyIn, status,
      h('label', { class: 'wtrrank-field' }, 'Model'), select,
      h('label', { class: 'wtrrank-field' }, 'Or type a model name'), manual,
      h('div', { class: 'wtrrank-actions' },
        h('button', { class: 'wtrrank-action secondary', onclick: load }, 'Reload models'),
        h('button', {
          class: 'wtrrank-action',
          onclick: () => {
            const model = manual.value.trim() || select.value;
            if (!detectProvider(keyIn.value)) return (status.textContent = 'Unrecognized key format.');
            if (!model) return (status.textContent = 'Choose or type a model.');
            GM_setValue('apiKey', keyIn.value.trim());
            GM_setValue('model', model);
            document.querySelector('.wtrrank-overlay')?.remove();
            if (after) after();
          },
        }, 'Save')));
    if (cfg.key) load();
  }

  GM_registerMenuCommand('AI Term Ranker settings', () => openConfig());

  // ---------- self-check ----------
  console.assert(detectProvider('sk-ant-api03-x').id === 'anthropic', 'wtrrank: anthropic');
  console.assert(detectProvider('sk-or-v1-x').id === 'openrouter', 'wtrrank: openrouter');
  console.assert(detectProvider('sk-0123456789abcdef0123456789abcdef').id === 'deepseek', 'wtrrank: deepseek');
  console.assert(detectProvider('sk-proj-abc').id === 'openai', 'wtrrank: openai');
  console.assert(detectProvider('AIzaXYZ').id === 'gemini', 'wtrrank: gemini');
  console.assert(normalize([{ score: 1 }, { score: 1 }, { score: 1 }]).reduce((a, x) => a + x.score, 0) === 100, 'wtrrank: sum 100');
  console.assert(normalize([{ score: 0 }, { score: 0 }]).every((x) => x.score === 0), 'wtrrank: zeros');
  console.assert(parseRanking('```json\n{"ranking":[{"term":"A","score":60,"reason":"r"}]}\n```')[0].score === 60, 'wtrrank: parse');
})();
