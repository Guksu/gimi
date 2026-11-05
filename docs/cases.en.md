# gimi review cases

Three cases that show how gimi-review uses context outside the diff. Each one goes: short diff → context it gathered → review result → how to fix.

Before you read:

- **All three are defects planted on purpose** in the example app (`evals/shop-fixture`, a noodle-shop ordering app). They are not from a real outside project.
- **The review results come from real run records** of the review evaluation (`scripts/review-eval.mjs run`). Dates, model and cost are from those records. gimi was a pre-0.1.0 development build then, and its version and commit were not recorded. Running today's gimi may give different wording or a different number of findings.
- **gimi's output was in Korean.** The quotes below are my translations, marked "translated". `/code-review`'s quotes are its original English.
- **Claude Code's built-in `/code-review` ran on the same pull requests**, with the same model and instructions. It also found cases 1 and 3.
- Line numbers in quoted output refer to the example app at that time. The app changed on 2026-10-31, so today's lines may differ.

## 1. An API response change breaks another screen — `COM-024`

**Short diff**. Pull request title: "refactor: drop screen-only values from the order response".

```diff
 // server/src/orders/orders.service.ts
-      canCancel: CANCELABLE.has(order.status),
-      canReturn: order.status === 'delivered' && deadline !== null && now < deadline && items.some((item) => item.returnable),
+      // the screen decides whether to show the buttons from the order status
```

**Context gathered**. The diff touches only a server file. gimi's context script searched the repository for the fields the response dropped (`canCancel`, `canReturn`) and found:

- `web/src/pages/OrderPage.tsx`: `{order.canCancel && (` (the cancel button) and `{order.canReturn && …` (the return button). This pull request does not change either.
- `contracts/openapi.yaml`: both fields are still in the order response's `required` list.
- `web/src/api/schema.d.ts`: the types generated from the contract are unchanged.

**Review result**. Real run on 2026-10-26, `claude-opus-5-5`, two runs per reviewer.

| Reviewer | Found (by location) | Cost and time (run 1) |
|---|---|---|
| gimi | 2 of 2 | $0.28 · 46 s |
| `/code-review` | 2 of 2 | $0.19 · 38 s |

gimi, run 1 (excerpt, translated):

```text
[must fix] impact
The server no longer sends canCancel/canReturn, but the screen still uses them to show buttons
- Changed: server/src/orders/orders.service.ts:143
- Evidence: web/src/pages/OrderPage.tsx:72, :77 (not changed in this PR)
- What happens: opening a paid or preparing order, or one delivered within 7 days, shows neither "Cancel order" nor "Request return".
- Tests: the MSW mock in web/src/test/server.ts:46-47 still returns canCancel/canReturn, so the web tests will likely not catch this (estimate).
```

`/code-review`, run 1 (original): "OrderPage still shows the cancel and return buttons only when order.canCancel / order.canReturn are true … so neither button ever appears."

**How to fix**. Keep computing cancel and return eligibility on the server and keep it in the response (commerce preset `COM-024`). If the screen really should decide, change the contract, the generated types and the screen in the same pull request.

## 2. A requirement written only in the issue is missed — `INTENT-001`

**Short diff**. Pull request title: "feat: tidy sold-out items on the menu". Body: `closes #41`.

```diff
 // web/src/pages/MenuPage.tsx
-      {products.map((product) => (
+      {products
+        .filter((product) => !product.soldOut)
+        .map((product) => (
```

**Context gathered**. The pull request body only has the issue number. gimi's context script read issue #41 with `gh`:

> Issue #41: Do not hide sold-out items; move them to the bottom of the menu. Keep the sold-out label and the disabled add button as they are. (translated)

In the evaluation, a fake `gh` (`scripts/fake-gh.mjs`) gives both reviewers the same issue instead of real GitHub.

**Review result**. Real run on 2026-10-27, `claude-opus-5-5`, two runs per reviewer.

| Reviewer | Said the change contradicts the requirement (I counted by reading the output) |
|---|---|
| gimi | 2 of 2, both quoting issue #41 |
| `/code-review` | 1 of 2. Run 1 inferred from the old test that hiding loses the sold-out state. Run 2 pointed only at the empty list, dead code and the cart. |

gimi, run 1 (excerpt, translated; $0.26 · 52 s):

```text
Must fix
1. This does the opposite of the requirement (web/src/pages/MenuPage.tsx:27). Issue #41 asks to "not hide sold-out items
   but move them to the bottom" and to "keep the sold-out label and disabled add button". This PR hides them with
   .filter(!soldOut). Because the commit message says closes #41, merging also closes the issue.
2. It deleted the test for the behavior the issue said to keep (web/src/pages/menu.test.tsx:6).
```

