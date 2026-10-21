/**
 * 기준 비교(--baseline, 금지선 done/blamed-preexisting) — 실패한 명령을 갈림점의 코드에서 다시 돌려 "원래 있던 실패"인지 가린다.
 * 갈림점의 파일은 git archive로 임시 폴더에 푼다. git 객체를 읽기만 하므로 저장소·작업 트리·브랜치를 건드리지 않는다.
 * 의존성(node_modules)은 지금 것을 링크한다 — 설치를 다시 하지 않는다. 의존성 파일이 바뀐 변경이면 기준 결과가 다를 수 있다.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { planChecks } from './plan.mjs'

/** 갈림점(rev)의 추적 파일을 dir에 푼다 @param {{ exec: { git: (args: string[]) => string }, rev: string, dir: string }} args */
export const exportTree = ({ exec, rev, dir }) => {
  const tar = `${dir}.tar`
  try {
    exec.git(['archive', '--format=tar', '-o', tar, rev])
    execFileSync('tar', ['-xf', tar, '-C', dir], { stdio: ['ignore', 'pipe', 'pipe'] })
  } finally {
    rmSync(tar, { force: true })
  }
}

/** 저장소 루트와 검사 폴더의 node_modules를 기준 폴더에 링크한다 @returns {string[]} 링크한 경로(기준 폴더 기준) */
export const linkDependencies = ({ root, dir, cwds }) => {
  const linked = []
  for (const cwd of [...new Set(cwds)].sort()) {
    const path = cwd ? `${cwd}/node_modules` : 'node_modules'
    const source = join(root, path)
    const target = join(dir, path)
    if (!existsSync(source) || existsSync(target) || !existsSync(join(dir, cwd))) continue
    symlinkSync(source, target, 'dir')
    linked.push(path)
  }
  return linked
}

/**
 * 실패·시간 초과한 명령마다 기준에서 돌릴 명령을 정한다. 프로젝트 파일로 찾은 명령은 기준에 있는 파일로 다시 계획한다
 * (관련 테스트에 넘긴 새 파일은 기준에 없다). 설정·하네스의 명령은 그대로 돌린다.
 * @returns {{ index: number, check: object | null, absent: boolean }[]}
 */
export const planBaseline = ({ runs, source, changed, config, harness, baseProject }) => {
  const replanned =
    source === 'detected'
      ? planChecks({ changed: changed.filter((file) => file.status !== 'D' && baseProject.exists(file.path)), config, harness, project: baseProject }).checks
      : null
  const out = []
  runs.forEach((run, index) => {
    if (run.status === 'pass') return
    const original = { name: run.name, cwd: run.cwd, scope: run.scope, command: run.command, timeoutMs: run.timeoutMs }
    if (!replanned) out.push({ index, check: original, absent: false })
    else {
      const found = replanned.find((check) => check.name === run.name && check.cwd === run.cwd)
      out.push({ index, check: found ? { ...found, timeoutMs: run.timeoutMs } : null, absent: !found })
    }
  })
  return out
}

/**
 * @param {{ run: { counts: { failed: number } | null }, base?: { status: string, counts: { failed: number } | null }, absent?: boolean, error?: string }} args
 * @returns {{ verdict: 'new' | 'preexisting' | 'worse' | 'unknown', message: string }}
 */
export const verdictOf = ({ run, base, absent = false, error }) => {
  if (error) return { verdict: 'unknown', message: `기준에서 돌리지 못했다 — ${error}` }
  if (absent) return { verdict: 'new', message: '기준에는 이 검사가 볼 파일이 없다 — 이 변경에서 생긴 실패다' }
  if (base.status === 'pass') return { verdict: 'new', message: '기준에서는 통과한다 — 이 변경에서 생긴 실패다' }
  const before = base.counts?.failed
  const now = run.counts?.failed
  if (before != null && now != null && now > before) return { verdict: 'worse', message: `기준에서도 실패하지만 실패가 늘었다(${before} → ${now}) — 늘어난 실패는 이 변경에서 생겼다` }
  return { verdict: 'preexisting', message: '기준에서도 실패한다 — 원래 있던 실패일 수 있다. 실패한 테스트가 같은지 두 출력 끝을 비교해 보고에 적는다' }
}
