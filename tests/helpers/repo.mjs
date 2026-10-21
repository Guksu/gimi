/**
 * 테스트용 임시 git 저장소 — 실제 git으로 커밋을 쌓아 맥락 수집을 시험한다.
 * 사용자의 전역 git 설정(서명·작성자)에 흔들리지 않게 작성자는 환경 변수로, 서명은 -c로 끈다.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'tester',
  GIT_AUTHOR_EMAIL: 'tester@example.com',
  GIT_COMMITTER_NAME: 'tester',
  GIT_COMMITTER_EMAIL: 'tester@example.com',
}

export const makeRepo = ({ dir = mkdtempSync(join(tmpdir(), 'gimi-ctx-')), init = true } = {}) => {
  const git = (...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: dir, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (init) git('init', '-q', '-b', 'main')
  const write = (files) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), text)
    }
  }
  const remove = (path) => rmSync(join(dir, path))
  const commit = (message) => {
    git('add', '-A')
    git('commit', '-q', '-m', message)
    return git('rev-parse', 'HEAD').trim()
  }
  const cleanup = () => rmSync(dir, { recursive: true, force: true })
  return { dir, git, write, remove, commit, cleanup }
}

/** 실제 git + 가짜 gh — gh는 테스트마다 응답을 정한다 */
export const execFor = ({ dir, gh }) => ({
  git: (args) => execFileSync('git', ['-c', 'core.quotePath=false', '-c', 'log.showSignature=false', '-c', 'color.ui=false', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }),
  gh:
    gh ??
    (() => {
      throw Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })
    }),
})

export const lines = (count, prefix = 'line') => Array.from({ length: count }, (_, i) => `${prefix}${i + 1}`).join('\n') + '\n'
