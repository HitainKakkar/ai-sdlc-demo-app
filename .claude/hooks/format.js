#!/usr/bin/env node
/*
 * format.js — PostToolUse hook (matcher Edit|Write|MultiEdit).
 * When a C# file inside the repo was edited, run:
 *   dotnet format whitespace <dir-of-file> --folder --include <file-name>
 * (30 s timeout). Every failure is ignored; always exit 0. Non-.cs files: no-op.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');

function normPath(p) {
  const m = String(p || '').match(/^\/([a-zA-Z])\/(.*)$/); // Git Bash style /c/Users/...
  return m ? `${m[1].toUpperCase()}:/${m[2]}` : String(p || '');
}

function findDotnet() {
  const exe = process.platform === 'win32' ? 'dotnet.exe' : 'dotnet';
  const candidates = [];
  if (process.env.DOTNET_ROOT) candidates.push(path.join(process.env.DOTNET_ROOT, exe));
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'dotnet', 'dotnet.exe'));
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* next */ } }
  return 'dotnet';
}

function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const ti = input.tool_input || {};
    const tr = input.tool_response && typeof input.tool_response === 'object' ? input.tool_response : {};
    const raw = ti.file_path || ti.path || tr.filePath || tr.file_path;
    if (!raw || !/\.cs$/i.test(String(raw))) return;
    const file = path.resolve(input.cwd || REPO, normPath(raw));
    const rel = path.relative(REPO, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(file)) return;
    const dir = path.dirname(file);
    cp.spawnSync(findDotnet(), ['format', 'whitespace', dir, '--folder', '--include', path.basename(file)], {
      cwd: dir, timeout: 30000, stdio: 'ignore', windowsHide: true,
    });
  } catch { /* formatting is best effort */ }
}

main();
process.exit(0);
