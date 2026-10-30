# gimi

기미(氣味)상궁이 임금의 수라를 먼저 맛보듯, 코드를 올리기 전에 먼저 맛보는 Claude Code·Codex 코드 리뷰 스킬입니다.

- **gimi-review** — diff 밖의 맥락(바뀐 코드를 쓰는 곳, 티켓의 요구사항, 그 줄을 예전에 넣은 이유)까지 모아 근거가 있는 지적만 남깁니다. 팀 규칙과 분야 프리셋(커머스·국내 전자상거래 법령)으로도 봅니다.

> 지금은 구현을 시작한 단계(0.0.1)입니다. 설치해도 아직 쓸 만한 기능이 없습니다. 설계는 [docs/design/2026-10-19-gimi.md](docs/design/2026-10-19-gimi.md)에 있습니다.

## 설치

아직 기능이 거의 없습니다. 구조를 확인하려는 경우에만 설치하세요.

**Claude Code** — 대화창에서:

```text
/plugin install gimi --marketplace Guksu/gimi
```

**Codex** — 터미널에서:

```bash
codex plugin marketplace add Guksu/gimi
codex plugin add gimi@gimi
```

## 개발

Node.js 22 이상이 필요합니다. 스킬과 함께 설치되는 스크립트에는 런타임 의존성이 없습니다. `typescript`는 테스트에서만 씁니다(맥락 수집은 리뷰하는 프로젝트의 `typescript`를 씁니다).

```bash
npm ci            # 개발 의존성 설치
npm test          # 단위·통합 테스트 (node:test)
npm run validate  # 스킬 구조 검사 + 트리거 평가
```

## 라이선스

[MIT](LICENSE) © 2026 Guksu
