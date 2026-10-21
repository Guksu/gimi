import { describe, expect, it } from 'vitest'
import { formatPrice } from './format'

describe('formatPrice — 금액 표시는 이 함수 하나로', () => {
  it.each([
    [0, '0원'],
    [6000, '6,000원'],
    [10000000, '10,000,000원'],
    [-3000, '-3,000원'],
  ])('%i → %s', (won, text) => {
    expect(formatPrice(won)).toBe(text)
  })
})
