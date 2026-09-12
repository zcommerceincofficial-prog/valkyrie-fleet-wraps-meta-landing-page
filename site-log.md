# Site log — Valkyrie Fleet Wraps, Meta ads landing page

This site was built by mirroring the live production HTML, not from a Claude Design
export, so it has no `site/` raw-export folder and no build step — `index.html` and
`thank-you.html` are the served files directly. The scripts below still apply.

- **2026-09-11** — Mirrored live site into this repo. Wired lead webhook
  (`FvnVnnGvT8TrWzmIlMXz` / trigger `7f8b94f0-9fae-48ce-9f19-c5b537bba5a6`), made Vehicle
  Type and Company Name required, added Meta Pixel (base on every page, Lead event on
  thank-you only). Confirmed via real test submission (webhook 204, landed on
  `/thank-you`).
- **2026-09-12** — Added a B2B-qualifying second form step (Company Role, Industry,
  both required) on both forms; added plain-language "business vehicles only" copy;
  changed "First Name" label to "Full Name". Verified with a real end-to-end test
  submission (name "Test Meta Ignore") — landed correctly, webhook 204.
- **2026-09-12** — Ran `scripts/machine-layer-check.mjs` against the live site for the
  first time. Found and fixed: canonical tag and `og:url` were pointing at
  `valkriewraps.xyz` (the OTHER Valkyrie site's domain, copied over during the mirror
  and never corrected) — now self-referencing this site's own `.pages.dev` address.
  Found and fixed a skipped heading level (H1 straight to H3 on the hero form card);
  bumped it to H2 and its "You're All Set" success heading to H3, updated the matching
  CSS selectors so nothing visually changed. Added LocalBusiness JSON-LD schema (there
  was none). Added meta description and canonical to `thank-you.html` (both missing).
  There was no real `robots.txt` or `sitemap.xml` in the repo, so Cloudflare Pages was
  falling back to serving the full `index.html` (45KB) at those paths under a 200 —
  added real files, plus a real `404.html` so unmatched paths stop doing that. Added
  `_headers` for security headers. Decision: this variant is a paid-Meta-traffic-only
  duplicate of the real site, so it is now `noindex, follow` and `robots.txt` is
  `Disallow: /` on purpose — it should never compete with `valkriewraps.xyz` in organic
  search. Deployed, probed, and re-ran the check live: all page-level checks pass.
  `scripts/mobile-qa.mjs` run pending against both live pages, all 8 viewports.
