import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mergeRanges, oldChangedRanges, parseDiff } from '../skills/gimi-review/scripts/lib/diff.mjs'

const sample = `diff --git a/src/order.ts b/src/order.ts
index 1111111..2222222 100644
--- a/src/order.ts
+++ b/src/order.ts
@@ -3,2 +3,3 @@ export const a = 1
-old3
--- old4 starts with dashes
+new3
+new4
+++ new5 starts with pluses
@@ -10 +11,0 @@
-removed10
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+line1
+line2
diff --git a/src/gone.ts b/src/gone.ts
deleted file mode 100644
index 4444444..0000000
--- a/src/gone.ts
+++ /dev/null
@@ -1 +0,0 @@
-only
\\ No newline at end of file
diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 90%
rename from src/old-name.ts
rename to src/new-name.ts
index 5555555..6666666 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1 +1 @@
-x
+y
diff --git a/img.png b/img.png
index 7777777..8888888 100644
Binary files a/img.png and b/img.png differ
`

describe('parseDiff', () => {
  const files = parseDiff(sample)

  it('파일마다 하나씩 나눈다', () => {
    assert.deepEqual(
      files.map((f) => [f.status, f.oldPath, f.newPath]),
      [
        ['modified', 'src/order.ts', 'src/order.ts'],
        ['added', null, 'src/new.ts'],
        ['deleted', 'src/gone.ts', null],
        ['renamed', 'src/old-name.ts', 'src/new-name.ts'],
        ['modified', 'img.png', 'img.png'],
      ],
    )
  })

  it('변경 덩어리의 시작·길이와 지운 줄·더한 줄 번호를 읽는다 — 내용이 ---·+++로 시작해도 헤더로 보지 않는다', () => {
    const [first, second] = files[0].hunks
    assert.deepEqual([first.oldStart, first.oldLines, first.newStart, first.newLines], [3, 2, 3, 3])
    assert.deepEqual(first.removed, [
      { line: 3, text: 'old3' },
      { line: 4, text: '-- old4 starts with dashes' },
    ])
    assert.deepEqual(first.added.map((a) => a.line), [3, 4, 5])
    assert.equal(first.added[2].text, '++ new5 starts with pluses')
    assert.deepEqual([second.oldStart, second.oldLines, second.newStart, second.newLines], [10, 1, 11, 0])
    assert.deepEqual(second.added, [])
  })

  it('더한 줄·지운 줄 수를 센다', () => {
    assert.deepEqual([files[0].additions, files[0].deletions], [3, 3])
    assert.deepEqual([files[1].additions, files[1].deletions], [2, 0])
  })

  it('"No newline" 표시는 줄로 세지 않는다', () => {
    assert.deepEqual(files[2].hunks[0].removed, [{ line: 1, text: 'only' }])
  })

  it('바이너리 파일은 표시만 하고 변경 덩어리가 없다', () => {
    assert.equal(files[4].binary, true)
    assert.deepEqual(files[4].hunks, [])
  })

  it('빈 diff는 빈 목록이다', () => {
    assert.deepEqual(parseDiff(''), [])
  })
})

describe('oldChangedRanges', () => {
  it('바뀌기 전 파일에서 바뀌거나 지워진 줄 구간을 돌려준다(더하기만 한 덩어리는 뺀다)', () => {
    const files = parseDiff(sample)
    assert.deepEqual(oldChangedRanges(files[0]), [
      [3, 4],
      [10, 10],
    ])
    assert.deepEqual(oldChangedRanges(files[1]), [])
  })
})

describe('mergeRanges', () => {
  it('겹치거나 맞닿은 구간을 합친다', () => {
    assert.deepEqual(
      mergeRanges([
        [10, 10],
        [3, 4],
        [5, 6],
      ]),
      [
        [3, 6],
        [10, 10],
      ],
    )
  })
})
