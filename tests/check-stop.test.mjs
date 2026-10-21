import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { changeDigest, collectChanges } from '../skills/gimi-test/scripts/lib/changes.mjs'
import { afterRun, beforeRun, EMPTY_STATE } from '../skills/gimi-test/scripts/lib/stop.mjs'
import { execFor, makeRepo } from './helpers/repo.mjs'

const limits = { maxBlocks: 3, stuckAfter: 3 }

describe('beforeRun — Stop 훅이 검사를 돌릴지', () => {
  it('마지막으로 통과한 뒤 바뀐 것이 없으면 돌리지 않고 끝내게 둔다', () => {
    assert.equal(beforeRun({ state: { ...EMPTY_STATE, passedDigest: 'd1' }, digest: 'd1', stopHookActive: false }).action, 'allow')
    assert.equal(beforeRun({ state: { ...EMPTY_STATE, passedDigest: 'd1' }, digest: 'd2', stopHookActive: false }).action, 'run')
  })

  it('사용자 메시지 뒤 첫 Stop이면 막은 횟수를 새로 센다', () => {
    const { state } = beforeRun({ state: { ...EMPTY_STATE, blocks: 3, streak: 2, wrapup: true }, digest: 'd2', stopHookActive: false })
    assert.deepEqual([state.blocks, state.streak, state.wrapup], [0, 0, false])
  })

  it('막은 뒤 아무것도 고치지 않고 끝내려 하면 다시 돌리지 않고 보고하고 끝내라고 한 번 막는다', () => {
    const decision = beforeRun({ state: { ...EMPTY_STATE, failedDigest: 'd1', blocks: 1, lastReport: '실패      test' }, digest: 'd1', stopHookActive: true })
    assert.equal(decision.action, 'wrapup')
    assert.match(decision.message, /고치지 않고 끝내려 한다/)
    assert.match(decision.message, /실패 {6}test/)
    assert.equal(decision.state.wrapup, true)
  })

  it('보고하고 끝내라고 막은 다음 Stop은 끝내게 둔다', () => {
    const decision = beforeRun({ state: { ...EMPTY_STATE, failedDigest: 'd1', wrapup: true }, digest: 'd1', stopHookActive: true })
    assert.equal(decision.action, 'allow')
    assert.equal(decision.state.wrapup, false)
  })
})

describe('afterRun — 검사 결과로 막을지', () => {
  it('통과하면 끝내게 두고 지금 상태를 통과로 기억한다', () => {
    const decision = afterRun({ state: { ...EMPTY_STATE, blocks: 2, failedDigest: 'd0' }, digest: 'd1', stopHookActive: true, passed: true, signature: null, report: '', limits })
    assert.equal(decision.action, 'allow')
    assert.deepEqual([decision.state.passedDigest, decision.state.failedDigest], ['d1', null])
  })

  it('실패하면 보고를 붙여 막는다 — 고친 뒤 끝내고, 원래 있던 실패로 보이면 --baseline으로 확인하라고 쓴다', () => {
    const decision = afterRun({ state: EMPTY_STATE, digest: 'd1', stopHookActive: false, passed: false, signature: 's1', report: '실패      test', limits })
    assert.equal(decision.action, 'block')
    assert.match(decision.message, /고친 뒤 끝낸다/)
    assert.match(decision.message, /--baseline/)
    assert.match(decision.message, /실패 {6}test/)
    assert.deepEqual([decision.state.blocks, decision.state.failedDigest, decision.state.lastReport], [1, 'd1', '실패      test'])
  })

  it('같은 차례에서 막은 횟수가 상한을 넘으면 보고하고 끝내라고 한다', () => {
    const decision = afterRun({ state: { ...EMPTY_STATE, blocks: 3, signature: 's0' }, digest: 'd4', stopHookActive: true, passed: false, signature: 's4', report: 'r', limits })
    assert.equal(decision.action, 'wrapup')
    assert.match(decision.message, /더 고치지 말고/)
    assert.equal(decision.state.wrapup, true)
  })

  it('고쳤는데도 같은 실패가 이어지면(막힘) 보고하고 끝내라고 한다', () => {
    let state = EMPTY_STATE
    const actions = []
    for (const digest of ['d1', 'd2', 'd3']) {
      const decision = afterRun({ state, digest, stopHookActive: state !== EMPTY_STATE, passed: false, signature: 'same', report: 'r', limits: { maxBlocks: 10, stuckAfter: 3 } })
      actions.push(decision.action)
      state = decision.state
    }
    assert.deepEqual(actions, ['block', 'block', 'wrapup'])
  })
})

describe('changeDigest — 바뀐 상태의 지문', () => {
  let repo
  let exec
  let mergeBase
  before(() => {
    repo = makeRepo()
    repo.write({ 'src/a.js': '1\n' })
    repo.commit('feat: 처음')
    repo.git('switch', '-q', '-c', 'feat/x')
    exec = execFor({ dir: repo.dir })
    mergeBase = collectChanges({ exec }).mergeBase
  })
  after(() => repo.cleanup())

  const digest = () => changeDigest({ exec, root: repo.dir, mergeBase, files: collectChanges({ exec }).files })

  it('아무것도 바뀌지 않으면 같고, 추적하는 파일이나 새 파일이 바뀌면 달라진다', () => {
    const first = digest()
    assert.equal(digest(), first)
    repo.write({ 'src/a.js': '2\n' })
    const edited = digest()
    assert.notEqual(edited, first)
    repo.write({ 'src/new.js': 'n\n' })
    const added = digest()
    assert.notEqual(added, edited)
    repo.write({ 'src/new.js': 'changed size\n' })
    assert.notEqual(digest(), added)
  })
})
