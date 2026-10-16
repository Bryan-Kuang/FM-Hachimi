#!/usr/bin/env node
// Turn the raw output of scripts/ops/collect-error-logs.sh into a short
// Markdown digest: one row per distinct error, with counts and a sample.
// Used by .github/workflows/auto-fix.yml to decide whether Claude runs at all
// and to give it something smaller than the raw log to start from.
//
// Usage: node scripts/ops/error-digest.js raw.txt > digest.md
// With GITHUB_OUTPUT set, also writes `errors=<n>` (ERROR lines + stderr
// blocks) so the workflow can skip the analysis on quiet days.

const fs = require("fs");

const LINE_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\[(ERROR|WARN)\]\[(.*?)\]\[(.*)\]$/;
const MAX_ERROR_GROUPS = 30;
const MAX_WARN_GROUPS = 15;
const SAMPLE_CHARS = 800;

function splitSections(raw) {
  const sections = {};
  let current = null;
  for (const line of raw.split(/\r?\n/)) {
    const m = /^### (\w+)/.exec(line);
    if (m) {
      current = m[1];
      sections[current] = [];
      continue;
    }
    if (current) sections[current].push(line);
  }
  return sections;
}

// Collapse ids, numbers and quoted values so "retry 3 for BV1xx" and
// "retry 4 for BV1yy" land in one group.
function normalize(message) {
  return message
    .replace(/BV[0-9A-Za-z]{10}/g, "BV…")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\d{3,}/g, "#")
    .replace(/"[^"]*"/g, '"…"')
    .trim();
}

function groupLines(lines) {
  const groups = new Map();
  for (const line of lines) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const [, ts, level, message, context] = m;
    const key = `${level} ${normalize(message)}`;
    let g = groups.get(key);
    if (!g) {
      g = { level, message: normalize(message), count: 0, first: ts, last: ts, sample: context };
      groups.set(key, g);
    }
    g.count++;
    if (ts < g.first) g.first = ts;
    if (ts > g.last) g.last = ts;
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function cell(text) {
  return text.replace(/\|/g, "\\|");
}

function table(groups) {
  const rows = ["| 次数 | 首次 (UTC) | 最近 (UTC) | 消息 |", "|---:|---|---|---|"];
  for (const g of groups) rows.push(`| ${g.count} | ${g.first} | ${g.last} | ${cell(g.message)} |`);
  return rows.join("\n");
}

function buildDigest(raw) {
  const s = splitSections(raw);
  const since = (s.SINCE || []).join("").trim();
  const container = (s.CONTAINER || []).join("\n").trim();
  const grouped = groupLines(s.LOGGER || []);
  const errors = grouped.filter((g) => g.level === "ERROR");
  const warns = grouped.filter((g) => g.level === "WARN");
  const stderr = (s.STDERR || []).join("\n").trim();
  const stderrBlocks = stderr ? stderr.split(/^--$/m).length : 0;
  const errorLines = errors.reduce((n, g) => n + g.count, 0);
  const warnLines = warns.reduce((n, g) => n + g.count, 0);

  const out = [];
  out.push(`# 报错日志摘要`);
  out.push("");
  out.push(`- 时间范围: ${since || "未知"} UTC 起`);
  out.push(`- 容器: ${container || "未知"}`);
  out.push(`- ERROR: ${errorLines} 条 / ${errors.length} 种; WARN: ${warnLines} 条 / ${warns.length} 种; 未经 logger 的崩溃输出: ${stderrBlocks} 段`);
  out.push("");
  if (errors.length) {
    out.push("## ERROR");
    out.push("");
    out.push(table(errors.slice(0, MAX_ERROR_GROUPS)));
    out.push("");
    out.push("### 每种 ERROR 的一条样本上下文");
    for (const g of errors.slice(0, MAX_ERROR_GROUPS)) {
      out.push("");
      out.push(`- **${g.message}**`);
      out.push("  ```");
      out.push(`  ${g.sample.slice(0, SAMPLE_CHARS)}`);
      out.push("  ```");
    }
    out.push("");
  }
  if (warns.length) {
    out.push(`## WARN (前 ${MAX_WARN_GROUPS} 种)`);
    out.push("");
    out.push(table(warns.slice(0, MAX_WARN_GROUPS)));
    out.push("");
  }
  if (stderr) {
    out.push("## 未经 logger 的输出 (docker logs)");
    out.push("");
    out.push("```");
    out.push(stderr.slice(0, 8000));
    out.push("```");
    out.push("");
  }
  return { markdown: out.join("\n"), errors: errorLines + stderrBlocks };
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: error-digest.js <raw.txt>");
    process.exit(2);
  }
  const { markdown, errors } = buildDigest(fs.readFileSync(file, "utf8"));
  process.stdout.write(markdown);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `errors=${errors}\n`);
}

module.exports = { buildDigest, normalize };
