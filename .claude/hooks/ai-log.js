#!/usr/bin/env node
/*
 * ai-log.js — automatic, structured AI interaction log for Claude Code.
 *
 * Hook mode (no args, hook JSON on stdin): SessionStart, UserPromptSubmit,
 *   PostToolUse, SubagentStop, Stop  ->  one record per event in logs/ai-interactions.jsonl
 * CLI:
 *   node .claude/hooks/ai-log.js stage <name>
 *   node .claude/hooks/ai-log.js human "<text>" [--status accepted|rejected|modified] [--related <id>]
 *   node .claude/hooks/ai-log.js rebuild <transcript.jsonl|dir> [...]
 *   node .claude/hooks/ai-log.js render
 *   node .claude/hooks/ai-log.js --selftest
 *
 * Record schema: _plan/LOG_SCHEMA.md (every key always present, fixed order).
 * Node built-ins only. Hook mode never blocks the session: all errors are swallowed, exit code is always 0.
 * Env AI_LOG_DIR overrides the output folder (used by --selftest and for dry runs).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..');
const CONTEXT = 'AI in SDLC assignment — approval limits by role';
const DEMO_PASSWORD = 'ChangeMe123!';
const KEYS = ['id', 'timestamp', 'stage', 'agent', 'agent_name', 'agent_type', 'ai_tool', 'model', 'mode', 'event',
  'related_ids', 'parent_task', 'context', 'request', 'skills_used', 'subagents_used', 'mcp_tools_used', 'tools_used',
  'suggestion', 'human_decision', 'action_verification', 'limitation', 'status', 'artifacts', 'commit', 'session_id'];
const ARRAY_KEYS = new Set(['related_ids', 'skills_used', 'subagents_used', 'mcp_tools_used', 'tools_used', 'artifacts']);
const FIELD_LIMIT = { request: 4000, suggestion: 600, limitation: 600, action_verification: 2000 };
const VERIFY_RE = /dotnet\s+(build|test)|stryker|npm\s+(run\s+)?test|playwright\s+test|openspec(@[\d.]+)?\s+validate/i;
const RESULT_LINE_RE = /Passed!|Failed!|Build succeeded|Build FAILED|error|mutation score|passed|failed|✓|✘|valid/i;
const STRONG_RESULT_RE = /Passed!|Failed!|Build succeeded|Build FAILED|mutation score|Error\(s\)|Warning\(s\)|\d+\s+(passed|failed)|is valid|valid/i;
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/* ----------------------------------------------------------------- paths */
function logDir() { return process.env.AI_LOG_DIR ? path.resolve(process.env.AI_LOG_DIR) : path.join(REPO, 'logs'); }
function P(name) { return path.join(logDir(), name); }
const F = {
  jsonl: 'ai-interactions.jsonl', md: 'AI_INTERACTION_LOG.md', oversight: 'HUMAN_OVERSIGHT.md',
  human: 'human-decisions.jsonl', stages: 'stages.json', stage: '.stage', state: '.state.json',
};
function ensureDir() { fs.mkdirSync(logDir(), { recursive: true }); }

/* ------------------------------------------------------- text utilities */
/**
 * Optional local redaction list: JSON array of { "pattern": "<regex>", "label": "<name>" }.
 * Path: $AI_LOG_REDACT_FILE, else .claude/hooks/redact.local.json (git-ignored). Loaded once.
 */
