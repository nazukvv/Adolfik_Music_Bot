// Чи треба (пере)збирати фронтенд Activity. Використовує start.bat.
// Код виходу: 0 — dist свіжий; 1 — треба `npm run build`; 2 — треба `npm ci` і `npm run build`.
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mtime = (path) => statSync(path).mtimeMs;
const newest = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce((max, entry) => {
    const path = join(dir, entry.name);
    return Math.max(max, entry.isDirectory() ? newest(path) : mtime(path));
  }, 0);

// Залежності: node_modules нема або package-lock.json новіший за встановлене.
const installed = join(root, "node_modules", ".package-lock.json");
if (!existsSync(installed) || mtime(join(root, "package-lock.json")) > mtime(installed)) process.exit(2);

// Збірка: dist нема або якийсь вихідний файл новіший за dist/index.html.
const built = join(root, "dist", "index.html");
if (!existsSync(built)) process.exit(1);
const sources = ["index.html", "package.json", "package-lock.json", "vite.config.ts", "tsconfig.json"]
  .map((file) => join(root, file))
  .filter(existsSync)
  .map(mtime);
sources.push(newest(join(root, "src")));
if (existsSync(join(root, "public"))) sources.push(newest(join(root, "public")));
process.exit(Math.max(...sources) > mtime(built) ? 1 : 0);
