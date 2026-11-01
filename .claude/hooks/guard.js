#!/usr/bin/env node
/*
 * guard.js — PreToolUse hook (matcher Bash|PowerShell).
 * Denies remote / cloud / credential writes so that only the human pushes:
 *   git push (any form, incl. --force / -f), git remote add|set-url|remove|rm|rename,
 *   git reset --hard origin/..., git config --global|--system, git credential*,
 *   gh (GitHub CLI), aws (AWS CLI).
 * Everything else is allowed (local git add / commit / checkout -b / diff / log ...).
 * Handles chained commands (&&, ||, ;, |, &, newlines), sub-shells, quoted paths,
 * powershell/pwsh/bash/sh/cmd -Command|-c "...", PowerShell -EncodedCommand.
 * Output on deny: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",...}}; always exit 0.
 */
'use strict';

const fs = require('fs');

/** Quote-aware split on shell separators. Quotes are kept inside segments. */
function splitSegments(cmd) {
  const segs = []; let cur = ''; let q = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      if (c === '\\' && q === '"' && i + 1 < cmd.length) { cur += c + cmd[++i]; continue; }
      if (c === q) q = null;
      cur += c; continue;
    }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === ';' || c === '&' || c === '|' || c === '\n' || c === '\r' || c === '(' || c === ')' || c === '{' || c === '}' || c === '`') {
      if (cur.trim()) segs.push(cur); cur = ''; continue;
    }
    cur += c;
  }
  if (cur.trim()) segs.push(cur);
  return segs;
}

const WRAPPER_RE = /^(sudo|env|command|builtin|exec|nohup|time|xargs|powershell|pwsh|bash|sh|zsh|cmd|iex|invoke-expression|eval|start-process|call|\$|@|-.*|\/[ck])$/i;

function normTok(t) { return String(t).replace(/^["']+|["']+$/g, '').replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase(); }

/** Find the executed command word of a segment (skipping wrappers, flags, VAR=val) and its arguments. */
function headOf(seg) {
  // collapse quoted executable paths:  "C:\Program Files\Git\cmd\git.exe" push  ->  git push
  const s = seg.replace(/["']([^"']*[\\/])?(git|gh|aws)(\.exe)?["']/gi, '$2');
  const toks = s.trim().split(/\s+/).filter(Boolean).map(t => t.replace(/^["']+|["']+$/g, ''));
  let i = 0; let prevFlag = false;
  while (i < toks.length) {
    const raw = toks[i]; const t = normTok(raw);
    if (['git', 'gh', 'aws'].includes(t)) return { cmd: t, args: toks.slice(i + 1) };
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(raw)) { i++; prevFlag = false; continue; } // VAR=value
    if (WRAPPER_RE.test(t) || WRAPPER_RE.test(raw)) { prevFlag = raw.startsWith('-'); i++; continue; }
    if (prevFlag) { prevFlag = false; i++; continue; } // value of a wrapper flag, e.g. -ExecutionPolicy Bypass
    return { cmd: t, args: toks.slice(i + 1) };
  }
  return { cmd: null, args: [] };
}

function checkGit(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    i += /^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/.test(args[i]) ? 2 : 1;
  }
  const sub = String(args[i] || '').toLowerCase();
  const rest = args.slice(i + 1).map(a => a.toLowerCase());
  if (sub === 'push') return 'git push is not allowed — pushing to a remote is done by the human only';
  if (sub === 'remote' && ['add', 'set-url', 'remove', 'rm', 'rename'].includes(rest[0])) return `git remote ${rest[0]} is not allowed — remote configuration is changed by the human only`;
  if (sub === 'reset' && rest.includes('--hard') && rest.some(a => /^(origin|upstream)(\/|$)|@\{u(pstream)?\}/.test(a))) return 'git reset --hard to a remote ref is not allowed — it can destroy local work';
  if (sub === 'config' && (rest.includes('--global') || rest.includes('--system'))) return 'git config --global/--system is not allowed — the agent must not change machine-wide git identity or credentials';
  if (sub.startsWith('credential')) return 'git credential commands are not allowed — credentials are handled by the human only';
  return null;
}

function analyze(cmd, depth = 0) {
  cmd = String(cmd || '');
  if (!cmd.trim() || depth > 4) return null;
  // PowerShell -EncodedCommand <base64 utf16le>
  for (const m of cmd.matchAll(/(?:^|\s)-e(?:nc(?:odedcommand)?)?\s+([A-Za-z0-9+/=]{8,})/gi)) {
    try { const r = analyze(Buffer.from(m[1], 'base64').toString('utf16le'), depth + 1); if (r) return r; } catch { /* ignore */ }
  }
  // nested scripts: powershell -Command "...", bash -c '...', cmd /c "...", iex "...", eval "..."
  for (const m of cmd.matchAll(/(?:-command|-c|\/c|\/k|invoke-expression|iex|eval)\s+("((?:[^"\\]|\\.)*)"|'([^']*)')/gi)) {
    const inner = (m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3]);
    const r = analyze(inner, depth + 1); if (r) return r;
  }
  // $( ... ) inside double quotes is executed by bash
  for (const m of cmd.matchAll(/\$\(([^()]*)\)/g)) { const r = analyze(m[1], depth + 1); if (r) return r; }
  for (const seg of splitSegments(cmd)) {
    const { cmd: head, args } = headOf(seg);
    if (head === 'git') { const r = checkGit(args); if (r) return r; }
    if (head === 'gh') return 'the GitHub CLI (gh) is not allowed — pull requests / releases / auth are done by the human only';
    if (head === 'aws') return 'the AWS CLI is not allowed — no cloud changes from the agent';
  }
  return null;
}

function main() {
  let out = null;
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const ti = input.tool_input || {};
    const command = String(ti.command || ti.script || '');
    const reason = analyze(command);
    if (reason) {
      const msg = `Blocked by guard.js: ${reason}. Remote, cloud and credential operations are performed by the human (see AGENTS.md). Local git add/commit/branch/diff/log are allowed.`;
      out = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: msg } });
      try { require('./ai-log.js').logGuardBlock(input, command, msg); } catch { /* logging must never break the guard */ }
    }
  } catch { /* never throw: unparseable input means nothing to guard */ }
  if (out) process.stdout.write(out + '\n');
  process.exit(0);
}

module.exports = { analyze };
if (require.main === module) main();
