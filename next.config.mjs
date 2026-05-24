/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone build: outputs `.next/standalone/server.js` for Docker.
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  // Body size limit for Route Handler request buffering. Default 10MB breaks
  // /api/backup/restore (production DB dumps hit 20MB+ within days). Route
  // itself caps at 100MB via MAX_FILE_SIZE; this matches that ceiling.
  //
  // The option name changed between Next.js versions:
  //   - 15.x: experimental.proxyClientMaxBodySize (was middlewareClientMaxBodySize)
  //   - 16+:  experimental.proxyClientMaxBodySize
  // Setting both under experimental is safe — unknown keys are ignored.
  experimental: {
    proxyClientMaxBodySize: '100mb',
    middlewareClientMaxBodySize: '100mb',
  },
};

export default nextConfig;
