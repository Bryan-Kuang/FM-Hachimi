const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
}

describe("beginner setup scripts", () => {
  test("package.json exposes the blessed Docker-first setup commands", () => {
    const { scripts } = readPackageJson();

    expect(scripts.build).toBe("tsc -p tsconfig.build.json");
    expect(scripts["setup:check"]).toBe("node scripts/doctor.js");
    expect(scripts["docker:up"]).toBe("docker compose up -d --build");
    expect(scripts["docker:logs"]).toBe("docker compose logs -f bilibili-bot");
    expect(scripts["docker:down"]).toBe("docker compose down");
    expect(scripts["bench:extractors"]).toBe("node scripts/bench-extractors.js");
    expect(scripts["deploy:commands:test"]).toBe("DEPLOY_TEST_COMMANDS=true node scripts/deploy-commands.js");
  });

  test("scripts that execute local files point at files that exist", () => {
    const { scripts } = readPackageJson();
    const missing = [];

    for (const [name, command] of Object.entries(scripts)) {
      const match = command.match(/^(?:[A-Z0-9_]+=\S+\s+)*(node|bash)\s+([^\s&|;]+)/);
      if (!match) continue;

      const target = path.join(root, match[2]);
      if (!fs.existsSync(target)) {
        missing.push(`${name} -> ${match[2]}`);
      }
    }

    expect(missing).toEqual([]);
  });

  test("cookie refresh guidance points to existing scripts", () => {
    const refreshScript = path.join(root, "scripts/refresh-youtube-cookies.sh");
    const compatibilityScript = path.join(root, "scripts/refresh-cookies.sh");
    const sourceFiles = [
      path.join(root, "src/youtube/extractor.ts"),
      path.join(root, "src/bot/commands/play.ts"),
    ];

    expect(fs.existsSync(refreshScript)).toBe(true);
    expect(fs.existsSync(compatibilityScript)).toBe(true);

    for (const sourceFile of sourceFiles) {
      const content = fs.readFileSync(sourceFile, "utf8");
      expect(content).toContain("bash scripts/refresh-youtube-cookies.sh");
    }
  });

  test("YouTube cookie refresh avoids playback extraction during export", () => {
    const refreshScript = fs.readFileSync(path.join(root, "scripts/refresh-youtube-cookies.sh"), "utf8");

    expect(refreshScript).toContain("UPLOAD_ONLY");
    expect(refreshScript).toContain("https://www.youtube.com/");
    expect(refreshScript).toContain("youtubetab:skip=authcheck");
    expect(refreshScript).toContain("--flat-playlist");
    expect(refreshScript).toContain("--playlist-items 0");
    expect(refreshScript).not.toContain("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  test("docker compose files are rooted at the project and use the same Node major", () => {
    const prodCompose = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");
    const devCompose = fs.readFileSync(path.join(root, "docker-compose.dev.yml"), "utf8");

    expect(prodCompose).toContain("bilibili-bot:");
    expect(devCompose).toContain("node:22-alpine");
    expect(devCompose).toContain("- .:/app");
    expect(devCompose).toContain("- .env");
    expect(devCompose).not.toContain("../../");
  });

  test("doctor warns when yt-dlp is stale or lacks js runtime support", () => {
    const { evaluateYtDlpEnvironment } = require("../../scripts/doctor");

    const result = evaluateYtDlpEnvironment({
      installed: true,
      version: "2025.08.27",
      helpText: "Usage: yt-dlp [OPTIONS] URL",
    });

    expect(result.notes).toContain("yt-dlp version: 2025.08.27");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("yt-dlp is older than"),
      expect.stringContaining("--js-runtimes"),
    ]));
  });
});
