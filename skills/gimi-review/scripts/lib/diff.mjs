// @shared diff.mjs origin: gimi-review
/**
 * `git diff --unified=0` 출력 해석 — 파일마다 변경 덩어리(hunk)와 지운 줄·더한 줄 번호를 돌려준다.
 * 앞뒤 문맥 줄 없이(--unified=0) 받으므로 덩어리 안의 줄은 모두 지운 줄(-)이거나 더한 줄(+)이다.
 */

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * @typedef {{ line: number, text: string }} Line
 * @typedef {{ oldStart: number, oldLines: number, newStart: number, newLines: number, removed: Line[], added: Line[] }} Hunk
 * @typedef {{ oldPath: string | null, newPath: string | null, status: 'added' | 'deleted' | 'modified' | 'renamed', binary: boolean, hunks: Hunk[], additions: number, deletions: number }} FileDiff
 */

/** @param {string} text @returns {FileDiff[]} */
export const parseDiff = (text) => {
  /** @type {FileDiff[]} */
  const files = []
  /** @type {FileDiff | null} */
  let file = null
  /** @type {Hunk | null} */
  let hunk = null
  let oldLine = 0
  let newLine = 0

  for (const row of text.split('\n')) {
    if (row.startsWith('diff --git ')) {
      // 경로는 아래 ---·+++ 줄이 정본이다. 바이너리처럼 그 줄이 없을 때만 머리 줄의 경로를 쓴다
      const header = row.match(/^diff --git a\/(.+) b\/(.+)$/)
      file = { oldPath: header?.[1] ?? null, newPath: header?.[2] ?? null, status: 'modified', binary: false, hunks: [], additions: 0, deletions: 0 }
      files.push(file)
      hunk = null
      continue
    }
    if (!file) continue

    // 파일 머리 정보 — 첫 덩어리 전에만 온다. 덩어리 안에서는 "---"로 시작하는 지운 줄일 수 있다
    if (!hunk) {
      if (row.startsWith('new file mode')) file.status = 'added'
      else if (row.startsWith('deleted file mode')) file.status = 'deleted'
      else if (row.startsWith('rename from ')) {
        file.oldPath = row.slice('rename from '.length)
        file.status = 'renamed'
      } else if (row.startsWith('rename to ')) {
        file.newPath = row.slice('rename to '.length)
        file.status = 'renamed'
      } else if (row.startsWith('Binary files ')) file.binary = true
      else if (row.startsWith('--- ')) file.oldPath = row === '--- /dev/null' ? null : row.slice(4).replace(/^a\//, '')
      else if (row.startsWith('+++ ')) file.newPath = row === '+++ /dev/null' ? null : row.slice(4).replace(/^b\//, '')
    }

    const header = row.match(HUNK)
    if (header) {
      hunk = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        removed: [],
        added: [],
      }
      file.hunks.push(hunk)
      oldLine = hunk.oldStart
      newLine = hunk.newStart
      continue
    }
    if (!hunk || row.startsWith('\\')) continue
    if (row.startsWith('-')) {
      hunk.removed.push({ line: oldLine, text: row.slice(1) })
      oldLine += 1
      file.deletions += 1
    } else if (row.startsWith('+')) {
      hunk.added.push({ line: newLine, text: row.slice(1) })
      newLine += 1
      file.additions += 1
    }
  }
  return files
}

/** 겹치거나 맞닿은 [시작, 끝] 구간을 합친다
 * @param {[number, number][]} ranges @returns {[number, number][]} */
export const mergeRanges = (ranges) => {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  /** @type {[number, number][]} */
  const merged = []
  for (const [start, end] of sorted) {
    const last = merged.at(-1)
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/** 바뀌기 전 파일에서 바뀌거나 지워진 줄 구간 — blame할 대상이다. 더하기만 한 덩어리는 옛 줄이 없다
 * @param {FileDiff} file */
export const oldChangedRanges = (file) =>
  mergeRanges(file.hunks.filter((hunk) => hunk.oldLines > 0).map((hunk) => [hunk.oldStart, hunk.oldStart + hunk.oldLines - 1]))
