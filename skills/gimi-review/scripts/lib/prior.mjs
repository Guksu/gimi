/**
 * 다시 리뷰(설계 결정 72) — 같은 PR·브랜치의 지난 리뷰 기록(docs/gimi/reviews/{날짜}-{이름}.md) 가운데 가장 최근 것을 찾아
 * 지적 번호·머리·판정·묶음을 돌려준다. 에이전트는 지난 지적이 고쳐졌는지 확인해 새 기록에 이어 적는다.
 * 기록은 저장소 안의 일반 파일만 읽는다. 리뷰하는 변경이 그 기록을 고쳤으면 changedInRange로 알린다 — 변경이 지난 판정을 꾸밀 수 있다.
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
 * @param {{ root: string, name: string, changedPaths: Set<string> }} args name은 맥락 묶음과 같은 이름(pr-번호·브랜치), changedPaths는 이 변경이 바꾼 파일
 * @returns {{ path: string, changedInRange: boolean, malformed: number, findings: { index: number, level: string, heading: string, verdict: string, rule: string | null, bundle: string | null }[] } | null}
 */
export const priorReview = ({ root, name, changedPaths }) => {
  const same = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${escape(name)}\\.md$`)
  // 날짜가 이름 앞이라 이름순의 끝이 가장 최근이다
  const latest = (attempt(() => readdirSync(join(root, REVIEW_DIR))) ?? []).filter((file) => same.test(file)).sort().at(-1)
  if (!latest) return null
  const path = `${REVIEW_DIR}/${latest}`
  const text = readRepoFile({ root, path })
  if (text == null) return null
  const rows = text.replace(/\r\n?/g, '\n').split('\n')
  const parsed = parseReviewRecord(text)
  return {
    path,
    changedInRange: changedPaths.has(path),
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
