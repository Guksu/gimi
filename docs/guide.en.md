# gimi full guide

[README](../README.md) · [한국어](guide.md)

## Introduction

The name comes from the royal food taster (gimi sanggung) who tasted the king's meal first: gimi tastes code before it goes up.

gimi is a code review skill (**gimi-review**) for Claude Code and Codex. Before reviewing, it gathers the context outside the diff (the lines a change touches): whether code this change did not touch uses the changed code, the requirements written in the pull request and issue, the reason in the commits that added the changed lines, and the pull request's CI results. It then leaves only findings that name a failure condition and point to the evidence. Comparisons with other review tools are limited to what [Evaluation](#evaluation) measured.

## What it checks

- **Impact** — finds places this change did not touch that use a changed function, type or class method (TypeScript and JavaScript). It also searches for changed strings such as query keys and paths, and for removed fields.
- **Contracts** — a contract is the API agreement between front end and back end (an OpenAPI or GraphQL schema). When it changes, gimi lists the changed endpoints and fields and where they are used. If the front end and back end live in different repositories, it also searches the repositories listed in the settings.
- **Intent** — reads the pull request and issue text and checks the diff against the requirements. It also checks claims in the pull request and commit messages ("refactor only", "adds tests" and so on) against the collected context. Without a pull request, the commit messages are the intent. Jira, Notion and Linear tickets are read through tools connected to your agent; if they cannot be read, the agent asks you to paste them.
- **CI** — if there is a pull request, collects its check results (name, result and link). For a failed check, the agent opens the log and uses it as evidence when this change caused the failure. gimi does not run tests itself, because that would run the pull request's code.
- **History** — finds the commits that added the changed or removed lines, to see whether the change undoes an earlier fix.
- **Rules** — checks against three layers.
  - Common guardrails: signs of AI-written code, tests and reviews (for example an empty catch, or a claim with no evidence)
  - Domain presets: 29 commerce rules and 14 Korean e-commerce law rules
  - Team rules: `docs/gimi/rules.md`
