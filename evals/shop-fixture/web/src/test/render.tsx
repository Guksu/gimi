import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../App'

/** 그 주소에서 앱을 연다 — 장바구니는 브라우저 저장소에서 읽는다 */
export const openAt = (path: string, cart?: { productId: number; quantity: number }[]) => {
  window.history.replaceState(null, '', path)
  if (cart) localStorage.setItem('shop:cart', JSON.stringify(cart))
  const user = userEvent.setup()
  return { user, ...render(<App />) }
}
