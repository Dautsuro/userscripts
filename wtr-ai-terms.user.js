// ==UserScript==
// @name         WTR AI Terms
// @namespace    wtr-ai-terms
// @version      1.7.3
// @description  Adds an "AI Rank" button to the term tooltip that asks an AI to score translation candidates (and propose new ones).
// @match        https://wtr-lab.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @grant        GM_addValueChangeListener
// @connect      api.anthropic.com
// @connect      api.openai.com
// @connect      openrouter.ai
// @connect      generativelanguage.googleapis.com
// @connect      api.groq.com
// @connect      api.x.ai
// @connect      api.deepseek.com
// @connect      100.125.40.99
// @require      http://100.125.40.99:8090/kvsync.js
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
  // NEW is decided locally (term absent from the tooltip candidates, case-sensitive), not from the AI's flag,
  // and exact duplicates are merged (scores summed, reason of the higher-scored entry kept).
  function parseRanking(text, candidates = []) {
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    if (s < 0 || e < s) throw new Error('AI did not return JSON');
    let list;
    try { list = JSON.parse(text.slice(s, e + 1)).ranking; } catch (err) {
      list = looseEntries(text.slice(s + 1, e)); // skip the outer object so its braces don't wrap the entries
      if (!list.length) throw err;
    }
    if (!Array.isArray(list)) throw new Error('AI JSON has no "ranking" array');
    const byTerm = new Map();
    for (const x of list) {
      if (!x || typeof x.term !== 'string' || !x.term.trim()) continue;
      const term = x.term.trim(), score = Math.max(0, +x.score || 0), reason = String(x.reason || '');
      const prev = byTerm.get(term);
      if (!prev) byTerm.set(term, { term, score, isNew: !candidates.includes(term), reason });
      else { if (score > prev.score) prev.reason = reason; prev.score += score; }
    }
    return [...byTerm.values()];
  }

  // Fallback for slightly broken AI JSON (missing comma, stray text): parse each innermost {...} on its own.
  // Braces inside strings are skipped; an entry that still doesn't parse is dropped.
  function looseEntries(text) {
    const out = [];
    let start = -1, inStr = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') start = i;
      else if (c === '}' && start >= 0) {
        try { const x = JSON.parse(text.slice(start, i + 1)); if (x && typeof x.term === 'string') out.push(x); } catch (_) { /* broken entry */ }
        start = -1;
      }
    }
    return out;
  }

  // Scale scores to integers summing to 100 (AI arithmetic drifts); all-zero stays all-zero.
  // Largest remainder: round down, then +1 to the biggest fractions, so no score goes negative or out of order.
  function normalize(list) {
    const total = list.reduce((a, x) => a + x.score, 0);
    const out = list.map((x) => { const exact = total ? (x.score * 100) / total : 0; return { ...x, score: Math.floor(exact), rest: exact % 1 }; });
    let left = total ? 100 - out.reduce((a, x) => a + x.score, 0) : 0;
    [...out].sort((a, b) => b.rest - a.rest).forEach((x) => { if (left > 0) { x.score++; left--; } });
    return out.map(({ rest, ...x }) => x).sort((a, b) => b.score - a.score);
  }

  const currentSerie = () => (location.pathname.match(/\/novel\/(\d+)/) || [])[1] || '';

  // Sources of the user's global WTR-LAB terms (no novel filter). This runs on every DOM change, so the
  // stored text is parsed again only when it differs from last time.
  let termsRaw = null, termsFroms = new Set();
  function globalTermFroms() {
    const raw = localStorage.getItem('user_terms_v2') || '[]';
    if (raw === termsRaw) return termsFroms;
    let list;
    try { list = JSON.parse(raw); } catch (_) { list = []; }
    termsRaw = raw;
    termsFroms = new Set((Array.isArray(list) ? list : [])
      .map((t) => (Array.isArray(t) ? { to: t[1], from: t[2], filter: t[4] } : t))
      .filter((t) => t && t.from && t.to && !t.filter?.serie_id).map((t) => t.from));
    return termsFroms;
  }

  const SYSTEM = `You judge English translations of one term from a Chinese web novel and produce a scored tier list.
Respond with JSON only, no prose: {"trap":boolean,"ranking":[{"term":string,"score":number,"new":boolean,"reason":string}]}
Rules:
- "trap": true only if no single rendering of this source can be right across contexts: its correct English form necessarily changes from sentence to sentence (e.g. 修炼 is "cultivate" as a verb but "cultivation" as a noun), so whatever is chosen will be wrong somewhere. Otherwise false.
- "score" is a percentage. All scores together must sum to 100.
- 0 is always allowed: give 0 to candidates that are wrong, irrelevant or clearly worse. Never spread points just to be fair.
- You are not limited to the listed candidates. If a better or competitive rendering exists, add it with "new": true and score it by exactly the same standard as listed ones.
- Include every listed candidate exactly as written (with "new": false).
- Consistency: REFERENCE TERMS are related terms the user already verified; they define the naming conventions to follow (how names, titles, ranks, sects, techniques and shared characters are rendered). Other translated terms that appear in the CONTEXT but are not in REFERENCE TERMS are unverified machine output and must have NO weight in your decision.
- Grammatical number: in the CONTEXT the term appears as ⟦source⟧. When an "s" directly follows it (e.g. "⟦魂师⟧s"), the site already adds the plural itself, so rank the singular form first ("Soul Master", not "Soul Masters", which would give "Soul Masterss"). Otherwise use the plural when the term is genuinely plural in the CONTEXT (e.g. "Soul Rings" for 魂环 when several rings are meant), the singular when it is not. Do not penalize a candidate just for being plural.
- Official renderings: if the NOVEL belongs to or is fan-fiction of a known franchise (e.g. Soul Land / Douluo Dalu) and the term has an established official or widely accepted English rendering in that franchise, rank that rendering first, even above a more accurate or natural one, and say so in the reason. Add it with "new": true if it is not listed. Apply this only when you are confident the rendering is established; never invent one.
- Otherwise judge accuracy to the source meaning, fit with the context, consistency with REFERENCE TERMS, and naturalness in English.
- "reason": one short sentence explaining why this term got this position and score.
- Order the array from highest to lowest score.`;

  function buildPrompt(d) {
    const refs = d.refs.length ? d.refs.map((t) => `${t.from} → ${t.to}`).join('\n') : '(none)';
    // d.current is deliberately not sent: knowing the selected term would bias the AI towards it.
    return `NOVEL: ${d.novel || '(unknown)'}
SOURCE TERM: ${d.source || '(unknown)'}

CANDIDATES:
${d.candidates.map((c) => `- ${c}`).join('\n') || '(none, propose your own)'}

CONTEXT:
${d.context || '(none)'}

REFERENCE TERMS (source → verified translation):
${refs}`;
  }

  // ---------- page integration ----------
  let lastClicked = null;
  let bypassOnce = false; // let the next tap on a picked term reach WTR-LAB's own tooltip
  let autoRank = null; // { until }: a term to rank by itself was just tapped; scan() presses AI Rank in its tooltip
  document.addEventListener('click', (e) => {
    if (!(e.target.closest && e.target.closest('.chapter-body'))) return;
    lastClicked = e.target;
    autoRank = null;
    const el = e.target.closest('.text-patch[data-hash]');
    if (!el || bypassOnce) { bypassOnce = false; return; }
    // Terms picked with this script get our popover instead of the site's (capture phase runs before React's).
    if (el.dataset.hash in localTerms()) {
      e.preventDefault(); e.stopPropagation();
      openTermPopover(el);
    } else if (!checkedHashes().has(el.dataset.hash)) autoRank = { until: Date.now() + 5000 }; // still term-colored
  }, true);

  // Term elements showing the selected translation are replaced by ⟦source⟧ so the AI never sees the current choice.
  function contextAround(el, source, current, radius = 2) {
    const line = el && el.closest('.wtr-line');
    if (!line) return '';
    const lines = [line];
    for (let i = 0, p = line; i < radius && (p = p.previousElementSibling); i++) lines.unshift(p);
    for (let i = 0, n = line; i < radius && (n = n.nextElementSibling); i++) lines.push(n);
    return lines.map((l) => {
      const clone = l.cloneNode(true);
      if (current && el !== line) {
        clone.querySelectorAll(el.tagName).forEach((t) => t.textContent.trim() === current && t.replaceWith(`⟦${source || '?'}⟧`));
      }
      const text = clone.textContent.trim();
      return l === line ? `>>> ${text} <<<` : text;
    }).join('\n');
  }

  // Innermost element whose text is exactly `txt` (its wrapper column can have the same text).
  const exactText = (root, txt) => [...root.querySelectorAll('div,span,label')]
    .find((x) => x.textContent.trim() === txt && ![...x.children].some((c) => c.textContent.trim() === txt));

  const novelTitle = () => document.title.replace(/\s+Chapter\s+\d+.*$/i, '').replace(/(^|\s*-\s*)WTR-LAB\s*$/i, '').trim(); // franchise hint for official renderings

  // Alternatives list is rendered next to the column holding the "To" label.
  function tooltipChips(toLabel) {
    const alts = toLabel.parentElement?.nextElementSibling;
    return alts ? [...(alts.querySelectorAll('button,[role="button"]').length ? alts.querySelectorAll('button,[role="button"]') : alts.children)] : [];
  }
  const chipText = (c) => {
    const clone = c.cloneNode(true); // drop the vote-count element ("99+", "96") so it doesn't glue to the term
    clone.querySelectorAll('*').forEach((e) => !e.children.length && /^\d+\+?$/.test(e.textContent.trim()) && e.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim().replace(/^\d+\+?\s+/, '');
  };

  // Press AI Rank by itself once the tooltip has loaded its alternatives, or the AI gets a partial list.
  // Once a loading spinner was seen, its disappearance ends loading: press when neither the spinner
  // nor the list changed for 150 ms (room for a final render), or 1 s if the list is still empty (the
  // spinner may have flashed before the fetch; some terms have no alternatives). Without a spinner,
  // wait for the list to stay unchanged for 400 ms and not be empty, unless 4 s passed.
  // After 8 s it presses anyway.
  // Stops when the tooltip goes away or another tap replaced `token`.
  function pressWhenLoaded(btn, root, toLabel, token) {
    const box = btn.closest('[data-slot="popover-content"]') || root;
    const started = Date.now();
    let last = null, since = 0, sawSpinner = false;
    const tick = () => {
      if (!btn.isConnected || autoRank !== token) return;
      const list = tooltipChips(toLabel).map(chipText).join('\n'), now = Date.now();
      if (list !== last) { last = list; since = now; }
      const loading = box.querySelector('.animate-spin, [aria-busy="true"], [role="progressbar"]');
      if (loading) { sawSpinner = true; since = now; } // the quiet time starts when the spinner is gone
      const quiet = now - since;
      const loaded = !loading && (list ? quiet >= (sawSpinner ? 150 : 400) : sawSpinner ? quiet >= 1000 : quiet >= 400 && now - started >= 4000);
      if (loaded || now - started >= 8000) { autoRank = null; btn.click(); }
      else setTimeout(tick, 50);
    };
    tick();
  }

  function readTooltip(root, toLabel) {
    const source = ((root.innerText || '').match(/From\s+([^\n]+)/) || [])[1]?.trim() || '';
    const chips = tooltipChips(toLabel);
    const current = lastClicked ? lastClicked.textContent.trim() : '';
    const candidates = [...new Set([
      ...chips.map(chipText),
      current,
    ].filter(Boolean))].sort((a, b) => a.localeCompare(b)); // sorted so list position can't hint which one is selected
    const trigger = lastClicked?.closest('.text-patch') || null;
    const hash = trigger?.dataset.hash || '';
    const popular = chips.filter((c) => c.textContent.includes('99+')).map(chipText); // 99+ WTR-LAB votes
    return { source, current, hash, trigger, novel: novelTitle(), candidates, popular, context: contextAround(lastClicked, source, current), refs: referenceTerms(hash || source) };
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
        autoRank = null; // a manual tap must not be followed by a second, automatic one
        runRanking(readTooltip(root, toLabel));
      });
      btn.after(ours);
      // Only a button added after the tap counts: a closing tooltip of the previous term already had its own.
      // If the tooltip re-renders while loading, its new button takes over; the first press ends it.
      if (autoRank && Date.now() < autoRank.until) pressWhenLoaded(ours, root, toLabel, autoRank);
    }

    // Term editor: "Clear" button next to the Replacement Text label (deleting text is tedious on mobile).
    for (const input of document.querySelectorAll('input[placeholder="Text to replace with"]')) {
      const label = input.parentElement?.querySelector('label');
      if (!label || label.querySelector('.wtrrank-clear')) continue;
      const style = input.closest('form')?.querySelector('button[type="button"]'); // "+ Variation", for the site's look
      label.append(h('button', {
        type: 'button', class: `${style ? style.className : ''} wtrrank-clear`,
        onclick: (e) => {
          e.preventDefault(); e.stopPropagation();
          setInputValue(input, '');
          input.focus();
        },
      }, '✕ Clear'));
    }
  }

  // Native setter + input event so React's controlled state sees the change.
  function setInputValue(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; scan(); applyLocalTerms(); syncRenderings(); renderTermColors(); }, 50); // SPA navigation, term edits, newly saved global terms
  }).observe(document.body, { childList: true, subtree: true, characterData: true }); // characterData: React re-rendering a term's text

  // ---------- local terms ----------
  // Picked renderings live in the script, never in WTR-LAB's term system: { serie: { hash: term } }.
  // Global terms apply to every novel; a novel's own pick wins. A null pick means "not in this novel":
  // it hides a global term there and is never counted.
  // Status per source, decided once and kept in termStatus ({ hash: { global: term } | { dynamic: true } }):
  // 5 novels all with the same rendering → global; otherwise at 10 novels, 9+ the same → global, else
  // dynamic (depends on context: never global, always checked).
  const picked = GM_getValue('pickedTerms', {});
  const termStatus = GM_getValue('termStatus', {});
  // Renderings picked while the AI gave them ≥80%: { hash: term }. They apply provisionally in novels
  // without their own pick, with no AI call, as long as every novel's pick for the source agrees.
  const confident = GM_getValue('confidentTerms', {});
  const CONFIDENT_SCORE = 80;

  // ---------- sync ----------
  // Optional: with a sync server URL and token set (device-local, never synced), every changed entry is
  // also written to KvSync, which pushes it to the personal server and pulls other devices' edits.
  // KvSync is undefined when the @require could not load (server down at install): the script runs unsynced.
  const SYNC_APP = 'wtr-lab-light';
  const syncUrl = GM_getValue('syncUrl', ''), syncToken = GM_getValue('syncToken', '');
  // KvSync re-reads and re-saves its whole state through GM on every set(); inside kvBatched() that
  // state is held in memory and written once, so bulk loops (bootstrap, reset) stay linear.
  const KV_STATE = `kvsync:${SYNC_APP}`;
  let kvBatch = null;
  const kvStorage = {
    get: (k, d) => (kvBatch && k === KV_STATE ? kvBatch.state : GM_getValue(k, d)),
    set: (k, v) => { if (kvBatch && k === KV_STATE) kvBatch.state = v; else GM_setValue(k, v); },
  };
  function kvBatched(fn) {
    kvBatch = { state: GM_getValue(KV_STATE, null) };
    try { fn(); } finally {
      const { state } = kvBatch;
      kvBatch = null;
      if (state) GM_setValue(KV_STATE, state);
    }
  }
  const kv = syncUrl && syncToken && typeof KvSync !== 'undefined'
    ? KvSync.create({ app: SYNC_APP, url: syncUrl, token: syncToken, storage: kvStorage }) : null;
  // JSON array keys keep any hash text unambiguous. Hashes are raw source text: a key over KvSync's
  // 2000-char limit would throw, so such an entry stays local only (null key).
  const kvKey = (...parts) => { const k = JSON.stringify(parts); return k.length <= 2000 ? k : null; };
  function kvPut(parts, value, clientUpdated) {
    const k = kv && kvKey(...parts);
    if (k) kv.set(k, value, clientUpdated);
  }
  function kvDel(parts) {
    const k = kv && kvKey(...parts);
    if (k) kv.remove(k);
  }
  // The model is saved per provider, so a Google key is never offered an OpenAI model.
  const savedModel = (pid) => GM_getValue(`model:${pid}`, '');
  {
    const legacy = GM_getValue('model', ''), p = detectProvider(GM_getValue('apiKey', ''));
    if (legacy && p && !savedModel(p.id)) { GM_setValue(`model:${p.id}`, legacy); kvPut(['model', p.id], legacy, 1); }
    if (legacy && p) GM_deleteValue('model');
  }
  function decideStatus(terms) {
    const counts = {};
    for (const t of terms) counts[t] = (counts[t] || 0) + 1;
    const [top, same] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];
    if (terms.length >= 5 && same === terms.length) return { global: top };
    if (terms.length >= 10) return same > 8 ? { global: top } : { dynamic: true };
    return null;
  }
  function updateStatus(hash) {
    if (termStatus[hash]) return;
    const status = decideStatus(Object.values(picked).map((novel) => novel[hash]).filter(Boolean));
    if (status) { termStatus[hash] = status; GM_setValue('termStatus', termStatus); kvPut(['status', hash], status); }
  }
  const globalPicks = () => Object.fromEntries(Object.entries(termStatus).filter(([, s]) => s.global).map(([h, s]) => [h, s.global]));

  // Global at once (99+ votes, context trap). Never replaces an existing global rendering; replaces "dynamic".
  function lockGlobal(hash, term) {
    if (!hash || termStatus[hash]?.global) return;
    termStatus[hash] = { global: term };
    GM_setValue('termStatus', termStatus);
    kvPut(['status', hash], termStatus[hash]);
  }
  function setConfident(hash, term) {
    if (!hash || confident[hash] === term) return;
    confident[hash] = term;
    GM_setValue('confidentTerms', confident);
    kvPut(['confident', hash], term);
  }
  // Confident terms for this novel: no own entry here, no status yet, and no novel picked something else
  // (a different pick means the source depends on context, so the AI is asked again).
  function provisionalPicks() {
    const mine = picked[currentSerie()] || {};
    return Object.fromEntries(Object.entries(confident).filter(([h, t]) => !(h in mine) && !termStatus[h]
      && Object.values(picked).every((novel) => !novel[h] || novel[h] === t)));
  }

  // Terms that apply in this novel (null = opted out of a global one).
  const localTerms = () => Object.fromEntries(Object.entries({ ...globalPicks(), ...provisionalPicks(), ...picked[currentSerie()] }).filter(([, t]) => t));

  // Rewrite term spans in place. The site puts the plural "s" outside the span, so the whole text is the term.
  // The site's text is kept in data-wtrrank-orig to put it back when a pick is deleted.
  function applyLocalTerms() {
    const terms = localTerms();
    for (const el of document.querySelectorAll('.chapter-body .text-patch[data-hash]')) {
      const orig = el.dataset.wtrrankOrig;
      const term = terms[el.dataset.hash] || orig;
      if (!term || el.textContent === term) continue;
      if (orig == null) el.dataset.wtrrankOrig = el.textContent;
      else if (term === orig) delete el.dataset.wtrrankOrig;
      // Keep React's own text node when possible, so its later updates still land on what we watch.
      if (el.childNodes.length === 1 && el.firstChild.nodeType === Node.TEXT_NODE) el.firstChild.data = term;
      else el.textContent = term;
    }
  }

  // term: a rendering, null (hide a global term here) or undefined (drop this novel's pick).
  function pickTerm(data, term) {
    const serie = currentSerie();
    if (!data.hash || !serie) return;
    const mine = (picked[serie] ||= {});
    if (term === undefined) delete mine[data.hash]; else mine[data.hash] = term;
    GM_setValue('pickedTerms', picked);
    if (term === undefined) kvDel(['picked', serie, data.hash]); else kvPut(['picked', serie, data.hash], term);
    // A deleted pick is no longer verified: drop it from checked, or referenceTerms() keeps sending it to the AI.
    if (term === undefined && checked[serie] && data.hash in checked[serie]) {
      delete checked[serie][data.hash];
      if (!Object.keys(checked[serie]).length) delete checked[serie];
      GM_setValue('checkedTerms', checked);
      kvDel(['checked', serie, data.hash]);
    }
    updateStatus(data.hash);
    applyLocalTerms();
    if (term) markChecked({ ...data, current: term });
    else renderTermColors();
  }

  // Novels per rendering of one source, most used first, for the term popover.
  function pickCounts(hash) {
    const counts = {};
    for (const novel of Object.values(picked)) if (novel[hash]) counts[novel[hash]] = (counts[novel[hash]] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }

  // ---------- term colors ----------
  // Unchecked terms get WTR-LAB's term color; terms already ranked by the AI go back to plain text.
  // Pure CSS keyed on data-hash (hash of the source text), so React-owned spans are never touched.
  // The site's `.chapter-body.term-color-disabled .text-patch { color: inherit !important }` lives in
  // @layer components, and a layered !important beats any unlayered one. So we also color the bare
  // wrapper <span> around each term: the term then inherits our color through the site's own rule.
  // :not(#wtrrank) adds id-level specificity for the non-layered cases (term colors enabled).
  // Checks are stored per novel ({ serie: { hash: rendering } }, data-hash is the source text itself);
  // a check counts in every novel only while its source term is saved globally, so novel-only terms
  // get re-checked elsewhere. The rendering is re-read from the page (syncRenderings) because the user
  // changes the term AFTER the AI check; a rendering equal to its hash means "not seen yet".
  const checked = GM_getValue('checkedTerms', {});
  const knownRendering = (h, r) => !!r && r !== h;
  let termStyle = null;
  const cssString = (s) => s.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ');
  function renderTermColors() {
    try { renderTermColorsUnsafe(); } catch (err) { console.error('[wtrrank] term colors:', err); }
  }
  // Terms shown as plain text, i.e. not term-colored (provisional ones get their own color on top).
  function checkedHashes() {
    const serie = currentSerie();
    const globalFroms = globalTermFroms();
    const hashes = new Set(Object.keys(checked[serie] || {}));
    for (const novel of Object.values(checked)) {
      for (const h of Object.keys(novel)) if (globalFroms.has(h)) hashes.add(h);
    }
    for (const h of Object.keys(globalPicks())) hashes.add(h); // global picks need no check in new novels
    return hashes;
  }
  function renderTermColorsUnsafe() {
    const hashes = checkedHashes();
    const sel = (h) => {
      const attr = `[data-hash="${cssString(h)}"]`;
      return [`.chapter-body .text-patch:not(#wtrrank)${attr}`, `.chapter-body span:not(.text-patch):has(> .text-patch${attr})`];
    };
    const done = [...hashes].flatMap(sel);
    const provisional = Object.keys(provisionalPicks()).flatMap(sel);
    const css = '.chapter-body .text-patch:not(#wtrrank), .chapter-body span:not(.text-patch):has(> .text-patch) { color: var(--wtr-term-color) !important; }'
      + (done.length ? `\n${done.join(',\n')} { color: inherit !important; }` : '')
      + (provisional.length ? `\n${provisional.join(',\n')} { color: #d39b2a !important; }` : ''); // after "done": same specificity, so it wins
    // Own <style> element instead of GM_addStyle: its return value differs between Violentmonkey inject modes.
    if (!termStyle || !termStyle.isConnected) { // first run, or the page dropped it
      termStyle = document.getElementById('wtrrank-terms') || document.createElement('style');
      termStyle.id = 'wtrrank-terms';
      (document.head || document.documentElement).append(termStyle);
    }
    if (termStyle.textContent !== css) termStyle.textContent = css;
  }

  function markChecked(data) {
    const serie = currentSerie();
    if (!data.hash || !serie) return;
    const rendering = (checked[serie] ||= {})[data.hash] = data.current || data.hash;
    GM_setValue('checkedTerms', checked);
    kvPut(['checked', serie, data.hash], rendering);
    renderTermColors();
  }

  // Keep each checked term's rendering equal to what the page shows now (first span per hash).
  function syncRenderings() {
    const serie = currentSerie(), mine = checked[serie];
    if (!mine) return;
    const seen = new Set(), changed = [];
    for (const el of document.querySelectorAll('.chapter-body .text-patch[data-hash]')) {
      const hash = el.dataset.hash, text = el.textContent.trim();
      if (seen.has(hash) || !(hash in mine) || !text) continue;
      seen.add(hash);
      if (mine[hash] !== text) { mine[hash] = text; changed.push(hash); }
    }
    if (!changed.length) return;
    GM_setValue('checkedTerms', checked);
    for (const hash of changed) kvPut(['checked', serie, hash], mine[hash]);
  }

  // Checked terms from every novel whose source shares a character with `source`. Common characters
  // (大, 之…) match a large share of all terms, so only the MAX_REFS most relevant are sent: this novel's
  // and global renderings first, then the most shared characters.
  const MAX_REFS = 50;
  function referenceTerms(source) {
    const chars = new Set(source), serie = currentSerie(), globals = globalPicks();
    const best = new Map(); // "from\0to" -> { from, to, rank }
    for (const [n, novel] of Object.entries(checked)) {
      for (const [from, to] of Object.entries(novel)) {
        if (from === source || !knownRendering(from, to)) continue;
        const shared = [...new Set(from)].filter((c) => chars.has(c)).length;
        if (!shared) continue;
        const rank = (n === serie || globals[from] === to ? 1000 : 0) + shared;
        const k = `${from}\0${to}`;
        if (!(best.get(k)?.rank >= rank)) best.set(k, { from, to, rank });
      }
    }
    return [...best.values()].sort((a, b) => b.rank - a.rank).slice(0, MAX_REFS).map(({ from, to }) => ({ from, to }));
  }

  // Renderings picked for this exact source in other novels.
  function previousPicks(hash) {
    const serie = currentSerie();
    return [...new Set(Object.entries(picked).filter(([n]) => n !== serie).map(([, novel]) => novel[hash]).filter(Boolean))];
  }
  for (const novel of Object.values(picked)) Object.keys(novel).forEach(updateStatus); // picks saved before statuses existed
  applyLocalTerms();
  renderTermColors();

  // Server changes go straight into the maps. Statuses are taken as they come (the server already resolved
  // conflicts), never re-derived from remote picks. Saving and re-rendering are batched: a first sync can
  // bring thousands of rows, and each GM_setValue writes a whole map.
  const remoteDirty = new Set();
  let remoteTimer = null;
  function flushRemote() {
    clearTimeout(remoteTimer); remoteTimer = null;
    if (!remoteDirty.size) return;
    if (remoteDirty.has('picked')) GM_setValue('pickedTerms', picked);
    if (remoteDirty.has('checked')) GM_setValue('checkedTerms', checked);
    if (remoteDirty.has('status')) GM_setValue('termStatus', termStatus);
    if (remoteDirty.has('confident')) GM_setValue('confidentTerms', confident);
    remoteDirty.clear();
    applyLocalTerms();
    renderTermColors();
  }
  // Rows can be edited by hand in the admin UI: anything with the wrong shape is ignored, since a bad
  // status saved here would make globalPicks() throw on every load and the script could never recover.
  function applyRemote(key, value, deleted) {
    let parts;
    try { parts = JSON.parse(key); } catch (_) { return; }
    if (!Array.isArray(parts)) return;
    const [kind, a, b] = parts;
    if (kind === 'model') { // the old ["model"] row has no provider: ignored
      if (!deleted && typeof value === 'string' && value && PROVIDERS.some((p) => p.id === a)) GM_setValue(`model:${a}`, value);
      return;
    }
    if (typeof a !== 'string') return;
    if (kind === 'status') {
      if (deleted) { if (!(a in termStatus)) return; delete termStatus[a]; }
      else if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      else if (JSON.stringify(termStatus[a]) === JSON.stringify(value)) return;
      else termStatus[a] = value;
    } else if (kind === 'confident') {
      if (deleted) { if (!(a in confident)) return; delete confident[a]; }
      else if (typeof value !== 'string' || !value || confident[a] === value) return;
      else confident[a] = value;
    } else if (kind === 'picked' || kind === 'checked') {
      if (typeof b !== 'string') return;
      const map = kind === 'picked' ? picked : checked;
      if (deleted) {
        if (!map[a] || !(b in map[a])) return;
        delete map[a][b];
        if (!Object.keys(map[a]).length) delete map[a];
      } else if (!(typeof value === 'string' || (kind === 'picked' && value === null))) return; // a picked null = "not in this novel"
      else if (map[a]?.[b] === value) return;
      else (map[a] ||= {})[b] = value;
    } else return;
    remoteDirty.add(kind);
    if (!remoteTimer) remoteTimer = setTimeout(flushRemote, 100);
  }
  // Each tab keeps these maps in memory and saves them whole: take another tab's save (a local edit or,
  // with sync, pulled entries), or this tab's next edit would write its stale copy over it. Sync on or off.
  for (const [name, map] of [['pickedTerms', picked], ['checkedTerms', checked], ['termStatus', termStatus], ['confidentTerms', confident]]) {
    GM_addValueChangeListener(name, (_, __, value, remote) => {
      if (!remote) return;
      for (const k of Object.keys(map)) delete map[k];
      Object.assign(map, value || {});
      applyLocalTerms();
      renderTermColors();
    });
  }
  if (kv) {
    kv.onChange(applyRemote);
    addEventListener('pagehide', flushRemote); // don't lose a pulled batch whose save was still pending
    kvBatched(() => {
      // First run with sync: offer every existing entry at clientUpdated 1, so any real edit on any device
      // wins over this old data, and two devices' old data merge instead of overwriting each other.
      if (!GM_getValue('syncBootstrapped', false)) {
        for (const [serie, novel] of Object.entries(picked)) for (const [hash, t] of Object.entries(novel)) kvPut(['picked', serie, hash], t, 1);
        for (const [serie, novel] of Object.entries(checked)) for (const [hash, r] of Object.entries(novel)) kvPut(['checked', serie, hash], r, 1);
        for (const [hash, s] of Object.entries(termStatus)) kvPut(['status', hash], s, 1);
        for (const [hash, t] of Object.entries(confident)) kvPut(['confident', hash], t, 1);
        for (const p of PROVIDERS) if (savedModel(p.id)) kvPut(['model', p.id], savedModel(p.id), 1);
        GM_setValue('syncBootstrapped', true);
      }
      // Heal maps that lost synced entries (e.g. overwritten by a stale tab before 1.4.0's listener).
      for (const [k, v] of kv.entries('')) applyRemote(k, v, false);
    });
    kv.start();
    // A new server (URL changed in settings) has none of our data: offer everything again.
    if (GM_getValue('syncResync', false)) { GM_deleteValue('syncResync'); kv.resync?.(); }
    // After a server restore, re-push edits newer than the backup (see the server README).
    GM_registerMenuCommand('WTR AI Terms: resync with server', () => kv.resync?.());
  }

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
    .wtrrank-tag.current { background: #2f6fde; }
    .wtrrank-tag.previous { background: #4a4f57; }
    .wtrrank-tag.popular { background: #8a5a00; }
    .wtrrank-trap { color: #e8b04a; font-size: 12.5px; margin-bottom: 8px; }
    .wtrrank-bar { height: 4px; background: #3a3d42; border-radius: 2px; margin: 6px 0 4px; overflow: hidden; }
    .wtrrank-bar > div { height: 100%; background: #4a7bd0; }
    .wtrrank-reason { color: #aab; font-size: 12.5px; }
    .wtrrank-muted { color: #999; font-size: 12.5px; }
    .wtrrank-err { color: #f77; white-space: pre-wrap; word-break: break-word; }
    .wtrrank-field { display: block; margin: 10px 0 4px; font-size: 12.5px; color: #bbb; }
    .wtrrank-input { width: 100%; box-sizing: border-box; background: #15171a; color: #eee; border: 1px solid #3a3d42; border-radius: 6px; padding: 8px; font-size: 14px; }
    .wtrrank-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
    .wtrrank-action { background: #2f6fde; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-size: 14px; cursor: pointer; }
    .wtrrank-action.secondary { background: #3a3d42; }
    .wtrrank-action.danger { background: #b3261e; }
    .wtrrank-pop { position: absolute; z-index: 2147482000; box-sizing: border-box; max-width: calc(100vw - 16px); }
    .wtrrank-pop-input { width: 100%; box-sizing: border-box; border-radius: 6px; padding: 4px 6px; font: inherit; color: inherit; }
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

  // The site's Base UI popover closes on Escape; only send it while the term's tooltip is open.
  function closeTooltip(data) {
    if (data.trigger?.getAttribute('aria-expanded') === 'true') {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
  }

  // onClose runs only when the user closes the panel (✕ or backdrop), not when code replaces it.
  function openPanel(title, onSettings, onClose) {
    document.querySelector('.wtrrank-overlay')?.remove();
    const body = h('div', { class: 'wtrrank-body' });
    const close = () => { overlay.remove(); if (onClose) onClose(); };
    const overlay = h('div', { class: 'wtrrank-overlay', onclick: (e) => e.target === overlay && close() },
      h('div', { class: 'wtrrank-panel', role: 'dialog', 'aria-label': title },
        h('div', { class: 'wtrrank-head' },
          h('b', {}, title),
          onSettings && h('button', { class: 'wtrrank-icon', title: 'API settings', 'aria-label': 'API settings', onclick: onSettings }, '⚙'),
          h('button', { class: 'wtrrank-icon', title: 'Close', 'aria-label': 'Close', onclick: close }, '✕')),
        body));
    document.body.append(overlay);
    return body;
  }

  const sameTerm = (a, b) => !!a && !!b && a.trim() === b.trim(); // case-sensitive: "pill" and "Pill" are different terms
  const getCfg = () => {
    const key = GM_getValue('apiKey', ''), p = detectProvider(key);
    return { key, model: p ? savedModel(p.id) : '' };
  };

  // ---------- term popover ----------
  // Replaces WTR-LAB's tooltip on picked terms. Classes are the site's own (Tailwind), so it follows its theme.
  const SITE_BTN = 'inline-flex cursor-pointer shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all select-none border border-border bg-card hover:bg-muted hover:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50 h-7 gap-1 rounded-[min(var(--radius-md),12px)] text-[0.8rem] px-2';
  let pop = null;
  const closePop = () => { pop?.remove(); pop = null; };
  document.addEventListener('pointerdown', (e) => { if (pop && !pop.contains(e.target)) closePop(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });

  function openTermPopover(el) {
    closePop();
    const hash = el.dataset.hash, serie = currentSerie();
    const term = localTerms()[hash], local = picked[serie]?.[hash], global = globalPicks()[hash];
    const counts = pickCounts(hash);
    const scope = termStatus[hash]?.dynamic ? 'This novel (dynamic: always checked)'
      : local ? (global && global !== local ? `This novel (global is "${global}")` : 'This novel')
        : !global ? `Provisional: AI gave it ≥${CONFIDENT_SCORE}% elsewhere. Save to confirm, AI Rank to check`
          : `Global, picked in ${counts.find(([t]) => t === global)?.[1] || 0} novels`;
    const data = { hash, source: hash };
    const input = h('input', { class: 'wtrrank-pop-input border border-border bg-card', value: term, autocomplete: 'off', 'aria-label': 'Term' });
    const save = () => {
      const v = input.value.trim();
      // A hand fix (e.g. "Soul Masters" -> "Soul Master") also fixes the confident rendering. If novels
      // disagree, provisionalPicks() ignores it anyway.
      if (v && hash in confident) setConfident(hash, v);
      if (v) pickTerm(data, v);
      closePop();
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
    const row = (label, ...value) => h('div', { class: 'flex items-baseline gap-2' },
      h('div', { class: 'min-w-14 px-1 font-semibold text-right text-xs shrink-0' }, label), h('div', { class: 'min-w-0 flex-1 break-words' }, ...value));
    const others = counts.filter(([t]) => t !== term).map(([t, n]) => `${t} (${n})`).join(', ');
    pop = h('div', { class: 'wtrrank-pop flex flex-col gap-2 rounded-lg bg-popover text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 p-2 w-80 chapter-theme', role: 'dialog', 'aria-label': `Term ${hash}` },
      row('From', h('span', { class: 'text-muted-foreground' }, hash)),
      row('To', input),
      row('Scope', scope),
      el.dataset.wtrrankOrig && row('WTR-LAB', h('span', { class: 'text-muted-foreground' }, el.dataset.wtrrankOrig)),
      others && row('Elsewhere', h('span', { class: 'text-muted-foreground' }, others)),
      h('div', { class: 'flex flex-wrap gap-2 justify-end' },
        h('button', { type: 'button', class: SITE_BTN, onclick: save }, 'Save'),
        h('button', { type: 'button', class: SITE_BTN, onclick: () => viaSiteTooltip(el, true) }, '🏆 AI Rank'),
        // Without a local pick only "hide here" makes sense: the global rendering comes from other novels.
        h('button', { type: 'button', class: SITE_BTN, onclick: () => { pickTerm(data, local ? undefined : null); closePop(); } }, local ? 'Delete' : 'Not in this novel'),
        h('button', { type: 'button', class: SITE_BTN, onclick: () => viaSiteTooltip(el, false) }, 'WTR-LAB')));
    document.body.append(pop);
    // Above the term like the site's tooltip, below when there is no room; kept inside the viewport.
    const r = el.getBoundingClientRect(), w = pop.offsetWidth, ph = pop.offsetHeight;
    const top = r.top - ph - 6 >= 0 ? r.top - ph - 6 : r.bottom + 6;
    pop.style.top = `${top + scrollY}px`;
    pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8)) + scrollX}px`;
  }

  // Open the site's tooltip for this term; with rank, scan() also presses AI Rank in it once loaded.
  // Candidates come from that tooltip, which is why ranking goes through it.
  function viaSiteTooltip(el, rank) {
    closePop();
    bypassOnce = true;
    el.click(); // the click handler resets autoRank, so set it after
    if (rank) autoRank = { until: Date.now() + 5000 };
  }

  // Rows for the result panel.
  // A term with 99+ WTR-LAB votes locks only when no other chip has 99+ (a split crowd means context matters).
  // Chips differing only in case ("Qi"/"qi") count as one, and either spelling locks.
  const popularTerm = (popular = []) => (new Set(popular.map((t) => t.toLowerCase())).size === 1 ? popular[0].toLowerCase() : null);
  function renderRows(body, list, data, trap) {
    const popular = popularTerm(data.popular);
    body.replaceChildren(h('div', { class: 'wtrrank-muted', style: 'margin-bottom:8px' },
      'Tap a term to use it in this novel.'),
      trap ? h('div', { class: 'wtrrank-trap' }, // native replaceChildren() would print "false"
        '⚠ Context trap: no single rendering fits every context. The term you pick becomes global, so it is never ranked again.') : '');
    const shown = list.some((x) => x.score > 0) ? list.filter((x) => x.score > 0) : list; // 0% rows hidden, unless all are 0%
    shown.forEach((x, i) => {
      const row = h('div', { class: 'wtrrank-row', tabindex: '0', role: 'button' },
        h('div', { class: 'wtrrank-top' },
          h('span', { class: 'wtrrank-muted' }, `#${i + 1}`),
          h('span', { class: 'wtrrank-term' }, x.term),
          x.isNew && h('span', { class: 'wtrrank-tag', title: 'Proposed by the AI' }, 'NEW'),
          sameTerm(x.term, data.current) && h('span', { class: 'wtrrank-tag current', title: 'Currently selected in the text' }, 'CURRENT'),
          data.previous?.includes(x.term) && h('span', { class: 'wtrrank-tag previous', title: 'Picked in another novel' }, 'PREVIOUS'),
          x.term.toLowerCase() === popular && h('span', { class: 'wtrrank-tag popular', title: '99+ WTR-LAB votes: picking it makes it global' }, '99+'),
          h('span', { class: 'wtrrank-score' }, `${x.score}%`)),
        h('div', { class: 'wtrrank-bar' }, h('div', { style: `width:${x.score}%` })),
        h('div', { class: 'wtrrank-reason' }, x.reason));
      // Use it in the text right away, then close the list and the term's tooltip.
      const pick = () => {
        if (trap || x.term.toLowerCase() === popular) lockGlobal(data.hash, x.term);
        if (x.score >= CONFIDENT_SCORE) setConfident(data.hash, x.term);
        pickTerm(data, x.term);
        document.querySelector('.wtrrank-overlay')?.remove();
        closeTooltip(data);
      };
      row.addEventListener('click', pick);
      row.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick()));
      body.append(row);
    });
  }

  // Picks from other novels join the candidates (sorted, unmarked: the AI must not know they were chosen)
  // and only get a PREVIOUS badge in the result list.
  async function runRanking(data) {
    const previous = previousPicks(data.hash);
    data = { ...data, previous, candidates: [...new Set([...data.candidates, ...previous])].sort((a, b) => a.localeCompare(b)) };
    const cfg = getCfg();
    if (!cfg.key || !cfg.model) return openConfig(() => runRanking(data));
    const body = openPanel(`Tier list: ${data.source || data.current}`, () => openConfig(() => runRanking(data)), () => closeTooltip(data));
    body.append(h('div', { class: 'wtrrank-muted' }, `Asking ${cfg.model}…`));
    try {
      const text = await chat(cfg, SYSTEM, buildPrompt(data));
      const list = normalize(parseRanking(text, data.candidates));
      markChecked(data);
      renderRows(body, list, data, /"trap"\s*:\s*true/.test(text)); // regex: survives the loose-JSON fallback
    } catch (err) {
      body.replaceChildren(h('div', { class: 'wtrrank-err' }, String(err.message || err)));
    }
  }

  function openConfig(after) {
    const cfg = getCfg();
    const body = openPanel('WTR AI Terms — API settings');
    const keyIn = h('input', { class: 'wtrrank-input', type: 'password', autocomplete: 'off', placeholder: 'sk-ant-… / sk-… / sk-or-… / AIza… / gsk_… / xai-…' });
    keyIn.value = cfg.key;
    const status = h('div', { class: 'wtrrank-muted' });
    const select = h('select', { class: 'wtrrank-input' });
    const manual = h('input', { class: 'wtrrank-input', placeholder: 'Model name (used if not empty)' });
    manual.value = cfg.model;
    let shownPid = detectProvider(cfg.key)?.id; // the provider whose saved model the fields show
    const syncUrlIn = h('input', { class: 'wtrrank-input', autocomplete: 'off', placeholder: 'http://100.x.y.z:8090 (empty = no sync)' });
    syncUrlIn.value = GM_getValue('syncUrl', '');
    const syncTokenIn = h('input', { class: 'wtrrank-input', type: 'password', autocomplete: 'off', placeholder: 'This device\'s token' });
    syncTokenIn.value = GM_getValue('syncToken', '');

    async function load() {
      const p = detectProvider(keyIn.value), chosen = select.value;
      select.replaceChildren();
      if (!p) { status.textContent = keyIn.value ? 'Unrecognized key format.' : ''; return; }
      let want = manual.value.trim() || chosen; // Reload models keeps what was chosen
      if (p.id !== shownPid) { shownPid = p.id; want = manual.value = savedModel(p.id); }
      status.textContent = `Detected ${p.name}. Loading models…`;
      try {
        const models = await listModels(keyIn.value.trim());
        select.append(h('option', { value: '' }, '— choose a model —'));
        for (const m of models) {
          const o = h('option', { value: m.id }, `${m.warn ? '⚠ ' : ''}${m.label}`);
          if (m.warn) o.title = 'Could not confirm this is a text model';
          select.append(o);
        }
        if (models.some((m) => m.id === want)) { select.value = want; manual.value = ''; }
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
      h('label', { class: 'wtrrank-field' }, 'Sync server URL'), syncUrlIn,
      h('label', { class: 'wtrrank-field' }, 'Sync token'), syncTokenIn,
      h('div', { class: 'wtrrank-muted' }, 'Sync settings stay on this device and apply after a page reload.'),
      h('div', { class: 'wtrrank-muted' }, kv ? syncStatusText(kv.status()) // why sync is off, so it can be fixed
        : !syncUrl || !syncToken ? 'Sync off: no server URL or token saved on this device.'
        : 'Sync off: the sync library (kvsync.js) did not load. Update the script in Violentmonkey while the server is on.'),
      h('div', { class: 'wtrrank-actions' },
        h('button', { class: 'wtrrank-action secondary', onclick: load }, 'Reload models'),
        h('button', {
          class: 'wtrrank-action',
          onclick: () => {
            const model = manual.value.trim() || select.value, p = detectProvider(keyIn.value);
            if (!p) return (status.textContent = 'Unrecognized key format.');
            if (!model) return (status.textContent = 'Choose or type a model.');
            GM_setValue('apiKey', keyIn.value.trim());
            if (model !== savedModel(p.id)) kvPut(['model', p.id], model);
            GM_setValue(`model:${p.id}`, model);
            if (syncUrlIn.value.trim() !== GM_getValue('syncUrl', '')) GM_setValue('syncResync', true);
            GM_setValue('syncUrl', syncUrlIn.value.trim());
            GM_setValue('syncToken', syncTokenIn.value.trim());
            document.querySelector('.wtrrank-overlay')?.remove();
            if (after) after();
          },
        }, 'Save')),
      h('div', { class: 'wtrrank-actions', style: 'justify-content:flex-start;border-top:1px solid #3a3d42;padding-top:12px' },
        h('button', { class: 'wtrrank-action danger', onclick: resetData }, 'Reset saved data')),
      h('div', { class: 'wtrrank-muted' }, 'Deletes every checked and picked term in all novels, on every synced device too. Keeps the API key, model and sync settings.'));
    if (cfg.key) load();
  }

  const syncStatusText = ({ lastOkAt, lastError }) =>
    `Last sync: ${lastOkAt ? new Date(lastOkAt).toLocaleString() : 'not yet'}${lastError ? ` · error: ${lastError}` : ''}`;

  function resetData() {
    if (!confirm('Delete all checked and picked terms in every novel (and on synced devices)? The API key, model and sync settings are kept. This cannot be undone.')) return;
    // Tombstones reach the other devices too. Their pending queue lives in the KvSync state key, so keep it.
    if (kv) kvBatched(() => { for (const [k] of kv.entries('')) if (!k.startsWith('["model"')) kv.remove(k); });
    const keep = ['apiKey', 'syncUrl', 'syncToken', 'syncResync', KV_STATE];
    for (const k of GM_listValues()) if (!keep.includes(k) && !k.startsWith('model:')) GM_deleteValue(k);
    for (const k of Object.keys(checked)) delete checked[k];
    for (const k of Object.keys(picked)) delete picked[k];
    for (const k of Object.keys(termStatus)) delete termStatus[k];
    for (const k of Object.keys(confident)) delete confident[k];
    applyLocalTerms(); // puts WTR-LAB's own text back on every term we had rewritten
    renderTermColors();
    document.querySelector('.wtrrank-overlay')?.remove();
  }

  GM_registerMenuCommand('WTR AI Terms settings', () => openConfig());
  // ---------- self-check ----------
  console.assert(detectProvider('sk-ant-api03-x').id === 'anthropic', 'wtrrank: anthropic');
  console.assert(detectProvider('sk-or-v1-x').id === 'openrouter', 'wtrrank: openrouter');
  console.assert(detectProvider('sk-0123456789abcdef0123456789abcdef').id === 'deepseek', 'wtrrank: deepseek');
  console.assert(detectProvider('sk-proj-abc').id === 'openai', 'wtrrank: openai');
  console.assert(detectProvider('AIzaXYZ').id === 'gemini', 'wtrrank: gemini');
  console.assert(normalize([{ score: 1 }, { score: 1 }, { score: 1 }]).reduce((a, x) => a + x.score, 0) === 100, 'wtrrank: sum 100');
  console.assert(normalize([{ score: 0 }, { score: 0 }]).every((x) => x.score === 0), 'wtrrank: zeros');
  console.assert(normalize(Array.from({ length: 6 }, () => ({ score: 25 }))).map((x) => x.score).join() === '17,17,17,17,16,16', 'wtrrank: rounding keeps order');
  console.assert(normalize([...Array.from({ length: 18 }, () => ({ score: 5.5 })), { score: 1 }]).every((x) => x.score >= 0), 'wtrrank: no negative score');
  // Bad server rows (wrong shape, unknown kind, broken key) must change nothing. '\0t' ids never exist for real.
  for (const [k, v] of [['not json', 'x'], ['["status","\\u0000t"]', null], ['["status","\\u0000t"]', ['a']], ['["picked","\\u0000t","x"]', 42],
    ['["checked","\\u0000t","x"]', null], ['["confident","\\u0000t"]', ''], ['["other","\\u0000t"]', 'v']]) applyRemote(k, v, false);
  console.assert(!('\0t' in termStatus) && !('\0t' in picked) && !('\0t' in checked) && !('\0t' in confident), 'wtrrank: bad sync rows ignored');
  const many = (a, n, b = '', m = 0) => [...Array(n).fill(a), ...Array(m).fill(b)];
  console.assert(decideStatus(many('A', 5)).global === 'A' && decideStatus(many('A', 4)) === null, 'wtrrank: global at 5 identical');
  console.assert(decideStatus(many('A', 4, 'B', 1)) === null && decideStatus(many('A', 8, 'B', 1)) === null, 'wtrrank: mixed waits for 10');
  console.assert(decideStatus(many('A', 9, 'B', 1)).global === 'A' && decideStatus(many('A', 8, 'B', 2)).dynamic, 'wtrrank: decided at 10');
  const loose = parseRanking('{"ranking":[{"term":"A","score":60,"reason":"uses {x}"} {"term":"B","score":40,"reason":"r"}]}');
  console.assert(loose.length === 2 && loose[0].reason === 'uses {x}' && loose[1].score === 40, 'wtrrank: missing comma tolerated');
  console.assert(parseRanking('```json\n{"ranking":[{"term":"A","score":60,"reason":"r"}]}\n```')[0].score === 60, 'wtrrank: parse');
  const dup = parseRanking('{"ranking":[{"term":"A","score":30,"new":true,"reason":"x"},{"term":"A","score":40,"reason":"y"},{"term":"a","score":30,"new":false}]}', ['A']);
  console.assert(syncStatusText({ lastOkAt: null, lastError: 'push 401' }) === 'Last sync: not yet · error: push 401', 'wtrrank: sync status text');
  console.assert(popularTerm(['Soul Ring', 'soul ring']) === 'soul ring' && popularTerm(['A', 'B']) === null && popularTerm([]) === null, 'wtrrank: 99+ case-only duplicates merge');
  console.assert(kvKey('model') === '["model"]' && kvKey('status', 'x'.repeat(2000)) === null, 'wtrrank: sync keys, too long stays local');
  console.assert(dup.length === 2 && dup[0].score === 70 && dup[0].reason === 'y' && !dup[0].isNew && dup[1].isNew, 'wtrrank: merge duplicates, local NEW');
})();
