import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    ENIGMA_SERVER_URL: process.env.ENIGMA_SERVER_URL ?? 'http://localhost:8080',
  },
}

export default nextConfig
