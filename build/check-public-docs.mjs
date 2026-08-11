import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const pairs = [["README.md", "README.pt-BR.md"], ["COMMANDS.md", "COMMANDS.pt-BR.md"]];
let failed = false;

for (const [english, portuguese] of pairs) {
  for (const [file, peer, marker] of [[english, portuguese, "Language:"], [portuguese, english, "Idioma:"]]) {
    const filePath = path.join(root, file);
    const prefix = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8").split("\n").slice(0, 5).join("\n") : "";
    if (!prefix.includes(marker) || !prefix.includes(`](${peer})`)) {
      console.error(`Documentation check failed: ${file} must link ${peer} in its first five lines.`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log("Public documentation language pairs: OK");
