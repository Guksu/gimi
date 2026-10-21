import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

// NestJS는 데코레이터 메타데이터로 의존성을 넣는다 — esbuild는 이것을 내지 못해 SWC로 바꾼다
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // 테스트 파일이 같은 DB를 쓴다 — 하나씩 돌린다
    fileParallelism: false,
    testTimeout: 15000,
  },
})
