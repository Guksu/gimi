import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeRepo } from './helpers/repo.mjs'

const CLI = fileURLToPath(new URL('../skills/gimi-review/scripts/rules.mjs', import.meta.url))
const run = ({ cwd, args = [] }) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' })
const withRepo = (files, fn) => {
  const repo = makeRepo()
  try {
    repo.write({ 'README.md': 'x\n', ...files })
    repo.commit('feat: 처음')
    return fn(repo)
  } finally {
    repo.cleanup()
  }
}
const COMPANY = `# 회사 규칙

## SHOP-001 금액은 정수 원 단위로만 계산한다
- 왜: 1원이 어긋났다(#412)
- 대신: toWon()으로 정수화한다
- 확인: 영향 범위 — price·amount의 곱셈
- 경계값:
  - 프론트: 0원
  - 백엔드: 1/3

## 끈 프리셋 규칙
- COM-004 — 쿠폰 표시는 디자인 시스템이 맡는다
- KCL-006
`

describe('rules.mjs — 설정에 맞는 규칙만 보이기', () => {
  it('설정에 stacks가 없으면 저장소를 보고 정한다 — 프론트 의존성만 있으면 백엔드 줄은 빼고 프론트·둘 다만 한 줄씩 보인다', () => {
    withRepo({ 'web/package.json': JSON.stringify({ dependencies: { react: '^19.0.0' } }) }, (repo) => {
      const result = run({ cwd: repo.dir })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /^규칙 {6}stacks frontend-ts \(설정 없음 — 추정: web\/package\.json의 react\) · 프리셋 없음 · 회사 규칙 없음$/m)
      assert.match(result.stdout, /^ {2}test\/only-left {2}\.only·fit을 남기지 않는다 {2}\[둘 다 · 검사 리뷰\]$/m)
      assert.match(result.stdout, /^ {2}test\/implementation-detail /m)
      assert.doesNotMatch(result.stdout, /test\/mock-repository|code\/n-plus-one/)
      assert.doesNotMatch(result.stdout, /^프리셋/m)
    })
  })

  it('백엔드 의존성이 있으면 백엔드 줄도 보이고, 신호가 없으면 둘 다 보인다', () => {
    const files = { 'server/package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^11.0.0' } }), 'web/src/App.tsx': 'export {}\n' }
    withRepo(files, (repo) => {
      const { stdout } = run({ cwd: repo.dir })
      assert.match(stdout, /^규칙 {6}stacks frontend-ts·backend \(설정 없음 — 추정: web\/src\/App\.tsx 같은 \.tsx 파일, server\/package\.json의 @nestjs\/core\) · /m)
      assert.match(stdout, /code\/n-plus-one/)
    })
    withRepo({}, (repo) => {
      const { stdout } = run({ cwd: repo.dir })
      assert.match(stdout, /^규칙 {6}stacks frontend-ts·backend \(설정 없음 — 프론트·백엔드 신호를 못 찾아 둘 다\) · /m)
      assert.match(stdout, /test\/mock-repository/)
    })
  })

  it('git이 아닌 곳에서도 죽지 않고 둘 다 보인다. 설정의 stacks가 비었거나 모르는 값이면 알리고 저장소를 보고 정한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gimi-rules-'))
    try {
      writeFileSync(join(dir, 'a.tsx'), 'x\n')
      const result = run({ cwd: dir })
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /^규칙 {6}stacks frontend-ts·backend \(설정 없음 — 프론트·백엔드 신호를 못 찾아 둘 다\)/m)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    withRepo({ '.agents/gimi.json': JSON.stringify({ stacks: [] }) }, (repo) => {
      assert.match(run({ cwd: repo.dir }).stdout, /^규칙 {6}stacks frontend-ts·backend \(설정 없음 — /m)
    })
    withRepo({ '.agents/gimi.json': JSON.stringify({ stacks: ['frontend', 'backend'] }) }, (repo) => {
      const { stdout } = run({ cwd: repo.dir })
      assert.match(stdout, /^규칙 {6}stacks backend · /m)
      assert.match(stdout, /^참고 {6}설정의 stacks에 모르는 값 frontend이 있다 — frontend-ts·backend 중에서 적는다$/m)
    })
    withRepo({ '.agents/gimi.json': JSON.stringify({ stacks: 'backend' }) }, (repo) => {
      const { stdout } = run({ cwd: repo.dir })
      assert.match(stdout, /^규칙 {6}stacks frontend-ts·backend \(설정을 쓸 수 없음 — /m)
      assert.match(stdout, /^참고 {6}설정의 stacks가 목록이 아니다/m)
    })
  })

  it('package.json이 아주 많아 다 읽지 못했는데 한쪽만 찾았으면 둘 다 보인다', () => {
    const files = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`packages/p${String(i).padStart(3, '0')}/package.json`, JSON.stringify({ dependencies: { react: '1' } })]))
    withRepo(files, (repo) => {
      assert.match(run({ cwd: repo.dir }).stdout, /^규칙 {6}stacks frontend-ts·backend \(설정 없음 — 추정: packages\/p000\/package\.json의 react, package\.json을 다 읽지 못함\)/m)
    })
  })

  it('설정에 presets가 없으면 분야 프리셋을 쓰지 않았다고 알린다 — 설정에서 비워 둔 것([])은 알리지 않는다', () => {
    withRepo({}, (repo) => {
      assert.match(run({ cwd: repo.dir }).stdout, /^참고 {6}설정에 presets가 없어 분야 프리셋\(commerce·kr-commerce-law\)을 쓰지 않았다 — 리뷰 기록의 건너뛴 맥락에 적는다\(켜는 것은 사용자가 "도메인 규칙 설정해줘"로 한다\)$/m)
    })
    withRepo({ '.agents/gimi.json': JSON.stringify({ stacks: ['backend'], presets: [] }) }, (repo) => {
      const { stdout } = run({ cwd: repo.dir })
      assert.match(stdout, /^규칙 {6}stacks backend · 프리셋 없음 · 회사 규칙 없음$/m)
      assert.doesNotMatch(stdout, /presets가 없어/)
    })
  })

  it('설정의 stacks·presets와 회사 규칙을 반영한다 — 이유를 단 끈 규칙은 빼고, 이유 없는 줄은 끄지 않고 알린다', () => {
    const config = JSON.stringify({ stacks: ['frontend-ts', 'backend'], presets: ['commerce', 'kr-commerce-law'] })
    withRepo({ '.agents/gimi.json': config, 'docs/gimi/rules.md': COMPANY }, (repo) => {
      const { stdout } = run({ cwd: repo.dir })
      assert.match(stdout, /^규칙 {6}stacks frontend-ts·backend · 프리셋 commerce·kr-commerce-law · 회사 규칙 docs\/gimi\/rules\.md 1개$/m)
      assert.match(stdout, /code\/n-plus-one/)
      assert.match(stdout, /^프리셋 commerce {2}28개 · 끈 규칙 1개$/m)
      assert.doesNotMatch(stdout, /^ {2}COM-004 /m)
      assert.match(stdout, /^ {2}KCL-006 /m)
      assert.match(stdout, /^참고 {6}docs\/gimi\/rules\.md:13 KCL-006 — 끈 이유가 없어 끄지 않았다/m)
      assert.match(stdout, /^회사 규칙 {2}1개$/m)
      assert.match(stdout, /^ {2}SHOP-001 {2}금액은 정수 원 단위로만 계산한다 {2}\[둘 다\]$/m)
    })
  })

  it('kr-commerce-law의 해석 값(kcl)이 설정되지 않았으면 해석이 든 규칙을 확인 질문으로 올리라고 알린다', () => {
    withRepo({ '.agents/gimi.json': JSON.stringify({ presets: ['kr-commerce-law'] }) }, (repo) => {
      const { stdout } = run({ cwd: repo.dir })
      assert.match(stdout, /^참고 {6}kr-commerce-law의 해석 값\(kcl\.periodCounting·kcl\.businessDays\)이 설정되지 않았다 — KCL-001.*확인 질문/m)
    })
    withRepo({ '.agents/gimi.json': JSON.stringify({ presets: ['kr-commerce-law'], kcl: { periodCounting: 'civil-code', businessDays: 'docs/gimi/business-days.json' } }) }, (repo) => {
      assert.doesNotMatch(run({ cwd: repo.dir }).stdout, /해석 값/)
    })
  })

  it('모르는 프리셋은 알린다. --area로 공통 금지선의 영역을 고른다', () => {
    withRepo({ '.agents/gimi.json': JSON.stringify({ presets: ['banking'] }) }, (repo) => {
      const { stdout } = run({ cwd: repo.dir, args: ['--area', 'test,review'] })
      assert.match(stdout, /^참고 {6}프리셋 banking이 없다 — 있는 프리셋은 commerce·kr-commerce-law다$/m)
      assert.match(stdout, /review\/diff-only/)
      assert.doesNotMatch(stdout, /code\//)
      assert.match(run({ cwd: repo.dir, args: ['--area', 'done'] }).stderr, /모르는 영역 done/)
    })
  })
})

