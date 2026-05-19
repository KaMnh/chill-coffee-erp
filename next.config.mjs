/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone build: outputs `.next/standalone/server.js` for Docker.
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ['localhost', '127.0.0.1'],
};

export default nextConfig;
