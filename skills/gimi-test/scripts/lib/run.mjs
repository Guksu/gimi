/**
 * 끝내기 전 검사 명령을 실제로 돌린다 — 종료 코드·걸린 시간·출력 끝·결과 수를 남긴다(금지선 done/unrun-claim).
 * 명령은 새 프로세스 그룹으로 띄운다. 시간을 넘기면 그룹 전체를 멈춘다 — sh -c 아래 테스트 워커가 살아남아 검사가 멈추지 않게.
 * 하위 명령에는 GIMI_CHECK_RUNNING=1을 넘긴다. 검사 명령이 다시 check.mjs를 부르면 check.mjs가 알아보고 멈춘다.
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'

export const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
const MAX_OUTPUT = 200 * 1024
const TAIL_LINES = 20
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g

const count = (pattern, text) => Number(text.match(pattern)?.[1] ?? 0)
const fromLine = (line) => ({ passed: count(/(\d+) passed/, line), failed: count(/(\d+) failed/, line), skipped: count(/(\d+) skipped/, line) })
const lineOf = (text, pattern) => text.split('\n').find((line) => pattern.test(line))

// 위에서부터 고른다 — 앞 도구의 요약 모양이 뒤 도구의 출력에 섞여 나오지 않는 순서다
const PARSERS = [
  (text) => (/^# pass \d+/m.test(text) ? { passed: count(/^# pass (\d+)/m, text), failed: count(/^# fail (\d+)/m, text), skipped: count(/^# skipped (\d+)/m, text) } : null),
  (text) => {
    const line = lineOf(text, /^\s*Tests\s{2,}.*\(\d+\)\s*$/)
    return line ? fromLine(line) : null
  },
  (text) => {
    const line = lineOf(text, /^Tests:\s/)
    return line ? fromLine(line) : null
  },
  (text) => {
    const line = [...text.split('\n')].reverse().find((row) => /\d+ (passed|failed)/.test(row) && / in [\d.]+s/.test(row))
    return line ? fromLine(line) : null
  },
  (text) => {
    const runs = [...text.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)/g)]
    if (runs.length === 0) return null
    const [run, failures, errors, skipped] = runs.at(-1).slice(1).map(Number)
    return { passed: run - failures - errors - skipped, failed: failures + errors, skipped }
  },
  (text) => {
    const match = text.match(/(\d+) tests completed, (\d+) failed(?:, (\d+) skipped)?/)
    if (!match) return null
    const [completed, failed, skipped] = [match[1], match[2], match[3] ?? 0].map(Number)
    return { passed: completed - failed - skipped, failed, skipped }
  },
  (text) => {
    const ok = (text.match(/^ok\s+\S+/gm) ?? []).length
    const fail = (text.match(/^FAIL\s+\S+/gm) ?? []).length
    return ok + fail > 0 ? { passed: ok, failed: fail, skipped: 0, unit: '패키지' } : null
  },
]

/** 테스트 도구 요약에서 통과·실패·건너뜀 수. 못 읽으면 null @param {string} output */
export const parseCounts = (output) => {
  const text = output.replace(ANSI, '')
  for (const parse of PARSERS) {
    const counts = parse(text)
    if (counts) return { unit: '테스트', ...counts }
  }
  return null
}

/**
 * @param {{ root: string, check: { name: string, cwd: string, scope: string, command: string, timeoutMs?: number } }} args
 * @returns {Promise<{ name: string, cwd: string, scope: string, command: string, status: 'pass' | 'fail' | 'timeout', exitCode: number | null, durationMs: number, counts: ReturnType<typeof parseCounts>, outputTail: string[] }>}
 */
export const runCheck = ({ root, check }) =>
  new Promise((resolve) => {
    const started = Date.now()
    let output = ''
    let timedOut = false
    const keep = (chunk) => {
      output += chunk
      if (output.length > MAX_OUTPUT) output = output.slice(-MAX_OUTPUT)
    }
    const finish = ({ exitCode, error }) => {
      clearTimeout(timer)
      if (error) keep(`\n${error.message}`)
      const tail = output.replace(ANSI, '').split('\n').map((line) => line.trimEnd()).filter(Boolean).slice(-TAIL_LINES)
      resolve({
        name: check.name,
        cwd: check.cwd,
        scope: check.scope,
        command: check.command,
        status: timedOut ? 'timeout' : exitCode === 0 ? 'pass' : 'fail',
        exitCode,
        durationMs: Date.now() - started,
        counts: parseCounts(output),
        outputTail: tail,
      })
    }
    // CI=true — 감시 모드로 들어가는 도구(vitest 등)가 한 번만 돌고 끝나게 한다
    const child = spawn('sh', ['-c', check.command], {
      cwd: join(root, check.cwd ?? ''),
      env: { ...process.env, GIMI_CHECK_RUNNING: '1', CI: process.env.CI ?? 'true', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    child.stdout.setEncoding('utf8').on('data', keep)
    child.stderr.setEncoding('utf8').on('data', keep)
    const timer = setTimeout(() => {
      timedOut = true
      try {
        process.kill(-child.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }, check.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    child.on('error', (error) => finish({ exitCode: null, error }))
    child.on('close', (code) => finish({ exitCode: code }))
  })
