# WTR-LAB Rating Filter 2.0 — fold away clearly bad novels

## Intent
Skip novels that are certainly bad (broken, no continuity, readers agree it's bad) without trying them.
Not a "find the best" filter: mediocre novels (2.5–3★) stay, because their worth depends on the content.
Example to skip: Soul Land: God-Level Martial Spirit (1.15★, 13 reviews). Example to keep: Soul Land: Beauty Ranking (2.51★, 53 reviews), which the user liked.
Used on Firefox Android, novel list and novel finder.

## Problems with 1.1.0
- It kept only novels *proven good* (rating − 2.433/√n ≥ 3.744, min 20 reviews) and grayed the rest: new, mediocre and bad looked the same, and the gray was faint.
- "Show all" only removed the gray; leftover from 1.0 when cards were hidden.

## Rule
Hide when the reviews prove the real rating is under 2★:
`reviews >= 5 && rating + 2 / √reviews < 2.0`
- 1.15/13 hidden, 1.6/40 hidden, 2.0/8 kept, 1.3/6 kept, anything ≥ 2.0 kept.
- Sample of 3,660 novels with ≥ 5 reviews (2026-11-04): hides 4.4% (6% at 5–9 reviews, 4% at 10–19, 1% at 20–49, 0% at 50+). Under 5 reviews: never hidden.

## Display
- A hidden card is folded into one thin line: `▸ <title> — 1.2★ (13)`. Tapping it unfolds the card in place (line stays, shows ▾, tap again to fold).
- Nothing grayed any more. No top bar, no "Show all"/filter toggle, no localStorage switch.

## Approaches considered
- Keep "proven good" and make gray stronger — rejected: marks the novels the user wants to keep (2.51/53 was grayed).
- Hide bad novels completely with a count in a bar — rejected by the user: an empty result leaves them guessing whether it worked.
- **Fold bad novels into a line (chosen)** — visible proof it worked, little space used.

## Left to the builder
- Keep reading exact values from React props with the card-text fallback.
- Title for the line: the card's displayed title text (raw data has `%{...|...}` markup).
- Self-check asserts for the examples above. Bump to 2.0.0, update README.
- Folded line must be touch-friendly and follow the site's theme colors (`currentColor`).
