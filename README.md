# gimi

A code review skill for Claude Code and Codex. Before reviewing, it gathers the context outside the diff (the lines a change touches). A review goes in this order:

1. Find whether code this change did not touch uses a changed function, type or string.
2. Check the requirements in the pull request and issue text, and the claims in the pull request description, against the diff.
3. Find the commits that added the changed lines, and see whether the change undoes an earlier fix. With a pull request, also read its CI results.
4. Leave only findings that name what goes wrong for which input (the failure condition) and point to the evidence.

[한국어](README.ko.md) · [Good fit](#good-fit) · [Install](#installation) · [Reading the results](#reading-the-results) · [Cases](docs/cases.en.md) · [Full guide](docs/guide.en.md) · [Evaluation (Korean)](evals/review/README.md)

A finding looks like this (an illustration, not real output — real run results are in [Cases](docs/cases.en.md)). gimi writes findings in Korean:

```text
[고쳐야 함] 영향 범위
주문 상태 형태가 바뀌었는데 배지는 예전 형태를 읽는다

바뀐 곳  src/api/order.ts:42
         status: string → { code, label }
근거    src/components/OrderBadge.tsx:12
         status === 'PAID'  (이 PR에서 안 바뀜)
상황    결제 완료 주문 → 배지가 항상 '알 수 없음'
생긴 때  이번 변경
```

The same finding, translated (gimi does not write English; this is a translation for reading):

```text
[must fix] impact
The order status changed shape, but the badge still reads the old shape

Changed       src/api/order.ts:42
              status: string → { code, label }
Evidence      src/components/OrderBadge.tsx:12
              status === 'PAID'  (not changed in this PR)
What happens  a paid order → the badge always shows "unknown"
Introduced    by this change
```

Labels: 고쳐야 함 = must fix, 고치면 좋음 = nice to fix, 확인 질문 = question. 바뀐 곳 = changed, 근거 = evidence, 상황 = what happens, 생긴 때 = introduced (이번 변경 = by this change, 변경 전부터 = before this change).

I reviewed 32 pull requests with defects planted in an example app, with gimi and with Claude Code's built-in `/code-review`. Both reviewers used the same model and instructions. Both found almost every defect (counted by where a finding points). Findings on something other than the planted defects were 55 for `/code-review` and 19 for gimi; that does not mean they were wrong, and nobody has judged their content yet. Each pull request was reviewed once, and gimi ran without a settings file (domain presets off). One review averaged 57 seconds and $0.41 with gimi, and 45 seconds and $0.31 with `/code-review`.

A separate evaluation used four defects whose requirements were written only in an issue, reviewed twice per reviewer. Reviews that said the change contradicts the requirement: gimi 8 of 8, `/code-review` 5 of 8. I counted these by reading the findings, not by where they point. [Method and all results (Korean)](evals/review/README.md) · [Caveats](docs/guide.en.md#evaluation) · [Three cases](docs/cases.en.md)

## Good fit

- **TypeScript and JavaScript projects** — gimi looks for where changed functions and types are used in files of these two languages. Usages inside Vue and Svelte files show up only when the project has no `typescript` and gimi falls back to text search.
- **Pull requests that need context outside the diff** — the context gimi gathers is meant for pull requests like these:
  - Code this pull request did not touch uses a changed function or type.
  - An API contract (OpenAPI or GraphQL schema) changed. If the frontend and backend live in separate repositories, list the other repository's path in the settings (`linkedRepos`), and gimi also looks for contract usages there.
  - The requirements are written in an issue.
  - The description makes a claim such as "refactor only" or "backward compatible".
  - It changes lines that an earlier bug fix put in.
  - The GitHub pull request's CI failed. A branch review without a pull request skips CI.
- **Commerce and payment code** — with the domain presets on (29 commerce rules, 14 Korean e-commerce law rules), gimi also reviews against those rules.

It is a weaker fit in these cases:

- **Languages other than TypeScript and JavaScript** — when a file in another language changes, gimi does not look for where changed functions and types are used. It looks only for where the changed strings (query keys, paths and the like) are used.
- **You want tests written or run** — gimi only reviews. It does review the test code in a pull request.
- **Teams that don't read Korean** — the skill, the rules and the finding format are in Korean.

## Status

The evaluation above was run before 0.1.0 (2026-10-27 and 10-31) on one example app. What was added or changed after that has not been measured yet, for example:

- using the pull request's CI results as evidence for findings
- checking claims in the pull request description and commit messages against the gathered context
- counting a finding repeated across reviews and proposing it as a rule candidate
- deciding from the repository whether to apply the frontend or backend guardrails when there are no settings
- looking for contract usages in other repositories (`linkedRepos`)
- shortening and rewriting the review procedure (SKILL.md)

Neither has the effect of turning on the domain presets. There are no results yet from real repositories outside the example app.

On 2026-11-10 the current version was run once on the same 32 defects. The location-based score was unchanged (31 of 32), and six pull requests without defects got no findings. All the changes above were in place together, so this does not separate the effect of any one of them. One case, where the requirement could not be read without `gh`, did not behave as expected (it should have asked a question). That was fixed, and two runs afterwards both asked the question. On 2026-11-11 three cases were added for a one-sided fix, a large change and a re-review, and each reviewer ran them twice. Both gimi and `/code-review` found every defect, so these cases did not separate the two. In the re-review case gimi recorded which earlier findings were fixed and which remained. [Results](evals/review/results/2026-11-10-depth.md) · [after the fix](evals/review/results/2026-11-10-followups.md) · [new cases](evals/review/results/2026-11-11-slim.md) (Korean)

## Installation

**Claude Code** — run in the chat:

```text
/plugin marketplace add Guksu/gimi
/plugin install gimi@gimi
```

**Codex** — run in a terminal:

```bash
codex plugin marketplace add Guksu/gimi
codex plugin add gimi@gimi
```

You need Node.js 22 or later and a git repository to review. To read pull request and issue text, sign in to the GitHub CLI (`gh`).

[Requirements](docs/guide.en.md#installation) · [Updating](docs/guide.en.md#updating)

## Try it

After installing, ask your agent in the repository you want reviewed:

> Use gimi-review to review the current branch. Check that screens using the changed API still work and that it does what the issue asked for.

Before reviewing, the agent collects where the changed code is used, the pull request and issue text, the pull request's CI results, and the history of the changed lines. It then leaves only findings it can back with a location, and writes the full review to `docs/gimi/reviews/`. In Claude Code you can also call it directly as `/gimi:gimi-review`. The skill and its rules are written in Korean; [English usage notes](docs/guide.en.md#how-it-works) are in the full guide.

To review before committing, ask for it ("review what I just changed before I commit"). Uncommitted changes and new files are then included.

To also review against the commerce and Korean e-commerce law rules, ask "도메인 규칙 설정해줘" (set up domain rules). [Settings](docs/guide.en.md#settings)

## Reading the results

- **Chat**: the first line is the verdict (the number of findings per level and any skipped context). Below it, each "must fix" and each question gets one line. "Nice to fix" findings are only counted.
- **Files**: two files appear in the reviewed repository. gimi does not comment on the pull request or post anything to GitHub.
  - `docs/gimi/reviews/{date}-pr-{number}.md` (`{date}-{branch}.md` without a pull request): the review record. Each finding has its level, evidence, what happens, when it was introduced, the rule and a verdict.
  - A `.context.json` with the same name: all the gathered context. It is large and can be regenerated, so don't commit it. Add `docs/gimi/reviews/*.context.json` to `.gitignore`.
- **Skipped context**: the context summary and the review record list what could not be gathered, and why, under "건너뜀" (skipped). The review did not see that part. Even with no findings, read skipped parts as unchecked. "사용처 없음" (searched, no usages) is different from "건너뜀" (could not search).

| Without | What changes |
|---|---|
| `gh` signed in | Pull request and issue text and CI results are not read and are listed as skipped. Intent comes only from commit messages |
| `typescript` in the reviewed project | Usages of changed names are found by text search, marked "정확도 낮음" (low accuracy). Unrelated code with the same name may show up. The same happens when git tracks any file under `node_modules`: `typescript` is not loaded, for security |
| Full history (shallow clone) | Change history is skipped. Run `git fetch --unshallow` and review again |
| Jira, Notion or Linear connection | If the agent cannot read the ticket, it asks you to paste it |

## Feedback

If something feels wrong, [open an issue](https://github.com/Guksu/gimi/issues) with your request and what happened.

[Releases](https://github.com/Guksu/gimi/releases) · [Changelog (Korean)](CHANGELOG.md) · [Evaluation (Korean)](evals/review/README.md) · [Design (Korean)](docs/design/2026-10-19-gimi.md)

[![CI](https://github.com/Guksu/gimi/actions/workflows/ci.yml/badge.svg)](https://github.com/Guksu/gimi/actions/workflows/ci.yml)
![Preset rules](https://img.shields.io/badge/gimi-43%20preset%20rules-1b1e24)
![Tests](https://img.shields.io/badge/tests-437%20passing-555555)
[![License: MIT](https://img.shields.io/badge/license-MIT-555555)](LICENSE)

## License

[MIT](LICENSE) © 2026 Guksu
