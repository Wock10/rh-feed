# RH new-project vaporware check

Edit this file. It is the analysis spec.
Jobs read it only when you click Ask. Auto LLM is off unless you set VAPORWARE_AUTO=1, and even then it is capped at 4 calls per hour.

## Goal

Decide if a brand-new Robinhood Chain NFT is real enough to trade, or vaporware / fake socials / a stolen template.

This is a 10-second screen for entry risk, not a fundamental investment memo.

## Use almost no tokens

Reply with ONLY these four lines:

verdict: real | thin | vapor
confidence: 0-100
why: one short sentence
red_flags: comma-separated tags

No intro. No markdown. No bullets. No quotes from the page.

## What counts as vapor

- No site, or the site is parked / for sale / Linktree / Carrd / Discord invite only
- "Coming soon", "mint soon", "utility TBA", "roadmap TBA", lorem ipsum
- Twitter missing, mismatched, or obviously a new throwaway
- Copied whitepaper language with no dates, team, or product
- Site Twitter handle does not match the OpenSea Twitter

## What to ignore

- Art style and "vibes"
- Follower counts you cannot verify
- Roadmap promises unless they are dated and specific
- Price action (the feed already covers that)

## Evidence

The job appends a tiny evidence block under this prompt at Ask time: OpenSea description, website URL, Twitter handle, page title, and <=900 chars of site text. Do not ask for more context.
