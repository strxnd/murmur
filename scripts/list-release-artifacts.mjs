import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageArtifactPattern = /\.(?:AppImage|deb|rpm|dmg|zip)$/;
const updaterMetadataPattern = /^latest-.+\.yml$/;
const checksumsFileName = "SHA256SUMS.txt";

export function listReleaseArtifacts(distDir = "dist") {
  const fileNames = readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const packageFileNames = fileNames.filter((fileName) => packageArtifactPattern.test(fileName)).sort();

  if (packageFileNames.length === 0) {
    throw new Error(`No release packages found in ${distDir}`);
  }
  if (!fileNames.includes(checksumsFileName)) {
    throw new Error(`Missing ${join(distDir, checksumsFileName)}`);
  }

  const optionalMetadataFileNames = fileNames.filter((fileName) => updaterMetadataPattern.test(fileName)).sort();
  return [...packageFileNames, ...optionalMetadataFileNames, checksumsFileName].map((fileName) =>
    join(distDir, fileName)
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const artifacts = listReleaseArtifacts(process.argv[2]);
  process.stdout.write(`${artifacts.join("\0")}\0`);
}
