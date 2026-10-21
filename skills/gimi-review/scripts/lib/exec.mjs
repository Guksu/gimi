// @shared exec.mjs origin: gimi-review
/**
 * 외부 명령 실행 — git과 gh만 쓴다. 테스트는 같은 모양의 객체를 넘겨 gh를 가짜로 바꾼다.
 * 사용자의 git 설정(색, 서명 표시, 경로 따옴표)이 출력 모양을 바꾸지 않게 -c로 고정한다.
 */
import { execFileSync } from 'node:child_process'

const GIT_FIXED = ['-c', 'core.quotePath=false', '-c', 'log.showSignature=false', '-c', 'color.ui=false']
const MAX_BUFFER = 64 * 1024 * 1024

/** 사용자에게 보일 오류 — CLI가 메시지만 출력하고 종료 코드 2로 끝낸다 */
export class ContextError extends Error {}

/** @param {{ cwd: string }} args */
export const createExec = ({ cwd }) => {
  const run = (cmd, args) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER })
  return {
    /** @param {string[]} args */
    git: (args) => run('git', [...GIT_FIXED, ...args]),
    /** @param {string[]} args */
    gh: (args) => run('gh', args),
  }
}

/** 실패하면 null — 없을 수도 있는 것(gh, PR, 이슈)을 읽을 때 쓴다
 * @template T @param {() => T} fn @returns {T | null} */
export const attempt = (fn) => {
  try {
    return fn()
  } catch {
    return null
  }
}
