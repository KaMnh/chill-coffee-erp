/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone build: outputs `.next/standalone/server.js` for Docker.
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ['localhost', '127.0.0.1'],
  // Body size limit for Route Handlers + middleware. Default is 10MB which
  // breaks /api/backup/restore for any non-trivial DB (a 50-row Chill DB
  // dump is already ~3MB; production data hits 10MB+ quickly). The route
  // itself caps at 100MB via MAX_FILE_SIZE; this matches that ceiling.
  middlewareClientMaxBodySize: '100mb',
};

export default nextConfig;
