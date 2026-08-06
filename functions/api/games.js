/* Cloudflare Pages Function — GET /api/games
 *
 * The browser cannot talk to the GitHub API often: unauthenticated access is
 * 60 requests/hour per IP, shared by everyone on a network. This runs on the
 * edge instead, so:
 *
 *   - a token can be held server-side (5,000 requests/hour) without shipping it
 *     to visitors, and
 *   - the response is cached, so a thousand visitors polling every 5 seconds
 *     still cost one upstream request per TTL rather than one each.
 *
 * Optional binding (Pages → Settings → Environment variables):
 *   GITHUB_TOKEN — a fine-grained token with Issues: read on this repo.
 *                  Without it this still works, just on the smaller quota, so
 *                  the cache TTL is raised to compensate.
 */

const REPO = 'jakubsenczyszyn2015-netizen/jakubsupcominggames';
const UPSTREAM = `https://api.github.com/repos/${REPO}/issues?state=open&per_page=100`;

export async function onRequestGet({ env }) {
  const token = env && env.GITHUB_TOKEN;
  // With a token the quota is ample, so cache briefly and stay responsive.
  // Without one, cache longer so the 60/hour budget is not the bottleneck.
  const ttl = token ? 5 : 45;

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'jakubs-upcoming-games',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token) headers.Authorization = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(UPSTREAM, { headers, cf: { cacheTtl: ttl, cacheEverything: true } });
  } catch (err) {
    return json({ error: 'Could not reach GitHub: ' + err.message }, 502, 0);
  }

  if (!res.ok) {
    const detail = res.status === 403 || res.status === 429
      ? 'GitHub rate limit reached at the edge.' + (token ? '' : ' Add a GITHUB_TOKEN binding to raise it.')
      : `GitHub returned ${res.status}.`;
    // Do not cache a failure for long, so recovery is quick.
    return json({ error: detail }, res.status === 404 ? 404 : 502, 0);
  }

  const issues = (await res.json()).filter(i => !i.pull_request);

  // Only the fields the site actually renders — smaller responses, and issue
  // metadata the page never uses does not get republished through this route.
  const slim = issues.map(i => ({
    number: i.number,
    title: i.title,
    body: i.body,
    html_url: i.html_url,
    reactions: { total_count: i.reactions ? i.reactions.total_count : 0 }
  }));

  return json(slim, 200, ttl);
}

function json(data, status, ttl) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': ttl ? `public, max-age=${ttl}` : 'no-store',
      'Access-Control-Allow-Origin': '*'
    }
  });
}