- **Review record** — writes findings to `docs/gimi/reviews/`. When the same group of findings that no rule covers appears in three separate reviews (`promoteAfter`), a script (`scripts/promote.mjs`) counts them and the agent drafts a team rule candidate. Reviewing the same pull request again counts once. A person must approve it before it becomes a rule.

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
- To read pull request and issue text and CI results, sign in to the GitHub CLI (`gh`). Without it, gimi reports that intent and CI were skipped. A branch review with no pull request also skips CI.
- Impact search uses the reviewed project's own `typescript`. Without it, gimi falls back to text search.
- If anything under the reviewed repository's `node_modules` is tracked by git, gimi loads neither `typescript` nor a YAML parser from it, so code committed in someone else's pull request does not run on your machine. It cannot protect packages you install yourself from a pull request's `package.json`; check dependency changes before installing them. In a repository that commits a file under `node_modules` (such as `.gitkeep`), impact search always falls back to text search.

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
2. **Gather context** — a script that ships with the skill (`scripts/context.mjs`) collects changed files, intent, CI results, history, impact and contracts, and prints a summary.
3. **Check rules** — only the rules that fit the project are listed, and the ones the diff touches are read.
4. **Write findings with evidence** — each finding states what goes wrong for which input or state (상황, what happens) and where the evidence is. Evidence may be inside or outside the diff: if the arithmetic or branches inside the changed function are enough to show the failure, that line is the evidence. The context outside the diff is checked whether or not there are findings. Each finding also says whether this change introduced the defect or it existed before (생긴 때). A defect that existed before is not raised as "must fix".
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
생긴 때  이번 변경
```

The heading reads "[must fix] impact". The labels are the changed line (바뀐 곳), the evidence (근거), what happens (상황) and whether this change introduced it (생긴 때 — 이번 변경 means this change, 변경 전부터 means it existed before). This one says the order status changed shape, but a badge outside the diff still reads the old shape, so paid orders always show "unknown".

A review adds two files to your repository:

- `docs/gimi/reviews/{date}-pr-{number}.md` — the review record, with findings and the context that was checked.
- `docs/gimi/reviews/{date}-pr-{number}.context.json` — the gathered context. It is large and can be rebuilt, so do not commit it. Add `docs/gimi/reviews/*.context.json` to `.gitignore`.

gimi does not comment on pull requests. It reviews only when you ask.

## Settings

Reviews work without settings. In that case gimi decides whether the common guardrails target the front end, the back end or both by looking at the repository: `package.json` dependencies (React or Vue for the front end; NestJS, Express or pg for the back end) and server build files such as `go.mod` or `pom.xml`. It looks only at files tracked by git. Frameworks with both server and UI code, such as Next.js, count as both. If it finds neither, or cannot tell, it uses both. Domain presets are not used; if `presets` is missing from the settings, the review record says so (an empty `[]` is not reported).

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

- `stacks` selects the common guardrails (`frontend-ts`, `backend`) instead of guessing; `presets` selects domain presets.
- The Korean law preset (`kr-commerce-law`) is not legal advice. Your team decides how the withdrawal period is counted (`kcl.periodCounting`) and the business-day calendar (`kcl.businessDays`). If they are not set, the review asks instead of asserting those calculations.
- `linkedRepos` lists other repositories to search, relative to the root of this checkout. They are read as currently checked out.
- If a pull request changes `linkedRepos`, gimi uses the value from the base branch (the merge base) instead and says so.
- To turn off a single preset rule, list it with a reason under "끈 프리셋 규칙" (disabled preset rules) in the team rules file.

- `promoteAfter` is how many separate reviews must repeat the same group of findings that no rule covers before it becomes a rule candidate (default 3). Candidates go to `docs/gimi/candidates.md` and become team rules only after you approve them.

All settings are described in the [settings section of the design document](design/2026-10-19-gimi.md#설정--agentsgimijson) (Korean). `rulePrefix` is not read by the scripts yet.

## Evaluation

gimi-review and Claude Code's built-in `/code-review` reviewed pull requests with defects planted in an example app (`evals/shop-fixture`, a noodle-shop ordering app), with the same model (`claude-opus-5-5`) and instructions.

- **Found** — both found almost every defect (32 new defects: `/code-review` 32, gimi 31). A finding counts as found if it points within three lines of the answer, so a different problem on the same line can also count.
- **Findings outside the answers** — findings on something other than the planted defect. They are not necessarily wrong. On the 32 new defects, `/code-review` made 55 and gimi 19. Their content was not checked.
- **Requirements only in issues** — four defects whose requirements were written only in an issue, reviewed twice per reviewer. Reviews that said the change contradicts the requirement: gimi 8 of 8, `/code-review` 5 of 8 (counted by me from the findings' content, not by where they point).
- **Cost and time** — gimi costs more. On the 32 new defects, one review averaged $0.41 and 57 seconds with gimi, $0.31 and 45 seconds with `/code-review`.

These results come from one model and one example app. The new defects were reviewed once each. gimi ran without a settings file. The domain presets (commerce and Korean e-commerce law) are on only when set, so they were off. At the time (before 2026-11-03), no settings also meant a frontend-only target, so the backend-only common guardrails were not in the rule list. The effect of the preset rules has not been measured yet. This evaluation ran before 0.1.0, so what was added or changed after that has not been measured either: pull request CI results, checking the pull request's claims, counting repeated findings, guessing the target when there are no settings, contract usages in other repositories (`linkedRepos`), and the shortened review procedure (SKILL.md), among others. In that evaluation the fake `gh` reported no pull request, so the CI results and the reading of the pull request body did not run. The evaluation tool now serves a fake pull request and CI for defects that define `github`, but those cases have not been run with a model yet. With only one evaluation repository, `linkedRepos` cannot be measured. There are no results yet from real repositories outside the example app. Results and conditions are in the [evaluation notes](../evals/review/README.md) and [result files](../evals/review/results/) (Korean).

## Limitations

- Uses of a changed name are found only in TypeScript and JavaScript. Usages inside Vue and Svelte files show up only when the project has no `typescript` and gimi falls back to text search (the language service sees only files listed in tsconfig). Files in other languages are searched only for changed strings.
- Proto contracts (gRPC `.proto` files) and GraphQL schemas written inside server code (typeDefs) are not read yet.
- gimi does not write or run tests. It does review test code in a pull request.

## Repository layout

| What | Path |
|---|---|
| Skill | `skills/gimi-review/SKILL.md`; first-time setup and rule candidates in `references/setup.md` |
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
