/**
 * 실행 기록 — claude -p --output-format stream-json --verbose의 출력에서 마지막 결과와 에이전트가 돌린 Bash 명령을 꺼낸다.
 * 슬롭 측정(scripts/slop-eval.mjs)과 리뷰 평가(scripts/review-eval.mjs)가 함께 쓴다.
 */
const OUTPUT_LIMIT = 4000
const DENIED = /^Permission to use \S+ has been denied/

const resultText = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.filter((part) => part?.type === 'text').map((part) => part.text).join('\n') : '')

/**
 * 실행 기록(claude -p --output-format stream-json --verbose) — 마지막 결과와 에이전트가 돌린 Bash 명령(부른 순서).
 * 명령은 성공·실패(종료 코드가 0이 아님)·막힘(권한으로 막힌 호출)·결과 없음. 출력은 끝부분만 남긴다.
 * 결과 한 줄(--output-format json)도 읽는다
 * @param {string} stdout
 * @returns {{ result: any | null, commands: { command: string, status: 'ok' | 'failed' | 'denied' | 'no-result', output: string }[] }}
 */
export const parseStream = (stdout) => {
  let result = null
  const commands = []
  const byId = new Map()
  for (const line of stdout.split('\n')) {
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event?.type === 'result') result = event
    const content = Array.isArray(event?.message?.content) ? event.message.content : []
    if (event?.type === 'assistant') {
      for (const part of content.filter((part) => part?.type === 'tool_use' && part.name === 'Bash' && typeof part.input?.command === 'string')) {
        const command = { command: part.input.command, status: 'no-result', output: '' }
        commands.push(command)
        byId.set(part.id, command)
      }
    }
    if (event?.type === 'user') {
      for (const part of content.filter((part) => part?.type === 'tool_result' && byId.has(part.tool_use_id))) {
        const command = byId.get(part.tool_use_id)
        const text = resultText(part.content)
        command.status = !part.is_error ? 'ok' : DENIED.test(text) ? 'denied' : 'failed'
        command.output = text.slice(-OUTPUT_LIMIT)
      }
    }
  }
  return { result, commands }
}
