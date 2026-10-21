/**
 * Stop 훅의 판단(설계 결정 9 — guksu-harness가 없는 프로젝트) — 끝내기 전 검사를 돌릴지, 막을지, 보고하고 끝내게 할지.
 * 상태는 세션마다 따로 둔다. 사용자 메시지 뒤 첫 Stop(stop_hook_active가 아님)이면 막은 횟수를 새로 센다.
 * 끝없이 막지 않게 상한(같은 차례에 막는 횟수·같은 실패가 이어지는 횟수)을 넘으면 실패를 보고하고 끝내라고 한 번 막는다.
 */

export const EMPTY_STATE = Object.freeze({ passedDigest: null, failedDigest: null, signature: null, streak: 0, blocks: 0, wrapup: false, lastReport: '' })
export const DEFAULT_LIMITS = Object.freeze({ maxBlocks: 3, stuckAfter: 3 })

const WRAPUP = '더 고치지 말고, 아래 실패와 고치지 못한 이유를 그대로 사용자에게 보고하고 끝낸다.'

/**
 * @param {{ state: typeof EMPTY_STATE, digest: string, stopHookActive: boolean }} args
 * @returns {{ action: 'allow' | 'wrapup' | 'run', state: typeof EMPTY_STATE, message?: string }}
 */
export const beforeRun = ({ state, digest, stopHookActive }) => {
  if (stopHookActive && state.wrapup) return { action: 'allow', state: { ...state, wrapup: false } }
  const current = stopHookActive ? state : { ...state, blocks: 0, streak: 0, wrapup: false }
  if (digest === current.passedDigest) return { action: 'allow', state: current }
  // 막은 뒤 아무것도 바꾸지 않았다 — 다시 돌려도 같은 실패다
  if (stopHookActive && digest === current.failedDigest) {
    return { action: 'wrapup', state: { ...current, wrapup: true }, message: `끝내기 전 검사가 실패한 채로, 고치지 않고 끝내려 한다 — ${WRAPUP}\n\n${current.lastReport}` }
  }
  return { action: 'run', state: current }
}

/**
 * @param {{ state: typeof EMPTY_STATE, digest: string, stopHookActive: boolean, passed: boolean, signature: string | null, report: string, limits: typeof DEFAULT_LIMITS }} args
 * @returns {{ action: 'allow' | 'block' | 'wrapup', state: typeof EMPTY_STATE, message?: string }}
 */
export const afterRun = ({ state, digest, stopHookActive, passed, signature, report, limits }) => {
  if (passed) return { action: 'allow', state: { ...state, passedDigest: digest, failedDigest: null, signature: null, streak: 0, wrapup: false, lastReport: '' } }
  const blocks = state.blocks + 1
  const streak = stopHookActive && signature === state.signature ? state.streak + 1 : 1
  const next = { ...state, failedDigest: digest, signature, streak, blocks, lastReport: report }
  if (blocks > limits.maxBlocks || streak >= limits.stuckAfter) {
    const cause = streak >= limits.stuckAfter ? `같은 실패가 ${streak}번 이어졌다` : `이번 차례에 ${blocks}번째 실패다`
    return { action: 'wrapup', state: { ...next, wrapup: true }, message: `끝내기 전 검사가 계속 실패한다(${cause}) — ${WRAPUP}\n\n${report}` }
  }
  return {
    action: 'block',
    state: next,
    message: `끝내기 전 검사가 실패했다 — 아래 실패를 고친 뒤 끝낸다. 원래 있던 실패로 보이면 check.mjs --baseline으로 기준에서 돌려 보고 그 결과와 함께 보고한다.\n\n${report}`,
  }
}
