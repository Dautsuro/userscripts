// ==UserScript==
// @name         TranslAI
// @namespace    https://github.com/Dautsuro/userscripts
// @version      1.18.0
// @description  TranslAI auto-translates Chinese novel chapters to English with consistent names using a built-in NameManager.
// @match        https://www.69shuba.com/book/*.htm
// @match        https://www.69shuba.com/txt/*/*
// @match        https://www.69shuba.com/book/*/
// @icon         https://www.google.com/s2/favicons?sz=64&domain=69shuba.com
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
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

        const instruction = 'You are a professional literary translator specializing in Chinese-to-English translations of web novels. Your task is to translate the Chinese novel chapter into English. If an English name is already present in the Chinese chapter, do not change it. Put proper spacing between each paragraphs. Only output the translated chapter, do not remove the chapter title. Do not include any explanations, commentary, or additional text. If you cannot translate, respond with [UNTRANSLATABLE] and nothing else.';

        let content = this.content;
        const names = NameManager.getNames();
        names.sort((a, b) => b.original.length - a.original.length);

        for (const name of names) {
            content = content.replace(new RegExp(RegExp.escape(name.original), 'g'), name.translated);
        }

        content = formatNumbers(content);

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
            fetchLinks();
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

    static getPreviousUrl() {
        const element = document.querySelector('.page1 > a:nth-child(1)');
        return element.href;
    }

    static getNextUrl() {
        const element = document.querySelector('.page1 > a:nth-child(4)');
        return element.href;
    }
}

class NameManager {
    static async init() {
        this.localNames = await GM.getValue(`names:${Novel.id}`, []);
        this.globalNames = await GM.getValue('names', []);
        this.copyMessage = await GM.getValue('copyMessage', '');
    }

    static addNames(names) {
        for (const name of names) {
            if (!name.original || !name.translated) continue;
            if (this.getName(name.original)) continue;
            if (!Chapter.instance.content.includes(name.original)) continue;

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
        GM.setValue('copyMessage', this.copyMessage);
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
            if (confirm(`Erase previous name? (${existingName.translated})`)) {
                Chapter.editName(existingName.translated, name.translated);
                this.removeName(existingName);
            } else {
                return;
            }
        }

        this.globalNames.push(name);
        this.save();
        Chapter.refreshDOM();
    }

    static async copyName() {
        const name = this.getSelectedName();
        if (!name) return;
        let formattedText = `${name.original}\n\n`;
        let isFormatted = false;
        let refuseFormat = false;

        if (this.isChild(name)) {
            if (true) {
                const parentNames = this.getParentNames(name);
                let tempFormattedText = '';

                for (const parentName of parentNames) {
                    tempFormattedText += `${parentName.original}: ${parentName.translated}\n`;
                }

                if (tempFormattedText !== '') {
                    formattedText += `Parent names:\n${tempFormattedText}\n`;
                }

                isFormatted = true;
            } else {
                refuseFormat = true;
            }
        }

        if (!refuseFormat) {
            if (this.isParent(name)) {
                if (isFormatted || true) {
                    const childNames = this.getChildNames(name);
                    let tempFormattedText = '';

                    for (const childName of childNames) {
                        if (formattedText.includes(`\n${childName.original}:`)) continue;
                        tempFormattedText += `${childName.original}: ${childName.translated}\n`;
                    }

                    if (tempFormattedText !== '') {
                        formattedText += `Child names:\n${tempFormattedText}\n`;
                    }

                    isFormatted = true;
                } else {
                    refuseFormat = true;
                }
            }
        }

        if (!refuseFormat) {
            const similarNames = this.getSimilarNames(name);

            if (similarNames.length > 0) {
                if (isFormatted || true) {
                    let tempFormattedText = '';

                    for (const similarName of similarNames) {
                        if (formattedText.includes(`\n${similarName.original}:`)) continue;
                        tempFormattedText += `${similarName.original}: ${similarName.translated}\n`;
                    }

                    if (tempFormattedText !== '') {
                        formattedText += `Similar names:\n${tempFormattedText}\n`;
                    }

                    isFormatted = true;
                } else {
                    refuseFormat = true;
                }
            }
        }

        if (this.copyMessage) {
            const context = await this.getContext()
            formattedText = this.copyMessage
                .replace('{DATA}', formattedText)
                .replace('{CONTEXT}', context);
        }

        GM.setClipboard(confirm('Formatted copy?') ? formattedText.trim() : name.original, 'text/plain');
    }

