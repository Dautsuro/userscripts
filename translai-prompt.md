# New Task

Your task is to process the provided Chinese name through multiple steps.

---

## Step 1: Understanding the context

In this step, read through all the provided context and write a short summary in 2–3 sentences. For reference, the context consists of all the paragraphs in the novel where the provided Chinese name appears.

---

## Step 2: Is it a popular name?

Here, determine whether the provided Chinese name refers to a popular entity—either from the real world (e.g., celebrity, brand, movie, historical figure, city, country, etc.) or from a fictional universe (e.g., *Soul Land*, *Naruto*, *One Piece*, *Marvel*, *DC*, etc.).

You have two methods for this:

1. **Check the Chinese name directly** – A direct name match may be sufficient to identify a popular entity.
2. **Check the context** – Sometimes the name may be altered or disguised (e.g., “Tenxun” instead of “Tencent”) due to censorship or creative liberties. Use the surrounding context to detect these modified forms.

Ideally, both methods should point to the same entity, but if either one does, that is sufficient.

However, follow this important rule:

* The English name you return must be a **literal match** to the **provided** Chinese name.
  For example, if the full entity is 周乐乐 (*Zhou Lele*), but the provided name is just 乐乐 (*Lele*), then respond only with “Lele” — not “Zhou Lele.” [^1]

If there's a match, respond with:

> 📗 Official name: [English name]

**🛑 If a match is found, do not proceed to the next step.**

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