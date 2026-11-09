# WTR AI Terms

Runs on `https://wtr-lab.com/*`.

## WTR AI Terms

File: `wtr-ai-terms.user.js`

Helps pick good translations for names and terms in WTR-LAB machine-translated novels.

- Adds an **AI Rank** button to the term tooltip. The AI scores the translation candidates and can propose new ones. Picked terms are applied by the script itself in the page, not through WTR-LAB's term system. Tapping a picked term opens its own card instead (a bottom sheet on phone) to edit it, pick another rendering, delete it, re-rank it or open WTR-LAB's tooltip.
- Each picked term can be global (all novels) or for the current novel only.
- No wiki lookup.
- Optional sync of picked terms between devices through the personal PocketBase server (see [CLAUDE.md](../CLAUDE.md)). Without a sync URL and token it works offline on one device.
- Settings: Violentmonkey menu, **WTR AI Terms settings**. With sync on, the menu also has **resync with server**.

## WTR AI Terms (outdated)

File: `wtr-ai-terms-outdated.user.js`

Older, bigger version of WTR AI Terms. No longer used; kept as a reference for its features (e.g. wiki lookup).

- Adds an **AI Rank** button to the term tooltip. The AI scores the existing translation candidates and can propose new ones, using the chapter as context.
- **Wiki** button: looks the term up on the novel's fandom wiki and shows the official names, ranked by how often the wiki uses them. Wiki results are also sent to the AI as evidence.
- **Auto** button: picks the best rendering and saves it in WTR-LAB's term editor (wiki names globally, AI or earlier picks for the current novel only).
- Colors terms the AI has not checked yet, and reuses earlier checks so the same term gets the same translation.
- Works with Anthropic, OpenAI, OpenRouter, Google Gemini, Groq, xAI and DeepSeek API keys.
- Settings: Violentmonkey menu, **WTR AI Terms (outdated) settings**.
