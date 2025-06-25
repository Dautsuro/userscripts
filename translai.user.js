// ==UserScript==
// @name         TranslAI
// @namespace    https://github.com/Dautsuro/userscripts
// @version      1.7.2
// @description  TranslAI auto-translates Chinese novel chapters to English with consistent names using a built-in NameManager.
// @match        https://www.69shuba.com/book/*.htm
// @match        https://www.69shuba.com/txt/*/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=69shuba.com
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.setClipboard
// @downloadURL  https://raw.githubusercontent.com/Dautsuro/userscripts/main/translai.user.js
// @supportURL   https://github.com/Dautsuro/userscripts/issues
// @homepageURL  https://github.com/Dautsuro/userscripts
// @top-level-await
// @noframes
// ==/UserScript==

const Color = {
    RED: '#a35c5c',
    GREEN: '#5c9c7c',
    BLUE: '#5c7c9c',
    ORANGE: '#a3754c',
    PURPLE: '#7a5c9e',
};

const Position = {
    LEFT: 'left',
    RIGHT: 'right',
};

class Gemini {
    static async init() {
        this.apiKey = await GM.getValue('apiKey', null);

        if (!this.apiKey) {
            this.apiKey = prompt('Enter your Gemini API key')?.trim();
            if (this.apiKey) GM.setValue('apiKey', this.apiKey);
        }
    }

