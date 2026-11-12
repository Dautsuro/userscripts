// ==UserScript==
// @name         69shuba Translate
// @namespace    69shuba-translate
// @version      1.0.0
// @description  Adds a "Translate" button to 69shuba.tw book pages: DeepSeek translates the title and synopsis to English, shown under the Chinese.
// @match        https://69shuba.tw/book/*/
// @include      /^https:\/\/69shuba\.tw\/book\/\d+$/
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.deepseek.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const SYSTEM_PROMPT = [
    'You translate Chinese web novel titles and synopses into English for web novel readers.',
    'Write a natural, readable English translation, not a word-for-word one.',
    'Keep proper names consistent: pinyin for character names; translate the meaning of sect, technique and place names when that reads naturally.',
    'Keep the synopsis line breaks.',
    'Output only a JSON object: {"title": "...", "synopsis": "..."}',
  ].join('\n');

  // Parses the model's reply into {title, synopsis}; falls back to the first {...} block in the text.
  function parseResult(text) {
    const tryParse = s => { try { return JSON.parse(s); } catch (e) { return null; } };
    let obj = tryParse(text);
    if (!obj) {
      const m = String(text).match(/\{[\s\S]*\}/);
      obj = m && tryParse(m[0]);
    }
    if (!obj || typeof obj.title !== 'string' || typeof obj.synopsis !== 'string') return null;
    return { title: obj.title.trim(), synopsis: obj.synopsis.trim() };
  }

  console.assert(parseResult('{"title":"A","synopsis":"B"}').title === 'A', '69shuba: plain json');
  console.assert(parseResult('Here:\n```json\n{"title":"A","synopsis":"B\\nC"}\n```').synopsis === 'B\nC', '69shuba: json in text');
  console.assert(parseResult('   ') === null && parseResult('{"title":1}') === null, '69shuba: bad json');

  GM_registerMenuCommand('Set DeepSeek API key', askKey);

  function askKey() {
    const key = (prompt('DeepSeek API key (stored in Violentmonkey only):') || '').trim();
    if (key) GM_setValue('apiKey', key);
    return key;
  }

  // Book page only: /book/<ID>/ or /book/<ID>, never chapter or other pages.
  const m = location.pathname.match(/^\/book\/(\d+)\/?$/);
  if (!m) return;
  const bookId = m[1];
  const cacheKey = 'book:' + bookId;

  const titleEl = document.querySelector('.bookinfo td.info h1');
  const introEl = document.querySelector('.intro');
  if (!titleEl || !introEl) return;

  const style = document.createElement('style');
  style.textContent = `
    .shuba-tr-bar { display: inline-flex; align-items: center; gap: 8px; margin-left: 10px; vertical-align: middle;
      font-size: 14px; font-weight: normal; }
    .shuba-tr-btn { background: rgb(101, 187, 236); color: #fff; border: 0; border-radius: 3px; padding: 4px 12px;
      font-size: 14px; cursor: pointer; }
    .shuba-tr-btn:disabled { opacity: .6; cursor: default; }
    .shuba-tr-redo { background: none; border: 0; padding: 0; color: rgb(101, 187, 236); font-size: 12px;
      cursor: pointer; text-decoration: underline; }
    .shuba-tr-redo[hidden] { display: none; }
    .shuba-tr-err { color: #c0392b; font-size: 13px; }
    .shuba-tr-title { margin: 4px 0 8px; font-size: 16px; font-weight: bold; color: #555; }
    .shuba-tr-syn { margin: 8px 0; padding: 8px 10px; border-left: 3px solid rgb(101, 187, 236); background: #f5fafd;
      color: #333; line-height: 1.6; white-space: pre-wrap; }
  `;
  document.head.appendChild(style);

  const bar = el('span', 'shuba-tr-bar');
  const btn = el('button', 'shuba-tr-btn', 'Translate');
  btn.type = 'button';
  const redo = el('button', 'shuba-tr-redo', 'retranslate');
  redo.type = 'button';
  redo.hidden = true;
  const err = el('span', 'shuba-tr-err');
  bar.append(btn, redo, err);
  titleEl.appendChild(bar);

  const titleOut = el('div', 'shuba-tr-title');
  const synOut = el('div', 'shuba-tr-syn');
  titleOut.hidden = synOut.hidden = true;
  titleEl.after(titleOut);
  introEl.after(synOut);

  const cached = GM_getValue(cacheKey, null);
  if (cached) show(cached);

  btn.addEventListener('click', () => {
    const c = GM_getValue(cacheKey, null);
    if (c) show(c); else translate();
  });
  redo.addEventListener('click', () => { if (!btn.disabled) translate(); });

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    e.className = cls;
    if (text) e.textContent = text;
    return e;
  }

  function show(r) {
    titleOut.textContent = r.title;
    synOut.textContent = r.synopsis;
    titleOut.hidden = synOut.hidden = false;
    redo.hidden = false;
  }

  async function translate() {
    err.textContent = '';
    const key = GM_getValue('apiKey', '') || askKey();
    if (!key) { err.textContent = 'No API key set (menu: Set DeepSeek API key).'; return; }

    // Title text only: our button bar sits inside the h1.
    const title = [...titleEl.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim();
    const synopsis = introEl.innerText.trim(); // innerText keeps <br> line breaks

    btn.disabled = true;
    btn.textContent = 'Translating…';
    try {
      const r = await callApi(key, title, synopsis);
      GM_setValue(cacheKey, r);
      show(r);
    } catch (e) {
      err.textContent = e.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Translate';
    }
  }

  async function callApi(key, title, synopsis) {
    const body = {
      model: 'deepseek-flash',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ title, synopsis }) },
      ],
      thinking: { type: 'disabled' },
      reasoning_effort: 'low',
      response_format: { type: 'json_object' },
    };
    let res = await post(key, body);
    // If the API refuses reasoning_effort next to disabled thinking, keep thinking off and drop it.
    if (res.status === 400 && /reasoning_effort/i.test(res.responseText)) {
      delete body.reasoning_effort;
      res = await post(key, body);
    }
    if (res.status === 401) throw new Error('Invalid API key (401). Fix it with the menu: Set DeepSeek API key.');
    if (res.status === 402) throw new Error('DeepSeek balance too low (402).');
    let data = null;
    try { data = JSON.parse(res.responseText); } catch (e) { /* handled below */ }
    if (res.status !== 200) {
      const msg = data && data.error && data.error.message;
      throw new Error(`API error ${res.status}${msg ? ': ' + String(msg).slice(0, 120) : ''}`);
    }
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const r = content && parseResult(content);
    if (!r) throw new Error('Bad response from the API (no valid JSON).');
    return r;
  }

  function post(key, body) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: 'https://api.deepseek.com/chat/completions',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        data: JSON.stringify(body),
        timeout: 90000,
        onload: resolve,
        onerror: () => reject(new Error('Network error: could not reach DeepSeek.')),
        ontimeout: () => reject(new Error('DeepSeek timed out.')),
      });
    });
  }
})();
