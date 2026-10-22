import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CATALOG_END, CATALOG_START, checkPatternDoc, evaluatePatternSelection, parsePatternDoc, renderCatalog, replaceBlock } from '../scripts/lib/patterns.mjs'

const DESCRIPTION = '동시에 들어온 요청이 같은 자원(재고·1회용 쿠폰·포인트 잔액)을 두 번 쓰지 않는지 실제 DB로 테스트한다 — 같은 요청 N건을 한꺼번에 보내 성공 1건과 남은 수량을 단언한다. "동시성 테스트, 동시 주문, 재고 초과 판매" 요청에 쓴다.'
const doc = ({ name = 'concurrency', description = DESCRIPTION, target = '백엔드', body } = {}) =>
  [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    `target: ${target}`,
    '---',
    '',
    body ??
      [
        '# concurrency',
        '## 언제 쓰는가',
        '수량이 한정된 자원',
        '## 무엇을 단언하는가',
        '성공 1건',
        '## 예시',
        '`assets/stock-race.test.ts`와 `assets/stock-race.slop.test.ts`',
        '## AI가 흔히 쓰는 테스트 / 대신',
        '| 흔히 | 대신 |',
        '## Jest와 다른 줄',
        '없음',
        '## 주의사항',
        '격리',
        '## 다른 언어',
        'JUnit',
      ].join('\n'),
  ].join('\n')
const assets = ['stock-race.test.ts', 'stock-race.slop.test.ts']

describe('parsePatternDoc', () => {
  it('frontmatter의 name·description·target을 읽는다', () => {
    assert.deepEqual(parsePatternDoc(doc()), { name: 'concurrency', description: DESCRIPTION, target: '백엔드' })
  })
})

describe('checkPatternDoc — PATTERN.md 하나', () => {
  it('형식이 맞으면 오류가 없다 — 정해진 절 뒤에 절을 더할 수 있다', () => {
    assert.deepEqual(checkPatternDoc({ name: 'concurrency', md: doc(), assets }), [])
  })

  it('name은 폴더 이름, description은 80자 이상·1,024바이트 이하에 ": "가 없고, target은 프론트·백엔드·둘 다 중 하나다', () => {
    const errors = checkPatternDoc({ name: 'concurrency', md: doc({ name: 'race', description: '짧다: 너무', target: 'mobile' }), assets })
    for (const pattern of [/name\(race\)/, /description/, /": "/, /target/]) assert.ok(errors.some((e) => pattern.test(e)), `${pattern} — ${errors.join(' / ')}`)
  })

  it('본문 절은 언제 쓰는가 → 무엇을 단언하는가 → 예시 → AI가 흔히 쓰는 테스트 → Jest와 다른 줄 → 주의사항 순서다', () => {
    const swapped = doc({ body: ['## 무엇을 단언하는가', '## 언제 쓰는가', '## 예시', '`assets/stock-race.test.ts` `assets/stock-race.slop.test.ts`', '## AI가 흔히 쓰는 테스트', '## 주의사항'].join('\n') })
    const errors = checkPatternDoc({ name: 'concurrency', md: swapped, assets })
    assert.ok(errors.some((e) => /절 순서/.test(e)), errors.join(' / '))
    assert.ok(errors.some((e) => /Jest와 다른 줄.*없다/.test(e)), errors.join(' / '))
  })

  it('예시는 좋은 예시(*.test.ts)와 슬롭 예시(*.slop.test.ts)가 하나 이상씩 있고, 본문이 모두 가리키며, 가리킨 파일은 있어야 한다', () => {
    assert.ok(checkPatternDoc({ name: 'concurrency', md: doc(), assets: ['stock-race.test.ts'] }).some((e) => /슬롭 예시/.test(e)))
    const errors = checkPatternDoc({ name: 'concurrency', md: doc(), assets: [...assets, 'coupon-race.test.ts'] })
    assert.ok(errors.some((e) => /coupon-race\.test\.ts.*본문/.test(e)), errors.join(' / '))
    const missing = checkPatternDoc({ name: 'concurrency', md: doc().replace('`assets/stock-race.test.ts`', '`assets/nope.test.ts`'), assets })
    assert.ok(missing.some((e) => /없음 — assets\/nope\.test\.ts/.test(e)), missing.join(' / '))
  })
})

