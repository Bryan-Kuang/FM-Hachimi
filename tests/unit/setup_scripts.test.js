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

  test("cookie refresh guidance points to automatic refresh behavior", () => {
    const sourceFiles = [
      path.join(root, "src/youtube/extractor.ts"),
      path.join(root, "src/bot/commands/play.ts"),
    ];

    for (const sourceFile of sourceFiles) {
      const content = fs.readFileSync(sourceFile, "utf8");
      expect(content).toContain("automatic cookie refresh");
    }
  });

  test("Docker mounts YouTube cookies through secrets directory and browser profile read-only", () => {
    const prodCompose = fs.readFileSync(path.join(root, "docker-compose.yml"), "utf8");

    expect(prodCompose).toContain("./secrets:/app/secrets");
    expect(prodCompose).toContain("${YOUTUBE_COOKIE_PROFILE_HOST:-/home/ubuntu/.fm-hachimi-youtube/profile}:/app/youtube-browser-profile:ro");
    expect(prodCompose).not.toContain("./youtube_cookies.txt:/app/youtube_cookies.txt");
  });

  test("deploy ensures secrets-mounted cookie files exist with restricted perms", () => {
    const deployScript = fs.readFileSync(path.join(root, "scripts/deploy/remote-deploy.sh"), "utf8");

    expect(deployScript).toContain("mkdir -p data logs secrets");
    expect(deployScript).toContain("touch -a secrets/bilibili_cookies.txt secrets/youtube_cookies.txt");
    expect(deployScript).toContain("chmod 600 secrets/bilibili_cookies.txt secrets/youtube_cookies.txt");
  });

  test("private cookie and browser-profile runtime paths stay ignored", () => {
    const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");

    expect(gitignore).toContain("secrets/");
    expect(gitignore).toContain("youtube-browser-profile/");
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
