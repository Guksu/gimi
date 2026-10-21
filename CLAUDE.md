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
