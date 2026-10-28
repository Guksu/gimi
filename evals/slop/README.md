# 슬롭 금지선 측정

설계 결정 16·34·49의 측정이다. 같은 요청(기능 구현·테스트 작성)을 gimi 없이·있이 실행하고, 공통 금지선의 줄(테스트·코드·완료 보고)이 몇 번의 실행에 나왔는지 센다. gimi 없이 한 번 이상 나온 줄만 SKILL.md의 금지선 표에 올라간다(결정 34).

## 명령

gimi 저장소 루트에서 돌린다. `run`·`judge`는 실제 모델을 부르므로 비용이 든다. `run`은 예제 저장소의 테스트 DB를 쓰니 하나씩 돌리고, 그동안 예제 저장소의 서버 테스트를 따로 돌리지 않는다.

```bash
node scripts/slop-eval.mjs run [ID…] --arm without|with --runs 2 --model <모델> [--out <폴더>]
node scripts/slop-eval.mjs run B1 --arm without --run 2 --model <모델>   # 실행 하나만 다시
node scripts/slop-eval.mjs judge <폴더> --model <모델> [--areas done]      # 판정한 실행은 건너뛴다. --areas는 그 영역의 줄만
node scripts/slop-eval.mjs score <폴더> --rejected <걸러 낸 파일> --results <결과 파일> --date YYYY-MM-DD [--areas done]
node scripts/slop-eval.mjs apply <결과 파일>      # 규칙 파일의 근거를 바꾸고 복사본에 옮긴다(결과 파일에 영역이 있으면 그 영역만)
node scripts/buildSlopTable.mjs                 # 두 SKILL.md의 금지선 표를 근거로 다시 쓴다(--check)
```

요청문은 `requests.json`(프론트 F1~F6, 백엔드 B1~B6)이다. 원본 실행 결과는 `runs/`(커밋하지 않는다), 결과 파일과 해석은 `results/`다.

## 실행 조건

- 요청마다 이름이 중립인 임시 폴더에 정상 버전 저장소를 만들고 예제 저장소의 의존성을 링크한다. 두 쪽 모두 같은 gimi 설정(`.agents/gimi.json` — stacks `frontend-ts`·`backend`, presets `commerce`)을 커밋해 둔다.
- 두 쪽에 같은 덧붙인 지시를 준다 — 사람 없이 한 번에 끝내고, 마지막에 바꾼 것과 확인한 것을 보고한다. 새 패키지는 설치하지 않고 커밋하지 않는다.
- 실행 기록은 `--output-format stream-json --verbose`로 받는다. 에이전트가 돌린 Bash 명령과 결과(성공·실패·막힘)를 결과 파일의 `commands`에 남긴다. 세션 파일은 남기지 않는다(`--no-session-persistence`).
- 사용자 설정·플러그인·MCP는 읽지 않는다(`--setting-sources project`, `--strict-mcp-config`). gimi 있이만 `--plugin-dir`로 이 저장소를 받고, 스킬이 자기 패턴·규칙 파일을 읽게 `--add-dir`로 스킬 폴더를 연다.
- 도구는 파일 읽기·쓰기와, Bash는 허용 목록의 명령만이다 — 읽기 명령, git 읽기(`status`·`diff`·`log`·`show`·`blame`·`ls-files`), 테스트·타입 검사(`npm test`·`npm run test`·`npm run typecheck`·`npm run generate:api`·`npx vitest`·`npx tsc`), 이 저장소의 gimi 스크립트. 묻지 않고 막는다(`--permission-mode dontAsk`). 처음에 Bash를 모두 허용하자 자동 승인 검사가 "안전하지 않은 에이전트"로 막아 줄였다.

## 세는 법

1. 실행이 끝나면 바뀐 것을 커밋하고 끝내기 전 검사(`check.mjs --json --base main`)를 돌린다. 자동 검사(error·warn) 줄은 그 보고로 센다.
2. 검사가 error·warn만이 아닌 줄(리뷰·출력이 섞인 줄)은 판정 모델이 도구 없이 요청·마지막 보고·에이전트가 돌린 명령·검사 결과·diff·규칙 전문을 읽고 고른다(`SLOP <ID> <경로>:<줄> <근거>`). 명령은 모두 성공·실패·막힘으로 보이고, 테스트·타입 검사·check.mjs 명령만 출력 끝 20줄을 붙인다. 완료 보고 줄은 마지막 보고를 에이전트가 돌린 명령과 견준다 — 끝내기 전 검사는 에이전트가 끝난 뒤 평가 도구가 돌린 것이라 근거로 쓰지 않는다.
3. 자동 검사와 판정이 고른 지적을 사람이 읽고, 틀린 것은 이유와 함께 걸러 낸다(`--rejected` — `{ rejected, unmeasured }`). 판정할 근거가 없는 줄은 "셀 수 없던 줄"로 따로 둔다.
4. 한 실행에서 여러 번 나와도 그 실행은 한 번으로 센다.

## 결과

| 날짜 | 무엇 | 파일 |
|---|---|---|
| 2026-10-27 | 요청 12개 × gimi 없이·있이 × 2번 | `results/2026-10-27.md`(해석), `2026-10-27.json`(결과), `2026-10-27-review.json`(걸러 낸 지적·셀 수 없던 줄) |
| 2026-10-28 | 완료 보고 줄만(`--areas done`) — 같은 요청·같은 실행 수, 에이전트가 돌린 명령을 남김 | `results/2026-10-28.md`(해석), `2026-10-28.json`(결과), `2026-10-28-review.json`(걸러 낸 지적) |
