import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    ENIGMA_SERVER_URL: process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080',
  },
  async redirects() {
    return [
      { source: '/setup', destination: '/dashboard/setup', permanent: true },
      { source: '/setup/:path*', destination: '/dashboard/setup/:path*', permanent: true },
    ]
  },
}

export default nextConfig