describe('renderCatalog·replaceBlock — SKILL.md의 패턴 카탈로그', () => {
  const patterns = [
    { name: 'concurrency', description: '동시 요청 | 재고', target: '백엔드' },
    { name: 'api-boundary', description: 'MSW로 응답마다', target: '프론트' },
    { name: 'domain-boundaries', description: '경계값 표', target: '둘 다' },
  ]

  it('표 한 줄에 패턴 하나 — 둘 다·프론트·백엔드 순, 링크는 PATTERN.md, 설명의 |는 이스케이프한다', () => {
    assert.equal(
      renderCatalog(patterns),
      [
        CATALOG_START,
        '| 패턴 | 대상 | 무엇을·언제 |',
        '|---|---|---|',
        '| [`domain-boundaries`](patterns/domain-boundaries/PATTERN.md) | 둘 다 | 경계값 표 |',
        '| [`api-boundary`](patterns/api-boundary/PATTERN.md) | 프론트 | MSW로 응답마다 |',
        '| [`concurrency`](patterns/concurrency/PATTERN.md) | 백엔드 | 동시 요청 \\| 재고 |',
        CATALOG_END,
      ].join('\n'),
    )
  })

  it('표시 사이를 바꾸고, 표시가 없으면 null이다', () => {
    const document = `앞\n${CATALOG_START}\n예전\n${CATALOG_END}\n뒤\n`
    assert.equal(replaceBlock({ document, block: `${CATALOG_START}\n새것\n${CATALOG_END}` }), `앞\n${CATALOG_START}\n새것\n${CATALOG_END}\n뒤\n`)
    assert.equal(replaceBlock({ document: '표시 없음', block: 'x' }), null)
  })
})

describe('evaluatePatternSelection — 요청에 맞는 패턴이 1위인가', () => {
  const patterns = [
    { name: 'concurrency', description: '동시 주문 재고 초과 판매 경쟁 상태 동시성 테스트', target: '백엔드' },
    { name: 'api-boundary', description: 'MSW 네트워크 경계 서버 오류 응답 화면 테스트', target: '프론트' },
    { name: 'domain-boundaries', description: '경계값 표 최소 금액 기한 마지막 날 테스트', target: '둘 다' },
  ]
  const spec = (pattern, should, shouldNot) => ({ file: `${pattern}.json`, spec: { pattern, should, shouldNot } })

  it('should는 그 패턴이 혼자 1위, shouldNot은 1위가 아니어야 통과한다', () => {
    const result = evaluatePatternSelection({
      patterns,
      specs: [spec('concurrency', ['동시 주문 테스트', '재고 초과 판매 막는지', '동시성 경쟁 상태'], ['서버 오류 화면', '기한 마지막 날', '최소 금액 경계값']),
        spec('api-boundary', ['MSW로 서버 오류', '네트워크 끊김 화면', '응답 화면 테스트'], ['동시 주문', '경계값 표', '재고 초과']),
        spec('domain-boundaries', ['경계값 표로', '최소 금액 경계', '기한 마지막 날'], ['동시성', 'MSW', '네트워크'])],
    })
    assert.deepEqual(result.errors, [])
    assert.equal(result.passed, 18)
    assert.equal(result.total, 18)
  })

  it('PATTERN.md가 없는 평가 파일, 평가 파일이 없는 패턴, 질의 수 부족, 틀린 선택을 알린다', () => {
    const result = evaluatePatternSelection({
      patterns,
      specs: [spec('concurrency', ['서버 오류 화면', '동시 주문', '재고 초과'], ['동시성 경쟁 상태', '기한', '금액']), spec('fake-time', ['a', 'b', 'c'], ['d', 'e', 'f']), spec('api-boundary', ['MSW'], ['동시'])],
    })
    for (const pattern of [/fake-time.*PATTERN\.md 없음/, /domain-boundaries.*evals\/selection\/domain-boundaries\.json 없음/, /api-boundary: should 질의 3개 이상/, /concurrency should "서버 오류 화면"/, /concurrency shouldNot "동시성 경쟁 상태"/]) {
      assert.ok(result.errors.some((e) => pattern.test(e)), `${pattern} — ${result.errors.join(' / ')}`)
    }
  })
})
