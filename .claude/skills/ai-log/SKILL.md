---
name: ai-log
description: How the AI interaction log in this repo works (hooks writing logs/ai-interactions.jsonl and logs/AI_INTERACTION_LOG.md) and how to use the ai-log.js CLI to set the stage, record human decisions, rebuild from transcripts and render. Use it at every stage change, after every human accept/reject/modify decision or review verdict, and before the write-up.
---

# AI interaction log

Deliverable D8 (DECISIONS D-12, D-26; schema in `_plan/LOG_SCHEMA.md`). Logging is **automatic**: hooks in `.claude/settings.json` call `.claude/hooks/ai-log.js` on SessionStart, UserPromptSubmit, PreToolUse/PostToolUse (Edit, Write, Bash, Agent, Skill, `mcp__*`), SubagentStop and Stop.

## Files
- `logs/ai-interactions.jsonl` — one JSON object per interaction (machine-readable).
- `logs/AI_INTERACTION_LOG.md` — readable summary generated from the JSONL (per stage → interactions, prompts, verification, outcome, human oversight).
- `logs/HUMAN_OVERSIGHT.md` — human decisions (answers, review verdicts, rejected suggestions, manual checks).
- `logs/.stage` — current stage, read by the hook.

## CLI (contract D-32; run from repo root)
```
node .claude/hooks/ai-log.js stage <name>
node .claude/hooks/ai-log.js human "<text>" --status accepted|rejected|modified [--related <id>]
node .claude/hooks/ai-log.js rebuild <transcript.jsonl | transcript dir>...
node .claude/hooks/ai-log.js render
node .claude/hooks/ai-log.js --selftest
```
- `stage` — set at the start of each stage, before any work.
- `human` — append a `human_decision` record. `--related` = the finding id (`R-03`), test-review id (`T-02`) or interaction id it answers.
- `rebuild` — regenerate the JSONL + summary from Claude Code transcripts (fills `model`, `mode`, planning-phase turns, skills, sub-agents, commit correlation via read-only `git log`).
- `render` — regenerate `AI_INTERACTION_LOG.md` from the current JSONL.
- `--selftest` — must pass after any change to the hook.

Stage names: `setup`, `context`, `spec`, `step1-single-approver`, `step2-two-approver`, `e2e`, `mutation`, `review`, `writeup` (later: `video`, `submit`).

## When to record a human decision
- Every AI suggestion the human (or the main agent on the human's stated rule) **accepts, rejects or modifies** — with the reason.
- Every review verdict: fixed (commit) / dismissed (reason) / deferred (reason), one call per finding.
- Every test-reviewer or mutation-analyst finding that is acted on or declined.
- Every manual correction of AI output (wrong code, wrong claim, reverted edit) and every manual check (e.g. Playwright MCP screenshot reviewed).
- Answers the user gives to agent questions (also captured as `user_prompt`; add a `human` record when it is a decision).

Examples:
```
node .claude/hooks/ai-log.js human "R-02 fixed: identity check now trims and ignores case (commit abc1234)" --status accepted --related R-02
node .claude/hooks/ai-log.js human "test-reviewer T-04 dismissed: DecidedAt already covered by snapshot compare" --status rejected --related T-04
```

## Record fields (LOG_SCHEMA.md)
`id`, `timestamp`, `stage`, `agent`, `agent_name`, `agent_type` (built-in/custom/sub-agent), `ai_tool`, `model`, `mode` (plan/agent), `event` (session_start, user_prompt, tool_use, subagent, skill, assistant_response, human_decision, verification), `related_ids`, `parent_task`, `context`, `request`, `skills_used[]`, `subagents_used[]`, `mcp_tools_used[]`, `tools_used[]`, `suggestion`, `human_decision`, `action_verification`, `limitation`, `status` (applied/rejected/partial/info), `artifacts[]`, `commit`, `session_id`.

## Before the write-up (Stage 8)
1. `rebuild` with the session transcript(s) (`~/.claude/projects/<project>/<session>.jsonl`).
2. Check every line parses: `node -e "require('fs').readFileSync('logs/ai-interactions.jsonl','utf8').trim().split('\n').forEach((l,i)=>{try{JSON.parse(l)}catch(e){console.log('bad line',i+1)}})"`.
3. Check there are entries for planning, every stage, every sub-agent and every skill used.
4. Curate the readable summary only; never invent, alter or remove real interactions; keep the raw JSONL (D-26).

## Never
- Log secrets: passwords other than the documented demo password, PATs, tokens, `Authorization` headers, cookies. If one appears in a prompt or command output, redact it (`***`) before committing.
- Edit `ai-interactions.jsonl` by hand to change history.
- Claim a decision was human when it was the agent's.
