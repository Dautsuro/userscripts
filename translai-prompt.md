# New Task

Your task is to process the provided Chinese name through multiple steps.

---

## Step 1: Understanding the context

In this step, read through all the provided context and write a short summary in 2–3 sentences. For reference, the context consists of all the paragraphs in the novel where the provided Chinese name appears.

---

## Step 2: Is it a popular name?

Determine whether the **provided Chinese name** refers to a popular or known entity—either from the real world (e.g., celebrity, brand, movie, historical figure, city, country, etc.) or from a fictional universe (e.g., *Soul Land*, *Naruto*, *One Piece*, *Marvel*, *DC*, etc.).

You have two methods for identifying this:

1. **Direct name check** – Search for the exact Chinese name in known databases or sources.
2. **Context check** – Examine the surrounding context to see if the name is used in a way that aligns with a known entity, even if slightly modified (e.g., “Tenxun” for “Tencent”).

However, follow these critical rules:

---

### ⚠️ Important rules:

* **Exact match required**: Only return a known entity if the **Chinese name provided** is an *exact* match (character for character) with a known entity.
* **No guessing based on context alone**: Do **not** infer or assume the name refers to a popular entity just because the setting, genre, or narrative is similar.
* **No full-name expansion**: If the provided name is partial (e.g. 乐乐 instead of 周乐乐), only return the part that was provided — even if the full name can be deduced from the context.

---

### 🛑 Override clause:

> If the Chinese name does **not** *exactly match* a known entity name, **do not treat it as a match**, even if the surrounding context resembles a popular setting or story.

---

If you find a match (based on **exact Chinese name**), respond with:

> 📗 Official name: [English name]

**🛑 If a match is found, do not proceed to the next step.**

If there is **no match**, move on to Step 3.

---

## Step 3: Translate the name

In this step, translate the provided Chinese name into English while following these rules:

1. First, determine from the context whether the name follows **Chinese or Japanese conventions**. This is crucial because it affects **how the name should be transliterated or translated**:

   * Chinese names should be transliterated using **pinyin**.
   * Japanese names should be transliterated using **romaji** or based on **katakana reading**.
     For example, the name 小南 might be transliterated as **Xiaonan** in Chinese or **Konan** in Japanese (as in *Naruto*).

2. If the name is a **character name**, use **transliteration**.
   If it's **not** a character name (e.g., a location, object, or title), use **translation**. [^2]

3. Maintain consistency with any **child or parent names** already provided. For **similar** names, consistency is optional, but they can serve as references.

Once you have translated the name, respond with:

> 📘 Translated name: [English name]

---

### Provided data


```
{CONTEXT}
```

```
Chinese name: {DATA}
```

---

### Notes

[^1]: This rule also applies when the match is found through **context** rather than the literal name. If the provided Chinese name is only a **partial match** to a known popular entity (e.g., only 乐乐 / Lele is provided, but context reveals it refers to 周乐乐 / Zhou Lele), you should still only respond with **Lele**, as that is the name explicitly given. Do not expand it to Zhou Lele, even if the context makes the full name clear.

[^2]: Pay special attention to **mixed cases**! Sometimes a name combines a **title** and a **character name** — for example, *Brother Fang* consists of the title “Brother” and the name “Fang.” In such cases, **translate** the title and **transliterate** the name.