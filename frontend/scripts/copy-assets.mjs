import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const target = fileURLToPath(new URL("../public/music/", import.meta.url));
mkdirSync(target, { recursive: true });
for (const name of ["Bravura.woff2", "Bravura-OFL.txt"])
  copyFileSync(
    fileURLToPath(
      new URL(
        "../node_modules/@coderline/alphatab/dist/font/" + name,
        import.meta.url,
      ),
    ),
    target + name,
  );
