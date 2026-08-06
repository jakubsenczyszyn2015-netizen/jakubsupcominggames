/* Supabase connection details.
 *
 * Dashboard → Project Settings → Data API:
 *   URL       → SUPABASE_URL
 *   anon key  → SUPABASE_ANON_KEY
 *
 * The anon key is publishable by design — it identifies the project, and row
 * level security is what actually decides who may read or write. It is meant to
 * ship to browsers, so it belongs in this file.
 *
 * Never put the service_role key here. That one bypasses every policy, and
 * anything in this file is served to every visitor.
 */
window.SUPABASE_URL = 'https://acimhlagxrbrurfhspbr.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFjaW1obGFneHJicnVyZmhzcGJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMzg0NjEsImV4cCI6MjEwMTYxNDQ2MX0.8rppYep-cC5q-SLTWPWcEM6AeqUJ9DdRCpusHnVhdOw';
