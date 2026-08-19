const fs = require("fs");
const path = require("path");

const DIST_MAIN = path.resolve(__dirname, "..", "dist", "main.js");

if (!fs.existsSync(DIST_MAIN)) {
  process.exit(0);
}

const { execSync } = require("child_process");
execSync("node dist/main.js hook install", { stdio: "inherit" });