    static async request(instruction, input) {
        try {
            if (!this.apiKey) {
                throw new Error('Missing Gemini API key');
            }

            const payload = {
                systemInstruction: { parts: [{ text: instruction }] },
                contents: [{ parts: [{ text: input }] }],
            };

            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent?key=${this.apiKey}`;

            const options = {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            };

            while (true) {
                const response = await fetch(url, options);

                if (!response.ok) {
                    if (response.status === 503) {
                        handleError('Gemini server is busy', 'Retry again in 5 s');
                        await sleep(5000);
                        continue;
                    }

                    if (response.status === 429) {
                        const data = await response.json();
                        let delay = data.error?.details?.[2]?.retryDelay;

                        if (delay) {
                            delay = delay.match(/\d+/g)[0] * 1000;
                        } else {
                            delay = 5000;
                        }

                        handleError('Gemini quota is reached', `Retry again in ${delay / 1000} s`);
                        await sleep(delay);
                        continue;
                    }

                    throw new Error(`Response is not OK: ${response.status} ${response.statusText ? `(${response.statusText})` : ''}\n${JSON.stringify(await response.json())}`);
                }

                const data = await response.json();

                if (
                    !data ||
                    !data.candidates ||
                    !data.candidates[0] ||
                    !data.candidates[0].content ||
                    !data.candidates[0].content.parts ||
                    !data.candidates[0].content.parts[0] ||
                    !data.candidates[0].content.parts[0].text
                ) {
                    throw new Error(`Data is not OK: ${JSON.stringify(data)}`);
                }

                return data.candidates[0].content.parts[0].text;
            }
        } catch (error) {
            throw error;
        }
    }
}

class Novel {
    constructor(titleElement, synopsisElement) {
        this.titleElement = titleElement;
        this.synopsisElement = synopsisElement;
    }

    static get id() {
        let id = location.href.split('/')[4];
        
        if (id.includes('.')) {
            id = id.split('.')[0];
        }

        return id;
    }

    translate() {
        let title = this.titleElement.innerText.trim();
        let synopsis = this.synopsisElement.innerText.trim();

        const names = NameManager.getNames();
        names.sort((a, b) => b.original.length - a.original.length);

        for (const name of names) {
            title = title.replace(new RegExp(RegExp.escape(name.original), 'g'), name.translated);
            synopsis = synopsis.replace(new RegExp(RegExp.escape(name.original), 'g'), name.translated);
        }

        const titleInstruction = 'You are a professional literary translator specializing in Chinese-to-English translations of web novels. Your task is to translate the Chinese novel title into English. If an English name is already present in the Chinese chapter, do not change it. Only output the translated title. Do not include any explanations, commentary, or additional text. If you cannot translate, respond with [UNTRANSLATABLE] and nothing else.';
        const synopsisInstruction = 'You are a professional literary translator specializing in Chinese-to-English translations of web novels. Your task is to translate the Chinese novel synopsis into English. If an English name is already present in the Chinese chapter, do not change it. Only output the translated synopsis. Do not include any explanations, commentary, or additional text. If you cannot translate, respond with [UNTRANSLATABLE] and nothing else.';

        Gemini.request(titleInstruction, title)
            .then(translatedTitle => this.titleElement.innerText = translatedTitle)
            .catch(error => handleError('Error while translating novel title', error));

        Gemini.request(synopsisInstruction, synopsis)
            .then(translatedSynopsis => this.synopsisElement.innerText = translatedSynopsis)
            .catch(error => handleError('Error while translating novel synopsis', error));
    }
}

class Chapter {
    constructor(element) {
        this.element = element;
        Chapter.instance = this;
    }

    async translate() {
        const titleElement = this.element.querySelector('h1.hide720');
        const title = titleElement.innerText.trim();
        titleElement.remove();

        this.content = this.element.innerText.trim();
        const lines = this.content.split('\n');

        if (!lines[0].includes(title) && !title.includes(lines[0].trim())) {
            this.content = [title, ...lines].join('\n');
        }

        const instruction = 'You are a professional literary translator specializing in Chinese-to-English translations of web novels. Your task is to translate the Chinese novel chapter into English. If an English name is already present in the Chinese chapter, do not change it. Only output the translated chapter, do not remove the chapter title. Do not include any explanations, commentary, or additional text. If you cannot translate, respond with [UNTRANSLATABLE] and nothing else.';

        let content = this.content;
        const names = NameManager.getNames();
        names.sort((a, b) => b.original.length - a.original.length);

        for (const name of names) {
            content = content.replace(new RegExp(RegExp.escape(name.original), 'g'), name.translated);
        }

        try {
            this.translatedContent = await Gemini.request(instruction, content);
            this.extractNames();
        } catch (error) {
            handleError('Error while translating novel chapter', error);
        }
    }

    async extractNames() {
        const instruction = 'You are a bilingual data extraction expert specializing in identifying and mapping proper nouns in Chinese-English novel texts. Your task is to extract all proper nouns from the Chinese and English chapter. Create a JSON array following this pattern: [{"original":"Chinese name","translated":"English name"}]. Only output the JSON array. Do not include any explanations, commentary, or additional text. If you cannot execute this task, respond with [ERROR] and nothing else.';

        const input = `Chinese chapter:
        ${this.content}
        
        English chapter:
        ${this.translatedContent}`;

        try {
            let names = await Gemini.request(instruction, input);

            if (names.includes('```json')) {
                names = names.replace(/```json|```/g, '');
            }

            if (!isParsable(names)) throw new Error(`Bad JSON: ${names}`);
            names = JSON.parse(names);
            NameManager.addNames(names);
            this.refreshDOM();
        } catch (error) {
            if (error.message.includes('PROHIBITED_CONTENT')) {
                this.refreshDOM();
                return;
            }

            handleError('Error while extracting names', error);
        }
    }

    refreshDOM() {
        let content = this.translatedContent;
        const names = NameManager.getNames();
        names.sort((a, b) => b.translated.length - a.translated.length);

        for (const name of names) {
            content = content.replace(new RegExp(`(?!<span[^>]*>)${RegExp.escape(name.translated)}(?![^<]*</span>)`, 'g'), () => {
                let color = Color.RED;
                if (NameManager.isChild(name)) color = Color.ORANGE;
                if (NameManager.isParent(name)) color = Color.PURPLE;
                if (name.checked) color = Color.BLUE;
                if (NameManager.isGlobal(name)) color = Color.GREEN;

                return `<span style="color: ${color}; user-select: all;" data-original="${name.original}">${name.translated}</span>`;
            });
        }

        this.element.innerHTML = content.replace(/\n/g, '<br>');
    }

    static editName(oldName, newName) {
        const chapter = this.instance;
        if (!chapter) return;

        chapter.translatedContent = chapter.translatedContent.replace(new RegExp(RegExp.escape(oldName), 'g'), newName);
        chapter.refreshDOM();
    }

    static refreshDOM() {
        this.instance?.refreshDOM();
    }
}

class NameManager {
    static async init() {
        this.localNames = await GM.getValue(`names:${Novel.id}`, []);
        this.globalNames = await GM.getValue('names', []);
    }

    static addNames(names) {
        for (const name of names) {
            if (!name.original || !name.translated) continue;
            if (this.getName(name.original)) continue;

            this.localNames.push({
                original: name.original,
                translated: name.translated,
            });
        }

        this.save();
    }

    static getName(originalName) {
        const names = this.getNames();
        return names.find(n => n.original === originalName);
    }

    static getNames() {
        return [...this.localNames, ...this.globalNames];
    }

    static save() {
        GM.setValue(`names:${Novel.id}`, this.localNames);
        GM.setValue('names', this.globalNames);
    }

    static isGlobal(name) {
        const globalName = this.globalNames.find(n => n.original === name.original);
        return globalName ? true : false;
    }

