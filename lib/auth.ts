import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { db, schema } from '@/db';
import { parseTrustedOrigins } from '@/lib/auth-origins';

export const auth = betterAuth({
  // usePlural: our tables are `users`/`sessions`/`accounts`/`verifications`,
  // where better-auth otherwise expects the singular forms.
  database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: true }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  // Everything the app may be reached at besides baseURL -- a reverse proxy
  // hostname, a Tailscale name. Without it better-auth answers a sign-in from
  // any other origin with `Invalid origin` and a 403. See lib/auth-origins.ts.
  trustedOrigins: parseTrustedOrigins(process.env.BETTER_AUTH_TRUSTED_ORIGINS),
  emailAndPassword: {
    enabled: true,
    // No mailer is configured yet, so requiring verification would lock
    // everyone out. See PLAN.md, phase 1 decisions.
    requireEmailVerification: false,
    // The handler at /api/auth/[...all] mounts better-auth's own sign-up
    // endpoint, which would let anyone create an account and bypass the
    // invite gate entirely. Accounts are created only by lib/users.ts, which
    // the gated register action calls after a code is claimed.
    disableSignUp: true,
  },
  user: {
    additionalFields: {
      // input:false keeps these out of the signup payload: a registrant must
      // not be able to make themselves an admin.
      role: { type: 'string', input: false, defaultValue: 'student' },
      status: { type: 'string', input: false, defaultValue: 'active' },
    },
  },
  plugins: [nextCookies()],
});
