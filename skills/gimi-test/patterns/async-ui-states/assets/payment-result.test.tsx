import { screen } from '@testing-library/react'
import { http, HttpResponse, type HttpResponseResolver } from 'msw'
import { describe, expect, it } from 'vitest'
import { API, order, server } from '../test/server'
import { openAt } from '../test/render'

const RETURN_URL = '/payments/success?paymentKey=pay_1&orderId=7&amount=15000'
const CART = [{ productId: 1, quantity: 2 }]

/** 확정 응답을 정한다 — 주문 조회는 아직 결제 대기인 주문을 돌려준다(확인 중인 결제) */
const confirmAnswers = (resolver: HttpResponseResolver) =>
  server.use(
    http.post(`${API}/payments/confirm`, resolver),
    http.get(`${API}/orders/7`, () => HttpResponse.json(order({ status: 'pending_payment', paidAt: null }))),
  )
const cartItems = () => JSON.parse(localStorage.getItem('shop:cart') ?? '[]') as unknown[]

// 서버 응답의 상태마다 화면 하나 — 상태마다 "보여야 할 것"과 "보이면 안 되는 것"을 함께 본다
describe('결제 결과 — 서버가 답한 상태마다', () => {
  it('응답을 기다리는 동안 마무리 중이라고 보이고, 완료라고 하지 않는다', async () => {
    let release = () => {}
    const answered = new Promise<void>((resolve) => (release = resolve))
    confirmAnswers(async () => (await answered, HttpResponse.json(order())))
    openAt(RETURN_URL)

    expect(screen.getByText('결제를 마무리하고 있어요')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '결제가 끝났어요' })).not.toBeInTheDocument()

    release()
    expect(await screen.findByRole('heading', { name: '결제가 끝났어요' })).toBeInTheDocument()
  })

  it('결제 완료(200·paid)면 완료와 결제 금액을 보이고 장바구니를 비운다', async () => {
    confirmAnswers(() => HttpResponse.json(order({ status: 'paid', total: 15000 })))
    openAt(RETURN_URL, CART)

    expect(await screen.findByRole('heading', { name: '결제가 끝났어요' })).toBeInTheDocument()
    expect(screen.getByText('15,000원')).toBeInTheDocument()
    expect(cartItems()).toEqual([])
  })

  it('입금 대기(200·waiting_for_deposit)면 완료가 아니라 입금을 기다린다고 보인다', async () => {
    confirmAnswers(() => HttpResponse.json(order({ status: 'waiting_for_deposit', method: 'virtual_account', paidAt: null })))
    openAt(RETURN_URL)

    expect(await screen.findByRole('heading', { name: '입금을 기다리고 있어요' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '결제가 끝났어요' })).not.toBeInTheDocument()
  })

  it('확인 중(202)이면 완료로 보이지 않고, 장바구니도 비우지 않는다', async () => {
    confirmAnswers(() => HttpResponse.json({ status: 'checking', message: '확인 중' }, { status: 202 }))
    openAt(RETURN_URL, CART)

    expect(await screen.findByRole('heading', { name: '결제를 확인하고 있어요' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '결제가 끝났어요' })).not.toBeInTheDocument()
    expect(cartItems()).toHaveLength(1)
  })

  it('거절(402)이면 이유를 보이고 다시 결제할 길을 준다', async () => {
    confirmAnswers(() => HttpResponse.json({ code: 'PAYMENT_REJECTED', message: '카드사 거절' }, { status: 402 }))
    openAt(RETURN_URL)

    expect(await screen.findByRole('alert')).toHaveTextContent('결제가 거절됐어요. 다른 결제수단으로 다시 시도해 주세요')
    expect(screen.getByRole('link', { name: '주문으로 돌아가 다시 결제하기' })).toHaveAttribute('href', '/orders/7')
  })
})