    static editName() {
        const name = this.getSelectedName();
        if (!name) return;

        const newName = prompt('Enter new name', name.translated)?.trim();
        if (!newName) return;

        const oldName = name.translated;
        name.translated = newName;
        this.save();
        Chapter.editName(oldName, newName);
    }

    static getSelectedName() {
        const selection = getSelection();

        if (!selection) {
            return;
        }

        const node = selection.anchorNode;
        return this.getName(node.dataset.original);
    }

    static removeName(name) {
        if (!name.original) name = this.getSelectedName();
        if (!name) return;

        this.localNames = this.localNames.filter(n => n.original !== name.original);
        this.globalNames = this.globalNames.filter(n => n.original !== name.original);
        this.save();
        Chapter.refreshDOM();
    }

    static addGlobal() {
        const name = this.getSelectedName();
        if (!name) return;

        if (this.isGlobal(name)) {
            this.globalNames = this.globalNames.filter(n => n.original !== name.original);
            this.localNames.push(name);
            this.save();
            Chapter.refreshDOM();
            return;
        }

        const newName = prompt('Enter new name')?.trim();

        if (newName) {
            const oldName = name.translated;
            name.translated = newName;
            Chapter.editName(oldName, newName);
        }

        this.localNames = this.localNames.filter(n => n.original !== name.original);
        delete name.checked;
        this.globalNames.push(name);
        this.save();
        Chapter.refreshDOM();
    }

    static checkName() {
        const name = this.getSelectedName();
        if (!name) return;
        if (this.isGlobal(name)) return;

        if (name.checked) {
            delete name.checked;
            this.save();
            Chapter.refreshDOM();
            return;
        }

        const newName = prompt('Enter new name')?.trim();

        if (newName) {
            const oldName = name.translated;
            name.translated = newName;
            Chapter.editName(oldName, newName);
        }

        name.checked = true;
        this.save();
        Chapter.refreshDOM();
    }

    static newName() {
        const originalName = prompt('Enter original name')?.trim();
        if (!originalName) return;

        const translatedName = prompt('Enter translated name')?.trim();
        if (!translatedName) return;

        const name = {
            original: originalName,
            translated: translatedName,
        };

        const existingName = this.getName(name.original);

        if (existingName) {
            Chapter.editName(existingName.translated, name.translated);
            this.removeName(existingName);
        }

        this.globalNames.push(name);
        this.save();
        Chapter.refreshDOM();
    }

    static copyName() {
        const name = this.getSelectedName();
        if (!name) return;
        let formattedText = `${name.original}\n\n`;
        let isFormatted = false;
        let refuseFormat = false;

        if (this.isChild(name)) {
            if (confirm('Formatted copy?')) {
                const parentNames = this.getParentNames(name);
                formattedText += `Parent names:\n`;

                for (const parentName of parentNames) {
                    formattedText += `${parentName.original}: ${parentName.translated}\n`;
                }

                formattedText += '\n';
                isFormatted = true;
            } else {
                refuseFormat = true;
            }
        }

        if (!refuseFormat) {
            if (this.isParent(name)) {
                if (isFormatted || confirm('Formatted copy?')) {
                    const childNames = this.getChildNames(name);
                    formattedText += `Child names:\n`;

                    for (const childName of childNames) {
                        if (formattedText.includes(`\n${childName.original}:`)) continue;
                        formattedText += `${childName.original}: ${childName.translated}\n`;
                    }

                    formattedText += '\n';
                    isFormatted = true;
                } else {
                    refuseFormat = true;
                }
            }
        }

        if (!refuseFormat) {
            const similarNames = this.getSimilarNames(name);

            if (similarNames.length > 0) {
                if (isFormatted || confirm('Formatted copy?')) {
                    formattedText += `Similar names:\n`;

                    for (const similarName of similarNames) {
                        if (formattedText.includes(`\n${similarName.original}:`)) continue;
                        formattedText += `${similarName.original}: ${similarName.translated}\n`;
                    }

                    isFormatted = true;
                } else {
                    refuseFormat = true;
                }
            }
        }

        GM.setClipboard(isFormatted ? formattedText.trim() : name.original, 'text/plain');
    }

    static isChild(name) {
        const verifiedNames = this.getVerifiedNames();

        for (const verifiedName of verifiedNames) {
            if (verifiedName.original.includes(name.original) && name.original !== verifiedName.original) {
                return true;
            }
        }

        return false;
    }

    static getVerifiedNames() {
        return [...this.localNames.filter(n => n.checked), ...this.globalNames];
    }

    static getParentNames(name) {
        const verifiedNames = this.getVerifiedNames();
        const parentNames = [];

        for (const verifiedName of verifiedNames) {
            if (verifiedName.original.includes(name.original) && name.original !== verifiedName.original) {
                parentNames.push(verifiedName);
            }
        }

        return parentNames;
    }

