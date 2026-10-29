import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { db, schema } from '@/db';

export const auth = betterAuth({
  // usePlural: our tables are `users`/`sessions`/`accounts`/`verifications`,
  // where better-auth otherwise expects the singular forms.
  database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: true }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    // No mailer is configured yet, so requiring verification would lock
    // everyone out. See PLAN.md, phase 1 decisions.
    requireEmailVerification: false,
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
