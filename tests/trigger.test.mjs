import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateTrigger, validateSpec } from '../scripts/lib/trigger.mjs'

const docs = [
  { name: 'gimi-review', description: '코드 리뷰 영향 범위 요구사항' },
  { name: 'gimi-test', description: '테스트 작성 경계값 동시성' },
  { name: 'layout', description: '화면 레이아웃 여백' },
]

describe('evaluateTrigger', () => {
  it('should는 대상이 0점보다 크고 혼자 1위일 때 통과한다', () => {
    const result = evaluateTrigger({ target: 'gimi-review', docs, should: ['영향 범위 리뷰'], shouldNot: [] })
    assert.equal(result.passed, 1)
    assert.equal(result.total, 1)
    assert.deepEqual(result.failures, [])
  })

  it('should에서 다른 스킬이 1위면 실패로 남기고 1위 이름을 적는다', () => {
    const result = evaluateTrigger({ target: 'gimi-review', docs, should: ['경계값 테스트 작성'], shouldNot: [] })
    assert.equal(result.passed, 0)
    assert.equal(result.failures.length, 1)
    assert.equal(result.failures[0].kind, 'should')
    assert.match(result.failures[0].detail, /gimi-test/)
  })

  it('should에서 1위가 동점이면 실패한다', () => {
    const tied = [
      { name: 'gimi-review', description: '리뷰' },
      { name: 'other', description: '리뷰' },
      { name: 'third', description: '여백' },
    ]
    const result = evaluateTrigger({ target: 'gimi-review', docs: tied, should: ['리뷰'], shouldNot: [] })
    assert.equal(result.passed, 0)
  })

  it('shouldNot은 대상이 0점이거나 1위가 아니면 통과한다', () => {
    const result = evaluateTrigger({ target: 'gimi-review', docs, should: [], shouldNot: ['경계값 테스트', '아무 관계 없는 말'] })
    assert.equal(result.passed, 2)
  })

  it('shouldNot에서 대상이 1위면 실패한다', () => {
    const result = evaluateTrigger({ target: 'gimi-review', docs, should: [], shouldNot: ['요구사항 리뷰'] })
    assert.equal(result.passed, 0)
    assert.equal(result.failures[0].kind, 'shouldNot')
  })

  it('contested는 대상이 1위 동점 안에 있으면 통과하고, 동점이면 경고를 남긴다', () => {
    const tied = [
      { name: 'gimi-review', description: '코드 리뷰' },
      { name: 'code-review', description: '코드 리뷰' },
      { name: 'third', description: '여백' },
    ]
    const result = evaluateTrigger({ target: 'gimi-review', docs: tied, should: [], shouldNot: [], contested: ['코드 리뷰'] })
    assert.equal(result.passed, 1)
    assert.equal(result.total, 1)
    assert.equal(result.warnings.length, 1)
    assert.match(result.warnings[0], /code-review/)
  })

  it('contested에서 대상이 지면 실패한다', () => {
    const result = evaluateTrigger({ target: 'gimi-review', docs, should: [], shouldNot: [], contested: ['경계값 테스트'] })
    assert.equal(result.passed, 0)
    assert.equal(result.failures[0].kind, 'contested')
  })

  it('통과한 should마다 2위와의 점수 차를 남긴다', () => {
    const result = evaluateTrigger({ target: 'gimi-test', docs, should: ['동시성 테스트'], shouldNot: [] })
    assert.equal(result.margins.length, 1)
    assert.ok(result.margins[0].margin > 0)
  })
})

describe('validateSpec', () => {
  it('should 8개·shouldNot 6개보다 적으면 오류를 낸다', () => {
    const errors = validateSpec({ spec: { skill: 'gimi-review', should: ['a'], shouldNot: [] } })
    assert.equal(errors.length, 2)
  })

  it('contested 질의가 should·shouldNot에도 있으면 오류를 낸다', () => {
    const should = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const shouldNot = ['x', 'y', 'z', 'u', 'v', 'w']
    const errors = validateSpec({ spec: { skill: 'gimi-review', should, shouldNot, contested: ['a'] } })
    assert.equal(errors.length, 1)
  })

  it('같은 질의가 should와 shouldNot에 함께 있으면 오류를 낸다', () => {
    const should = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const shouldNot = ['a', 'x', 'y', 'z', 'u', 'v']
    const errors = validateSpec({ spec: { skill: 'gimi-review', should, shouldNot } })
    assert.equal(errors.length, 1)
    assert.match(errors[0], /"a"/)
  })
})
