/**
 * 다시 리뷰(설계 결정 72) — 같은 PR·브랜치의 지난 리뷰 기록(docs/gimi/reviews/{날짜}-{이름}.md) 가운데 읽을 수 있는 가장 최근 것을 찾아
 * 지적 번호·머리·판정·묶음을 돌려준다. 에이전트는 지난 지적이 고쳐졌는지 확인해 새 기록에 이어 적는다.
 * 기록은 저장소 안의 일반 파일만 읽는다. 리뷰하는 변경이 기록을 더하거나 고치거나 지울 수 있으니(남의 PR이면 지난 판정을 꾸미거나 숨길 수 있다)
 * 이 변경이 건드린 것을 알린다 — 고른 기록을 건드렸는지(changedInRange), 건드리지 않은 가장 최근 기록(untouched), 지운 기록(removed), 읽을 수 없는 기록(unreadable).
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { attempt, readRepoFile } from './exec.mjs'
import { parseReviewRecord } from './promote.mjs'
import { oneLine } from './text.mjs'
import { REVIEW_DIR } from './worktree.mjs'

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const MAX_HEADING = 160

/**
 * @param {{ root: string, name: string, changedPaths: Set<string> }} args name은 맥락 묶음과 같은 이름(pr-번호·브랜치), changedPaths는 이 변경이 바꾼 파일(지운 것·옛 이름 포함)
 * @returns {{ path: string | null, changedInRange: boolean, untouched: string | null, removed: string[], unreadable: string[], malformed: number, findings: { index: number, level: string, heading: string, verdict: string, rule: string | null, bundle: string | null }[] } | null} 기록도 알릴 것도 없으면 null
 */
export const priorReview = ({ root, name, changedPaths }) => {
  const same = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escape(name)}\\.md$`)
  // 날짜가 이름 앞이라 이름순의 끝이 가장 최근이다
  const onDisk = (attempt(() => readdirSync(join(root, REVIEW_DIR))) ?? []).filter((file) => same.test(file)).sort().reverse().map((file) => `${REVIEW_DIR}/${file}`)
  const read = new Map(onDisk.map((path) => [path, readRepoFile({ root, path })]))
  const readable = onDisk.filter((path) => read.get(path) != null)
  const unreadable = onDisk.filter((path) => read.get(path) == null)
  const removed = [...changedPaths].filter((path) => path.startsWith(`${REVIEW_DIR}/`) && same.test(path.slice(REVIEW_DIR.length + 1)) && !onDisk.includes(path)).sort()
  const path = readable[0] ?? null
  if (!path && removed.length === 0 && unreadable.length === 0) return null
  const changedInRange = path != null && changedPaths.has(path)
  const text = path ? read.get(path) : ''
  const rows = text.replace(/\r\n?/g, '\n').split('\n')
  const parsed = parseReviewRecord(text)
  return {
    path,
    changedInRange,
    // 고른 기록을 이 변경이 건드렸으면, 건드리지 않은 가장 최근 기록을 함께 알린다 — 꾸민 기록이 진짜를 가리지 못하게
    untouched: changedInRange ? (readable.find((candidate) => !changedPaths.has(candidate)) ?? null) : null,
    removed,
    unreadable,
    malformed: parsed.filter((finding) => finding.index == null).length,
    findings: parsed
      .filter((finding) => finding.index != null)
      .map((finding) => ({
        index: finding.index,
        level: finding.level,
        heading: oneLine(rows[finding.line - 1].replace(/^## \d+\.\s*/, ''), MAX_HEADING),
        verdict: finding.verdict,
        rule: finding.rule,
        bundle: finding.bundle,
      })),
  }
}
