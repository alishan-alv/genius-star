/* /api/config — exposes the public backend configuration to the browser as a script.
 *
 * Set these environment variables in Vercel (Project → Settings → Environment Variables):
 *   SUPABASE_URL       e.g. https://abcdefghijklmnop.supabase.co
 *   SUPABASE_ANON_KEY  the project's anon / publishable key (safe to expose; RLS protects data)
 *
 * Without them the game runs in local mode (guest play, records in the browser).
 * Uses only plain Node http primitives so tools/serve.js can reuse it locally.
 */
'use strict';

function publicConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_ANON_KEY || '').trim();
  const valid = /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url) && key.length > 20 && key.length < 400;
  return valid ? { supabaseUrl: url, supabaseAnonKey: key } : {};
}

module.exports = function handler(req, res) {
  const body = 'window.GS_CONFIG=' + JSON.stringify(publicConfig()).replace(/</g, '\\u003c') + ';';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
};

module.exports.publicConfig = publicConfig;
