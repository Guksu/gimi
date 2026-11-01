/**
 * 외부 명령 실행 — git과 gh만 쓴다. 테스트는 같은 모양의 객체를 넘겨 gh를 가짜로 바꾼다.
 * 사용자의 git 설정(색, 서명 표시, 경로 따옴표)이 출력 모양을 바꾸지 않게 -c로 고정한다.
 */
import { execFileSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, sep } from 'node:path'

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

/**
 * 리뷰하는 저장소의 패키지(typescript·yaml 등)를 불러온다. 단, 패키지 파일이 그 저장소의 git에 커밋되어 있으면 불러오지 않는다 —
 * 남의 PR을 체크아웃해 리뷰할 때, PR이 커밋한 node_modules의 코드가 리뷰하는 사람 컴퓨터에서 실행되기 때문이다.
 * npm 등으로 설치한 패키지는 git이 추적하지 않으므로 그대로 불러온다. 경로만 먼저 찾고(require.resolve는 실행하지 않는다) 판단한다.
 * @param {{ root: string, name: string }} args
 * @returns {{ module: any, installed: boolean, reason: string | null }} installed는 패키지를 찾았는지
 */
export const requireFromProject = ({ root, name }) => {
  const require = createRequire(join(root, 'gimi-context.cjs'))
  const file = attempt(() => require.resolve(name))
  if (!file) return { module: null, installed: false, reason: null }
  const rootReal = attempt(() => realpathSync(root)) ?? root
  const rel = relative(rootReal, attempt(() => realpathSync(file)) ?? file)
  if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
    const tracked = attempt(() => createExec({ cwd: rootReal }).git(['ls-files', '--error-unmatch', '--', rel]))
    if (tracked !== null) {
      return { module: null, installed: true, reason: `${name}이(가) git에 커밋되어 있어(${rel.split(sep).join('/')}) 불러오지 않았다 — PR이 커밋한 코드를 실행할 수 있다` }
    }
  }
  return { module: attempt(() => require(name)), installed: true, reason: null }
}
