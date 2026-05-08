import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  async redirects() {
    return [
      { source: '/setup', destination: '/dashboard/setup', permanent: true },
      { source: '/setup/:path*', destination: '/dashboard/setup/:path*', permanent: true },
    ]
  },
}

export default nextConfig
