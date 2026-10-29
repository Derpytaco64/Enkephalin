import type { NextConfig } from 'next';

const config: NextConfig = {
  // Emits a minimal self-contained server bundle so the runtime image does not
  // need node_modules or the full source tree.
  output: 'standalone',
  experimental: { typedRoutes: true },
};

export default config;
