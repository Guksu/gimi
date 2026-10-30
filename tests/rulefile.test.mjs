import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { checkRuleFile, matchesStacks, parseRuleFile } from '../skills/gimi-review/scripts/lib/rulefile.mjs'

const SLOP = `# 테스트 금지선

머리 글은 규칙이 아니다.

## test/only-left .only·fit을 남기지 않는다
- 대상: 둘 다
- 왜: 다른 테스트가 돌지 않는다
- 대신: 지운다
- 확인: it.only·fit
- 검사: 리뷰
- 근거: 측정 전

## test/real-wait 실제 시간을 기다리지 않는다
- 대상: 프론트
- 왜: 느리고
  가끔 깨진다
- 대신: 가짜 타이머
- 확인: setTimeout
- 검사: 기록
- 근거: 측정 전
`

const PRESET = `# commerce

## 금액

## COM-001 금액은 최소 단위 정수로 다룬다
- 대상: 둘 다
- 왜: 오차
- 대신: 정수
- 확인: toFixed
- 경계값:
  - 프론트: 999원의 10% 할인
  - 백엔드: 1/3 나눗셈
- 근거:
  - Stripe 통화 https://docs.stripe.com/currencies

## COM-002 반올림은 한 함수에서
- 대상: 백엔드
- 왜: 1원 차이
- 대신: 함수 하나
- 확인: Math.round
- 경계값:
  - 백엔드: 1000 ÷ 3
- 근거: 출처 없음 — 도메인 관례
`

describe('parseRuleFile', () => {
  it('## ID 한 줄 절과 - 이름: 값 항목을 읽는다 — 이어지는 줄은 값에 붙고, ID가 아닌 ## 제목은 묶음 제목이다', () => {
    const file = parseRuleFile(SLOP)
    assert.deepEqual(file.rules.map((r) => [r.id, r.title, r.line]), [
      ['test/only-left', '.only·fit을 남기지 않는다', 5],
      ['test/real-wait', '실제 시간을 기다리지 않는다', 13],
    ])
    assert.equal(file.rules[1].items.get('왜').value, '느리고 가끔 깨진다')
    assert.equal(file.rules[0].items.get('검사').value, '리뷰')
  })

  it('들여쓴 하위 줄(경계값의 프론트·백엔드, 근거 목록)은 항목의 목록으로 읽는다', () => {
    const [first, second] = parseRuleFile(PRESET).rules
    assert.deepEqual(first.items.get('경계값').list, ['프론트: 999원의 10% 할인', '백엔드: 1/3 나눗셈'])
    assert.deepEqual(first.items.get('근거').list, ['Stripe 통화 https://docs.stripe.com/currencies'])
    assert.equal(second.items.get('근거').value, '출처 없음 — 도메인 관례')
    assert.deepEqual(parseRuleFile(PRESET).groups.map((g) => g.title), ['금액'])
  })

  it('"끈 프리셋 규칙" 절의 줄을 ID와 이유로 읽는다 — 이유가 없으면 이유는 빈 문자열이다', () => {
    const file = parseRuleFile('## SHOP-001 정수 원\n- 왜: a\n- 대신: b\n- 확인: c\n\n## 끈 프리셋 규칙\n- COM-004 — 쿠폰 중복은 서버에서만 막는다\n- KCL-006\n')
    assert.deepEqual(file.disabled, [
      { id: 'COM-004', reason: '쿠폰 중복은 서버에서만 막는다', line: 7 },
      { id: 'KCL-006', reason: '', line: 8 },
    ])
    assert.deepEqual(file.rules.map((r) => r.id), ['SHOP-001'])
  })
})

describe('checkRuleFile', () => {
  it('형식이 맞으면 오류가 없다', () => {
    assert.deepEqual(checkRuleFile({ path: 'shared/rules/test.md', text: SLOP, kind: 'slop', area: 'test' }), [])
    assert.deepEqual(checkRuleFile({ path: 'shared/domains/commerce/rules.md', text: PRESET, kind: 'preset', prefix: 'COM' }), [])
  })

  it('필수 항목이 빠지거나, ID가 겹치거나, 영역·머리가 다르면 오류다', () => {
    const broken = `${SLOP.replace('- 대신: 지운다\n', '')}\n## code/empty-catch 빈 catch\n- 대상: 둘 다\n- 왜: a\n- 대신: b\n- 확인: c\n- 검사: 리뷰\n- 근거: 측정 전\n\n## test/only-left 다시\n- 대상: 둘 다\n- 왜: a\n- 대신: b\n- 확인: c\n- 검사: 리뷰\n- 근거: 측정 전\n`
    const errors = checkRuleFile({ path: 'shared/rules/test.md', text: broken, kind: 'slop', area: 'test' })
    assert.ok(errors.some((e) => /test\/only-left.*대신/.test(e)))
    assert.ok(errors.some((e) => /code\/empty-catch.*test 영역/.test(e)))
    assert.ok(errors.some((e) => /test\/only-left.*겹친다/.test(e)))
  })

  it('대상은 프론트·백엔드·둘 다로 시작하고, 슬롭의 검사는 리뷰·기록으로 시작한다 — 정적 검사(error·warn)는 없다(설계 결정 52)', () => {
    const errors = checkRuleFile({ path: 'shared/rules/test.md', text: SLOP.replace('- 대상: 프론트', '- 대상: 웹').replace('- 검사: 기록', '- 검사: 가끔'), kind: 'slop', area: 'test' })
    assert.ok(errors.some((e) => /test\/real-wait.*대상/.test(e)))
    assert.ok(errors.some((e) => /test\/real-wait.*검사/.test(e)))
    const old = checkRuleFile({ path: 'shared/rules/test.md', text: SLOP.replace('- 검사: 리뷰', '- 검사: error'), kind: 'slop', area: 'test' })
    assert.ok(old.some((e) => /test\/only-left.*검사는 리뷰·기록/.test(e)), old.join('\n'))
  })

  it('프리셋의 근거는 URL이나 "출처 없음"이 있어야 하고, "URL 확인 필요"가 남으면 오류다', () => {
    const errors = checkRuleFile({ path: 'p.md', text: PRESET.replace('출처 없음 — 도메인 관례', '가격표시제 실시요령. URL 확인 필요'), kind: 'preset', prefix: 'COM' })
    assert.ok(errors.some((e) => /COM-002.*URL 확인 필요/.test(e)))
    const noSource = checkRuleFile({ path: 'p.md', text: PRESET.replace('출처 없음 — 도메인 관례', '관례'), kind: 'preset', prefix: 'COM' })
    assert.ok(noSource.some((e) => /COM-002.*근거/.test(e)))
  })
})

describe('matchesStacks', () => {
  it('대상이 설정 stacks에 맞는지 — 둘 다는 늘, 프론트는 frontend-ts, 백엔드는 backend', () => {
    assert.equal(matchesStacks('둘 다', ['frontend-ts']), true)
    assert.equal(matchesStacks('프론트', ['frontend-ts']), true)
    assert.equal(matchesStacks('백엔드', ['frontend-ts']), false)
    assert.equal(matchesStacks('백엔드', ['frontend-ts', 'backend']), true)
    assert.equal(matchesStacks('둘 다(판정은 백엔드)', ['backend']), true)
    assert.equal(matchesStacks('프론트·백엔드: 기준 − 1', ['backend']), true)
  })
})
