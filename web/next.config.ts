import type { NextConfig } from 'next'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { version } = require('./package.json')

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    APP_VERSION: version,
  },
  async redirects() {
    return [
      { source: '/setup', destination: '/dashboard/setup', permanent: true },
      { source: '/setup/:path*', destination: '/dashboard/setup/:path*', permanent: true },
    ]
  },
}

export default nextConfig
