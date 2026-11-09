import { describe, expect, it } from 'vitest';
import { parseTrustedOrigins } from '@/lib/auth-origins';

/**
 * The reverse-proxy sign-in failure, pinned.
 *
 * better-auth seeds its trusted-origin list with exactly one entry -- the
 * origin of `baseURL` -- and refuses any sign-in whose `Origin` header is not
 * in that list with `Invalid origin` and a 403. Put a proxy in front and the
 * browser's origin becomes the public hostname while `baseURL` still names the
 * LAN address, so login breaks with no other symptom.
 *
 * `BETTER_AUTH_TRUSTED_ORIGINS` is how the other addresses get in. These tests
 * exist because the failure mode of getting the parsing wrong is *silent*: an
 * empty or malformed entry matches no origin, so it looks exactly like a
 * configured value that simply did not help.
 */

describe('parsing the trusted-origin list', () => {
  it('takes one origin', () => {
    expect(parseTrustedOrigins('https://drugs.example.com'))
      .toEqual(['https://drugs.example.com']);
  });

  it('takes several, comma-separated', () => {
    expect(parseTrustedOrigins(
      'https://drugs.example.com,http://192.168.1.50:3636,https://zima.tailnet.ts.net',
    )).toEqual([
      'https://drugs.example.com',
      'http://192.168.1.50:3636',
      'https://zima.tailnet.ts.net',
    ]);
  });

  it('tolerates the spaces a person types after a comma', () => {
    expect(parseTrustedOrigins('https://a.example, http://b.example:3636'))
      .toEqual(['https://a.example', 'http://b.example:3636']);
  });

  /**
   * The case this function exists for. A trailing comma is the most ordinary
   * way to write a list, and an empty string in `trustedOrigins` matches
   * nothing -- so passing it through would read as a configured value that
   * quietly does not work.
   */
  it('drops blank entries rather than passing an origin that matches nothing', () => {
    expect(parseTrustedOrigins('https://a.example,')).toEqual(['https://a.example']);
    expect(parseTrustedOrigins(',https://a.example')).toEqual(['https://a.example']);
    expect(parseTrustedOrigins('https://a.example,,http://b.example'))
      .toEqual(['https://a.example', 'http://b.example']);
    expect(parseTrustedOrigins('  ,  ')).toEqual([]);
  });

  it('gives an empty list when unset, which is better-auth own default', () => {
    expect(parseTrustedOrigins(undefined)).toEqual([]);
    expect(parseTrustedOrigins('')).toEqual([]);
  });

  /**
   * `https://host/` and `https://host` are the same place, and a reader should
   * not have to know which form the comparison wants.
   */
  it('trims a trailing slash, so a pasted URL still works', () => {
    expect(parseTrustedOrigins('https://drugs.example.com/'))
      .toEqual(['https://drugs.example.com']);
    expect(parseTrustedOrigins('http://192.168.1.50:3636//'))
      .toEqual(['http://192.168.1.50:3636']);
  });

  /**
   * Not a URL parser, deliberately. Whatever is given is handed to
   * better-auth, which does its own matching and supports wildcard patterns --
   * so validating here would reject forms the library accepts.
   */
  it('passes a wildcard pattern through untouched', () => {
    expect(parseTrustedOrigins('https://*.example.com'))
      .toEqual(['https://*.example.com']);
  });
});