let LOCAL_REDACTIONS = null;
function localRedactions() {
  if (LOCAL_REDACTIONS) return LOCAL_REDACTIONS;
  LOCAL_REDACTIONS = [];
  const file = process.env.AI_LOG_REDACT_FILE || path.join(__dirname, 'redact.local.json');
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const item of Array.isArray(list) ? list : []) {
      try { LOCAL_REDACTIONS.push([new RegExp(item.pattern, 'gi'), String(item.label || 'private')]); } catch { /* skip bad regex */ }
    }
  } catch { /* no local list */ }
  return LOCAL_REDACTIONS;
}
function redact(s) {
  if (typeof s !== 'string' || !s) return s;
  let out = s
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED:github-token]')
    .replace(/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED:github-token]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED:aws-key]')
    .replace(/(?<![A-Za-z0-9])sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g, '[REDACTED:api-key]')
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED:bearer]')
    // personal / company e-mail addresses (keep public no-reply and example addresses)
    .replace(/\b[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      (m) => (/(users\.noreply\.github\.com|noreply@anthropic\.com|@example\.(com|org))$/i.test(m) ? m : '[REDACTED:email]'))
    .replace(/\bdev\.azure\.com(?:\/[A-Za-z0-9._-]+)*/gi, '[REDACTED:internal-host]');
  // Machine-specific patterns (company hosts, client names, partial e-mails) live in a
  // git-ignored file so the committed code never reveals what it hides. See logs/README.md.
  for (const [re, label] of localRedactions()) out = out.replace(re, `[REDACTED:${label}]`);
  out = out.replace(/((?:\\?["'])?\bpassword(?:\\?["'])?\s*[:=]\s*(?:\\?["'])?)([^"'\s,;&}\\]+)/gi,
    (m, pre, val) => (val === DEMO_PASSWORD || val.startsWith('[REDACTED') ? m : pre + '[REDACTED:password]'));
  return out;
}
function trunc(s, n) {
  if (typeof s !== 'string' || s.length <= n) return s;
  return s.slice(0, n) + ` …[truncated ${s.length - n} chars]`;
}
function oneLine(s, n) { return trunc(String(s == null ? '' : s).replace(/\s+/g, ' ').trim(), n); }
function stripAnsi(s) { return String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); }
function stripReminders(s) { return String(s).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim(); }
function firstLine(s) { const l = String(s || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean); return l.length ? oneLine(l.slice(0, 2).join(' — '), 300) : null; }
function sanitize(v, key) {
  if (typeof v === 'string') return trunc(redact(v), FIELD_LIMIT[key] || 4000);
  if (Array.isArray(v)) return v.map(x => sanitize(x, key));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = sanitize(v[k], key === 'request' ? key : '_nested'); return o; }
  return v;
}
function makeRecord(f) {
  const r = {};
  for (const k of KEYS) {
    let v = f[k];
    if (v === undefined || v === '') v = ARRAY_KEYS.has(k) ? [] : null;
    if (ARRAY_KEYS.has(k) && !Array.isArray(v)) v = v == null ? [] : [v];
    r[k] = sanitize(v, k);
  }
  return r;
}
function compactTs(iso) { return String(iso).replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z'); }
function slugify(s, n = 32) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n).replace(/-+$/g, '') || 'x';
}
function shortHash(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 6); }
function makeId(ts, event, slugSrc, uniq) {
  return `${compactTs(ts)}-${event}-${slugify(slugSrc)}-${shortHash(uniq == null ? Math.random() + ts : uniq)}`;
}
function isoNow() { return new Date().toISOString(); }
function readJson(file, dflt) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dflt; } }
function readJsonl(file) {
  let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of txt.split(/\r?\n/)) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* skip */ } }
  return out;
}
function appendJsonl(file, rec) { ensureDir(); fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf8'); }
function normPath(p) {
  let s = String(p || '');
  const m = s.match(/^\/([a-zA-Z])\/(.*)$/); // Git Bash style /c/Users/...
  if (m) s = `${m[1].toUpperCase()}:/${m[2]}`;
  return s;
}
function relArtifact(p) {
  if (!p) return null;
  try {
    const rel = path.relative(REPO, path.resolve(REPO, normPath(p)));
    return (rel || '.').split(path.sep).join('/');
  } catch { return String(p); }
}
function aiTool(version, entrypoint) {
  let s = 'Claude Code';
  if (version) s += ' ' + version;
  if (entrypoint === 'claude-vscode') s += ' (VS Code extension)';
  else if (entrypoint === 'cli') s += ' (CLI)';
  else if (entrypoint) s += ` (${entrypoint})`;
  return s;
}
function fileExists(p) { try { return fs.existsSync(p); } catch { return false; } }
function agentDefType(name) { return name && fileExists(path.join(REPO, '.claude', 'agents', `${name}.md`)) ? 'custom' : 'built-in'; }
function skillDefType(name) { return name && !/[:/\\]/.test(name) && fileExists(path.join(REPO, '.claude', 'skills', name, 'SKILL.md')) ? 'custom' : 'built-in'; }
function roleFromPrompt(p) {
  const m = String(p || '').match(/You are (?:the |an? )?["“']([A-Za-z0-9][\w-]{2,40})["”'] (?:sub-?)?agent/i);
  return m ? m[1] : null;
}
function stageAt(ts, stages) {
  let s = 'planning'; const t = Date.parse(ts);
  for (const st of stages) if (Date.parse(st.started_at) <= t) s = st.name;
  return s;
}
function readStages() {
  const a = readJson(P(F.stages), []);
  return (Array.isArray(a) ? a : []).filter(x => x && x.name && x.started_at).sort((x, y) => Date.parse(x.started_at) - Date.parse(y.started_at));
}
function currentStage() { try { const s = fs.readFileSync(P(F.stage), 'utf8').trim(); if (s) return s; } catch { /* default */ } return 'setup'; }

/* --------------------------------------------------- tool -> record map */
function responseText(resp) {
  if (resp == null) return '';
  if (typeof resp === 'string') return resp;
  if (Array.isArray(resp)) return resp.map(b => (typeof b === 'string' ? b : (b && b.type === 'text' ? b.text : ''))).filter(Boolean).join('\n');
  if (typeof resp === 'object') {
    const parts = [];
    if (typeof resp.stdout === 'string') parts.push(resp.stdout);
    if (typeof resp.stderr === 'string') parts.push(resp.stderr);
    if (parts.length) return parts.join('\n');
    if (resp.content != null) return responseText(resp.content);
    for (const k of ['output', 'result', 'error', 'message']) if (typeof resp[k] === 'string') return resp[k];
  }
  try { return JSON.stringify(resp).slice(0, 2000); } catch { return ''; }
}
/** Quote-aware split on shell separators (heredoc / here-string bodies removed first). */
function shellSegments(cmd) {
  const s = String(cmd || '')
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2[ \t]*(?=\r?\n|$)/g, '\n')
    .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, ' ');
  const segs = []; let cur = ''; let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '\\' && q === '"') { cur += c + (s[++i] || ''); continue; } if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (';&|\n\r(){}`'.includes(c)) { if (cur.trim()) segs.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) segs.push(cur.trim());
  return segs;
}
/** True when the command actually RUNS a build / test / mutation / spec-validation tool (not just mentions it). */
function isVerificationCommand(cmd) {
  // VERIFY_RE is the documented pattern; the prefilter is looser so "$DN" test / quoted dotnet paths are also seen
  if (!VERIFY_RE.test(String(cmd || '')) && !/\b(test|build|stryker)\b/i.test(String(cmd || ''))) return false;
  return shellSegments(cmd).some((seg) => {
    let s = seg.replace(/^(?:(?:sudo|env|time|nohup|exec|command)\s+|[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+)+/, '');
    if (/--version\b|--help\b|--list-sdks\b|--info\b/.test(s)) return false;
    s = s.replace(/^(?:&\s*)?["']?(?:[^"'\s]*[\\/])?dotnet(?:\.exe)?["']?(?=\s)/i, 'dotnet') // quoted / absolute dotnet path
      .replace(/^["']?\$\{?[A-Za-z_]\w*\}?["']?(?=\s+(?:build|test|stryker)\b)/, 'dotnet'); // "$DN" test
    return /^dotnet\s+(build|test|stryker)\b/i.test(s) || /^(dotnet-)?stryker\b/i.test(s)
      || /^npm\s+(run\s+)?test\b/i.test(s) || /^npx\s+(?:-y\s+)?playwright\s+test\b/i.test(s) || /^playwright\s+test\b/i.test(s)
      || /^(?:npx\s+(?:-y\s+)?)?(?:@[\w-]+\/)?openspec(@[\d.]+)?\s+validate\b/i.test(s);
  });
}
function outcomeOf(resp, text, isErrorFlag) {
  // only trust these markers when they are the tool's own error result, never when they merely appear in stdout
  const errText = `${typeof resp === 'string' ? resp.slice(0, 300) : ''}\n${isErrorFlag ? text.slice(0, 300) : ''}`;
  const rejected = /User rejected tool use|The user doesn't want to proceed with this tool use/i.test(errText);
  const guard = /Blocked by guard\.js/.test(errText);
  let error = !!isErrorFlag;
  if (typeof resp === 'string' && /^\s*(Error\b|<tool_use_error>)/.test(resp)) error = true;
  if (resp && typeof resp === 'object' && !Array.isArray(resp)) {
    if (resp.is_error === true || resp.interrupted === true || resp.success === false) error = true;
    if (typeof resp.error === 'string' && resp.error) error = true;
    if (resp.status === 'failed' || resp.status === 'error') error = true;
  }
  return { rejected, guard, error: error || rejected || guard };
}
function extractResultLines(text) {
  const lines = stripAnsi(text).split(/\r?\n/).map(l => l.trim()).filter(l => l && RESULT_LINE_RE.test(l));
  const uniq = [...new Set(lines)];
  const strong = uniq.filter(l => STRONG_RESULT_RE.test(l));
  const rest = uniq.filter(l => !STRONG_RESULT_RE.test(l));
  return [...strong.slice(-6), ...rest.slice(0, Math.max(0, 8 - Math.min(6, strong.length)))].slice(0, 8).map(l => trunc(l, 200));
}
function summarizeInput(input) {
  if (!input || typeof input !== 'object') return '';
  for (const k of ['file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'command', 'element', 'text']) {
    if (typeof input[k] === 'string' && input[k]) return oneLine(input[k], 150);
  }
  try { return oneLine(JSON.stringify(input), 150); } catch { return ''; }
}
function mapTool(name, input, resp, isErrorFlag, extraText) {
  name = String(name || 'unknown');
  input = input && typeof input === 'object' ? input : {};
  let text = responseText(resp);
  if (extraText && !text.includes(extraText.slice(0, 60))) text = `${extraText}\n${text}`;
  const oc = outcomeOf(resp, text, isErrorFlag);
  const f = { event: 'tool_use', tools_used: [name], status: oc.error ? 'partial' : 'applied' };
  if (oc.error) f.limitation = firstLine(text) || 'tool reported an error';
  if (oc.rejected) { f.status = 'rejected'; f.human_decision = 'rejected — user declined this tool call'; f.limitation = 'Tool call rejected by the user'; }

  if (name === 'Agent' || name === 'Task') {
    const sub = input.subagent_type || 'general-purpose';
    const role = roleFromPrompt(input.prompt);
    let st = oc.error ? 'failed' : 'completed';
    if (!oc.error && resp && typeof resp === 'object' && !Array.isArray(resp)) {
      if (resp.status === 'async_launched' || resp.isAsync === true) st = 'partial'; // launched in background; rebuild resolves the final status
      else if (['completed', 'failed', 'partial'].includes(resp.status)) st = resp.status;
    }
    f.event = 'subagent';
    f.agent_type = 'sub-agent';
    f.agent_name = role || sub;
    f.subagents_used = [{ name: sub, type: agentDefType(sub), task: input.description || oneLine(input.prompt, 120) || null, status: st }];
    f.request = `Agent(${sub}${role ? ' as ' + role : ''}): ${input.description || ''} — ${oneLine(input.prompt, 300)}`;
  } else if (name === 'Skill') {
    const sk = input.skill || input.name || input.command || 'unknown';
    const args = input.args == null || input.args === '' ? null : (typeof input.args === 'string' ? input.args : JSON.stringify(input.args));
    f.event = 'skill';
    f.skills_used = [{ name: sk, type: skillDefType(sk), purpose: args, invocation: 'explicit' }];
    f.request = `Skill ${sk}${args ? ' ' + oneLine(args, 200) : ''}`;
  } else if (name.startsWith('mcp__')) {
    const rest = name.slice(5); const i = rest.indexOf('__');
    const server = i >= 0 ? rest.slice(0, i) : rest; const tool = i >= 0 ? rest.slice(i + 2) : '';
    f.mcp_tools_used = [{ server, tool, purpose: summarizeInput(input) || null }];
    f.request = `${server}.${tool} ${summarizeInput(input)}`.trim();
  } else if (FILE_TOOLS.has(name)) {
    const fp = input.file_path || input.notebook_path || (resp && typeof resp === 'object' && (resp.filePath || resp.file_path));
    const rel = relArtifact(fp);
    f.artifacts = rel ? [rel] : [];
    f.request = `${name} ${rel || ''}`.trim();
  } else if (SHELL_TOOLS.has(name)) {
    const cmd = String(input.command || '');
    f.request = trunc(cmd, 500);
    if (isVerificationCommand(cmd) && !oc.rejected && !oc.guard) {
      const lines = extractResultLines(text);
      const failed = oc.error || lines.some(l => /Failed!|Build FAILED|\b[1-9]\d*\s+failed\b/i.test(l));
      f.event = 'verification';
      f.action_verification = `${oneLine(cmd, 300)} → ${lines.length ? lines.join(' | ') : (input.run_in_background ? 'started in background (result in later notification)' : (failed ? 'failed (no summary lines)' : 'completed (no summary lines)'))}`;
      if (failed) f.status = 'partial';
    }
  } else {
    f.request = `${name} ${summarizeInput(input)}`.trim();
  }
  if (oc.guard) { f.event = 'guard_block'; f.status = 'rejected'; f.limitation = firstLine(text); }
  return f;
}

/* ------------------------------------------------------- transcript I/O */
function readTail(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let s = buf.toString('utf8');
    if (start > 0) s = s.slice(s.indexOf('\n') + 1);
    return s;
  } catch { return ''; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
}
function readHead(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.slice(0, n).toString('utf8');
  } catch { return ''; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ } }
}
/** Cheap facts from the end of a transcript: model, version, entrypoint, last assistant text. */
function transcriptInfo(file, bytes) {
  const info = { model: null, version: null, entrypoint: null, lastText: null, mode: null };
  if (!file) return info;
  const lines = readTail(normPath(file), bytes).split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let o; try { o = JSON.parse(lines[i]); } catch { continue; }
    if (!info.version && o.version) info.version = o.version;
    if (!info.entrypoint && o.entrypoint) info.entrypoint = o.entrypoint;
    if (!info.mode && o.permissionMode) info.mode = o.permissionMode;
    if (o.type === 'assistant' && o.message) {
      if (!info.model && o.message.model && o.message.model !== '<synthetic>') info.model = o.message.model;
      if (!info.lastText && Array.isArray(o.message.content)) {
        const t = o.message.content.filter(b => b && b.type === 'text' && b.text).map(b => b.text).join('\n');
        if (t.trim()) info.lastText = t;
      }
    }
    if (info.model && info.version && info.entrypoint && info.lastText && info.mode) break;
  }
  return info;
}

/* --------------------------------------------------------------- state */
function readState() { const s = readJson(P(F.state), {}); return s && typeof s === 'object' ? s : {}; }
function writeState(s) { try { ensureDir(); fs.writeFileSync(P(F.state), JSON.stringify(s), 'utf8'); } catch { /* ignore */ } }

function hookBase(input, tinfo, st, now) {
  const sub = input.agent_id || (input.agent_type && input.hook_event_name !== 'SubagentStop');
  const mode = input.permission_mode || tinfo.mode;
  return {
    timestamp: now, stage: currentStage(), agent: 'agent',
    agent_name: sub ? (input.agent_type || 'sub-agent') : 'claude-code-main',
    agent_type: sub ? 'sub-agent' : 'built-in',
    ai_tool: aiTool(tinfo.version, tinfo.entrypoint), model: tinfo.model || 'unknown',
    mode: mode === 'plan' ? 'plan' : 'agent', context: CONTEXT,
    related_ids: st.parent_task ? [st.parent_task] : [], parent_task: st.parent_task || null,
    session_id: input.session_id || null, commit: null,
  };
}

/* ------------------------------------------------------------ hook mode */
function hookMain(raw) {
  let input; try { input = JSON.parse(raw); } catch { return; }
  if (!input || typeof input !== 'object') return;
  const ev = input.hook_event_name;
  const known = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'SubagentStop', 'Stop'];
  if (!known.includes(ev)) return;
  const st = readState();
  const now = isoNow();
  const tinfo = transcriptInfo(input.transcript_path, ev === 'Stop' ? 256 * 1024 : 64 * 1024);
  const b = hookBase(input, tinfo, st, now);
  let rec = null; let render = false;

  if (ev === 'SessionStart') {
    rec = { ...b, event: 'session_start', request: `Session ${input.source || 'startup'} in ${input.cwd || ''}`.trim(), status: 'info' };
    st.session_id = input.session_id || null; st.tools = [];
  } else if (ev === 'UserPromptSubmit') {
    const prompt = String(input.prompt || '');
    const event = /^\s*\/[\w:-]+(\s|$)/.test(prompt) ? 'slash_command' : 'user_prompt';
    const id = makeId(now, event, prompt, input.session_id + now + prompt.length);
    rec = { ...b, id, event, request: prompt, parent_task: id, related_ids: [], status: 'info' };
    st.parent_task = id; st.prompt_head = oneLine(prompt, 120); st.tools = [];
  } else if (ev === 'PostToolUse' || ev === 'PostToolUseFailure') {
    const m = mapTool(input.tool_name, input.tool_input, input.tool_response != null ? input.tool_response : input.error,
      ev === 'PostToolUseFailure');
    rec = { ...b, ...m };
    rec.id = makeId(now, m.event, m.request || input.tool_name, input.tool_use_id);
    st.tools = Array.isArray(st.tools) ? st.tools : [];
    if (input.tool_name && !st.tools.includes(input.tool_name)) st.tools.push(input.tool_name);
  } else if (ev === 'SubagentStop') {
    const atp = input.agent_transcript_path;
    const ai = atp ? transcriptInfo(atp, 128 * 1024) : { lastText: null, model: null };
    const role = atp ? roleFromPrompt(readHead(normPath(atp), 16 * 1024)) : null;
    const name = input.agent_type || 'general-purpose';
    rec = {
      ...b, event: 'subagent', agent_name: role || name, agent_type: 'sub-agent', model: ai.model || b.model,
      request: `Sub-agent ${role || name} finished`, suggestion: ai.lastText ? oneLine(ai.lastText, 600) : null,
      subagents_used: [{ name, type: agentDefType(name), task: role, status: 'completed' }], status: 'applied',
    };
  } else if (ev === 'Stop') {
    rec = {
      ...b, event: 'assistant_response', request: `Final response to: ${st.prompt_head || '(prompt not captured)'}`,
      suggestion: tinfo.lastText ? oneLine(tinfo.lastText, 600) : null,
      tools_used: Array.isArray(st.tools) ? st.tools : [], status: 'applied',
    };
    render = true;
  }
  if (!rec) return;
  if (!rec.id) rec.id = makeId(now, rec.event, rec.request || rec.event, input.session_id + now + ev);
  appendJsonl(P(F.jsonl), makeRecord(rec));
  writeState(st);
  if (render) renderAll();
}

