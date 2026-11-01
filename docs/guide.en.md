# gimi full guide

[README](../README.md) · [한국어](guide.md)

## Introduction

The name comes from the royal food taster (gimi sanggung) who tasted the king's meal first: gimi tastes code before it goes up.

gimi is a code review skill (**gimi-review**) for Claude Code and Codex. AI reviewers usually judge only what is inside the diff. Most defects people catch in review are outside it: another screen that uses the changed function, a requirement written in the ticket, the reason a line was written that way. gimi-review gathers that context before reviewing. It then leaves only findings it can back with a location.

## What it checks

- **Impact** — finds places this change did not touch that use a changed function, type or class method (TypeScript and JavaScript). It also searches for changed strings such as query keys and paths, and for removed fields.
- **Contracts** — a contract is the API agreement between front end and back end (an OpenAPI or GraphQL schema). When it changes, gimi lists the changed endpoints and fields and where they are used. If the front end and back end live in different repositories, it also searches the repositories listed in the settings.
- **Intent** — reads the pull request and issue text and checks the diff against the requirements. Jira, Notion and Linear tickets are read through tools connected to your agent; if they cannot be read, the agent asks you to paste them.
- **History** — finds the commits that added the changed or removed lines, to see whether the change undoes an earlier fix.
- **Rules** — checks against three layers.
  - Common guardrails: signs of AI-written code, tests and reviews (for example an empty catch, or a claim with no evidence)
  - Domain presets: 29 commerce rules and 14 Korean e-commerce law rules
  - Team rules: `docs/gimi/rules.md`
- **Review record** — writes findings to `docs/gimi/reviews/`. When the same kind of finding appears three times in the records, the agent reads them and proposes a team rule. A person must approve it before it becomes a rule.

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

Requirements:

- Node.js 22 or later. The context script has no runtime dependencies.
- A git repository to review. In a shallow clone, history is skipped.
- To read pull request and issue text, sign in to the GitHub CLI (`gh`). Without it, gimi reports that intent was skipped.
- Impact search uses the reviewed project's own `typescript`. Without it, gimi falls back to text search.

## Updating

