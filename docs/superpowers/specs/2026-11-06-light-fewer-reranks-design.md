# Light term ranker: fewer AI re-ranks

## Why
Every term tapped in a new novel costs a full AI call until 5 novels agree on it. Too costly.
Context-dependent sources (修炼 → "cultivate" / "cultivation") must not get locked to one rendering by accident.

## Approaches
1. Global after 2 agreeing novels: rejected, two novels in a row lock out the other valid rendering.
2. **Reuse confident AI picks provisionally (chosen)**: only clear AI wins (≥80%) skip the AI.
3. Reuse every previous pick provisionally: rejected by the user.

## Design
- **Confident picks.** Picking a term the AI scored ≥80% stores it as confident for the source (`confidentTerms`, synced as `["confident", hash]`).
  In a novel with no own pick, a confident term is applied as *provisional* (own amber color, no AI call)
  while every novel's pick for that source equals it and the source has no global/dynamic status.
  Picking anything else anywhere ends provisional reuse for that source. The popover's Save confirms it for the novel.
- **99+ lock.** Picking a term whose WTR-LAB chip shows "99+" votes makes it global at once, but only when it is the only 99+ chip (two 99+ chips = split crowd, likely context-dependent).
- **Context trap.** The AI returns `"trap": true` when no single rendering of the source can be right across contexts.
  The result panel says so, and the picked term becomes global at once: if it is doomed to be wrong somewhere, stop paying to re-rank it.
- Locks never replace an existing global status; they do replace "dynamic".

## Unchanged
Prompt rules other than the trap flag, the 5/10-novel global rule, per-novel overrides and "Not in this novel".
