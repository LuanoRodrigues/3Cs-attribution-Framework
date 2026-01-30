import fs from "fs";
import path from "path";

const outDir = path.join(process.cwd(), "dist", "lib");
fs.mkdirSync(outDir, { recursive: true });

const outFile = path.join(outDir, "index.cjs");
const content = `"use strict";

throw new Error(
  "leditor: CommonJS (require) is not supported by the bundled library output. " +
    "Use ESM import (dist/lib/index.js) or the global bundle (dist/lib/leditor.global.js)."
);
`;

fs.writeFileSync(outFile, content, "utf8");
console.log("Wrote", outFile);

