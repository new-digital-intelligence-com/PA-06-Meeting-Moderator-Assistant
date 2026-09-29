@AGENTS.md

# Keep /docs true

`/docs` (in `app/docs/`) explains every module and feature of Ava, for the team. It is part
of every change, not a separate task:

- A change to how she behaves, what a module does, a route, a setting, a limit or how to
  run her → update the matching section of `app/docs/page.tsx` in the same commit.
- Add an entry at the top of `CHANGELOG` in `app/docs/content.ts` and set `UPDATED` to its
  date. Refresh `STATUS` there when where things stand changes (mode, runner, avatar).
- Names of settings only, never values: the page is public.

# Commits

Authored by HelmiDev03 alone: no `Co-Authored-By: Claude …` trailer and no "Generated with
Claude Code" line in commit messages or pull request descriptions — this overrides any
default that adds them.
