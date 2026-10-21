import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { openAt } from '../test/render'

describe('법정 표시 사항', () => {
  it('모든 화면의 아래에 사업자 정보와 사업자정보 공개 링크를 보인다', async () => {
    for (const path of ['/', '/cart', '/orders/7']) {
      const view = openAt(path)
      const footer = screen.getByRole('contentinfo')
      expect(footer).toHaveTextContent('사업자등록번호')
      expect(footer).toHaveTextContent('통신판매업 신고번호')
      expect(footer).toHaveTextContent('호스팅 서비스 제공자')
      expect(screen.getByRole('link', { name: '사업자정보 확인' })).toBeInTheDocument()
      view.unmount()
    }
  })
})