    static async getContext(name, maxContext = 80, globalIndex = 1, parentName = null) {
        if (!name) name = this.getSelectedName();
        if (!name) return;

        const contents = await GM.getValue(`contents:${Novel.id}`, []);
        const text = contents.join('\n');
        let paragraphs = text.split('\n').filter(p => p.length > 0 && p.includes(name.original));
        if (parentName) paragraphs = paragraphs.filter(p => !p.includes(parentName));
        paragraphs.sort((a, b) => b.length - a.length);
        let context = '';
        
        for (let i = 0; i < maxContext; i++) {
            if (!paragraphs[i]) break;
            const p = paragraphs[i];
            context += `Context ${globalIndex}: ${p}\n`;
            globalIndex++
        }

        if (paragraphs.length < maxContext) {
            const childNames = this.getChildNamesUnsafe(name);
            if (childNames.length > 0) {
                childNames.sort((a, b) => b.original.length - a.original.length);
                const childName = childNames[0];
                const childNameContext = await this.getContext(childName, maxContext - paragraphs.length, globalIndex, name.original);
                context += childNameContext;
            }
        }

        return context.trim();
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

    static getChildNamesUnsafe(name) {
        const names = this.getNames();
        const childNames = [];

        for (const n of names) {
            if (name.original.includes(n.original) && name.original !== n.original) {
                childNames.push(n);
            }
        }

        return childNames;
    }

    static getSimilarNames(name) {
        const isSimilar = (similarLetterCount, totalLetterCount) => {
            if ((similarLetterCount / totalLetterCount) * 100 >= 50) return true;
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

    static setCopyMessage() {
        const copyMessage = prompt('Enter your copy message')?.trim();
        if (!copyMessage) return;

        this.copyMessage = copyMessage;
        this.save();
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

async function fetchLinks() {
    const links = await GM.getValue(`links:${Novel.id}`, []);
    if (links.length === 0) return;
    const link = links[0];

    const pageContents = await GM.getValue(`contents:${Novel.id}`, []);

    const decoder = new TextDecoder('gbk');
    const parser = new DOMParser();

    const page = await fetch(link);
    const pageBuffer = await page.arrayBuffer();
    const pageContent = decoder.decode(pageBuffer);

    const pageDoc = parser.parseFromString(pageContent, 'text/html');
    const pageElement = pageDoc.querySelector('.txtnav');
    const pageText = pageElement.innerText;

    links.shift();
    await GM.setValue(`links:${Novel.id}`, links);
    pageContents.push(pageText);
    await GM.setValue(`contents:${Novel.id}`, pageContents);
    setTimeout(fetchLinks, 5000);
}

function formatNumbers(content) {
    function formatLargeNumber(num) {
        const units = [
            { value: 1e33, label: "decillion" },
            { value: 1e30, label: "nonillion" },
            { value: 1e27, label: "octillion" },
            { value: 1e24, label: "septillion" },
            { value: 1e21, label: "sextillion" },
            { value: 1e18, label: "quintillion" },
            { value: 1e15, label: "quadrillion" },
            { value: 1e12, label: "trillion" },
            { value: 1e9, label: "billion" },
            { value: 1e6, label: "million" },
            { value: 1e3, label: "thousand" },
        ];

        for (const unit of units) {
            if (num >= unit.value) {
                return `${(num / unit.value).toFixed(2).replace(/\.00$/, '')} ${unit.label}`;
            }
        }

        return num.toString();
    }

    const charsData = [
        { char: '十', value: 10 },
        { char: '百', value: 100 },
        { char: '千', value: 1_000 },
        { char: '万', value: 10_000 },
        { char: '亿', value: 100_000_000 },
        { char: '兆', value: 1_000_000_000_000 },
    ];

    for (const charData of charsData) {
        let numbers = content.match(new RegExp(`\\d+${charData.char}`, 'g'));
        numbers = [...new Set(numbers)];

        for (const number of numbers) {
            const num = parseFloat(number.replace(charData.char)) * charData.value;
            content = content.replace(new RegExp(number, 'g'), formatLargeNumber(num));
        }
    }

    return content;
}

await Gemini.init();
await NameManager.init();

new Button('✏️', Position.LEFT, NameManager.editName.bind(NameManager));
new Button('➖', Position.LEFT, NameManager.removeName.bind(NameManager));
new Button('⚙️', Position.LEFT, NameManager.setCopyMessage.bind(NameManager));
new Button('🗑️', Position.LEFT, async () => {
    if (confirm('Are you sure?')) {
        await GM.deleteValue(`contents:${Novel.id}`);
        await GM.deleteValue(`links:${Novel.id}`);
    }
});

new Button('➕', Position.RIGHT, NameManager.addGlobal.bind(NameManager));
new Button('✅', Position.RIGHT, NameManager.checkName.bind(NameManager));
new Button('🆕', Position.RIGHT, NameManager.newName.bind(NameManager));
new Button('📋', Position.RIGHT, NameManager.copyName.bind(NameManager));

const url = location.href;

if (url.includes('/book/') && url.endsWith('.htm')) {
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
} else if (url.includes('/book/') && url.endsWith('/')) {
    let links = await GM.getValue(`links:${Novel.id}`, null);

    if (links === null) {
        links = Array.from(document.querySelectorAll('#catalog li a')).map(link => link.href);
        links.reverse();
        GM.setValue(`links:${Novel.id}`, links);
    }
}