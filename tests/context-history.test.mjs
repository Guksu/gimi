import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { classifyCommit, isFormatting, parseBlamePorcelain, parseLog, prRefsOf } from '../skills/gimi-review/scripts/lib/history.mjs'

describe('classifyCommit', () => {
  it('수정·되돌리기·긴급·우회 커밋에 표시를 단다', () => {
    assert.deepEqual(classifyCommit({ subject: 'fix: iOS 키보드 닫힌 뒤 스크롤 복원' }), ['fix'])
    assert.deepEqual(classifyCommit({ subject: 'Revert "feat: 빠른 담기"' }), ['revert'])
    assert.deepEqual(classifyCommit({ subject: 'hotfix: 결제 실패 화면' }), ['hotfix'])
    assert.deepEqual(classifyCommit({ subject: 'chore: 임시 처리', body: 'setTimeout으로 우회한다' }), ['workaround'])
    assert.deepEqual(classifyCommit({ subject: '결제 오류 수정' }), ['fix'])
  })

  it('제목에 수정이 아닌 유형(feat·docs 등)이 있으면 본문은 보지 않는다 — 큰 기능 커밋 본문의 "버그 수정" 항목으로 표시하지 않는다', () => {
    assert.deepEqual(classifyCommit({ subject: 'feat(ux): 사진 뷰어 (#27)', body: '- 지도 버그 수정\n- 임시 처리 제거' }), [])
  })

  it('제목에 유형이 없으면 본문까지 본다', () => {
    assert.deepEqual(classifyCommit({ subject: '스크롤 복원', body: 'iOS 버그 수정' }), ['fix'])
  })

  it('평범한 기능 커밋에는 표시가 없다 — "버그"·"prefix"처럼 낱말만 겹치는 것도', () => {
    assert.deepEqual(classifyCommit({ subject: 'feat: 장바구니 수량 변경' }), [])
    assert.deepEqual(classifyCommit({ subject: 'refactor: prefix 정리' }), [])
    assert.deepEqual(classifyCommit({ subject: 'feat: 버그 신고 버튼 추가' }), [])
  })
})

describe('isFormatting', () => {
  it('서식 정리 커밋을 알아본다', () => {
    assert.equal(isFormatting({ subject: 'style: prettier 적용' }), true)
    assert.equal(isFormatting({ subject: 'chore: lint 수정' }), true)
    assert.equal(isFormatting({ subject: '서식 정리' }), true)
  })

  it('포맷터를 만드는 기능 커밋은 서식 정리가 아니다', () => {
    assert.equal(isFormatting({ subject: 'feat: 금액 포맷터 추가' }), false)
    assert.equal(isFormatting({ subject: 'fix: 날짜 format 오류' }), false)
  })
})

describe('prRefsOf', () => {
  it('스쿼시·머지 커밋 제목에서 PR 번호를 뽑는다', () => {
    assert.deepEqual(prRefsOf({ subject: 'feat: 쿠폰 입력 (#12)' }), [12])
    assert.deepEqual(prRefsOf({ subject: 'Merge pull request #7 from a/b' }), [7])
    assert.deepEqual(prRefsOf({ subject: 'fix: 없음' }), [])
  })
})

describe('parseLog', () => {
  it('구분 문자로 나눈 git log 출력을 커밋 목록으로 바꾼다', () => {
    const text = 'aaa\x1ffix: 하나\x1f본문 첫 줄\n둘째 줄\n\x1f2026-10-01T10:00:00+09:00\x1e\nbbb\x1ffeat: 둘\x1f\x1f2026-10-02T10:00:00+09:00\x1e\n'
    assert.deepEqual(parseLog(text), [
      { sha: 'aaa', subject: 'fix: 하나', body: '본문 첫 줄\n둘째 줄', date: '2026-10-01T10:00:00+09:00' },
      { sha: 'bbb', subject: 'feat: 둘', body: '', date: '2026-10-02T10:00:00+09:00' },
    ])
  })

  it('빈 출력은 빈 목록이다', () => {
    assert.deepEqual(parseLog(''), [])
  })
})

describe('parseBlamePorcelain', () => {
  const a = 'a'.repeat(40)
  const b = 'b'.repeat(40)
  const porcelain = [
    `${a} 3 3 2`,
    'author tester',
    'author-time 1700000000',
    'summary fix: iOS 스크롤 복원 (#5)',
    'filename src/order.ts',
    '\told3',
    `${a} 4 4`,
    '\told4',
    `${b} 1 5 1`,
    'author tester',
    'summary feat: 처음',
    'boundary',
    'filename src/order.ts',
    '\told5',
    '',
  ].join('\n')

  it('줄마다 그 줄을 마지막으로 바꾼 커밋을 돌려준다', () => {
    const { lines } = parseBlamePorcelain(porcelain)
    assert.deepEqual(lines, [
      { line: 3, sha: a },
      { line: 4, sha: a },
      { line: 5, sha: b },
    ])
  })

  it('커밋마다 요약과 경계 여부를 남긴다', () => {
    const { commits } = parseBlamePorcelain(porcelain)
    assert.equal(commits.get(a).summary, 'fix: iOS 스크롤 복원 (#5)')
    assert.equal(commits.get(b).boundary, true)
  })
})
