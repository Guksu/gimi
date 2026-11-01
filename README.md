# gimi

A code review skill for Claude Code and Codex. It gathers the context outside the diff first — where the changed code is used, what the ticket asked for, why a line was written that way — and leaves only findings it can back with a location.

AI reviews judge only what is inside the diff, so they kept missing the defects people catch in review: another screen that uses the changed function, a requirement written only in the ticket. I built gimi to review with that context gathered first.

[한국어](README.ko.md) · [Install](#installation) · [Full guide](docs/guide.en.md) · [Evaluation](evals/review/README.md)

```text
[고쳐야 함] 영향 범위
주문 상태 형태가 바뀌었는데 배지는 예전 형태를 읽는다

바뀐 곳  src/api/order.ts:42
         status: string → { code, label }
근거    src/components/OrderBadge.tsx:12
         status === 'PAID'  (이 PR에서 안 바뀜)
상황    결제 완료 주문 → 배지가 항상 '알 수 없음'
```

A finding in Korean: the order status changed shape, but a badge outside the diff still reads the old shape, so paid orders always show "unknown".

I reviewed 32 pull requests with planted defects in an example app, once with gimi and once with Claude Code's built-in `/code-review`, using the same model and instructions. Both found almost every defect. Findings outside the planted defects were 55 for `/code-review` and 19 for gimi; that does not mean those findings were wrong. Each pull request was reviewed once, and gimi took about 1.3 times the time and cost per review. [Method, all results and limitations](evals/review/README.md)

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

[Requirements and settings](docs/guide.en.md#installation) · [Updating](docs/guide.en.md#updating)

## Try it

After installing, ask your agent in the repository you want reviewed:

> Use gimi-review to review the current branch. Check that screens using the changed API still work and that it does what the issue asked for.

Before reviewing, the agent collects where the changed code is used, the pull request and issue text, and the history of the changed lines. It then leaves only findings it can back with a location and writes the full review to `docs/gimi/reviews/`. In Claude Code you can also call it directly as `/gimi:gimi-review`. The skill and its rules are written in Korean, and so are the findings; [English usage notes](docs/guide.en.md#how-it-works) are in the full guide.

To also review against the commerce and Korean e-commerce law rules, ask "도메인 규칙 설정해줘" (set up domain rules). [Settings](docs/guide.en.md#settings)

## Follow development

I use gimi in my own work and will keep fixing issues and widening its rules and context collection. If something feels wrong, [open an issue](https://github.com/Guksu/gimi/issues) with your request and what happened.

[Releases](https://github.com/Guksu/gimi/releases) · [Changelog](CHANGELOG.md) · [Evaluation](evals/review/README.md) · [Design (Korean)](docs/design/2026-10-19-gimi.md)

[![CI](https://github.com/Guksu/gimi/actions/workflows/ci.yml/badge.svg)](https://github.com/Guksu/gimi/actions/workflows/ci.yml)
![Preset rules](https://img.shields.io/badge/gimi-43%20preset%20rules-1b1e24)
![Tests](https://img.shields.io/badge/tests-287%20passing-555555)
[![License: MIT](https://img.shields.io/badge/license-MIT-555555)](LICENSE)

## License

The code is [MIT](LICENSE) (© 2026 Guksu).