Read the [release notes](https://github.com/Guksu/gimi/releases) before updating.

For **Claude Code**, run these commands in a terminal, then start a new session:

```bash
claude plugin marketplace update gimi
claude plugin update gimi@gimi
```

For **Codex**, refresh the marketplace with `codex plugin marketplace upgrade gimi`. Then open gimi in the app's plugin settings to check and update the installed version. Refreshing the marketplace alone is not confirmation that the installed plugin changed.

Command references: [Claude Code](https://code.claude.com/docs/en/discover-plugins#update-plugins-now) · [Codex plugins](https://developers.openai.com/plugins/build/plugins)

## How it works

In the repository you want reviewed, ask for things like "review PR 42", "review this branch" or "check whether this breaks other screens". In Claude Code you can call it directly as `/gimi:gimi-review`; when a request could also match the built-in `/code-review`, calling it by name is more reliable.

A review runs in five steps.

1. **Scope** — the pull request if you give a number, otherwise the current branch since it split from the default branch.
2. **Gather context** — a script that ships with the skill (`scripts/context.mjs`) collects changed files, intent, history, impact and contracts, and prints a summary.
3. **Check rules** — only the rules that fit the project are listed, and the ones the diff touches are read.
4. **Write findings with evidence** — evidence must be outside the diff. Only findings about AI-code tells (slop) may cite lines inside the diff.
5. **Report** — the chat shows the number of findings and the must-fix ones. The full review goes to the record file.

The skill and its rules are written in Korean. A finding looks like this (example):

```text
[고쳐야 함] 영향 범위
주문 상태 형태가 바뀌었는데 배지는 예전 형태를 읽는다

바뀐 곳  src/api/order.ts:42
         status: string → { code, label }
근거    src/components/OrderBadge.tsx:12
         status === 'PAID'  (이 PR에서 안 바뀜)
상황    결제 완료 주문 → 배지가 항상 '알 수 없음'
```

The heading reads "[must fix] impact". The labels are the changed line (바뀐 곳), the evidence (근거) and what happens (상황). This one says the order status changed shape, but a badge outside the diff still reads the old shape, so paid orders always show "unknown".

A review adds two files to your repository:

- `docs/gimi/reviews/{date}-pr-{number}.md` — the review record, with findings and the context that was checked.
- `docs/gimi/reviews/{date}-pr-{number}.context.json` — the gathered context. It is large and can be rebuilt, so do not commit it. Add `docs/gimi/reviews/*.context.json` to `.gitignore`.

gimi does not comment on pull requests. It reviews only when you ask.

## Settings

Reviews work without settings. In that case only the shared and front-end (TypeScript) common guardrails apply. Back-end guardrails and domain presets do not.

To use presets, ask "도메인 규칙 설정해줘" (set up domain rules). After you choose presets and requirement sources, the agent writes `.agents/gimi.json`.

```json
{
  "stacks": ["frontend-ts", "backend"],
  "presets": ["commerce", "kr-commerce-law"],
  "kcl": { "periodCounting": "civil-code", "businessDays": "docs/gimi/business-days.json" },
  "requirements": [{ "source": "github" }, { "source": "jira", "keyPattern": "SHOP-\\d+" }],
  "linkedRepos": ["../shop-web"]
}
```

- `stacks` selects the common guardrails (`frontend-ts`, `backend`); `presets` selects domain presets.
- The Korean law preset (`kr-commerce-law`) is not legal advice. Your team decides how the withdrawal period is counted (`kcl.periodCounting`) and the business-day calendar (`kcl.businessDays`). If they are not set, the review asks instead of asserting those calculations.
- `linkedRepos` lists other repositories to search, relative to the root of this checkout. They are read as currently checked out.
- If a pull request changes `linkedRepos`, gimi uses the value from the base branch (the merge base) instead and says so.
- To turn off a single preset rule, list it with a reason under "끈 프리셋 규칙" (disabled preset rules) in the team rules file.

All settings are described in the [settings section of the design document](design/2026-10-19-gimi.md#설정--agentsgimijson) (Korean). `promoteAfter` and `rulePrefix` are not read by the scripts yet.

## Evaluation

gimi-review and Claude Code's built-in `/code-review` reviewed pull requests with defects planted in an example app (`evals/shop-fixture`, a noodle-shop ordering app), with the same model (`claude-opus-5-5`) and instructions.

- **Found** — both found almost every defect (32 new defects: `/code-review` 32, gimi 31). A finding counts as found if it points within three lines of the answer, so a different problem on the same line can also count.
- **Findings outside the answers** — findings on something other than the planted defect. They are not necessarily wrong. On the 32 new defects, `/code-review` made 55 and gimi 19. Their content was not checked.
- **Requirements only in issues** — four defects whose requirements were written only in an issue, reviewed twice per reviewer. gimi read the requirement in 8 of 8 reviews, `/code-review` in 5 of 8 (counted by me).
- **Cost and time** — gimi costs more. On the 32 new defects, one review averaged $0.41 and 57 seconds with gimi, $0.31 and 45 seconds with `/code-review`.

These results come from one model and one example app. The new defects were reviewed once each. Results and conditions are in the [evaluation notes](../evals/review/README.md) and [result files](../evals/review/results/) (Korean).

## Limitations

- Uses of a changed name are found only in TypeScript and JavaScript (including Vue and Svelte). Files in other languages are searched only for changed strings.
- Proto contracts (gRPC `.proto` files) and GraphQL schemas written inside server code (typeDefs) are not read yet.
- gimi does not write or run tests. It does review test code in a pull request.

## Repository layout

| What | Path |
|---|---|
| Skill | `skills/gimi-review/SKILL.md` |
| Context script | `skills/gimi-review/scripts/context.mjs` + `lib/` |
| Rules | `skills/gimi-review/shared/rules/` (common guardrails), `shared/domains/` (domain presets) |
| Example app and defect pull requests | `evals/shop-fixture/` |
| Review evaluation | `evals/review/` |
| Design | `docs/design/2026-10-19-gimi.md` (Korean) |

## Development

You need Node.js 22 or later. `typescript` is used only in tests.

```bash
npm ci            # install dev dependencies
npm test          # unit and integration tests (node:test)
npm run validate  # skill structure check + trigger evaluation
```

Working rules are in [AGENTS.md](../AGENTS.md) (Korean). Changes are in [CHANGELOG.md](../CHANGELOG.md) (Korean).
