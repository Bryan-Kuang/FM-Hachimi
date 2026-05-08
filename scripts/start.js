const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const entrypoint = path.join(projectRoot, "dist", "index.js");

if (!fs.existsSync(entrypoint)) {
  console.error("Build output is missing. Run `npm run build` before `npm start`.");
  process.exit(1);
}

require(entrypoint);
