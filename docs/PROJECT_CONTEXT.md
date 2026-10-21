# Factrove project memory

Imported on 2026-10-20 from the [Magnificode Projects spreadsheet](https://docs.google.com/spreadsheets/d/1mqM1gBGfQZtMMt8oaPKB9xyPJgGidm9Srk5Dug3LN4Y/edit), specifically Overview (gid `879758894`), Factrove (gid `1463895153`), and Rules (all projects) (gid `1204947103`). The source's status snapshot is dated 2026-10-19. This is reference context, not a live status feed: verify current code, PRs, roadmap, pricing, and launch state before relying on dated details. Current explicit user instructions take precedence over recorded preferences.

## Product and audience

Factrove is a self-hostable home for the HTML artifacts coding agents create, with an open-source product direction and a planned hosted cloud. The name means “the trove of the artifacts.” Postiz is a business-model inspiration.

The intended workflow is to upload HTML using a CLI, receive an artifact ID/link, publish a page for humans, and retrieve it by ID for agents as HTML or Markdown converted on request. Sharing, optional password protection, and iframe embedding are part of the product direction; verify implementation before presenting them as available.

The main problem is preserving agent-created artifacts beyond an individual session and making them usable across teammates using different agents. Primary audience: developers on mixed-agent teams using Claude Code, Codex, and Cursor. Secondary: docs-first teams embedding artifacts in ClickUp or wikis. Tertiary: agencies and consultants. A broader knowledge-base vision is explicitly deferred and should stay out of current copy.

Tom selected the headline “Your agents make artifacts. Factrove keeps them.” and sub-line “Publish for humans. Retrieve for agents.” Positioning also uses “Factrove is the home for your artifacts…”

The differentiation is agent retrieval and curated context: Markdown by ID, a `factrove.md` convention, and open source/self-hosting. Basic HTML hosting is crowded. The source identifies DocStash, tiiny.host, HTMLRadar, and Sentway as competitors; competitor features and prices are historical research, not verified current facts. Do not name DocStash on the site.

## Product and implementation decisions

- Store HTML; never store Markdown. Convert HTML to Markdown on request.
- Prefer S3 CLI conventions when CLI design is ambiguous.
- Use the local stack for testing for now.
- Source roadmap item #15 describes shareable links as a base URL plus artifact ID, requiring no separate server for that link construction.
- Source roadmap item #17 plans versioning through `PUT` using the artifact ID and a corresponding CLI wrapper. Versioning was planned, not live, in this snapshot.
- `factrove.md` committed to Git is curated context; `factrove list` serves discovery and work in progress. CLI auto-appending to `factrove.md` remains undecided.
- The landing page expresses the intended direction; the internal MVP does not establish public feature availability.

The repository's storage invariant still applies: derive the storage key as `{artifactId}.html`; never persist object keys, storage paths, or file locations.

## Recorded communication and approval preferences

The spreadsheet records that Tom approves external sending, posting, publishing, listing changes, PR merges, and deployments. It also records that Chief Of Staff may approve marketing plans on Tom's behalf, while finished content still needs Tom's approval before publication. These are recorded preferences; direct authorization in the current session governs the work.

Do not use the Grok Bot inbox or its tagged addresses to sign up for services unless Tom explicitly requests that particular signup. The source also records approval for copying deliverables to his Mac; the current request explicitly authorizes saving this project context here.

Content should fit the product, serve real user intent, sound human, and state unknown facts as unknown. X is the lead marketing channel, using Tom's personal `@thetomweiss`. Whether `@factrove` exists is unknown. X drafts should use first person, a builder voice, concrete moments, and at most one emoji. Avoid feature lists, taglines, and landing-page copy in X posts.

### Claims and wording

- Do not publicly claim an unapproved price, launch date, SSO, “lossless,” security/encryption/verification guarantees, invented counts, or testimonials without permission.
- Avoid “forever” or “permanent” until retention is defined.
- Describe features as the direction of the product until current availability is verified. The snapshot describes an internal local MVP, not a live public service.
- Say “runs locally,” rather than “on your Mac.”
- Say “get any artifact as Markdown,” never “upload/store Markdown.”
- Describe other products as “designed for that agent's users”; do not attack Claude or frame copy as “Claude can't.”
- Check code examples against the actual CLI. Source examples are `pnpm factrove upload` and `pnpm factrove get <id> --format markdown`, with UUID artifact IDs; otherwise label examples illustrative.

## Historical status: 2026-10-19

Pre-launch: internal MVP on a local stack; private repository; no license, launch date, or hosting recorded. Tom bought `factrove.app` on October 19. Pricing is undecided. Free / Maker $12 / Pro $29 / Team $99 was a marketing proposal, not a decision. Tom explicitly set aside an older $20/month plus $3/additional-user idea. Neither proposal is public pricing. Strategy targets of roughly $2k MRR / 100 paying accounts by day 90 and $10k MRR in 9–12 months are planning assumptions, not actual traction or commitments.

The source records these merges on October 18: PR #4 (API, library, sandboxed viewer), #6 (CLI upload), #7 (local runtime), #9 (local e2e with Garage as S3 stand-in; internal MVP completion), and #8 (roadmap #13, get-by-ID HTML/Markdown).

At the snapshot, PR #10 (roadmap #20, Better Auth login/accounts/API keys) was draft and unmerged. The source says Tom's three review findings were applied at `1bff194` and tests/e2e passed. The required Opus 5.5 review was blocked on included usage being exhausted and on-demand usage being disabled. No alternate merge approval was recorded. Roadmap #20 is not PR #20.

The recorded build loop is feature implementation, Opus 5.5 approval, merge, then next feature. Recorded sequence: #13 → #20 → #15 → #14 → #17 → #44 (shadcn UI with landing logo), with #45 immediately after #20. The remaining queue (#45, #15, #14, #17, #44) was waiting on PR #10. Approved roadmap rows use status “Ready to start.” If a feature needs Tom's input, wait on that feature. Recheck all of this before continuing implementation or merging.

Landing PR #1 was recorded as merged to master on October 18 (`efd2f44`). The waitlist form backend and `og:url`/`og:image` remained unfinished. A later versioning FAQ change was local, with pushing not yet approved. Tom requested no hosting setup for now, including removal of Vercel-related files, and no internal calendar in the landing bundle.

## Marketing work and open decisions

The source records a completed $10k MRR strategy with open questions, a draft 10-week pre-launch cadence, and 60 X drafts (one thread plus five posts per week, W-10 through W-1). W0 was empty and truth-dependent placeholders remained. Proposed timing of a public repo at W-4, Show HN at W-3, and cloud at W0 awaited approval. These relative weeks do not establish a launch date.

A blog strategy and three posts were approved; a blog-section PR for the landing repository was being built and was unmerged. Publishing still depended on a working waitlist and Tom's decision about naming Claude/Codex/Cursor. Proposed cadence: blog/dev.to every two weeks, five posts pre-launch.

SEO topics include sharing Claude artifacts with non-Claude users or Codex teammates, enterprise artifact sharing, hosting HTML artifacts, iframe embeds in ClickUp/wikis, persistent context with AGENTS.md, previous-run context, password-protected HTML, a free HTML-to-Markdown tool, and alternatives pages. The research's strongest stated unmet need is a stable latest-version link, which was planned. Evidence for embedding in docs was weaker. Other ideas include a tool-neutral `factrove.md` convention page and relevant AGENTS.md lists. Revalidate research before citing it publicly.

Open product questions: human-readable titles (the snapshot library showed `{uuid}.html`), retention, CLI access to password-protected artifacts, automatic `factrove.md` updates and required titles, logo emphasis, semantic search/governance, and a Claude Code skill or MCP server (roadmap #28). Tom's local check and real AWS S3 testing were pending.

Open go-to-market questions: waitlist backend, license (AGPL suggested, not chosen), launch date, vendor naming, cadence approval, design partners/testimonials, early-access perks/referrals, Show HN ownership, BoardSync reveal on X, `@factrove` availability, and pushing the versioning FAQ change.

## References

- [Product repository](https://github.com/magnificode-ltd/factrove)
- [Domain](https://factrove.app) (purchase recorded; deployment not established)
- [Roadmap](https://docs.google.com/spreadsheets/d/1fpuXylYGhs544xG6zt7cfHB8qfePDDsEOyVUBZZtmIQ/edit)
- [Pain evidence and competitor research](https://docs.google.com/spreadsheets/d/14QhUn9skCZuOnZCKaXQszGuFvNpvg4T6bibhN_99H4o/edit) (source reported 40 rows, 17 verified)
- [Authentication PR #10](https://github.com/magnificode-ltd/factrove/pull/10)
- [Landing PR #1](https://github.com/magnificode-ltd/factrove-landing/pull/1)

Only the supplied Magnificode Projects spreadsheet was read for this import. Linked roadmap, research, PRs, and the source's `/workspace/factrove/` documents were not independently read or verified. Paths mentioned in that spreadsheet refer to its original agent environment, not this Mac. The source labels its older pre-PR-#4 MVP plan/code audit as stale on build status.
