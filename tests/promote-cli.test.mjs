import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeRepo } from './helpers/repo.mjs'

const CLI = fileURLToPath(new URL('../skills/gimi-review/scripts/promote.mjs', import.meta.url))
const run = ({ cwd, args = [] }) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' })
const withRepo = (files, fn) => {
  const repo = makeRepo()
  try {
    repo.write({ 'README.md': 'x\n', ...files })
    return fn(repo)
  } finally {
    repo.cleanup()
  }
}
const record = (...rules) => ['# 리뷰', '', ...rules.flatMap((rule, i) => [`## ${i + 1}. [고쳐야 함] 영향 범위 — 지적`, `- 규칙: ${rule}`, '- 판정: 미정', ''])].join('\n')

describe('promote.mjs — 반복 지적을 규칙 후보로', () => {
  const reviews = {
    'docs/gimi/reviews/2026-11-01-pr-1.md': record('없음 — 묶음 api-shape', '없음 — 묶음 order-transition'),
    'docs/gimi/reviews/2026-11-02-pr-2.md': record('없음 — 묶음 api-shape', '없음 — 묶음 order-transition'),
    'docs/gimi/reviews/2026-11-03-feat-x.md': record('없음 — 묶음 api-shape', 'COM-003', '없음 — 묶음 order-transition', '없음'),
    'docs/gimi/reviews/2026-11-03-feat-x.context.json': '{}',
    'docs/gimi/candidates.md': '# 규칙 후보\n\n## SHOP-007 주문 상태는 한 곳에서만 바꾼다\n- 상태: 대기\n- 묶음: order-transition\n',
  }

  it('기준(기본 리뷰 3건)에 닿은 묶음과 출처, 이미 후보인 묶음, 형식 어김을 보인다', () => {
    withRepo(reviews, (repo) => {
      const result = run({ cwd: repo.dir })
      assert.equal(result.status, 0, result.stderr)
      const lines = result.stdout.trimEnd().split('\n')
      assert.equal(lines[0], '묶음      기준 리뷰 3건 · 리뷰 기록 3개 · 규칙 없는 지적 6개(틀림·의도함 0개 뺌)')
      assert.ok(lines.includes('후보로 올릴 것'), result.stdout)
      assert.ok(lines.includes('  api-shape  리뷰 3건 — docs/gimi/reviews/2026-11-01-pr-1.md#1, docs/gimi/reviews/2026-11-02-pr-2.md#1, docs/gimi/reviews/2026-11-03-feat-x.md#1'), result.stdout)
      assert.ok(lines.includes('이미 후보·규칙'), result.stdout)
      assert.ok(lines.includes('  order-transition  리뷰 3건 — docs/gimi/candidates.md'), result.stdout)
      assert.ok(lines.includes('형식 어김  지적 1개 — docs/gimi/reviews/2026-11-03-feat-x.md#4(묶음 이름이 없거나 형식이 틀림)'), result.stdout)
    })
  })

  it('설정 promoteAfter를 따르고, 쓸 수 없는 값이면 기본값으로 알린다', () => {
    withRepo({ ...reviews, '.agents/gimi.json': JSON.stringify({ promoteAfter: 4 }) }, (repo) => {
      const result = run({ cwd: repo.dir })
      assert.match(result.stdout, /^묶음 {6}기준 리뷰 4건/)
      assert.match(result.stdout, /^후보로 올릴 것 {2}없음$/m)
      assert.match(result.stdout, /^쌓이는 중\n {2}api-shape {2}리뷰 3건/m)
    })
    for (const value of [0, 'x', 2.5]) {
      withRepo({ ...reviews, '.agents/gimi.json': JSON.stringify({ promoteAfter: value }) }, (repo) => {
        const result = run({ cwd: repo.dir })
        assert.match(result.stdout, /^묶음 {6}기준 리뷰 3건/)
        assert.match(result.stdout, /^참고 {4}설정의 promoteAfter는 1 이상의 정수다 — 기본값 3으로 셌다$/m)
      })
    }
  })

  it('회사 규칙(docs/gimi/rules.md)에 "- 묶음:"으로 남은 묶음도 다시 올리지 않는다', () => {
    withRepo({ ...reviews, 'docs/gimi/rules.md': '# 회사 규칙\n\n## SHOP-009 응답 모양\n- 왜: x\n- 대신: y\n- 확인: z\n- 묶음: api-shape\n' }, (repo) => {
      const result = run({ cwd: repo.dir })
      assert.match(result.stdout, /^ {2}api-shape {2}리뷰 3건 — docs\/gimi\/rules\.md$/m)
      assert.match(result.stdout, /^후보로 올릴 것 {2}없음$/m)
    })
  })

  it('리뷰 기록이 없으면 없다고 알리고 0으로 끝난다', () => {
    withRepo({}, (repo) => {
      const result = run({ cwd: repo.dir })
      assert.equal(result.status, 0)
      assert.match(result.stdout, /^묶음 {6}기준 리뷰 3건 · 리뷰 기록 0개 · 규칙 없는 지적 0개\(틀림·의도함 0개 뺌\)$/m)
      assert.match(result.stdout, /^후보로 올릴 것 {2}없음$/m)
    })
  })

  it('--json이면 묶음·출처·형식 어김을 JSON으로 낸다', () => {
    withRepo(reviews, (repo) => {
      const json = JSON.parse(run({ cwd: repo.dir, args: ['--json'] }).stdout)
      assert.equal(json.threshold, 3)
      assert.equal(json.records, 3)
      assert.deepEqual(json.bundles.map((b) => [b.name, b.status, b.reviews]), [['api-shape', 'reached', 3], ['order-transition', 'known', 3]])
      assert.deepEqual(json.malformed, [{ path: 'docs/gimi/reviews/2026-11-03-feat-x.md', finding: 4, problem: '묶음 이름이 없거나 형식이 틀림' }])
    })
  })

  it('모르는 옵션이면 사용법을 보이고 2로 끝낸다', () => {
    withRepo({}, (repo) => {
      const result = run({ cwd: repo.dir, args: ['--nope'] })
      assert.equal(result.status, 2)
      assert.match(result.stderr, /사용: node promote\.mjs/)
    })
  })
})
