import type { NextConfig } from 'next';
import { SERVER_ACTION_BODY_LIMIT } from './lib/data/limits';

const config: NextConfig = {
  // Emits a minimal self-contained server bundle so the runtime image does not
  // need node_modules or the full source tree.
  output: 'standalone',
  experimental: {
    // authInterrupts enables forbidden(), so a student reaching /admin gets a
    // real 403 rather than a 200 that happens to render an error.
    typedRoutes: true,
    authInterrupts: true,
    serverActions: {
      // The restore screen posts a whole backup through a server action, and
      // the parser's default is 1 MB -- which the export crossed, after which
      // restoring one failed with nothing to read. The number is shared with
      // the action that checks it; see `lib/data/limits.ts` for why it is the
      // looser of the two.
      bodySizeLimit: SERVER_ACTION_BODY_LIMIT,
    },
  },
};

export default config;
