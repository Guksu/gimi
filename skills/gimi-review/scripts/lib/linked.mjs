/**
 * 함께 보는 저장소(설계 결정 57) — 프론트·백엔드가 다른 저장소일 때, 설정의 linkedRepos(리뷰하는 저장소 기준 경로)를 읽어
 * 계약 사용처를 그 저장소에서도 찾을 곳으로 만든다. 지금 체크아웃된 그대로 읽고 브랜치는 맞추지 않는다.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { attempt, createExec } from './exec.mjs'

/**
 * @param {{ root: string, linkedRepos: unknown, loadTs: (args: { root: string }) => { ts: any } }} args
 * @returns {{ linked: { label: string, root: string, exec: any, ts: any }[], skipped: { context: string, reason: string }[], notes: string[] }}
 */
export const resolveLinked = ({ root, linkedRepos, loadTs }) => {
  const linked = []
  const skipped = []
  const notes = []
  if (linkedRepos == null) return { linked, skipped, notes }
  if (!Array.isArray(linkedRepos)) {
    notes.push('설정의 linkedRepos는 경로 목록이다 — 읽지 않았다')
    return { linked, skipped, notes }
  }
  for (const entry of linkedRepos) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      notes.push(`설정의 linkedRepos에 경로가 아닌 값(${JSON.stringify(entry)})이 있다 — 건너뛰었다`)
      continue
    }
    const abs = resolve(root, entry)
    if (!existsSync(abs)) {
      skipped.push({ context: '영향 범위', reason: `함께 보는 저장소 ${entry}을(를) 찾지 못했다 — 설정의 경로를 확인한다` })
      continue
    }
    const exec = createExec({ cwd: abs })
    const top = attempt(() => exec.git(['rev-parse', '--show-toplevel']).trim())
    if (!top) {
      skipped.push({ context: '영향 범위', reason: `함께 보는 저장소 ${entry}은(는) git 저장소가 아니다` })
      continue
    }
    // 리뷰하는 저장소 자신은 이미 찾는다
    if (attempt(() => exec.git(['rev-parse', '--git-common-dir']).trim()) === attempt(() => createExec({ cwd: root }).git(['rev-parse', '--git-common-dir']).trim()) && resolve(top) === resolve(root)) continue
    const head = attempt(() => exec.git(['rev-parse', '--short=7', 'HEAD']).trim()) ?? '알 수 없음'
    notes.push(`함께 보는 저장소 ${entry}는 지금 체크아웃된 커밋 ${head}로 읽었다 — 브랜치를 맞추지 않는다`)
    linked.push({ label: entry, root: top, exec, ts: loadTs({ root: top }).ts })
  }
  return { linked, skipped, notes }
}