    static isParent(name) {
        const verifiedNames = this.getVerifiedNames();

        for (const verifiedName of verifiedNames) {
            if (name.original.includes(verifiedName.original) && name.original !== verifiedName.original) {
                return true;
            }
        }

        return false;
    }

    static getChildNames(name) {
        const verifiedNames = this.getVerifiedNames();
        const childNames = [];

        for (const verifiedName of verifiedNames) {
            if (name.original.includes(verifiedName.original) && name.original !== verifiedName.original) {
                childNames.push(verifiedName);
            }
        }

        return childNames;
    }

    static getSimilarNames(name) {
        const isSimilar = (similarLetterCount, totalLetterCount) => {
            if ((similarLetterCount / totalLetterCount) * 100 >= 60) return true;
            return false;
        }
        
        const verifiedNames = this.getVerifiedNames();
        const similarNames = [];

        for (const verifiedName of verifiedNames) {
            if (verifiedName.original === name.original) continue;

            const nameLetters = name.original.split('');
            const verifiedNameLetters = verifiedName.original.split('');

            let similarLetterCount = 0;
            let totalLetterCount = 0;

            for (const nameLetter of nameLetters) {
                for (const verifiedNameLetter of verifiedNameLetters) {
                    if (nameLetter === verifiedNameLetter) {
                        similarLetterCount++;
                        break;
                    }
                }

                totalLetterCount++;
            }

            if (isSimilar(similarLetterCount, totalLetterCount)) {
                similarNames.push(verifiedName);
                continue;
            }

            similarLetterCount = 0;
            totalLetterCount = 0;

            for (const verifiedNameLetter of verifiedNameLetters) {
                for (const nameLetter of nameLetters) {
                    if (verifiedNameLetter === nameLetter) {
                        similarLetterCount++;
                        break;
                    }
                }

                totalLetterCount++;
            }

            if (isSimilar(similarLetterCount, totalLetterCount)) {
                similarNames.push(verifiedName);
            }
        }

        return similarNames;
    }
}

class Button {
    static leftOffset = 0;
    static rightOffset = 0;

    constructor(text, position, onClick) {
        const element = document.createElement('button');
        element.innerText = text;
        element.addEventListener('click', onClick);

        Object.assign(element.style, {
            position: 'fixed',
            bottom: `${5 + Button[`${position}Offset`]}px`,
            [position]: '5px',
            zIndex: 1000,
            backgroundColor: '#181a1b',
            padding: '5px',
        });

        document.body.appendChild(element);
        Button[`${position}Offset`] += 5 + element.getBoundingClientRect().height;
    }
}

function handleError(reason, error) {
    if (typeof error === 'string') {
        error = { message: error };
    }

    document.body.innerHTML = `
        <div style="
            font-family: system-ui, sans-serif;
            padding: 1.5rem;
            margin: 3rem auto;
            max-width: 600px;
            border-left: 5px solid #d00;
            background-color: rgba(255, 0, 0, 0.05);
            color: inherit;
            border-radius: 6px;
        ">
            <h2 style="margin-top: 0;">⚠️ An error occured</h2>
            <p><strong>Reason:</strong> ${reason}</p>
            <p><strong>Details:</strong> ${error.message}</p>
            <p>Try refreshing the page.</p>
        </div>
    `;
}

function sleep(delay) {
    return new Promise(res => setTimeout(res, delay));
}

function isParsable(jsonString) {
    try {
        JSON.parse(jsonString);
        return true;
    } catch (error) {
        return false;
    }
}

await Gemini.init();
await NameManager.init();

new Button('✏️', Position.LEFT, NameManager.editName.bind(NameManager));
new Button('➖', Position.LEFT, NameManager.removeName.bind(NameManager));

new Button('➕', Position.RIGHT, NameManager.addGlobal.bind(NameManager));
new Button('✅', Position.RIGHT, NameManager.checkName.bind(NameManager));
new Button('🆕', Position.RIGHT, NameManager.newName.bind(NameManager));
new Button('📋', Position.RIGHT, NameManager.copyName.bind(NameManager));

const url = location.href;

if (url.includes('/book/')) {
    const titleElement = document.querySelector('.booknav2 > h1:nth-child(1) > a:nth-child(1)');
    const synopsisElement = document.querySelector('.navtxt > p:nth-child(1)');

    const novel = new Novel(titleElement, synopsisElement);
    novel.translate();
} else if (url.includes('/txt/')) {
    document.querySelector('.txtinfo')?.remove();
    document.querySelector('.tools')?.remove();

    const chapterElement = document.querySelector('.txtnav');

    const chapter = new Chapter(chapterElement);
    chapter.translate();
}