describe('rules.mjs — 전문과 경계값', () => {
  it('--id는 그 규칙의 절을 그대로 보인다 — 거른 것과 상관없이 어느 출처에서든 찾는다', () => {
    withRepo({ 'docs/gimi/rules.md': COMPANY }, (repo) => {
      const { stdout, status } = run({ cwd: repo.dir, args: ['--id', 'COM-003,SHOP-001,code/n-plus-one'] })
      assert.equal(status, 0)
      assert.match(stdout, /^## COM-003 결제 금액은 서버가 계산·저장하고/m)
      assert.match(stdout, /^## SHOP-001 금액은 정수 원 단위로만 계산한다\n- 왜: 1원이 어긋났다\(#412\)/m)
      assert.match(stdout, /^## code\/n-plus-one /m)
    })
  })

  it('--id에 없는 ID가 있으면 종료 코드 1이다', () => {
    withRepo({}, (repo) => {
      const result = run({ cwd: repo.dir, args: ['--id', 'COM-999'] })
      assert.equal(result.status, 1)
      assert.match(result.stderr, /COM-999/)
    })
  })

  it('--boundaries는 프리셋·회사 규칙의 경계값 가운데 stacks에 맞는 층만 보인다', () => {
    withRepo({ '.agents/gimi.json': JSON.stringify({ stacks: ['frontend-ts'], presets: ['commerce'] }), 'docs/gimi/rules.md': COMPANY }, (repo) => {
      const { stdout } = run({ cwd: repo.dir, args: ['--boundaries'] })
      assert.match(stdout, /^ {2}COM-001 금액은 통화의 최소 단위 정수로 다루고 통화 코드를 함께 둔다\n {4}프론트: 999원의 10% 할인 표시$/m)
      assert.doesNotMatch(stdout, /백엔드: 1\/3 나눗셈/)
      assert.match(stdout, /^ {2}SHOP-001 .*\n {4}프론트: 0원$/m)
    })
  })

  it('--json은 거른 규칙과 참고, 추정한 stacks의 근거를 담는다', () => {
    withRepo({ '.agents/gimi.json': JSON.stringify({ stacks: ['frontend-ts'] }) }, (repo) => {
      const report = JSON.parse(run({ cwd: repo.dir, args: ['--json'] }).stdout)
      assert.equal(report.stacksGuess, null)
      assert.ok(report.notes.some((note) => note.startsWith('설정에 presets가 없어')))
    })
    withRepo({ '.agents/gimi.json': JSON.stringify({ presets: ['commerce'] }), 'web/package.json': JSON.stringify({ dependencies: { vue: '3' } }) }, (repo) => {
      const report = JSON.parse(run({ cwd: repo.dir, args: ['--json'] }).stdout)
      assert.deepEqual(report.stacks, ['frontend-ts'])
      assert.deepEqual(report.stacksGuess, { evidence: ['web/package.json의 vue'] })
      assert.ok(report.rules.some((r) => r.id === 'COM-001' && r.source === 'commerce' && r.target === '둘 다'))
      assert.ok(report.rules.some((r) => r.id === 'test/only-left' && r.check === '리뷰'))
    })
  })
})
