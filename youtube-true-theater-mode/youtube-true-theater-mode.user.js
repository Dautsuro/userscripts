// ==UserScript==
// @name         YouTube True Theater Mode
// @namespace    youtube-true-theater-mode
// @version      1.0.0
// @description  Theater mode fills the whole page like fullscreen, without leaving the browser window. Scroll down for the comments.
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // Only while a watch page is shown in theater mode (YouTube keeps a hidden watch page around on other pages).
  const ON = 'ytd-watch-flexy[theater]:not([hidden])';
  const style = document.createElement('style');
  style.textContent = `
    html:has(${ON}) { scrollbar-width: none !important; }
    ytd-app:has(${ON}) #masthead-container { display: none !important; }
    ytd-app:has(${ON}) #page-manager { margin-top: 0 !important; }
    ${ON} #full-bleed-container { height: 100vh !important; max-height: none !important; min-height: 0 !important; }
  `;
  document.documentElement.append(style);
})();
