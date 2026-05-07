import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Enigma Network',
  description: 'Decentralized AI Compute Network',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  )
}
