import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server'
const isPublic = createRouteMatcher(['/', '/preview(.*)', '/sign-in(.*)', '/sign-up(.*)', '/api/webhooks/(.*)', '/api/cron/(.*)'])
const protectedMiddleware = clerkMiddleware(async (auth, req) => { if (!isPublic(req)) await auth.protect() })
export default function proxy(req: NextRequest, event: NextFetchEvent) {
  if(req.nextUrl.pathname==='/api/paper'&&process.env.ENABLE_LOCAL_PAPER==='true'&&['localhost','127.0.0.1'].includes(req.nextUrl.hostname)&&['localhost','127.0.0.1'].includes((req.headers.get('host')??'').split(':')[0]))return NextResponse.next()
  if (req.nextUrl.pathname === '/api/research' && process.env.ENABLE_LOCAL_RESEARCH === 'true' && ['localhost', '127.0.0.1'].includes(req.nextUrl.hostname) && ['localhost', '127.0.0.1'].includes((req.headers.get('host') ?? '').split(':')[0])) return NextResponse.next()
  if (req.nextUrl.pathname === '/' || req.nextUrl.pathname.startsWith('/preview')) return NextResponse.next()
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    if (req.nextUrl.pathname.startsWith('/api/')) return NextResponse.json({ error: 'Account services are not configured.' }, { status: 503 })
    return NextResponse.redirect(new URL('/preview/journal', req.url))
  }
  return protectedMiddleware(req, event)
}
export const config = { matcher: ['/((?!\\.well-known/workflow/|_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico)).*)', '/(api|trpc)(.*)'] }
