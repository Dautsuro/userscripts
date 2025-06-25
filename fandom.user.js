// ==UserScript==
// @name         Fandom
// @namespace    https://github.com/Dautsuro/userscripts
// @version      1.0.0
// @description  Change the Fandom website to be easier to use with other userscripts.
// @match        https://*.fandom.com/wiki/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=fandom.com
// @downloadURL  https://raw.githubusercontent.com/Dautsuro/userscripts/main/fandom.user.js
// @supportURL   https://github.com/Dautsuro/userscripts/issues
// @homepageURL  https://github.com/Dautsuro/userscripts
// @top-level-await
// @noframes
// ==/UserScript==

setInterval(() => {
    const buttons = document.querySelectorAll('button');
    const expandButtons = Array.from(buttons).filter(button => button.textContent.includes('Expand'));

    for (const expandButton of expandButtons) {
        expandButton.click();
    }
}, 500);
