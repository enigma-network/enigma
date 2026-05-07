import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { nextUrl } = req
  const isLoggedIn = !!req.auth?.user

  const isProtected =
    nextUrl.pathname.startsWith('/dashboard') ||
    nextUrl.pathname.startsWith('/profile') ||
    nextUrl.pathname === '/onboard'

  if (isProtected && !isLoggedIn) {
    return NextResponse.redirect(new URL('/login', nextUrl))
  }

  // /dashboard/setup is Provider/Admin only
  if (
    nextUrl.pathname === '/dashboard/setup' &&
    req.auth?.user?.role !== 'PROVIDER' &&
    req.auth?.user?.role !== 'ADMIN'
  ) {
    return NextResponse.redirect(new URL('/dashboard', nextUrl))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/dashboard/:path*', '/profile', '/onboard'],
}
