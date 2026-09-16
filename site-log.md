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
- **2026-09-16** — Discovered the 09-12 two-step form (Company Role, Industry as a
  second step) was committed to this repo but never actually deployed; live had been
  quietly running the original single-step form the whole time. Izaiah's call: drop the
  two-step form for good, do not re-attempt deploying it. Reverted `index.html` to the
  single-step form by pulling the exact bytes off the live site (proven-working source
  of truth) rather than hand-reversing the two-step diff, so the repo now matches
  production exactly. Confirmed before reverting: both forms still post to the correct,
  currently-live webhook trigger (`7f8b94f0-9fae-48ce-9f19-c5b537bba5a6`) with zero
  occurrences of an unrelated older trigger ID (`6004111c...`) found in an unrelated
  stale file that was never used. `thank-you.html` needed no change, already identical
  to live. Everything else from 09-12 (schema, canonical, `_headers`, `robots.txt`)
  was already live and untouched by this revert. `scripts/mobile-qa.mjs` still pending.
- **2026-09-16** — Izaiah's call: replace the light-cream design with the dark navy/gold
  design (`--bg:#0B0E13`, `--gold:#FFC20E`, Big Shoulders Display + Public Sans), pasted
  in from an external source. Applied as given, with two corrections flagged and made
  before deploying:
  1. Webhook trigger in the pasted source was `6004111c-fd5a-45bb-b769-e3e681774f4a`,
     never tested against this project. Swapped for `7f8b94f0-9fae-48ce-9f19-c5b537bba5a6`,
     the one confirmed working via a real test submission (see 09-11 entry).
  2. Canonical/og:url in the pasted source pointed at `valkriewraps.xyz` (the other
     Valkyrie site's domain) -- the exact bug already found and fixed once on 09-12.
     Pointed back at this project's own address on both index.html and thank-you.html
     (thank-you.html had no canonical at all in the pasted source; added one).
  LocalBusiness JSON-LD schema, present in the previous version, is NOT in this pasted
  design and was not re-added -- deployed as given rather than silently combining the
  two. `_headers`, `robots.txt`, security headers untouched, still applying site-wide.
  `scripts/mobile-qa.mjs` still pending, now more relevant since this is a full
  design swap, not just a form-field change.
