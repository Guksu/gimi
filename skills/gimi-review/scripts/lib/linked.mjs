/**
 * 함께 보는 저장소(설계 결정 57) — 프론트·백엔드가 다른 저장소일 때, 설정의 linkedRepos(이 체크아웃의 루트 기준 경로)를 읽어
 * 계약 사용처를 그 저장소에서도 찾을 곳으로 만든다. 지금 체크아웃된 그대로 읽고 브랜치는 맞추지 않는다.
 * 저장소 안의 폴더를 적으면 그 폴더 안만 찾는다. 겹치는 경로(같은 저장소를 두 번, 앞에 적은 것의 안이나 바깥)는 앞에 적은 것만 쓴다.
 */
import { existsSync, realpathSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import { attempt, createExec } from './exec.mjs'

const real = (path) => attempt(() => realpathSync(path)) ?? resolve(path)
const overlaps = (a, b) => a === '' || b === '' || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)

/**
 * @param {{ root: string, linkedRepos: unknown, loadTs: (args: { root: string }) => { ts: any, reason?: string | null } }} args
 * @returns {{ linked: { label: string, root: string, prefix: string, exec: any, ts: any }[], skipped: { context: string, reason: string }[], notes: string[] }}
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
  const rootReal = real(root)
  const seen = []
  for (const entry of linkedRepos) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      notes.push(`설정의 linkedRepos에 경로가 아닌 값(${JSON.stringify(entry)})이 있다 — 건너뛰었다`)
      continue
    }
    const abs = resolve(root, entry)
    if (!existsSync(abs)) {
      skipped.push({ context: '영향 범위', reason: `함께 보는 저장소 ${entry}(${abs})을(를) 찾지 못했다 — 상대 경로는 이 체크아웃의 루트 기준이다` })
      continue
    }
    const top = attempt(() => createExec({ cwd: abs }).git(['rev-parse', '--show-toplevel']).trim())
    if (!top) {
      skipped.push({ context: '영향 범위', reason: `함께 보는 저장소 ${entry}(${abs})은(는) git 저장소가 아니다` })
      continue
    }
    const topReal = real(top)
    // 리뷰하는 저장소 자신과 그 안의 폴더는 이미 찾는다
    if (topReal === rootReal) continue
    const prefix = relative(topReal, real(abs)).split(sep).join('/')
    const dup = seen.find((other) => other.topReal === topReal && overlaps(other.prefix, prefix))
    if (dup) {
      notes.push(`함께 보는 저장소 ${entry}은(는) 앞에 적은 ${dup.label}과(와) 겹쳐 건너뛰었다`)
      continue
    }
    seen.push({ topReal, prefix, label: entry })
    const exec = createExec({ cwd: top })
    const branch = attempt(() => exec.git(['rev-parse', '--abbrev-ref', 'HEAD']).trim()) ?? '알 수 없음'
    const head = attempt(() => exec.git(['rev-parse', '--short=7', 'HEAD']).trim()) ?? '알 수 없음'
    const dirty = (attempt(() => exec.git(['status', '--porcelain', '--untracked-files=no'])) ?? '').trim() !== ''
    notes.push(`함께 보는 저장소 ${entry}은(는) 지금 체크아웃된 ${branch}(커밋 ${head})로 읽었다${dirty ? ' — 커밋하지 않은 변경도 함께 읽었다' : ''}. 브랜치는 맞추지 않는다`)
    const { ts, reason } = loadTs({ root: top })
    if (!ts) notes.push(`함께 보는 저장소 ${entry}은(는) 생성 타입의 TypeScript 참조 없이 경로 문자열로만 찾는다 — ${reason ?? 'typescript를 불러오지 못했다'}`)
    linked.push({ label: entry, root: top, prefix, exec, ts })
  }
  return { linked, skipped, notes }
}
