---
name: mutation-testing
description: How to run Stryker.NET 4.13.0 on InvoiceApp.Domain in this repo, read surviving mutants from the JSON report, classify them as meaningful or equivalent, write killing tests and record before/after scores as text. Use it for any mutation-testing run, analysis or write-up.
---

# Mutation testing (Stryker.NET 4.13.0)

DECISIONS D-11, D-19: local dotnet tool (`.config/dotnet-tools.json`, `dotnet-stryker` 4.13.0); config `backend/tests/InvoiceApp.Tests/stryker-config.json` (`"project": "InvoiceApp.Domain.csproj"`, reporters progress/cleartext/markdown/json/html, thresholds high 80 / low 60 / break 0, concurrency 4).

## Run
```
cd backend/tests/InvoiceApp.Tests
dotnet tool restore
dotnet stryker
```
- If `dotnet` is not on PATH: `"$LOCALAPPDATA/Microsoft/dotnet/dotnet.exe" stryker`.
- Takes ~20 s–3 min; from an agent, run it in the background and keep working.
- All unit tests must be green first (`dotnet test backend/InvoiceApp.sln`), otherwise Stryker aborts.

## Where reports land
`backend/tests/InvoiceApp.Tests/StrykerOutput/<yyyy-MM-dd.HH-mm-ss>/reports/mutation-report.{md,json,html}` — `StrykerOutput/` is git-ignored, so evidence must be copied into `docs/evidence/` as text. Use the newest folder.

## Read the JSON
Shape: `files["<abs path>.cs"].mutants[]` with `id`, `mutatorName`, `replacement`, `location.start.line/column`, `status`, `coveredBy[]`, `killedBy[]` (test ids). Test ids map to names in `testFiles["<abs path>"].tests[]` (`id`, `name`).
Statuses: `Killed`, `Timeout` (both detected), `Survived`, `NoCoverage` (undetected), `Ignored`, `CompileError` (excluded). Score = detected / (detected + undetected).

List every non-killed mutant (run with the Bash tool; pass the report path):
```
node -e "const p=require('path'),r=require(p.resolve(process.argv[1]));for(const[f,v]of Object.entries(r.files))for(const m of v.mutants)if(['Survived','NoCoverage'].includes(m.status))console.log([p.win32.basename(f),m.location.start.line,m.status,m.mutatorName,JSON.stringify(m.replacement)].join(' | '))" StrykerOutput/<run>/reports/mutation-report.json
```
Output looks like `ApprovalService.cs | 39 | Survived | Statement mutation | ";"` (baseline: the removed `Update` in `Approve`). Then open the source line to see the exact mutation.

## Classify each survivor
- **Meaningful** — the mutation changes observable behaviour a rule cares about; a test is missing or too weak. Examples here: `_repository.Update(invoice)` removed (fake `Update` used to be a no-op → now killed via `UpdateCalls`); `<=`→`<` at a limit; threshold `>`→`>=`; `OrdinalIgnoreCase` lost / `Trim()` lost; denial message → `""` (D-31 messages are asserted, so this is meaningful); `EnsurePending` removed from `Reject`.
- **Equivalent** — no test could ever tell the difference (same behaviour for every input). State *why* concretely.
- **Out of scope / low value** — mutants in code outside this feature (e.g. `DiscountCalculator.cs`, 17 NoCoverage in the baseline; `Invoice.cs` `= string.Empty` initialisers). Keep them in the score for honesty; say so in the write-up.

## Write a killing test
1. Name the mutant: file, line, mutator, replacement.
2. Write the smallest test that passes on real code and fails on the mutant (follow `writing-approval-tests`; denial tests use the full checklist).
3. Prove it: temporarily apply the mutation by hand → test fails → revert → green. Or rerun Stryker and confirm the mutant is `Killed`.
4. Never weaken production code or delete assertions to change the score.

## Record before / after
- BEFORE (exists): `docs/evidence/stryker-before.md` — 30.77 % overall; `ApprovalService.cs` 60.00 % (12 killed / 8 survived); survivors include the three removed `_repository.Update` calls (no-op fake), `EnsurePending` removed in `Reject`, and four error-message strings.
- AFTER: `docs/evidence/stryker-after-1.md` (first run after features) and `docs/evidence/stryker-after-final.md` (after killing tests), same layout as the baseline: date, commit, command, the markdown-reporter table verbatim, final score line, table of remaining non-killed mutants with a meaningful/equivalent verdict.
- `ASSIGNMENT.md` §Mutation: before vs after table (overall + per file), what was killed and how, what remains and why.

## Pitfalls
- Comparing runs with different `stryker-config.json` or mutate scope — keep the config unchanged between before and after.
- Quoting a score you did not see in the report. Paste the real lines.
- Reading an old `StrykerOutput` folder; check the timestamp.
