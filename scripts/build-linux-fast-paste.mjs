import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(repoRoot, "resources", "linux-fast-paste.c");
const output = join(repoRoot, "resources", "bin", "linux-fast-paste");

await mkdir(dirname(output), { recursive: true });

const compiler = process.env.CC || "cc";
const result = spawnSync(
  compiler,
  ["-O2", "-Wall", "-Wextra", "-std=c11", source, "-o", output],
  { encoding: "utf8", stdio: "pipe" }
);

if (result.status !== 0) {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

process.stdout.write(`Built ${output}\n`);