/** Used by guard.js when it denies a command. */
function logGuardBlock(input, command, reason) {
  try {
    input = input || {};
    const st = readState(); const now = isoNow();
    const b = hookBase(input, transcriptInfo(input.transcript_path, 32 * 1024), st, now);
    const rec = {
      ...b, event: 'guard_block', request: trunc(String(command || ''), 500), tools_used: [input.tool_name || 'Bash'],
      limitation: reason, status: 'rejected',
    };
    rec.id = makeId(now, 'guard_block', command, input.tool_use_id || now + command);
    appendJsonl(P(F.jsonl), makeRecord(rec));
  } catch { /* never throw */ }
}

/* ------------------------------------------------------------------ CLI */
function cmdStage(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('usage: stage <name>');
  ensureDir();
  const now = isoNow();
  const stages = readJson(P(F.stages), []);
  const list = Array.isArray(stages) ? stages : [];
  list.push({ name, started_at: now });
  fs.writeFileSync(P(F.stages), JSON.stringify(list, null, 2) + '\n', 'utf8');
  fs.writeFileSync(P(F.stage), name + '\n', 'utf8');
  const st = readState();
  const rec = {
    ...hookBase({ session_id: st.session_id }, {}, st, now), stage: name, id: makeId(now, 'stage_change', name, 'stage' + name + now),
    event: 'stage_change', request: `Stage → ${name}`, status: 'info', model: null,
  };
  appendJsonl(P(F.jsonl), makeRecord(rec));
  console.log(`stage set to "${name}"`);
}
function humanRecord(text, status, related, now, st) {
  return makeRecord({
    id: makeId(now, 'human_decision', text, 'human' + now + text), timestamp: now, stage: currentStage(),
    agent: 'human', agent_name: 'human', agent_type: 'human', ai_tool: null, model: null, mode: null,
    event: 'human_decision', related_ids: related ? [related] : (st.parent_task ? [st.parent_task] : []),
    parent_task: st.parent_task || null, context: CONTEXT, request: text, human_decision: `${status}: ${text}`,
    status, session_id: st.session_id || null, commit: null,
  });
}
function cmdHuman(args) {
  const text = args[0];
  if (!text) throw new Error('usage: human "<text>" [--status accepted|rejected|modified] [--related <id>]');
  let status = 'accepted'; let related = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--status') status = String(args[++i] || 'accepted');
    else if (args[i] === '--related') related = args[++i] || null;
  }
  if (!['accepted', 'rejected', 'modified'].includes(status)) throw new Error('--status must be accepted|rejected|modified');
  const rec = humanRecord(text, status, related, isoNow(), readState());
  appendJsonl(P(F.human), rec);
  appendJsonl(P(F.jsonl), rec);
  renderAll();
  console.log(`human decision logged: ${rec.id}`);
}

