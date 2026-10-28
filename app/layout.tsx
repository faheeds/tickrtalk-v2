import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

export const metadata: Metadata = {
  title: 'TickrTalk | Invest with perspective',
  description: 'Research, a connected trading journal, automated investing, and AAOIFI stock screening.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
      <html lang="en">
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        </head>
        <body className="antialiased">
          {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? <ClerkProvider>{children}</ClerkProvider> : children}
        </body>
      </html>
  )
}
