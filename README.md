# gimi

A code review skill for Claude Code and Codex. Before reviewing, it gathers the context outside the diff (the lines a change touches). A review goes in this order:

1. Find whether code this change did not touch uses a changed function, type or string.
2. Check the requirements in the pull request and issue text, and the claims in the pull request description, against the diff.
3. Find the commits that added the changed lines, and see whether the change undoes an earlier fix. With a pull request, also read its CI results.
4. Leave only findings that name what goes wrong for which input (the failure condition) and point to the evidence.

[한국어](README.ko.md) · [Good fit](#good-fit) · [Install](#installation) · [Full guide](docs/guide.en.md) · [Evaluation (Korean)](evals/review/README.md)

A finding looks like this (example):

```text
[고쳐야 함] 영향 범위
주문 상태 형태가 바뀌었는데 배지는 예전 형태를 읽는다

바뀐 곳  src/api/order.ts:42
         status: string → { code, label }
근거    src/components/OrderBadge.tsx:12
         status === 'PAID'  (이 PR에서 안 바뀜)
상황    결제 완료 주문 → 배지가 항상 '알 수 없음'
```

In English: the order status changed shape, but a badge outside the diff still reads the old shape, so paid orders always show "unknown".

I reviewed 32 pull requests with defects planted in an example app, with gimi and with Claude Code's built-in `/code-review`. Both reviewers used the same model and instructions. Both found almost every defect (counted by where a finding points). Findings on something other than the planted defects were 55 for `/code-review` and 19 for gimi; that does not mean they were wrong. Each pull request was reviewed once, and gimi ran without a settings file (domain presets off). One review averaged 57 seconds and $0.41 with gimi, and 45 seconds and $0.31 with `/code-review`.

A separate evaluation used four defects whose requirements were written only in an issue, reviewed twice per reviewer. Reviews that said the change contradicts the requirement: gimi 8 of 8, `/code-review` 5 of 8. I counted these by reading the findings, not by where they point. [Method and all results (Korean)](evals/review/README.md) · [Caveats](docs/guide.en.md#evaluation)

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

To also review against the commerce and Korean e-commerce law rules, ask "도메인 규칙 설정해줘" (set up domain rules). [Settings](docs/guide.en.md#settings)

## Feedback

If something feels wrong, [open an issue](https://github.com/Guksu/gimi/issues) with your request and what happened.

[Releases](https://github.com/Guksu/gimi/releases) · [Changelog (Korean)](CHANGELOG.md) · [Evaluation (Korean)](evals/review/README.md) · [Design (Korean)](docs/design/2026-10-19-gimi.md)

[![CI](https://github.com/Guksu/gimi/actions/workflows/ci.yml/badge.svg)](https://github.com/Guksu/gimi/actions/workflows/ci.yml)
![Preset rules](https://img.shields.io/badge/gimi-43%20preset%20rules-1b1e24)
![Tests](https://img.shields.io/badge/tests-370%20passing-555555)
[![License: MIT](https://img.shields.io/badge/license-MIT-555555)](LICENSE)

## License

[MIT](LICENSE) © 2026 Guksu