/* -------------------------------------------------------------- rebuild */
function collectFiles(paths) {
  const out = [];
  const walk = (p) => {
    let s; try { s = fs.statSync(p); } catch { console.error(`skip (not found): ${p}`); return; }
    if (s.isDirectory()) { for (const e of fs.readdirSync(p)) walk(path.join(p, e)); } else if (/\.jsonl$/i.test(p)) out.push(path.resolve(p));
  };
  for (const p of paths) walk(normPath(p));
  return [...new Set(out)];
}
function userText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const t = content.filter(b => b && b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
  const imgs = content.filter(b => b && b.type === 'image').length;
  return imgs ? `${t}${t ? '\n' : ''}[+${imgs} image${imgs > 1 ? 's' : ''} attached]` : t;
}
function gitCommits() {
  try {
    const out = cp.execFileSync('git', ['-C', REPO, 'log', '--format=%h|%cI'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    return out.split(/\r?\n/).filter(Boolean).map(l => { const [h, d] = l.split('|'); return { h, t: Date.parse(d) }; })
      .filter(c => c.h && !isNaN(c.t)).sort((a, b) => a.t - b.t);
  } catch { return []; }
}

function rebuild(paths) {
  if (!paths.length) throw new Error('usage: rebuild <transcript.jsonl|dir> [...]');
  ensureDir();
  const stages = readStages();
  const files = collectFiles(paths).map(f => {
    const lines = readJsonl(f);
    const meta = readJson(f.replace(/\.jsonl$/i, '.meta.json'), null);
    const side = lines.length > 0 && lines.filter(l => l && l.isSidechain === true).length > lines.length / 2;
    const first = lines.find(l => l && l.timestamp);
    return { f, lines, meta, side, t0: first ? Date.parse(first.timestamp) : 0 };
  }).sort((a, b) => (a.side - b.side) || (a.t0 - b.t0));

  const recs = [];
  const seenUuid = new Set();
  const promptByPromptId = {};
  const agentRecByToolUse = {};
  const agentRecByAgentId = {};
  const notif = {};
  const notifSummary = {};
  const agentDone = {};
  const sessionsStarted = new Set();
  let seq = 0;
  const push = (r) => { r._seq = seq++; recs.push(r); return r; };

  // pre-pass: background task notifications (tool-use-id -> completed|failed)
  for (const d of files) for (const l of d.lines) {
    if (!l) continue;
    let t = null;
    if (l.type === 'user' && l.message) t = userText(l.message.content);
    else if (l.type === 'queue-operation' && typeof l.content === 'string') t = l.content; // queued while the main agent was busy
    if (!t) continue;
    const m = t.match(/<task-notification>[\s\S]*?<tool-use-id>([^<]+)<\/tool-use-id>[\s\S]*?<status>([^<]+)<\/status>/);
    if (m) {
      notif[m[1].trim()] = m[2].trim();
      const sm = t.match(/<summary>([\s\S]*?)<\/summary>/);
      if (sm) notifSummary[m[1].trim()] = sm[1].trim();
    }
  }

  for (const d of files) {
    const firstWith = (k) => { const x = d.lines.find(l => l && l[k]); return x ? x[k] : null; };
    const cur = { parent: null, parentHead: '', mode: 'agent', version: firstWith('version'), entry: firstWith('entrypoint'), model: null, turnText: null, turnTs: null, turnModel: null, turnTools: [], lastSlash: null };
    const pending = {};
    const sideMeta = d.meta || {};
    let sideRole = null; let sideAgentId = null; let sideParent = null; let sideRelated = [];
    const sideName = () => sideRole || sideMeta.agentType || 'sub-agent';
    const base = (ts, l) => {
      const side = d.side || (l && l.isSidechain === true);
      const parent = side ? (sideParent || cur.parent) : cur.parent;
      return {
        timestamp: ts, stage: stageAt(ts, stages), agent: 'agent',
        agent_name: side ? sideName() : 'claude-code-main', agent_type: side ? 'sub-agent' : 'built-in',
        ai_tool: aiTool(cur.version, cur.entry), model: cur.model || 'unknown', mode: cur.mode, context: CONTEXT,
        parent_task: parent, related_ids: side ? [...new Set([parent, ...sideRelated].filter(Boolean))] : (parent ? [parent] : []),
        session_id: (l && l.sessionId) || null, commit: null, _side: side,
      };
    };
    const flushTurn = () => {
      if (cur.turnText) {
        const r = { ...base(cur.turnTs, { isSidechain: d.side, sessionId: cur.sessionId }), event: 'assistant_response', model: cur.turnModel || cur.model || 'unknown',
          request: `${d.side ? 'Sub-agent final response' : 'Final response'} to: ${cur.parentHead || (d.side ? sideMeta.description || 'task' : '(no prompt)')}`,
          suggestion: oneLine(cur.turnText, 600), tools_used: [...new Set(cur.turnTools)], status: 'applied' };
        r.id = makeId(r.timestamp, 'assistant_response', r.suggestion, cur.turnUuid);
        push(r);
      }
      cur.turnText = null; cur.turnTools = [];
    };
    const emitTool = (p, resp, isErr, resultTs, extraText) => {
      const m = mapTool(p.name, p.input, resp, isErr, extraText);
      const b = base(p.ts, p.line);
      const r = { ...b, ...m, model: p.model || b.model };
      if (!p.line.isSidechain && !d.side && !['subagent'].includes(m.event)) { r.agent_name = 'claude-code-main'; r.agent_type = 'built-in'; }
      if (d.side) { r.agent_name = sideName(); r.agent_type = 'sub-agent'; }
      r.id = makeId(p.ts, m.event, m.request || p.name, p.id);
      r._resultTs = resultTs;
      if (m.event === 'verification' && /started in background/.test(m.action_verification || '') && notif[p.id]) {
        r.action_verification = m.action_verification.replace(/started in background.*$/, `background task ${notif[p.id]}${notifSummary[p.id] ? ': ' + notifSummary[p.id] : ''}`);
        if (/failed|killed/.test(notif[p.id])) r.status = 'partial';
      }
      push(r);
      if (p.name === 'Agent' || p.name === 'Task') {
        agentRecByToolUse[p.id] = r;
        const aid = resp && typeof resp === 'object' && !Array.isArray(resp) ? resp.agentId : null;
        if (aid) agentRecByAgentId[aid] = r;
        r._agentId = aid;
      }
    };

    for (const l of d.lines) {
      if (!l || typeof l !== 'object' || !l.type) continue;
      if (l.uuid) { if (seenUuid.has(l.uuid)) continue; seenUuid.add(l.uuid); }
      if (l.version) cur.version = l.version;
      if (l.entrypoint) cur.entry = l.entrypoint;
      if (l.permissionMode) cur.mode = l.permissionMode === 'plan' ? 'plan' : 'agent';
      if (l.sessionId) cur.sessionId = l.sessionId;
      const ts = l.timestamp;
      if (!d.side && l.sessionId && ts && !sessionsStarted.has(l.sessionId)) {
        sessionsStarted.add(l.sessionId);
        const r = { ...base(ts, l), event: 'session_start', request: `Session ${l.sessionId} (from transcript ${path.basename(d.f)})${l.cwd ? ' in ' + l.cwd : ''}`, status: 'info', model: null, parent_task: null, related_ids: [] };
        r.id = makeId(ts, 'session_start', 'session', l.sessionId);
        push(r);
      }
      if (d.side && !sideAgentId && l.agentId) {
        sideAgentId = l.agentId;
        const ar = agentRecByAgentId[sideAgentId] || (sideMeta.toolUseId && agentRecByToolUse[sideMeta.toolUseId]);
        if (l.promptId && promptByPromptId[l.promptId]) sideParent = promptByPromptId[l.promptId];
        else if (ar) sideParent = ar.parent_task;
        if (ar) { sideRelated = [ar.id]; sideRole = ar.agent_name !== (ar.subagents_used[0] || {}).name ? ar.agent_name : null; }
      }
      if (l.type === 'assistant' && l.message) {
        const model = l.message.model && l.message.model !== '<synthetic>' ? l.message.model : null;
        if (model) cur.model = model;
        for (const blk of Array.isArray(l.message.content) ? l.message.content : []) {
          if (!blk || typeof blk !== 'object') continue;
          if (blk.type === 'text' && blk.text && blk.text.trim()) { cur.turnText = blk.text; cur.turnTs = ts; cur.turnModel = model || cur.model; cur.turnUuid = l.uuid || ts; cur.lastWasText = true; }
          else if (blk.type === 'tool_use' && /Handback$/.test(String(blk.name)) && blk.input && typeof blk.input.message === 'string') {
            // sub-agent final report delivered through the hand-back tool = its final response
            cur.turnText = blk.input.message; cur.turnTs = ts; cur.turnModel = model || cur.model; cur.turnUuid = blk.id; cur.lastWasText = true; cur.handback = true;
          } else if (blk.type === 'tool_use' && blk.id) { pending[blk.id] = { id: blk.id, name: blk.name, input: blk.input, ts, model: model || cur.model, line: l }; cur.turnTools.push(blk.name); cur.lastWasText = false; }
          // thinking blocks are intentionally never read
        }
        continue;
      }
      if (l.type === 'attachment' && l.attachment && /skill/i.test(String(l.attachment.type || '')) && !/listing|available|catalog/i.test(String(l.attachment.type))) {
        const a = l.attachment; const names = [].concat(a.skills || a.names || a.name || a.skillName || []).map(x => (typeof x === 'string' ? x : x && x.name)).filter(Boolean);
        for (const n of names) {
          const r = { ...base(ts, l), event: 'skill', request: `Skill ${n} loaded automatically`, skills_used: [{ name: n, type: skillDefType(n), purpose: null, invocation: 'automatic' }], status: 'applied' };
          r.id = makeId(ts, 'skill', n, (l.uuid || ts) + n); push(r);
        }
        continue;
      }
      if (l.type !== 'user' || !l.message) continue;
      const content = l.message.content;
      if (Array.isArray(content) && content.some(x => x && x.type === 'tool_result')) {
        for (const blk of content) {
          if (!blk || blk.type !== 'tool_result') continue;
          const p = pending[blk.tool_use_id];
          if (!p) continue;
          delete pending[blk.tool_use_id];
          const resp = l.toolUseResult !== undefined && content.filter(x => x && x.type === 'tool_result').length === 1 ? l.toolUseResult : blk.content;
          // the tool_result block text is also passed so guard denials / user rejections are detected whatever toolUseResult holds
          const blkText = resp === blk.content ? null : responseText(blk.content).slice(0, 2000);
          emitTool(p, resp, blk.is_error === true || (typeof resp === 'string' && blk.is_error !== false && /^Error/.test(resp)), ts, blk.is_error === true ? blkText : null);
        }
        continue;
      }
      if (l.isMeta === true) continue;
      const raw = userText(content);
      const text = stripReminders(raw);
      if (!text) continue;
      if (/^<task-notification>/.test(text)) { flushTurn(); continue; }
      if (/^<local-command-caveat>/.test(text)) continue;
      if (/^<local-command-stdout>/.test(text)) {
        if (cur.lastSlash) cur.lastSlash.request = `${cur.lastSlash.request} → ${oneLine(text.replace(/<\/?local-command-stdout>/g, ''), 200)}`;
        continue;
      }
      if (/^\[Request interrupted by user/.test(text)) {
        flushTurn();
        const r = { ...base(ts, l), event: 'human_decision', agent: 'human', agent_name: 'human', agent_type: 'human', ai_tool: null, model: null,
          request: text, human_decision: 'rejected: user interrupted the running request', status: 'rejected' };
        r.id = makeId(ts, 'human_decision', 'interrupt', l.uuid || ts); push(r);
        continue;
      }
      if (d.side || l.isSidechain === true) {
        if (!sideRole) sideRole = roleFromPrompt(text);
        if (!cur.parentHead) cur.parentHead = oneLine(sideMeta.description || text, 120);
        continue; // sub-agent task prompt (already captured on the parent Agent record)
      }
      const cmd = text.match(/<command-name>\s*([^<]+?)\s*<\/command-name>/);
      flushTurn();
      if (cmd) {
        const args = (text.match(/<command-args>([\s\S]*?)<\/command-args>/) || [])[1] || '';
        const cname = cmd[1].replace(/^\//, '');
        const r = { ...base(ts, l), event: 'slash_command', request: `/${cname}${args.trim() ? ' ' + args.trim() : ''}`, status: 'info', model: null };
        if (skillDefType(cname) === 'custom') r.skills_used = [{ name: cname, type: 'custom', purpose: args.trim() || null, invocation: 'explicit' }];
        r.id = makeId(ts, 'slash_command', cname, l.uuid || ts);
        r.parent_task = r.id; r.related_ids = [];
        push(r); cur.lastSlash = r;
        cur.parent = r.id; cur.parentHead = oneLine(r.request, 120);
        if (l.promptId) promptByPromptId[l.promptId] = r.id;
        continue;
      }
      const r = { ...base(ts, l), event: 'user_prompt', request: text, status: 'info', model: null };
      r.id = makeId(ts, 'user_prompt', text, l.uuid || ts);
      r.parent_task = r.id; r.related_ids = [];
      push(r);
      cur.parent = r.id; cur.parentHead = oneLine(text, 120);
      if (l.promptId) promptByPromptId[l.promptId] = r.id;
    }
    // a sub-agent is finished when its transcript ends with a text answer and no open tool call
    if (d.side && sideAgentId && cur.turnText && (cur.handback || (cur.lastWasText && !Object.keys(pending).length))) agentDone[sideAgentId] = true;
    flushTurn();
    for (const id of Object.keys(pending)) {
      const p = pending[id];
      emitTool(p, null, false, null);
      const r = recs[recs.length - 1];
      r.status = 'partial'; r.limitation = 'no tool result in transcript (interrupted, still running, or session ended)';
      if (r.subagents_used && r.subagents_used[0]) r.subagents_used[0].status = 'partial';
    }
  }

  // resolve background sub-agent status
  for (const r of recs) {
    if (r.event !== 'subagent' || !(r.subagents_used || [])[0] || r.subagents_used[0].status !== 'partial') continue;
    const tid = Object.keys(agentRecByToolUse).find(k => agentRecByToolUse[k] === r);
    const n = tid && notif[tid];
    if (n && /completed|failed|killed|stopped/.test(n)) r.subagents_used[0].status = /completed/.test(n) ? 'completed' : 'failed';
    else if (r._agentId && agentDone[r._agentId]) r.subagents_used[0].status = 'completed';
  }
  // user prompts / slash commands: model = first model that answered it
  const modelByParent = {};
  for (const r of recs) if (r.parent_task && r.model && r.model !== 'unknown' && !modelByParent[r.parent_task]) modelByParent[r.parent_task] = r.model;
  for (const r of recs) if ((r.event === 'user_prompt' || r.event === 'slash_command') && !r.model) r.model = modelByParent[r.id] || null;

  // stage changes from stages.json
  for (const s of stages) {
    push({ id: makeId(s.started_at, 'stage_change', s.name, 'stage' + s.name + s.started_at), timestamp: s.started_at, stage: s.name, agent: 'agent',
      agent_name: 'claude-code-main', agent_type: 'built-in', ai_tool: 'Claude Code', model: null, mode: 'agent', event: 'stage_change',
      context: CONTEXT, request: `Stage → ${s.name}`, status: 'info', session_id: null, commit: null });
  }
  // merge human decisions (re-link parent_task to the closest preceding prompt)
  const prompts = recs.filter(r => r.event === 'user_prompt' || r.event === 'slash_command').sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  for (const h of readJsonl(P(F.human))) {
    const r = { ...h };
    const t = Date.parse(r.timestamp);
    let pp = null; for (const p of prompts) if (Date.parse(p.timestamp) <= t) pp = p;
    if (pp) { r.parent_task = pp.id; r.related_ids = [...new Set([...(Array.isArray(h.related_ids) ? h.related_ids : []), pp.id])]; if (!r.session_id) r.session_id = pp.session_id; }
    push(r);
  }
  // commits: first commit at/after a record that produced files or verification evidence
  const commits = gitCommits();
  if (commits.length) for (const r of recs) {
    if (!(r.artifacts && r.artifacts.length) && r.event !== 'verification') continue;
    const t = Date.parse(r.timestamp); const c = commits.find(x => x.t >= t);
    if (c) r.commit = c.h;
  }
  // sort, de-duplicate, write
  recs.sort((a, b) => (Date.parse(a.timestamp) - Date.parse(b.timestamp)) || (a._seq - b._seq));
  const seenId = new Set(); const final = [];
  for (const r of recs) { if (!r.timestamp) continue; const rec = makeRecord(r); if (seenId.has(rec.id)) continue; seenId.add(rec.id); final.push(rec); }
  fs.writeFileSync(P(F.jsonl), final.map(r => JSON.stringify(r)).join('\n') + (final.length ? '\n' : ''), 'utf8');
  renderAll(final);
  const c = counts(final);
  console.log(`rebuild: ${files.length} transcript file(s) -> ${final.length} records in ${P(F.jsonl)}`);
  console.log(JSON.stringify(c, null, 2));
  return c;
}

function counts(records) {
  const c = { records: records.length, prompts: 0, slash_commands: 0, tool_calls: 0, subagents: 0, skills: 0, mcp_calls: 0, human_decisions: 0, verifications: 0, guard_blocks: 0, assistant_responses: 0, models: {} };
  for (const r of records) {
    if (r.event === 'user_prompt') c.prompts++;
    if (r.event === 'slash_command') c.slash_commands++;
    if (['tool_use', 'subagent', 'skill', 'verification', 'guard_block'].includes(r.event) && r.tools_used.length) c.tool_calls++;
    if (r.event === 'subagent' && r.tools_used.some(t => t === 'Agent' || t === 'Task')) c.subagents++;
    c.skills += r.skills_used.length;
    c.mcp_calls += r.mcp_tools_used.length;
    if (r.event === 'human_decision' || (r.human_decision && r.event !== 'human_decision')) c.human_decisions++;
    if (r.event === 'verification') c.verifications++;
    if (r.event === 'guard_block') c.guard_blocks++;
    if (r.event === 'assistant_response') { c.assistant_responses++; if (r.model) c.models[r.model] = (c.models[r.model] || 0) + 1; }
  }
  return c;
}

/* --------------------------------------------------------------- render */
function cell(s, n) {
  if (s == null || s === '') return '';
  let t = String(s).replace(/ …\[truncated \d+ chars\]/g, '…').replace(/\s+/g, ' ').trim();
  if (t.length > (n || 140)) t = t.slice(0, n || 140).trimEnd() + '…';
  return t.replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function fence(text) {
  const runs = String(text).match(/`+/g) || [];
  const n = Math.max(3, ...runs.map(r => r.length + 1));
  const f = '`'.repeat(n);
  return `${f}text\n${text}\n${f}`;
}
function hhmm(ts) { return String(ts || '').replace('T', ' ').replace(/\.\d+Z$|Z$/, ''); }
function outcome(r) {
  let s = r.status || '';
  if (r.subagents_used[0]) s += ` (sub-agent ${r.subagents_used[0].status})`;
  if (r.limitation) s += ` — ${oneLine(r.limitation, 80)}`;
  if (r.commit) s += ` @${r.commit}`;
  return s;
}
function agentLabel(r) { return r.agent_type === 'sub-agent' ? `${r.agent_name} (sub-agent)` : r.agent_name || ''; }

function renderLog(records) {
  const c = counts(records);
  const tools = [...new Set(records.map(r => r.ai_tool).filter(t => t && t !== 'Claude Code'))];
  const sessions = [...new Set(records.map(r => r.session_id).filter(Boolean))];
  const ts = records.map(r => r.timestamp).filter(Boolean).sort();
  const L = [];
  L.push('# AI Interaction Log', '');
  L.push('> Generated automatically by `.claude/hooks/ai-log.js` from `logs/ai-interactions.jsonl` (Claude Code hooks + transcript rebuild). Do not edit by hand — run `node .claude/hooks/ai-log.js render`.', '');
  L.push('| Item | Value |', '|---|---|');
  L.push(`| AI tool | ${cell(tools.join(', ') || 'Claude Code', 300)} |`);
  L.push(`| Models (assistant turns) | ${cell(Object.entries(c.models).map(([m, n]) => `${m} (${n})`).join(', ') || 'unknown', 300)} |`);
  L.push(`| Sessions | ${cell(sessions.join(', '), 400)} |`);
  L.push(`| Date range (UTC) | ${ts.length ? `${hhmm(ts[0])} → ${hhmm(ts[ts.length - 1])}` : '—'} |`);
  L.push(`| Totals | ${c.prompts} prompts, ${c.slash_commands} slash commands, ${c.tool_calls} tool calls, ${c.subagents} sub-agent runs, ${c.skills} skill uses, ${c.mcp_calls} MCP calls, ${c.verifications} verifications, ${c.human_decisions} human decisions, ${c.guard_blocks} guard blocks |`);
  L.push('');
  const stageOrder = [];
  for (const r of records) if (r.stage && !stageOrder.includes(r.stage)) stageOrder.push(r.stage);
  L.push('## Stages', '', '| Stage | First record (UTC) | Records | Prompts |', '|---|---|---|---|');
  for (const s of stageOrder) {
    const rs = records.filter(r => r.stage === s);
    L.push(`| ${cell(s)} | ${hhmm(rs[0].timestamp)} | ${rs.length} | ${rs.filter(r => r.event === 'user_prompt' || r.event === 'slash_command').length} |`);
  }
  L.push('');
  const lastResponse = {};
  for (const r of records) if (r.event === 'assistant_response' && r.agent_type !== 'sub-agent' && r.parent_task) lastResponse[r.parent_task] = r;
  const toolsByParent = {};
  for (const r of records) if (r.parent_task && r.event !== 'assistant_response') (toolsByParent[r.parent_task] = toolsByParent[r.parent_task] || new Set()) && r.tools_used.forEach(t => toolsByParent[r.parent_task].add(t));

  for (const s of stageOrder) {
    const rs = records.filter(r => r.stage === s);
    L.push(`## Stage: ${s}`, '');
    L.push('| Time (UTC) | Agent | Request | Files | Verification | Outcome |', '|---|---|---|---|---|---|');
    for (const r of rs) {
      const req = r.event === 'assistant_response' ? `${r.event}: ${r.suggestion || ''}` : `${r.event}: ${r.request || ''}`;
      const files = r.artifacts.length > 3 ? `${r.artifacts.slice(0, 3).join(', ')} +${r.artifacts.length - 3}` : r.artifacts.join(', ');
      L.push(`| ${hhmm(r.timestamp)} | ${cell(agentLabel(r), 60)} | ${cell(req, 140)} | ${cell(files, 120)} | ${cell(r.action_verification, 160)} | ${cell(outcome(r), 120)} |`);
    }
    L.push('');
    const ps = rs.filter(r => r.event === 'user_prompt' || r.event === 'slash_command');
    if (ps.length) {
      L.push(`### Prompts and final responses — ${s}`, '');
      ps.forEach((p, i) => {
        L.push(`#### ${i + 1}. ${p.event === 'slash_command' ? 'Slash command' : 'Prompt'} · ${hhmm(p.timestamp)} UTC · model ${p.model || 'unknown'} · mode ${p.mode || 'agent'}`, '');
        L.push(fence(p.request || ''), '');
        const resp = lastResponse[p.id];
        const tset = toolsByParent[p.id];
        if (tset && tset.size) L.push(`**Tools used:** ${[...tset].join(', ')}`, '');
        L.push(`**Final response (summary):** ${resp && resp.suggestion ? oneLine(resp.suggestion, 600) : '_(none recorded)_'}`, '');
      });
    }
  }
  L.push('## Human oversight', '');
  const hs = records.filter(r => r.event === 'human_decision' || r.human_decision);
  if (!hs.length) L.push('_No human decisions recorded yet._', '');
  else {
    L.push('| Time (UTC) | Stage | Decision | Status | Related |', '|---|---|---|---|---|');
    for (const h of hs) L.push(`| ${hhmm(h.timestamp)} | ${cell(h.stage)} | ${cell(h.human_decision || h.request, 220)} | ${cell(h.status)} | ${cell(h.related_ids.join(', '), 80)} |`);
    L.push('', 'See `logs/HUMAN_OVERSIGHT.md` for details.', '');
  }
  L.push('## Appendix A — Verification commands and results', '');
  const vs = records.filter(r => r.event === 'verification');
  if (!vs.length) L.push('_No verification commands recorded yet._', '');
  else {
    L.push('| Time (UTC) | Stage | Agent | Command → result | Outcome |', '|---|---|---|---|---|');
    for (const v of vs) L.push(`| ${hhmm(v.timestamp)} | ${cell(v.stage)} | ${cell(agentLabel(v), 50)} | ${cell(v.action_verification, 400)} | ${cell(v.status)}${v.commit ? ' @' + v.commit : ''} |`);
    L.push('');
  }
  L.push('## Appendix B — Sub-agents, skills and MCP tools', '');
  const subs = records.filter(r => r.subagents_used.length);
  const sks = records.filter(r => r.skills_used.length);
  const mcps = records.filter(r => r.mcp_tools_used.length);
  L.push(`**Sub-agents (${subs.length}):**`, '');
  for (const r of subs) for (const s of r.subagents_used) L.push(`- ${hhmm(r.timestamp)} — \`${s.name}\` (${s.type})${r.agent_name && r.agent_name !== s.name ? ` as ${r.agent_name}` : ''}: ${oneLine(s.task, 160)} — ${s.status}`);
  L.push('', `**Skills (${sks.length}):**`, '');
  for (const r of sks) for (const s of r.skills_used) L.push(`- ${hhmm(r.timestamp)} — \`${s.name}\` (${s.type}, ${s.invocation})${s.purpose ? ': ' + oneLine(s.purpose, 120) : ''}`);
  L.push('', `**MCP tools (${mcps.length}):**`, '');
  for (const r of mcps) for (const m of r.mcp_tools_used) L.push(`- ${hhmm(r.timestamp)} — \`${m.server}.${m.tool}\`${m.purpose ? ': ' + oneLine(m.purpose, 120) : ''}`);
  L.push('');
  return L.join('\n');
}

function renderOversight(records) {
  const recorded = new Set(readJsonl(P(F.human)).map(h => h && h.id));
  const hs = records.filter(r => r.event === 'human_decision' || r.human_decision);
  const L = ['# Human Oversight', '',
    '> Generated by `.claude/hooks/ai-log.js` from `logs/human-decisions.jsonl` (decisions recorded with `node .claude/hooks/ai-log.js human "<text>" --status accepted|rejected|modified`) plus interventions detected automatically in the Claude Code transcript (rejected tool calls, interrupts).', ''];
  const sections = [
    ['Recorded decisions', hs.filter(h => recorded.has(h.id))],
    ['Interventions detected automatically', hs.filter(h => !recorded.has(h.id))],
  ];
  for (const [title, list] of sections) {
    L.push(`## ${title}`, '');
    if (!list.length) { L.push('_None._', ''); continue; }
    L.push('| # | Time (UTC) | Stage | Decision | Status | Related to |', '|---|---|---|---|---|---|');
    list.forEach((h, i) => L.push(`| ${i + 1} | ${hhmm(h.timestamp)} | ${cell(h.stage)} | ${cell(h.human_decision || h.request, 300)} | ${cell(h.status)} | ${cell([h.parent_task, ...h.related_ids].filter((x, j, a) => x && a.indexOf(x) === j).join(', '), 120)} |`));
    L.push('');
  }
  return L.join('\n');
}

function renderAll(records) {
  try {
    ensureDir();
    const recs = records || readJsonl(P(F.jsonl)).map(r => makeRecord(r));
    fs.writeFileSync(P(F.md), renderLog(recs), 'utf8');
    fs.writeFileSync(P(F.oversight), renderOversight(recs), 'utf8');
  } catch (e) { if (require.main === module && process.argv.length > 2) throw e; }
}

/* ------------------------------------------------------------- selftest */
function selftest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-log-selftest-'));
  const env = { ...process.env, AI_LOG_DIR: tmp };
  const results = [];
  const check = (name, ok, extra) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };
  const run = (args, input) => cp.spawnSync(process.execPath, [__filename, ...args], { input, env, encoding: 'utf8', timeout: 20000 });
  const SECRET = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
  const sid = 'selftest-session';
  try {
    // synthetic transcript (also used by Stop hook and rebuild)
    const tdir = path.join(tmp, 'transcripts'); fs.mkdirSync(path.join(tdir, 'sid', 'subagents'), { recursive: true });
    const tfile = path.join(tdir, 'sid.jsonl');
    const T = (s) => `2026-11-01T10:00:${String(s).padStart(2, '0')}.000Z`;
    const common = { sessionId: sid, version: '9.9.9', entrypoint: 'cli', cwd: REPO, isSidechain: false };
    const lines = [
      { type: 'user', uuid: 'u1', timestamp: T(1), permissionMode: 'default', promptId: 'p1', message: { role: 'user', content: `Implement R1. token ${SECRET} password=hunter2 password=${DEMO_PASSWORD}` }, ...common },
      { type: 'assistant', uuid: 'a1', timestamp: T(2), message: { model: 'claude-test-1', content: [{ type: 'thinking', thinking: 'SECRET_THINKING_TEXT' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'dotnet test backend' } }] }, ...common },
      { type: 'user', uuid: 'u2', timestamp: T(3), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Passed!  - Failed: 0, Passed: 24' }] }, toolUseResult: { stdout: 'Build succeeded.\nPassed!  - Failed:     0, Passed:    24, Skipped: 0', stderr: '' }, ...common },
      { type: 'assistant', uuid: 'a2', timestamp: T(4), message: { model: 'claude-test-1', content: [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: path.join(REPO, 'backend', 'X.cs') } }, { type: 'tool_use', id: 't3', name: 'Agent', input: { subagent_type: 'test-reviewer', description: 'Review tests', prompt: 'You are the "test-reviewer" agent. Review.' } }] }, ...common },
      { type: 'user', uuid: 'u3', timestamp: T(5), message: { content: [{ type: 'tool_result', tool_use_id: 't2', content: 'ok' }, { type: 'tool_result', tool_use_id: 't3', content: 'done' }] }, ...common },
      { type: 'assistant', uuid: 'a3', timestamp: T(6), message: { model: 'claude-test-1', content: [{ type: 'tool_use', id: 't4', name: 'Skill', input: { skill: 'approval-rules' } }, { type: 'tool_use', id: 't5', name: 'mcp__playwright__browser_click', input: { element: 'Approve button' } }, { type: 'tool_use', id: 't6', name: 'Bash', input: { command: 'git push origin main' } }] }, ...common },
      { type: 'user', uuid: 'u4', timestamp: T(7), message: { content: [{ type: 'tool_result', tool_use_id: 't4', content: 'loaded' }, { type: 'tool_result', tool_use_id: 't5', content: 'clicked' }, { type: 'tool_result', tool_use_id: 't6', is_error: true, content: 'Blocked by guard.js: git push is not allowed' }] }, ...common },
      { type: 'assistant', uuid: 'a4', timestamp: T(8), message: { model: 'claude-test-1', content: [{ type: 'text', text: 'R1 implemented; 24 tests pass.' }] }, ...common },
      { type: 'user', uuid: 'u5', timestamp: T(9), isMeta: true, message: { content: 'meta line must be skipped' }, ...common },
      { type: 'user', uuid: 'u6', timestamp: T(10), message: { content: '<command-name>/model</command-name><command-args>opus</command-args>' }, ...common },
      { type: 'user', uuid: 'u7', timestamp: T(11), message: { content: [{ type: 'text', text: '<system-reminder>only a reminder</system-reminder>' }] }, ...common },
    ];
    fs.writeFileSync(tfile, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    const sideLines = [
      { type: 'user', uuid: 's1', timestamp: T(5), isSidechain: true, agentId: 'ag1', promptId: 'p1', sessionId: sid, message: { content: 'You are the "test-reviewer" agent. Review.' } },
      { type: 'assistant', uuid: 's2', timestamp: T(5), isSidechain: true, agentId: 'ag1', sessionId: sid, message: { model: 'claude-test-2', content: [{ type: 'tool_use', id: 'st1', name: 'Read', input: { file_path: 'a.cs' } }] } },
      { type: 'user', uuid: 's3', timestamp: T(5), isSidechain: true, agentId: 'ag1', sessionId: sid, message: { content: [{ type: 'tool_result', tool_use_id: 'st1', content: 'x' }] } },
      { type: 'assistant', uuid: 's4', timestamp: T(6), isSidechain: true, agentId: 'ag1', sessionId: sid, message: { model: 'claude-test-2', content: [{ type: 'text', text: 'Review done: 2 findings.' }] } },
    ];
    fs.writeFileSync(path.join(tdir, 'sid', 'subagents', 'agent-ag1.jsonl'), sideLines.map(l => JSON.stringify(l)).join('\n') + '\n');

    // 1) hook mode: every event type
    const ev = (o) => JSON.stringify({ session_id: sid, transcript_path: tfile, cwd: REPO, permission_mode: 'default', ...o });
    let r = run(['stage', 'spec']); check('stage CLI exits 0', r.status === 0, r.stderr);
    const events = [
      ev({ hook_event_name: 'SessionStart', source: 'startup' }),
      ev({ hook_event_name: 'UserPromptSubmit', prompt: `please use ${SECRET} and Bearer abcdefghijklmnop1234 AKIAABCDEFGHIJKLMNOP` }),
      ev({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'h1', tool_input: { command: 'dotnet test' }, tool_response: { stdout: 'Passed!  - Failed: 0, Passed: 24', stderr: '' } }),
      ev({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'h2', tool_input: { file_path: path.join(REPO, 'backend', 'Y.cs') }, tool_response: {} }),
      ev({ hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_use_id: 'h3', tool_input: { subagent_type: 'pr-reviewer', description: 'review', prompt: 'x' }, tool_response: { status: 'completed' } }),
      ev({ hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_use_id: 'h4', tool_input: { skill: 'review-pr' }, tool_response: 'ok' }),
      ev({ hook_event_name: 'PostToolUse', tool_name: 'mcp__playwright__browser_navigate', tool_use_id: 'h5', tool_input: { url: 'http://localhost:5000' }, tool_response: 'ok' }),
      ev({ hook_event_name: 'PostToolUse', tool_name: 'Read', tool_use_id: 'h6', tool_input: { file_path: 'x' }, tool_response: 'ok' }),
      ev({ hook_event_name: 'SubagentStop', agent_type: 'pr-reviewer', stop_hook_active: false }),
      ev({ hook_event_name: 'Stop', stop_hook_active: false }),
    ];
    let allOk = true;
    for (const e of events) { r = run([], e); if (r.status !== 0) allOk = false; }
    check('hook mode exits 0 for every event type', allOk);
    r = run(['stage', 'step1-single-approver']);
    const guard = path.join(__dirname, 'guard.js');
    if (fileExists(guard)) {
      const g = cp.spawnSync(process.execPath, [guard], { input: ev({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'g1', tool_input: { command: `git push https://x:${SECRET}@github.com/me/r.git main` } }), env, encoding: 'utf8' });
      check('guard.js denies git push and exits 0', g.status === 0 && /"permissionDecision":"deny"/.test(g.stdout), oneLine(g.stdout, 80));
    }
    r = run(['human', 'Accepted the R1 implementation after reading the diff', '--status', 'accepted']);
    check('human CLI exits 0', r.status === 0, r.stderr);
    r = run(['render']); check('render exits 0', r.status === 0, r.stderr);
    r = run([], 'this is not json'); check('hook mode survives invalid stdin', r.status === 0);

    const hookTxt = fs.readFileSync(path.join(tmp, F.jsonl), 'utf8');
    const checkFile = (label, txt) => {
      const ls = txt.split('\n').filter(Boolean); let parse = true; let order = true; const evs = new Set();
      for (const l of ls) { let o; try { o = JSON.parse(l); } catch { parse = false; continue; } if (JSON.stringify(Object.keys(o)) !== JSON.stringify(KEYS)) order = false; evs.add(o.event); }
      check(`${label}: every JSONL line parses (${ls.length} lines)`, parse && ls.length > 0);
      check(`${label}: every record has all ${KEYS.length} schema keys in order`, order);
      return evs;
    };
    const hevs = checkFile('hook mode', hookTxt);
    const want = ['session_start', 'user_prompt', 'verification', 'tool_use', 'subagent', 'skill', 'assistant_response', 'stage_change', 'human_decision', 'guard_block'];
    const missing = want.filter(w => !hevs.has(w));
    check('hook mode produced every event type', !missing.length, missing.length ? 'missing ' + missing.join(',') : '');
    const hrecs = hookTxt.split('\n').filter(Boolean).map(l => JSON.parse(l));
    const ver = hrecs.find(x => x.event === 'verification');
    check('verification result lines extracted', !!ver && /Passed!/.test(ver.action_verification || ''));
    const stop = hrecs.find(x => x.event === 'assistant_response');
    check('Stop record has model + summary from transcript tail', !!stop && stop.model === 'claude-test-1' && /24 tests pass/.test(stop.suggestion || ''));
    check('secrets redacted in hook output (GitHub token, Bearer, AWS key)', !hookTxt.includes(SECRET) && !hookTxt.includes('abcdefghijklmnop1234') && !hookTxt.includes('AKIAABCDEFGHIJKLMNOP') && hookTxt.includes('[REDACTED:github-token]'));

    // 2) rebuild from the synthetic transcript
    r = run(['rebuild', tdir]);
    check('rebuild exits 0', r.status === 0, oneLine(r.stderr, 200));
    const rbTxt = fs.readFileSync(path.join(tmp, F.jsonl), 'utf8');
    const revs = checkFile('rebuild', rbTxt);
    const rrecs = rbTxt.split('\n').filter(Boolean).map(l => JSON.parse(l));
    check('rebuild: no thinking text', !rbTxt.includes('SECRET_THINKING_TEXT') && !/"thinking"/.test(rbTxt));
    check('rebuild: token + non-demo password redacted, demo password kept', !rbTxt.includes(SECRET) && !rbTxt.includes('hunter2') && rbTxt.includes(DEMO_PASSWORD));
    check('rebuild: isMeta and reminder-only lines skipped', !rbTxt.includes('meta line must be skipped') && !rbTxt.includes('only a reminder'));
    check('rebuild: slash command kept', revs.has('slash_command'));
    check('rebuild: guard denial mapped to guard_block', revs.has('guard_block'));
    check('rebuild: model from transcript', rrecs.some(x => x.event === 'assistant_response' && x.model === 'claude-test-1'));
    check('rebuild: sidechain attributed to sub-agent', rrecs.some(x => x.agent_type === 'sub-agent' && x.agent_name === 'test-reviewer' && x.tools_used.includes('Read')));
    check('rebuild: human decision merged back', revs.has('human_decision') && revs.has('stage_change'));
    check('rebuild: verification + skill + mcp + artifacts', rrecs.some(x => x.event === 'verification' && /Passed!/.test(x.action_verification)) && rrecs.some(x => x.skills_used.length) && rrecs.some(x => x.mcp_tools_used.length) && rrecs.some(x => x.artifacts.includes('backend/X.cs')));
    check('rebuild: ai_tool carries version', rrecs.some(x => x.ai_tool === 'Claude Code 9.9.9 (CLI)'));
    const md = fs.readFileSync(path.join(tmp, F.md), 'utf8');
    const ho = fs.readFileSync(path.join(tmp, F.oversight), 'utf8');
    check('Markdown files exist with stage headings', /^## Stage: planning$/m.test(md) && /^## Stage: spec$/m.test(md) && /^## Stage: step1-single-approver$/m.test(md) && /# Human Oversight/.test(ho) && /Accepted the R1/.test(ho));
    check('Markdown contains no secret', !md.includes(SECRET) && !ho.includes(SECRET));
    const pii = redact('mail jane.doe@corp-example.net or jane.doe%40corp-example.net; keep 1+me@users.noreply.github.com and noreply@anthropic.com; host dev.azure.com/SomeOrg/Proj');
    check('PII redacted (e-mails, Azure DevOps org), no-reply kept',
      !/corp-example\.net|dev\.azure\.com/i.test(pii)
      && pii.includes('1+me@users.noreply.github.com') && pii.includes('noreply@anthropic.com'), pii);
    const rfile = path.join(tmp, 'redact.local.json');
    fs.writeFileSync(rfile, JSON.stringify([{ pattern: 'acme-internal\\.example', label: 'internal-host' }, { pattern: '[\\w.-]*clientco[\\w.-]*', label: 'client' }]));
    const lr = cp.spawnSync(process.execPath, ['-e', `process.stdout.write(require(${JSON.stringify(__filename)}).redact('git.acme-internal.example and jdoe_clientco and SomeClientCo-Repo'))`],
      { env: { ...process.env, AI_LOG_REDACT_FILE: rfile }, encoding: 'utf8' });
    check('local redaction file applied (hosts, client names)', !/acme-internal|clientco/i.test(lr.stdout) && /REDACTED:client/.test(lr.stdout), lr.stdout || lr.stderr);
  } catch (e) {
    check('selftest ran without exception', false, e && e.stack);
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  const ok = results.every(Boolean);
  console.log(ok ? `SELFTEST PASS (${results.length} checks)` : `SELFTEST FAIL (${results.filter(x => !x).length} of ${results.length} failed)`);
  return ok;
}

/* ----------------------------------------------------------------- main */
function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd) {
    // hook mode: never fail, never block
    const killer = setTimeout(() => process.exit(0), 8000); killer.unref();
    try {
      if (process.stdin.isTTY) { console.error('ai-log.js: hook mode expects JSON on stdin. CLI: stage|human|rebuild|render|--selftest'); process.exit(0); }
      hookMain(fs.readFileSync(0, 'utf8'));
    } catch { /* swallow */ }
    process.exit(0);
  }
  try {
    if (cmd === 'stage') cmdStage(args.slice(1).join(' '));
    else if (cmd === 'human') cmdHuman(args.slice(1));
    else if (cmd === 'rebuild') rebuild(args.slice(1));
    else if (cmd === 'render') { renderAll(); console.log(`rendered ${P(F.md)} and ${P(F.oversight)}`); }
    else if (cmd === '--selftest' || cmd === 'selftest') process.exit(selftest() ? 0 : 1);
    else { console.error('usage: ai-log.js [stage NAME | human "TEXT" [--status accepted|rejected|modified] [--related ID] | rebuild PATH... | render | --selftest]'); process.exit(1); }
  } catch (e) {
    console.error(`ai-log.js: ${e && (process.env.AI_LOG_DEBUG ? e.stack : e.message)}`);
    process.exit(1);
  }
}

module.exports = { logGuardBlock, makeRecord, redact, mapTool, isVerificationCommand, KEYS, REPO };
if (require.main === module) main();