This case also shows the limit of scoring by location. The score table at the time counted by location (within three lines of the answer), and both reviewers got 2 of 2. But `/code-review` run 2 matched only by location, with a different problem near the answer line (dead code after the filter) ([result file, Korean](../evals/review/results/2026-10-27-intent.md)). That is why I counted the requirement separately by reading. The evaluation now has a form for human judgments (`judgments.json`, [evaluation notes, Korean](../evals/review/README.md)).

**How to fix**. Replace the `filter` with a stable sort that moves sold-out items last. Bring back the deleted test (the sold-out button is disabled), and also check that sold-out items are the last cards.

## 3. A change undoes an earlier bug fix — `HIST-001`

**Short diff**. Pull request title: "refactor: make the return deadline calculation easier to read". Body: "the result is the same".

```diff
 // server/src/orders/returns-policy.ts
-  const kst = new Date(deliveredAt.getTime() + KST_OFFSET_MS)
-  const startOfDeliveryDay = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS
+  // midnight (Korean time) of the delivery day, in one line
+  const startOfDeliveryDay = Date.UTC(deliveredAt.getUTCFullYear(), deliveredAt.getUTCMonth(), deliveredAt.getUTCDate()) - KST_OFFSET_MS
```

**Context gathered**. gimi's context script found the commit that added the deleted lines:

- Commit "fix: return deadline was one day short for orders delivered early in the morning — count the delivery day in Korean time" (translated). The deleted `kst` line is that fix.
- The regression test that commit added, "early-morning deliveries also count the delivery day in Korean time" (translated). This pull request does not change it.

**Review result**. Real run on 2026-10-26, `claude-opus-5-5`, two runs per reviewer.

| Reviewer | Found (by location) | Cost and time (run 1) |
|---|---|---|
| gimi | 2 of 2 | $0.20 · 29 s |
| `/code-review` | 2 of 2 | $0.14 · 29 s |

gimi, run 1 (excerpt, translated):

```text
[must fix] history
A "same result" refactor undoes the previous bug fix (71291ef) exactly

Changed       server/src/orders/returns-policy.ts:14
Evidence      git show 71291ef: the commit that fixed "return deadline one day short for early-morning deliveries".
              The line that commit removed is identical to line 14 of this PR.
What happens  An order delivered 2026-10-20 02:30 KST (2026-10-19T17:30Z) gets a deadline of
              2026-10-26T15:00Z instead of 2026-10-27T15:00Z, one day short.
Tests         The regression test above will likely fail (estimate). I did not run the suite (it needs a database).
```

`/code-review`, run 1 (original), pointed at the same commit: "… the delivery day is counted on the UTC calendar again — the bug 71291ef fixed."

**How to fix**. Even without the intermediate variable, keep the step that adds the Korean time offset before taking the date (`new Date(deliveredAt.getTime() + KST_OFFSET_MS)`). The regression test guards this case.

## Run it yourself

You need:

- Node.js 22 or later, and git
- A signed-in Claude Code CLI (`claude`). It calls a real model, so it costs money. Based on the records above and the 2026-10-31 evaluation (gimi averaged $0.41 and 57 seconds), one review costs about $0.1–0.5 and takes 30 seconds to a minute.
- The gimi repository's dev dependencies and the example app's dependencies

```bash
git clone https://github.com/Guksu/gimi && cd gimi
npm ci && (cd evals/shop-fixture && npm ci)
node scripts/review-eval.mjs run COM-024 INTENT-001 HIST-001 --reviewer gimi --model claude-opus-5-5 --out /tmp/gimi-cases
node scripts/review-eval.mjs score /tmp/gimi-cases
```

For each defect, `run` makes a temporary repository with the normal version on `main` and the defect pull request on `feature/pr`, and serves the issue through the fake `gh`. `score` writes the score table to `/tmp/gimi-cases/score.md` and a judgment form to `judgments.json`.

What to expect:

- `COM-024`: a "must fix" whose evidence is the buttons in `web/src/pages/OrderPage.tsx` or the contract file
- `INTENT-001`: a "must fix" that quotes issue #41
- `HIST-001`: a "must fix" that cites the early-morning fix commit

Model output varies between runs, and today's gimi is not the build in these records, so don't expect the same sentences.

To look by hand, make only the defect repository and call gimi inside it:

```bash
node scripts/defects.mjs materialize COM-024 /tmp/pr --branch feature/pr --link-deps
cd /tmp/pr   # open Claude Code here and ask "review the current branch with gimi-review"
```

This way there is no fake `gh`, so `INTENT-001` cannot read issue #41. Paste the issue text instead (`issues` in `evals/shop-fixture/defects/INTENT-001/defect.json`).
