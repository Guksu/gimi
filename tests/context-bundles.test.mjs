import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { staleBundles } from '../skills/gimi-review/scripts/lib/bundles.mjs'

describe('staleBundles — 같은 PR·브랜치의 예전 맥락 묶음(설계 결정 54)', () => {
  it('이름이 정확히 같은 {날짜}-{이름}.context.json만 고른다 — 새로 쓴 파일과 리뷰 기록(.md)은 남긴다', () => {
    const files = [
      '2026-10-28-pr-4.context.json',
      '2026-10-29-pr-4.context.json',
      '2026-10-30-pr-4.context.json',
      '2026-10-29-pr-42.context.json',
      '2026-10-29-feature-pr-4.context.json',
      '2026-10-29-pr-4.md',
      'notes-pr-4.context.json',
    ]
    assert.deepEqual(staleBundles({ files, name: 'pr-4', keep: '2026-10-30-pr-4.context.json' }), ['2026-10-28-pr-4.context.json', '2026-10-29-pr-4.context.json'])
  })

  it('이름의 점은 글자 그대로 비교한다', () => {
    const files = ['2026-10-29-v1.2.context.json', '2026-10-29-v1x2.context.json']
    assert.deepEqual(staleBundles({ files, name: 'v1.2', keep: '2026-10-30-v1.2.context.json' }), ['2026-10-29-v1.2.context.json'])
  })
})
