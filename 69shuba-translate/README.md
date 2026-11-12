# 69shuba Translate

File: `69shuba-translate.user.js` · runs on `https://69shuba.tw/book/<ID>/` (book pages only, not chapters)

Adds a **Translate** button next to the novel's title. Clicking it asks DeepSeek (`deepseek-flash`, thinking off) to translate the title and synopsis into English, shown under the Chinese originals. The result is saved per book, so it shows again at once on reload; **retranslate** asks DeepSeek again.

Set the key with the Violentmonkey menu command **Set DeepSeek API key** (or paste it when the button asks the first time). The key stays in Violentmonkey's storage on that device.
