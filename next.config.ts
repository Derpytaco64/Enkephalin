import type { NextConfig } from 'next';

const config: NextConfig = {
  // Emits a minimal self-contained server bundle so the runtime image does not
  // need node_modules or the full source tree.
  output: 'standalone',
  // authInterrupts enables forbidden(), so a student reaching /admin gets a
  // real 403 rather than a 200 that happens to render an error.
  experimental: { typedRoutes: true, authInterrupts: true },
};

export default config;
