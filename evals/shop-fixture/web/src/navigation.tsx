import { type MouseEvent, type ReactNode, useEffect, useState } from 'react'

/** 주소 바꾸기 — 화면 안에서는 pushState, 결제창처럼 밖으로 갈 때는 redirect */
export const navigate = (to: string) => {
  window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export const redirect = (url: string) => window.location.assign(url)

export const useLocation = () => {
  const [location, setLocation] = useState(() => ({ pathname: window.location.pathname, search: window.location.search }))
  useEffect(() => {
    const update = () => setLocation({ pathname: window.location.pathname, search: window.location.search })
    window.addEventListener('popstate', update)
    return () => window.removeEventListener('popstate', update)
  }, [])
  return location
}

export const Link = ({ to, children }: { to: string; children: ReactNode }) => (
  <a
    href={to}
    onClick={(event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault()
      navigate(to)
    }}
  >
    {children}
  </a>
)
