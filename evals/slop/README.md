# 슬롭 금지선 측정

설계 결정 16·34의 측정이다. 공통 금지선의 줄(테스트·코드·리뷰)이 gimi 없이·있이 몇 번의 실행에 나왔는지 센다. gimi 없이 한 번 이상 나온 줄만 아래 "금지선 표"에 올라간다(결정 34). 표는 2026-11-04부터 SKILL.md가 아니라 이 문서에 둔다 — SKILL.md는 리뷰마다 읽히는데 표는 리뷰에 쓰이지 않는다(결정 63).

- **리뷰 줄**(`review/`)은 리뷰 평가의 PR로 잰다 — `review-prs.json`의 12개(결함 7 + 결함 없음 5)를 내장 `/code-review`(gimi 없이)와 gimi-review(gimi 있이)로 리뷰한다.
- **테스트·코드 줄**(`test/`·`code/`)은 2026-10-27에 기능 구현·테스트 작성 요청 12개(`requests.json`)를 gimi 없이·있이 실행해 셌다. 그 실행 도구(`run`)는 테스트 스킬과 함께 지웠다(설계 결정 52). 원본 결과는 그대로 판정·셀 수 있다.

## 명령

gimi 저장소 루트에서 돌린다. `review-eval.mjs run`과 `judge`는 실제 모델을 부르므로 비용이 든다. zsh에서는 PR 목록을 변수에 담아 넘기지 않는다(단어로 나누지 않는다).

```bash
node scripts/review-eval.mjs run $(node -p "require('./evals/slop/review-prs.json').prs.join(' ')") --reviewer code-review --runs 2 --model <모델> --out evals/slop/runs/<날짜>-review
node scripts/review-eval.mjs run $(node -p "require('./evals/slop/review-prs.json').prs.join(' ')") --reviewer gimi --runs 2 --model <모델> --out evals/slop/runs/<날짜>-review
node scripts/slop-eval.mjs judge evals/slop/runs/<날짜>-review --reviews --model <모델>   # 판정한 실행은 건너뛴다
node scripts/slop-eval.mjs score evals/slop/runs/<날짜>-review --reviews --rejected <걸러 낸 파일> --results <결과 파일> --date YYYY-MM-DD
node scripts/slop-eval.mjs apply <결과 파일>      # 규칙 파일의 근거를 바꾼다(결과 파일에 영역이 있으면 그 영역만)
node scripts/buildSlopTable.mjs                 # 이 문서의 금지선 표를 근거로 다시 쓴다(--check)
```

원본 실행 결과는 `runs/`(커밋하지 않는다), 결과 파일과 해석은 `results/`다.

## 금지선 표

규칙 파일(`skills/gimi-review/shared/rules/{test,code,review}.md`)의 `근거`로 `buildSlopTable.mjs`가 다시 쓴다. 손으로 고치지 않는다. 테스트·코드 줄은 기능 구현·테스트 작성 요청 12개를, 리뷰 줄은 PR 12개를 gimi 없이·있이 2번씩 실행해 셌다. "gimi 있이"는 이 표가 SKILL.md에 있을 때(2026-11-04 전) 잰 것이다. 다시 재면 표가 SKILL.md에 없는 조건이라 같은 조건이 아니다.

<!-- slop-table:start -->
| 줄 | gimi 없이 | gimi 있이 |
|---|---|---|
| `code/single-use-abstraction` 한 번 쓰는 헬퍼·래퍼·설정 객체를 만들지 않는다 | 24번 중 4번 | 24번 중 6번 |
| `review/repeated-finding` 같은 문제를 위치마다 따로 지적하지 않는다 | 24번 중 3번 | 24번 중 1번 |
| `code/n-plus-one` 반복문 안에서 쿼리를 날리지 않는다 | 24번 중 2번 | 24번 중 2번 |
| `review/filler` 칭찬과 diff를 다시 설명하는 요약을 쓰지 않는다 | 24번 중 2번 | 24번 중 2번 |
| `code/unrelated-change` 요구사항과 상관없는 변경을 섞지 않는다 | 24번 중 1번 | 24번 중 0번 |
| `review/diff-only` diff 안에서만 판단하지 않는다 | 24번 중 1번 | 24번 중 0번 |
| `review/guessed-intent` 티켓을 읽지 않고 PR 제목으로 의도를 짐작하지 않는다 | 24번 중 1번 | 24번 중 0번 |
| `review/unverified-claim` 돌려 보지 않고 "테스트가 깨질 것"이라고 하지 않는다 | 24번 중 1번 | 24번 중 0번 |
| `test/real-wait` 실제 시간을 기다리거나 고정하지 않은 현재 시각에 기대지 않는다 | 24번 중 1번 | 24번 중 0번 |
| `test/sequential-only` 동시성 규칙을 순차 호출로만 테스트하지 않는다 | 24번 중 1번 | 24번 중 0번 |
<!-- slop-table:end -->

`review/diff-only`의 측정(2026-10-29)은 옛 확인 기준으로 셌다. 옛 기준은 "슬롭이 아닌 지적의 근거 위치가 모두 diff 안"이다. 2026-11-05 설계 결정 64로 확인 기준이 "모은 diff 밖 맥락을 보지 않고 결론을 낸다"로 바뀌었고, 새 기준으로는 다시 재지 않았다.

## 세는 법

1. 리뷰는 리뷰 평가와 같은 조건으로 돌린다(같은 모델, Bash 허용·npm·npx 막음, 사용자 설정·플러그인·MCP를 읽지 않음). 실행 기록(`--output-format stream-json --verbose`)에서 리뷰어가 돌린 명령을 결과 파일의 `commands`에 남긴다.
2. 판정 모델이 도구 없이 PR·이슈·diff·리뷰어가 돌린 명령·gimi 리뷰 기록·리뷰 출력과 줄의 전문을 읽고 고른다(`SLOP <ID> 보고 <근거>`).
3. 판정이 고른 지적을 사람이 읽고, 틀린 것은 이유와 함께 걸러 낸다(`--rejected` — `{ rejected, unmeasured }`). 판정할 근거가 없는 줄은 "셀 수 없던 줄"로 따로 둔다.
4. 한 실행에서 여러 번 나와도 그 실행은 한 번으로 센다.

## 결과

| 날짜 | 무엇 | 파일 |
|---|---|---|
| 2026-10-27 | 요청 12개 × gimi 없이·있이 × 2번 | `results/2026-10-27.md`(해석), `2026-10-27.json`(결과), `2026-10-27-review.json`(걸러 낸 지적·셀 수 없던 줄) |
| 2026-10-28 | 완료 보고 줄만(`--areas done`) — 같은 요청·같은 실행 수, 에이전트가 돌린 명령을 남김. 완료 보고 줄은 설계 결정 52로 지웠다 | `results/2026-10-28.md`(해석), `2026-10-28.json`(결과), `2026-10-28-review.json`(걸러 낸 지적) |
| 2026-10-29 | 리뷰 줄 — PR 12개 × 내장 `/code-review`·gimi-review × 2번(`--reviews`) | `results/2026-10-29.md`(해석), `2026-10-29.json`(결과), `2026-10-29-review.json`(걸러 낸 지적) |
