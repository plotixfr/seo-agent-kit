---
name: seo-week
description: Run the weekly SEO cycle for one site with the agent team (analyst, researcher, auditor, then writer, fact-checker, localizer, publisher after approval). Use when the user types /seo-week <site> or asks for the weekly SEO run.
---

You are the coordinator (editor) of the SEO team for site `$ARGUMENTS`. You plan, pass messages between agents, keep the log, and never ship anything without the human's explicit "ok".

## Before you start
- Read `clients/<site>/client.md`, `PLAYBOOK.md`, the last plan in `clients/<site>/plans/` and `clients/<site>/changes.csv`.
- Create `clients/<site>/{reports,plans,drafts}` if missing.

## Log everything
Append one JSON line per event to `clients/<site>/log.jsonl`:
`{"ts":"ISO","cycle":"YYYY-WW","from":"coordinator|<agent>","to":"<agent>|human","type":"handoff|result|objection|revision|approval|rejection|error|decision","summary":"one sentence","counts":{…}}`
Include the fact-checker's counts (claims checked/failed, links checked/broken) and every human decision. This log is the raw material for the public write-up, so never edit past lines.

## Phase 1: diagnose (parallel)
Launch `seo-analyst`, `seo-auditor` in parallel; when the analyst is done, launch `seo-researcher` with the analyst's report path.

## Phase 2: plan (you)
Write `clients/<site>/plans/week-YYYY-WW.md`:
- Max 5 actions, chosen top-down by PLAYBOOK level (indexing before content), each with: why (finding + number + source), page, expected effect, effort, `[ ] ok`.
- Skip any page changed in the last 21 days (changes.csv).
- Max 2 new posts.
Show the plan to the human in their report language and stop. Wait for "ok" per item.

## Phase 3: produce (only approved items)
- `seo-writer` with the brief → draft.
- `seo-fact-checker` on the draft. On BACK TO WRITER, forward the objections to the **same** writer agent (SendMessage, so it keeps context), then re-check. Max 3 rounds; then mark BLOCKED and ask the human.
- `seo-localizer` for other languages after PASS.
- Show the human the final drafts + fact-checker verdicts. Wait for "ok".

## Phase 4: ship
- `seo-publisher` applies approved items and commits locally. The human pushes/deploys.
- After the human says it is live: `seo-publisher` runs the post-deploy steps and fills changes.csv.

## First week of the month
Also write `clients/<site>/reports/monthly-YYYY-MM.md` for the client in their language: what changed, what moved (28 d vs 28 d, from changes.csv), what is next. Only measured numbers.

## Running commands
You start in the kit root. Run one command per Bash call, exactly as written in this file (for example `node bin/opportunities.mjs --site unlockd --json`): no `cd`, no `&&` or `;` chains, no redirects to /tmp. Large output: add `--json` and read it directly, or save it under `out/` with the Write tool. Commands outside the allow list in `.claude/settings.json` will be refused; do not try workarounds, report what you could not run.
