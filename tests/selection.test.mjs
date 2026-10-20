import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TRIGGER_STOPWORDS, createRanker, features } from '../scripts/lib/selection.mjs'

describe('features', () => {
  it('조사가 붙은 한글 토큰은 원형과 조사를 뗀 어간을 모두 정확 토큰으로 넣는다', () => {
    const f = features({ text: '웹훅을 리뷰' })
    assert.equal(f.get('w:웹훅을'), 3)
    assert.equal(f.get('w:웹훅'), 3)
    assert.equal(f.get('w:리뷰'), 3)
  })

  it('한글은 음절 2-gram을 가중 1로 넣어 부분 일치를 잡는다', () => {
    const f = features({ text: '바텀시트로' })
    assert.equal(f.get('b:바텀'), 1)
    assert.equal(f.get('b:시트'), 1)
    assert.equal(f.get('b:트로'), 1)
  })

  it('불용어는 그대로든 조사를 떼서든 빠진다', () => {
    const f = features({ text: '기능을 만들어줘' })
    assert.equal(f.has('w:만들어줘'), false)
    assert.equal(f.has('w:기능을'), false)
    assert.equal(f.has('w:기능'), false)
  })

  it('영어는 소문자로 바꾸고 끝의 s를 떼 단수·복수를 합친다', () => {
    const f = features({ text: 'Reviews TESTS' })
    assert.equal(f.get('w:review'), 3)
    assert.equal(f.get('w:test'), 3)
  })

  it('문장부호에서 끊는다', () => {
    const f = features({ text: 'PR#42 리뷰!' })
    assert.equal(f.get('w:pr'), 3)
    assert.equal(f.get('w:42'), 3)
    assert.equal(f.get('w:리뷰'), 3)
  })

  it('트리거 불용어는 요청에 늘 나오는 말을 뺀다', () => {
    const f = features({ text: '이거 좀 해줘', stopwords: TRIGGER_STOPWORDS })
    assert.equal(f.size, 0)
  })
})

describe('createRanker', () => {
  it('겹치는 단어가 많은 설명이 1위가 되고, 겹침이 없으면 0점이다', () => {
    const rank = createRanker({
      docs: [
        { name: 'review', description: '결제 웹훅 코드 리뷰' },
        { name: 'layout', description: '화면 레이아웃 여백' },
      ],
    })
    const ranked = rank('웹훅 리뷰해줘')
    assert.equal(ranked[0].name, 'review')
    assert.ok(ranked[0].score > 0)
    assert.equal(ranked.find((r) => r.name === 'layout').score, 0)
  })

  it('모든 설명에 나오는 특징은 IDF가 0이라 점수를 주지 않는다', () => {
    const rank = createRanker({
      docs: [
        { name: 'a', description: '공통 고유어' },
        { name: 'b', description: '공통 다른말' },
      ],
    })
    const ranked = rank('공통 고유어')
    assert.equal(ranked[0].name, 'a')
    assert.equal(ranked.find((r) => r.name === 'b').score, 0)
  })
})
