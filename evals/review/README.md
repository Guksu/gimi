# 리뷰 평가

리뷰 품질 평가(설계 결정 15①)다. 예제 저장소(`evals/shop-fixture/`)의 결함 PR마다 `gimi-review`와 내장 `/code-review`를 같은 모델로 돌린다. 지적을 정답(`defect.json`의 `findings`)과 맞춰 기계로 채점한다.

## 명령

gimi 저장소 루트에서 돌린다. `run`은 실제 모델을 부르므로 비용이 든다.

```bash
node scripts/review-eval.mjs coverage [ID…] [--out <폴더>]
                      # 모델 없이 — 정답·근거가 gimi의 맥락 묶음(context.mjs)에 있는지
node scripts/review-eval.mjs run [ID…] --reviewer gimi|code-review --model <모델> [--runs N] [--out <폴더>]
                      # 결함 PR마다 평가용 저장소를 만들어 claude -p로 리뷰한다
node scripts/review-eval.mjs score <폴더>
                      # run이 쓴 결과를 채점표로(<폴더>/score.md)
```

`--out`을 주지 않으면 `evals/review/runs/{날짜}/`에 쓴다. 이 폴더는 `.gitignore`로 뺀다. 채점표와 해석만 `results/`에 커밋한다. `coverage --out`을 같은 폴더에 주면 `score`가 놓친 정답을 수집 실패·판단 실패로 나눈다.

## 공정하게

- 두 리뷰어는 같은 모델, 같은 덧붙인 지시(`--append-system-prompt`)를 받는다. gimi만 `--plugin-dir`로 이 저장소를 플러그인으로 받는다.
- 사용자 설정·플러그인·MCP는 읽지 않는다(`--setting-sources project`, `--strict-mcp-config`).
- 도구는 Read·Grep·Glob·Write·Skill·Agent·Bash를 허용하고, 테스트 명령(`npm`·`npx`·`pnpm`·`yarn`)만 묻지 않고 막는다(`--disallowedTools`, `--permission-mode dontAsk`). 이어 붙인 명령은 하나라도 허용 밖이면 통째로 막힌다. code-review는 `git diff`에 따옴표 없는 `find` 패턴과 `~/.claude/CLAUDE.md` 읽기를 이어 붙여서, `Bash(git *)` 같은 명령 이름 규칙으로는 diff를 못 본다.
- 실행마다 도구 조건(`tools`)과 막힌 도구 호출(`permissionDenials`)을 결과에 남긴다. 조건이 다른 실행을 한 표에 섞을 때는 결과 문서에 적는다.
- 평가용 저장소는 이름이 중립인 임시 폴더에 만들고, 결함 브랜치 이름은 `feature/pr`이다. 처음에 `defect/COM-024`로 만들었더니 `context.mjs`가 브랜치 이름을 티켓 번호로 읽었다.
- 부르는 말은 gimi가 `/gimi:gimi-review`, code-review가 `/code-review feature/pr`이다. gimi는 범위를 스스로 정한다(지금 브랜치와 기본 브랜치의 갈림점부터).

## 채점

- 리뷰어는 출력 끝에 지적마다 `FINDING <고쳐야 함|고치면 좋음|확인 질문> <경로>:<줄> <요약>`을 한 줄씩 적는다. 지적이 없으면 `FINDING 없음`을 적는다.
- 내장 `/code-review`는 이 지시를 따르지 않고 자기 JSON 지적 목록(`file`·`line`·`summary`)을 낸다. FINDING 줄이 없으면 그 목록을 읽는다. 그 목록에는 단계가 없다. 둘 다 없으면 "형식 어김"으로 센다.
- 같은 파일에서 정답 줄(범위) ±3 안이거나, 정답의 근거 위치(±3)에서 지적하면 찾은 것이다. 지적 하나는 정답 하나에만 쓴다.
- 결함 PR에서 정답에 맞지 않는 지적은 "정답 밖 지적"으로 따로 센다. 정답을 모두 적었다고 할 수 없어서 오탐으로 치지 않는다.
- 결함 없는 PR(`clean: true`)의 지적은 모두 오탐이다. 그 가운데 "고쳐야 함"을 따로 센다. 단계가 없는 지적이 섞이면 따로 세지 못한다(`-`).
- gimi는 놓친 정답을 나눈다. 정답이나 근거 가운데 하나라도 맥락 묶음에 없으면 "수집 실패", 모두 있는데 지적하지 못했으면 "판단 실패"다.

## 맥락 수집 점검

`coverage`는 정답과 근거마다 맥락 묶음의 어디에 있는지 본다.

| 어디 | 뜻 |
|---|---|
| 바뀐 조각 | diff 조각의 새 줄 범위 ±3 |
| 영향 범위 | 바뀐 export·문자열·계약의 사용처 ±3 |
| 바뀐 파일 | 바뀐 파일이지만 조각 밖 — 묶음이 파일을 가리키고, 리뷰어가 그 파일을 열면 보인다 |
| 이력 | 근거가 커밋이면 묶음의 이력에 그 커밋이 있다 |
| (없음) | 묶음에 없다 — 리뷰어가 스스로 찾아야 한다 |

## 결과

| 날짜 | 무엇 | 파일 |
|---|---|---|
| 2026-10-26 | 시험 — COM-024를 리뷰어마다 1번, 맥락 수집 점검은 결함 15개 전체 | `results/2026-10-26-trial.md` |
| 2026-10-26 | 전체 1회차 — 결함 15 + 결함 없음 2를 리뷰어마다 2번. 도구 조건이 다르다(gimi는 git·node만) | `results/2026-10-26-full.md` |
