import type { Metadata } from 'next'
import { Syne } from 'next/font/google'
import './globals.css'

const syne = Syne({ subsets: ['latin'], weight: ['700', '800'] })

export const metadata: Metadata = {
  title: 'Enigma Network',
  description: 'Decentralized AI Compute Network',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <style>{`:root { --font-syne: ${syne.style.fontFamily}; }`}</style>
        {children}
      </body>
    </html>
  )
}
