import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseStream } from '../scripts/lib/stream.mjs'

describe('parseStream — 실행 기록(stream-json)', () => {
  const event = (value) => JSON.stringify(value)
  const use = (id, command) => event({ type: 'assistant', message: { content: [{ type: 'text', text: '돌려 본다' }, { type: 'tool_use', id, name: 'Bash', input: { command, description: 'x' } }] } })
  const answer = (id, content, isError) => event({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } })

  it('에이전트가 돌린 Bash 명령을 부른 순서대로 성공·실패·막힘으로 꺼내고, 마지막 결과를 읽는다', () => {
    const stdout = [
      event({ type: 'system', subtype: 'init' }),
      use('a', 'ls web/src'),
      use('b', 'npm test -w web'),
      event({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'a.ts' } }] } }),
      use('c', 'npm run lint'),
      answer('b', 'Exit code 1\n실패 1', true),
      answer('a', [{ type: 'text', text: 'cart.ts' }], false),
      answer('r', '파일 내용', false),
      answer('c', "Permission to use Bash has been denied because Claude Code is running in don't ask mode.", true),
      use('d', 'npx tsc --noEmit'),
      '깨진 줄',
      event({ type: 'result', result: '구현했습니다', total_cost_usd: 0.5, duration_ms: 10, num_turns: 4, permission_denials: [] }),
    ].join('\n')
    const { result, commands } = parseStream(stdout)
    assert.equal(result.result, '구현했습니다')
    assert.equal(result.total_cost_usd, 0.5)
    assert.deepEqual(commands, [
      { command: 'ls web/src', status: 'ok', output: 'cart.ts' },
      { command: 'npm test -w web', status: 'failed', output: 'Exit code 1\n실패 1' },
      { command: 'npm run lint', status: 'denied', output: "Permission to use Bash has been denied because Claude Code is running in don't ask mode." },
      { command: 'npx tsc --noEmit', status: 'no-result', output: '' },
    ])
  })

  it('막는 규칙(--disallowedTools)에 걸린 명령도 막힘이다 — 메시지에 명령이 들어 있다', () => {
    const stdout = [use('a', 'cd web && npx vitest run'), answer('a', 'Permission to use Bash with command cd web && npx vitest run has been denied.', true)].join('\n')
    assert.equal(parseStream(stdout).commands[0].status, 'denied')
  })

  it('명령 출력은 끝부분만 남긴다. 결과 한 줄(json 형식)도 읽는다', () => {
    const long = Array.from({ length: 3000 }, (_, i) => `줄 ${i}`).join('\n')
    const { commands } = parseStream([use('a', 'npm test'), answer('a', long, false)].join('\n'))
    assert.ok(commands[0].output.length <= 4000)
    assert.ok(commands[0].output.endsWith('줄 2999'))
    assert.deepEqual(parseStream(event({ type: 'result', result: '끝' })), { result: { type: 'result', result: '끝' }, commands: [] })
    assert.deepEqual(parseStream('형식 없음'), { result: null, commands: [] })
  })
})
