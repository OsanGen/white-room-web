import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const clientDist = path.join(root, "client", "dist");
const outDir = path.join(root, "release");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version ?? "0.0.0";
const zipName = `white-room-jarvis-v${version}-web.zip`;
const zipPath = path.join(outDir, zipName);

if (!fs.existsSync(clientDist)) {
  throw new Error("client/dist missing. Run npm run build first.");
}

fs.mkdirSync(outDir, { recursive: true });

const staging = path.join(outDir, "staging");
fs.rmSync(staging, { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });

execFileSync("cp", ["-R", clientDist + "/.", staging], { stdio: "inherit" });
execFileSync("cp", [path.join(root, "README.md"), path.join(staging, "README.md")], { stdio: "inherit" });
execFileSync("cp", [path.join(root, "THIRD_PARTY_NOTICES.txt"), path.join(staging, "THIRD_PARTY_NOTICES.txt")], {
  stdio: "inherit",
});

if (fs.existsSync(zipPath)) {
  fs.rmSync(zipPath, { force: true });
}

execFileSync("zip", ["-r", zipPath, "."], {
  cwd: staging,
  stdio: "inherit",
});

console.log(`Release package created: ${zipPath}`);
