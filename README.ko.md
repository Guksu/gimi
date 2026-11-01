# gimi

Claude Code나 Codex가 코드를 리뷰할 때 쓰는 스킬입니다. diff 밖의 맥락(바뀐 코드를 쓰는 곳, 티켓의 요구사항, 그 줄을 넣은 이유)을 먼저 모으고, 근거가 있는 지적만 남깁니다.

AI 리뷰는 diff 안에서만 판단해서, 사람이 리뷰하며 잡는 결함을 자주 놓쳤습니다. 바뀐 함수를 쓰는 다른 화면이나 티켓에 적힌 요구사항 같은 것입니다. 그 맥락을 먼저 모으는 리뷰를 하려고 gimi를 만들었습니다.

[English](README.md) · [설치](#설치) · [상세 안내](docs/guide.md) · [측정 결과](evals/review/README.md)

```text
[고쳐야 함] 영향 범위
주문 상태 형태가 바뀌었는데 배지는 예전 형태를 읽는다

바뀐 곳  src/api/order.ts:42
         status: string → { code, label }
근거    src/components/OrderBadge.tsx:12
         status === 'PAID'  (이 PR에서 안 바뀜)
상황    결제 완료 주문 → 배지가 항상 '알 수 없음'
```

예제 앱에 결함을 심은 PR 32개를 gimi와 Claude Code 내장 `/code-review`로 리뷰했습니다. 같은 모델·같은 지시로 돌렸습니다. 결함은 둘 다 거의 다 찾았고, 심은 결함이 아닌 곳을 짚은 지적은 `/code-review` 55개·gimi 19개였습니다. 그 지적이 틀렸다는 뜻은 아닙니다. PR마다 한 번씩 돌렸고, 리뷰 한 번에 gimi가 시간·비용이 약 1.3배 들었습니다. [측정 방법·전체 결과·한계](evals/review/README.md)

## 설치

**Claude Code** — 대화창에서 실행합니다.

```text
/plugin marketplace add Guksu/gimi
/plugin install gimi@gimi
```

**Codex** — 터미널에서 실행합니다.

```bash
codex plugin marketplace add Guksu/gimi
codex plugin add gimi@gimi
```

Node.js 22 이상과 리뷰할 git 저장소가 필요합니다. PR·이슈 본문을 읽으려면 GitHub CLI(`gh`)에 로그인해 둡니다.

[필요한 것과 설정](docs/guide.md#설치) · [업데이트](docs/guide.md#업데이트)

## 첫 요청

설치한 뒤 리뷰할 저장소에서 이렇게 요청해 보세요.

> gimi-review로 지금 브랜치를 리뷰해줘. 바뀐 API를 쓰는 화면이 깨지지 않는지, 이슈의 요구사항대로 됐는지도 봐줘.

에이전트가 리뷰 전에 바뀐 코드를 쓰는 곳, PR·이슈 본문, 바뀐 줄의 이력을 모읍니다. 그다음 근거 위치를 댈 수 있는 지적만 남기고, 전체를 `docs/gimi/reviews/`에 기록합니다. Claude Code에서는 `/gimi:gimi-review`로 직접 부를 수도 있습니다. 스킬과 규칙 문서는 한국어로 작성되어 있습니다.

커머스·국내 전자상거래 법령 규칙으로도 보려면 "도메인 규칙 설정해줘"라고 요청합니다. [설정](docs/guide.md#설정)

## 앞으로

직접 사용하면서 부족한 부분을 계속 고치고, 규칙과 맥락 수집도 꾸준히 넓힐 예정입니다. 사용해 보시고 불편한 점을 [이슈](https://github.com/Guksu/gimi/issues)로 알려주시면 개선에 반영하겠습니다.

[릴리스](https://github.com/Guksu/gimi/releases) · [바뀐 내용](CHANGELOG.md) · [측정 결과](evals/review/README.md) · [설계 문서](docs/design/2026-10-19-gimi.md)

[![CI](https://github.com/Guksu/gimi/actions/workflows/ci.yml/badge.svg)](https://github.com/Guksu/gimi/actions/workflows/ci.yml)
![Preset rules](https://img.shields.io/badge/gimi-43%20preset%20rules-1b1e24)
![Tests](https://img.shields.io/badge/tests-287%20passing-555555)
[![License: MIT](https://img.shields.io/badge/license-MIT-555555)](LICENSE)

## 라이선스

코드는 [MIT](LICENSE)입니다(© 2026 Guksu).
