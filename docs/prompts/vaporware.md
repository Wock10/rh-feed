# RH new-project vaporware check

Edit this file. It is the analysis spec.
Jobs read it only when you click Ask, and only for collections OpenSea could not score cleanly.
Auto LLM is off unless you set VAPORWARE_AUTO=1, and even then it is capped at 4 calls per hour.

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

- OpenSea has no website, Twitter, or Discord
- Collection is disabled
- Description is parked / for sale / Linktree / Discord-only / "coming soon" / "utility TBA"
- Twitter missing or obviously a throwaway
- One owner with supply already minted and no sales

## What to ignore

- Art style and "vibes"
- Follower counts you cannot verify
- Roadmap promises unless they are dated and specific
- Price action (the feed already covers that)
- Anything OpenSea already scored as verified / approved

## Evidence

The job appends OpenSea collection fields and stats: safelist, created date, supply, owners, sales, volume, website, Twitter, Discord, description. Do not ask for a site scrape. Do not ask for more context.
