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
