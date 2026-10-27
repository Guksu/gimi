import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyEvidence, evidenceText, parseEvidence, renderSlopTable, replaceSlopBlock, SLOP_TABLE_END, SLOP_TABLE_START } from '../scripts/lib/slop-table.mjs'

const RULES = `<!-- @shared test.md origin: gimi-test -->
# 테스트 금지선

## test/no-assertion 단언이 없는 테스트를 쓰지 않는다
- 대상: 둘 다
- 왜: 늘 통과한다
- 검사: error
- 근거: 측정 전

## test/real-wait 실제 시간을 기다리지 않는다
- 대상: 둘 다
- 검사: warn
- 근거: 측정 전

## test/mock-echo mock이 돌려준 값을 그대로 단언하지 않는다
- 대상: 둘 다
- 검사: warn
- 근거: 측정 전
`

describe('evidenceText·parseEvidence — 근거의 "N번 중 M번"', () => {
  it('gimi 없이·있이를 함께 적고 다시 읽는다. 측정 전은 null', () => {
    const text = evidenceText({ date: '2026-10-27', without: 3, with: 0, runs: { without: 24, with: 24 } })
    assert.equal(text, '측정 2026-10-27 — gimi 없이 24번 중 3번 · gimi 있이 24번 중 0번')
    assert.deepEqual(parseEvidence(text), { date: '2026-10-27', without: 3, with: 0, runs: { without: 24, with: 24 } })
    assert.equal(parseEvidence('측정 전'), null)
  })
})

describe('applyEvidence — 규칙 파일의 근거 줄만 바꾼다', () => {
  it('측정한 줄마다 근거를 바꾸고, 나오지 않은 줄은 0번으로 적는다. 다른 줄은 그대로다', () => {
    const results = { date: '2026-10-27', runs: { without: 24, with: 24 }, rules: [{ id: 'test/no-assertion', without: 5, with: 1 }] }
    const out = applyEvidence({ text: RULES, results })
    assert.match(out, /## test\/no-assertion[^]*?- 근거: 측정 2026-10-27 — gimi 없이 24번 중 5번 · gimi 있이 24번 중 1번\n/)
    assert.match(out, /## test\/real-wait[^]*?- 근거: 측정 2026-10-27 — gimi 없이 24번 중 0번 · gimi 있이 24번 중 0번\n/)
    assert.equal(out.replace(/- 근거: .*\n/g, ''), RULES.replace(/- 근거: .*\n/g, ''))
  })
})

describe('renderSlopTable·replaceSlopBlock — SKILL.md의 금지선 표', () => {
  const results = { date: '2026-10-27', runs: { without: 24, with: 24 }, rules: [{ id: 'test/no-assertion', without: 5, with: 1 }, { id: 'test/mock-echo', without: 5, with: 0 }, { id: 'test/real-wait', without: 0, with: 2 }] }
  const ruleText = applyEvidence({ text: RULES, results })

  it('gimi 없이 한 번 이상 나온 줄만, 많이 나온 순(같으면 ID 순)으로 표를 만든다', () => {
    const block = renderSlopTable({ files: [{ area: 'test', text: ruleText }] })
    assert.equal(
      block,
      [
        SLOP_TABLE_START,
        '| 줄 | gimi 없이 | gimi 있이 |',
        '|---|---|---|',
        '| `test/mock-echo` mock이 돌려준 값을 그대로 단언하지 않는다 | 24번 중 5번 | 24번 중 0번 |',
        '| `test/no-assertion` 단언이 없는 테스트를 쓰지 않는다 | 24번 중 5번 | 24번 중 1번 |',
        SLOP_TABLE_END,
      ].join('\n'),
    )
  })

  it('측정한 줄이 없으면 표 대신 측정 전이라고 쓴다. 표시가 없으면 null', () => {
    assert.match(renderSlopTable({ files: [{ area: 'test', text: RULES }] }), /측정 전/)
    const document = `앞\n${SLOP_TABLE_START}\n옛 표\n${SLOP_TABLE_END}\n뒤\n`
    assert.equal(replaceSlopBlock({ document, block: `${SLOP_TABLE_START}\n새 표\n${SLOP_TABLE_END}` }), `앞\n${SLOP_TABLE_START}\n새 표\n${SLOP_TABLE_END}\n뒤\n`)
    assert.equal(replaceSlopBlock({ document: '표시 없음', block: 'x' }), null)
  })
})
