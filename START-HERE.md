# Start here (for Jag — not for Claude Code)

1. Copy everything in this folder into the root of a new, empty git repo and commit it.
2. Open Claude Code in the repo and paste this kickoff prompt:

   > Read CLAUDE.md, docs/PROGRESS.md and the M0 row of docs/ROADMAP.md. Use plan mode:
   > propose the M0 plan in ≤ 15 lines, then implement it after I approve.

3. After each milestone: check the review verdict, run `/clear`, then:

   > Continue with the next milestone per docs/PROGRESS.md. Plan first (≤ 15 lines).

4. Switch the main model per the ROADMAP note (Opus for M1/M3/M4/M6, Sonnet otherwise).
5. Use `/compact` if a milestone runs long, and `/cost` or `/usage` to keep an eye on spend.
