import type { Metadata } from 'next'
import './globals.css'
import { Providers } from '@/components/providers/Providers'
import { Navbar } from '@/components/layout/Navbar'
import { Toaster } from 'react-hot-toast'
import localFont from 'next/font/local'
import Marqee from '@/components/layout/Marqee'
import Footer from '@/components/layout/Footer'
 
const myFont = localFont({
  src: [
    {
      path: '../fonts/CraftRounded-DemiBold.ttf',
      weight: '500',
      style: 'normal',
    },
  ],
  variable: '--font-primary',
})

export const metadata: Metadata = {
  title: 'Wavz.fun',
  description:
    'Launch your own token with a fair bonding curve. No presale, no team allocation. Just fair and fun.',
  keywords: ['solana', 'token', 'launchpad', 'meme', 'bonding curve', 'defi'],
    icons: {
    icon: '/favicon.ico',
  },
}
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={myFont.variable}>
      <body className={myFont.className}>
        <Providers>
          {/* Navbar + Marquee sticky at top — z-index must be above the fixed bg video (z:0) */}
          <div style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', flexDirection: 'column' }}>
            <Navbar />
            <Marqee />
          </div>

          {/* Page content */}
          <div className="min-h-screen bg-background" style={{ position: 'relative', zIndex: 2 }}>
            <main className="container mx-auto px-4 py-8">
              {children}
            </main>
          </div>
 <div style={{ position: 'sticky', bottom: 0, zIndex: 50, display: 'flex', flexDirection: 'column' }}>
            <Footer />
          </div>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: '#1a1a1a',
                color: '#fff',
                border: '1px solid #333',
              },
            }}
          />
        </Providers>
      </body>
    </html>
  )
}