const { buildDigest, normalize } = require("../../scripts/ops/error-digest");

const raw = [
  "### SINCE",
  "2026-10-15 01:00:00",
  "### CONTAINER",
  "status=running health=healthy started=2026-10-15T07:20:00Z restarts=0 image=ghcr.io/x:abc",
  "### LOGGER",
  '[2026-10-15 02:00:00][ERROR][Failed to get video info for BV1ab411c7de][{"status":412}]',
  '[2026-10-15 03:00:00][ERROR][Failed to get video info for BV1zz411c7xy][{"status":412}]',
  '[2026-10-15 04:00:00][WARN][Retry 3 of 5][{}]',
  "not a logger line",
  "### STDERR",
  "",
].join("\n");

describe("error digest", () => {
  test("groups errors that differ only by id and counts them", () => {
    const { markdown, errors } = buildDigest(raw);
    expect(errors).toBe(2);
    expect(markdown).toContain("| 2 | 2026-10-15 02:00:00 | 2026-10-15 03:00:00 | Failed to get video info for BV… |");
    expect(markdown).toContain("WARN: 1 条 / 1 种");
    expect(markdown).not.toContain("未经 logger 的输出");
  });

  test("counts crash output that bypassed the logger as errors", () => {
    const withCrash = raw + "Uncaught TypeError: x is undefined\n    at foo (/app/dist/a.js:1:1)\n";
    const { markdown, errors } = buildDigest(withCrash);
    expect(errors).toBe(3);
    expect(markdown).toContain("Uncaught TypeError");
  });

  test("a quiet day reports zero errors", () => {
    const quiet = "### SINCE\n2026-10-15 01:00:00\n### CONTAINER\nstatus=running\n### LOGGER\n### STDERR\n";
    expect(buildDigest(quiet).errors).toBe(0);
  });

  test("normalize collapses numbers, urls and quoted values", () => {
    expect(normalize('GET https://api.bilibili.com/x?a=1 failed "foo" after 12345ms')).toBe(
      'GET <url> failed "…" after #ms'
    );
  });
});
