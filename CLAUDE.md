@AGENTS.md

# Claude Code 전용 보충

공통 지침은 위에서 가져온 `AGENTS.md`가 단일 출처다. 이 파일에는 Claude Code에서만 해당하는 것만 적는다.

**스킬 이름:** 플러그인으로 설치하면 `gimi:gimi-review`·`gimi:gimi-test`로 보인다. 이 저장소에서 스킬 자체를 고치는 작업에는 두 스킬을 쓰지 않는다(아직 구현 중이다).

**변경 이력:**
| 날짜 | 변경 내용 | 대상 | 사유 |
|------|----------|------|------|
| 2026-10-20 | 저장소 뼈대 — 매니페스트(Claude Code·Codex, 훅 없음), AGENTS.md·CLAUDE.md, 두 스킬 SKILL.md, 트리거 평가, 구조 검사, CI | 전체 | 사용자 결정 — suta처럼 뼈대와 트리거 평가부터 구현 |
| 2026-10-21 | 맥락 수집 1단계 — context.mjs(범위·바뀐 파일·의도·이력, 요약 + JSON). 영향 범위는 2단계 | skills/gimi-review/scripts·tests | 사용자 요청 — 맥락 수집 스크립트를 테스트부터 |
| 2026-10-21 | 맥락 수집 2단계 — 영향 범위(바뀐 export·바뀐 문자열의 사용처, 프로젝트의 TypeScript 참조 찾기 + 문자열 검색). typescript 6.0.3을 테스트 전용 개발 의존성으로. 계약 파일은 3단계 | skills/gimi-review/scripts·tests·package.json·CI | 사용자 결정 — typescript는 개발 의존성, 계약 파일은 따로 |
| 2026-10-21 | 끝내기 전 검사 1단계 — check.mjs(바뀐 범위 → 명령 찾기 → 실행 → 보고), 두 스킬 공유 파일 @shared 복사본과 동기 검사 | skills/gimi-test/scripts·scripts/lib/skills.mjs·tests | 사용자 요청 — check.mjs를 테스트부터. 슬롭 정적 검사·옵트인 연결은 다음 단계 |
| 2026-10-21 | 끝내기 전 검사 2단계 — 바뀐 JS·TS 줄의 테스트·코드 슬롭 정적 검사(error·warn, 무시 주석, 프론트 전용 줄은 stacks로), diff.mjs 공유 복사본. muklog로 오탐 보정 | skills/gimi-test/scripts·tests | 사용자 요청 — 슬롭 정적 검사를 테스트부터. 옵트인 연결·--baseline은 다음 단계 |
| 2026-10-21 | 끝내기 전 검사 3단계 — --baseline(git archive로 갈림점을 임시 폴더에 풀어 실패한 명령만 다시 돌림), --hook(Stop 훅, 세션별 상태·막는 횟수 상한)·--verifier(하네스 명령은 다시 돌리지 않음), connect.mjs(프로젝트에 복사 + verifier 또는 Stop 훅 등록, --remove). guksu-harness v2 위치(.claude/hooks) 읽기, 신호를 받으면 명령 프로세스 그룹 정지 | skills/gimi-test/scripts·tests | 사용자 결정 — 복사·겹치지 않는 verifier 항목·앱 추정 + --app·임시 폴더 기준 |
| 2026-10-21 | 맥락 수집 3단계 — 계약 파일(OpenAPI·GraphQL) 영향 범위. OpenAPI 비교 + 엔드포인트 경로 문자열 검색 + 생성 타입 TypeScript 참조, GraphQL 스키마 비교 + 연산을 스키마로 풀어 필드 단위 사용처, YAML은 프로젝트 파서 + 내장 최소 파서 | skills/gimi-review/scripts·tests | 사용자 결정 — 프로젝트 파서 + 내장, 생성 타입 없으면 경로 문자열 검색, GraphQL은 연산을 스키마로 풀기 |
| 2026-10-21 | 규칙 파일과 분야 프리셋 — shared/rules/*.md 61줄(원본은 영역 주인), shared/domains의 commerce·kr-commerce-law(설계 초안을 옮기고 지움, 근거 URL 확인), rules.mjs(설정에 맞는 규칙·전문·경계값), 구조 검사의 규칙 형식·check.mjs 대조 | skills/*/shared·scripts·scripts/lib/skills.mjs·tests | 사용자 결정 — rules.mjs를 함께, 영역 주인이 원본, 초안 지우기, 출처 직접 확인 |
| 2026-10-21 | 예제 저장소 evals/shop-fixture — web(React + Vite)·server(NestJS + pg)·fake-pg·PostgreSQL(docker), OpenAPI 계약. 결함 PR 형식(change.patch + defect.json)과 defects.mjs(check·materialize·base), 첫 결함 COM-007·COM-016·KCL-001, CI 별도 job(PostgreSQL 서비스 컨테이너) | evals/shop-fixture·scripts·tests·CI | 사용자 결정 — NestJS, 패치 + 정답 파일, 앱 + 도구 + 예시 3개, 매 PR 별도 job |
| 2026-10-22 | 테스트 패턴 1단계 — PATTERN.md 형식·구조 검사, SKILL.md 패턴 표 생성(buildCatalog.mjs), 패턴 선택 평가(evals/selection), 예시 검증(evals/patterns + defects.mjs check — 정상·결함 버전에 복사해 좋은 예시 결함 실패·슬롭 예시 결함 통과). 패턴 concurrency·domain-boundaries·api-boundary | skills/gimi-test·scripts·evals·tests | 사용자 결정 — 패턴 틀 + 결함과 짝인 3개, 예시는 검사 때 임시 저장소에 복사. 결함 PR은 정상 버전 테스트를 통과하지 않아도 된다 |
| 2026-10-23 | 테스트 패턴 2단계 — 백엔드 결제 묶음 idempotency↔COM-018·webhook-contract↔COM-021·external-api-fake↔COM-019(결함 PR·PATTERN.md·예시·선택 평가). COM-018을 잡는 웹훅 테스트를 정상 버전에 추가 | skills/gimi-test/patterns·evals·evals/shop-fixture | 사용자 결정 — 백엔드 결제 묶음, 패턴·결함 짝마다 커밋 |
| 2026-10-24 | 테스트 패턴 3단계 — 프론트 화면 묶음 async-ui-states↔COM-015·user-interaction↔KCL-005·race-and-duplicate↔COM-028(결함 PR·PATTERN.md·예시·선택 평가). external-api-fake description 보완 | skills/gimi-test/patterns·evals·evals/shop-fixture | 제안한 프론트 화면 묶음에 사용자가 "진행". 커밋은 2단계와 같이 짝마다 |
| 2026-10-24 | 테스트 패턴 — 백엔드 나머지 db-integration↔missing-ownership·api-contract↔COM-024(결함 PR·PATTERN.md·예시·선택 평가). 예제 저장소 server에 개발 의존성 ajv·yaml | skills/gimi-test/patterns·evals·evals/shop-fixture | 사용자 요청 — "남은것들도 각각 진행해서 pr올려줘" |
| 2026-10-24 | 테스트 패턴 — fake-time↔COM-012(결함 PR·PATTERN.md·예시·선택 평가). 정상 버전의 테스트가 못 잡는 결함이라 패턴 예시로만 확인 | skills/gimi-test/patterns·evals·evals/shop-fixture | 사용자 요청 — "남은것들도 각각 진행해서 pr올려줘" |
| 2026-10-24 | 테스트 패턴 — 맥락 결함 requirement-cases↔COM-029(의도)·regression-first↔HIST-001(이력). 결함 PR의 history(평가용 저장소 main에 예전 커밋), 정상 버전에 새벽 배송 재현 테스트 | scripts·skills/gimi-test/patterns·evals·evals/shop-fixture·tests | 사용자 요청 — "남은것들도 각각 진행해서 pr올려줘". history 형식은 제가 정했다 |
| 2026-10-24 | 테스트 패턴 — 바탕 test-principles↔COM-003·test-audit(check.mjs 규칙표, 예시는 검사기로 검증). 모든 좋은 예시에 check.mjs 지적이 없는지 보는 테스트 | skills/gimi-test/patterns·evals·evals/shop-fixture·tests | 사용자 요청 — "남은것들도 각각 진행해서 pr올려줘". test-audit 검증 방식은 제가 정했다 |
