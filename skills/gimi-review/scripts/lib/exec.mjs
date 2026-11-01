/**
 * 외부 명령 실행 — git과 gh만 쓴다. 테스트는 같은 모양의 객체를 넘겨 gh를 가짜로 바꾼다.
 * 사용자의 git 설정(색, 서명 표시, 경로 따옴표)이 출력 모양을 바꾸지 않게 -c로 고정한다.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
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
 * 리뷰하는 저장소의 패키지(typescript·yaml 등)를 불러온다 — 저장소에 커밋된 코드는 실행하지 않는다.
 * 남의 PR을 체크아웃해 리뷰할 때 PR이 커밋한 코드가 리뷰하는 사람 컴퓨터에서 돌지 않게 두 가지를 본다.
 *   1. 저장소 루트의 node_modules 아래에 git이 추적하는 것이 하나라도 있으면(대소문자 무시, 하위 모듈 포함) 아무것도 불러오지 않는다.
 *      커밋된 패키지뿐 아니라, 체크아웃이 설치해 둔 패키지의 안쪽 파일을 덮어쓴 경우도 막는다.
 *   2. 찾은 파일(require.resolve — 실행하지 않는다)의 실제 경로가 저장소 안이면 node_modules 아래여야 한다.
 *      main이 .git·루트 파일을 가리키거나 루트 package.json의 자기 참조로 저장소 파일을 부르는 경우를 막는다.
 * git이 실패하면 불러오지 않는다. 설치한 패키지(git이 추적하지 않는 node_modules)와 저장소 밖의 패키지는 그대로 불러온다.
 * @param {{ root: string, name: string }} args
 * @returns {{ module: any, reason: string | null }} 설치되지 않았으면 module·reason 모두 null
 */
export const requireFromProject = ({ root, name }) => {
  const refuse = (detail) => ({ module: null, reason: `${name}을(를) 불러오지 않았다 — ${detail}` })
  const rootReal = attempt(() => realpathSync.native(root))
  if (!rootReal) return refuse('저장소 경로를 확인하지 못했다')
  const tracked = attempt(() => execFileSync('git', [...GIT_FIXED, '--icase-pathspecs', 'ls-files', '-z', '--', 'node_modules'], { cwd: rootReal, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER }))
  if (tracked == null) return refuse('git으로 node_modules를 확인하지 못했다')
  const first = tracked.split('\0').find(Boolean)
  if (first) return refuse(`node_modules에 git이 추적하는 파일이 있다(${first}) — 저장소에 커밋된 코드를 실행할 수 있다`)
  const require = createRequire(join(rootReal, 'gimi-context.cjs'))
  const file = attempt(() => require.resolve(name))
  if (!file) return { module: null, reason: null }
  const real = attempt(() => realpathSync.native(file))
  if (!real) return refuse('찾은 파일의 경로를 확인하지 못했다')
  const rel = relative(rootReal, real)
  const outside = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)
  if (!outside && rel.split(sep)[0].toLowerCase() !== 'node_modules') return refuse(`찾은 파일(${rel.split(sep).join('/')})이 저장소 안의 node_modules 밖에 있다`)
  return { module: attempt(() => require(name)), reason: null }
}

// 저장소에서 읽는 파일 한 개의 상한 — 이보다 크면 소스·설정 파일로 보지 않는다
const MAX_READ_BYTES = 4 * 1024 * 1024

/**
 * 저장소 안의 일반 파일만 읽는다 — 심볼릭 링크가 저장소 밖(다른 비밀 파일)이나 장치 파일(/dev/zero 등)을 가리키면 읽지 않는다.
 * 저장소의 내용(PR이 커밋한 것)이 고른 경로라 리뷰하는 사람의 다른 파일을 읽거나 멈추게 할 수 있기 때문이다.
 * @param {{ root: string, path: string }} args path는 절대 경로나 root 기준 경로 @returns {string | null}
 */
export const readRepoFile = ({ root, path }) => {
  const rootReal = attempt(() => realpathSync(root))
  const real = attempt(() => realpathSync(isAbsolute(path) ? path : join(root, path)))
  if (!rootReal || !real || !(real === rootReal || real.startsWith(`${rootReal}${sep}`))) return null
  const stat = attempt(() => statSync(real))
  if (!stat?.isFile() || stat.size > MAX_READ_BYTES) return null
  return attempt(() => readFileSync(real, 'utf8'))
}
