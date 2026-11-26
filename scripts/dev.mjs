import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const children = [];
const env = {
  ...process.env,
  OMP_NUM_THREADS: process.env.OMP_NUM_THREADS || "2",
  MKL_NUM_THREADS: process.env.MKL_NUM_THREADS || "2",
  TF_CPP_MIN_LOG_LEVEL: "2",
};
const start = (command, args) => {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
  children.push(child);
  child.on("error", (error) => console.error(error.message));
  return child;
};
if (existsSync(root + ".venv/bin/python")) {
  start(root + ".venv/bin/python", [
    "-m",
    "uvicorn",
    "riffsync.api:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
  ]);
  start(root + ".venv/bin/python", ["-m", "riffsync.worker"]);
} else {
  console.log(
    "Interface local: execute scripts/setup.sh para habilitar a API e o worker de IA.",
  );
}
const vite = start("npm", [
  "--prefix",
  "frontend",
  "run",
  "dev",
  "--",
  "--host",
  "0.0.0.0",
  ...process.argv.slice(2),
]);
const shutdown = () => {
  for (const child of children) child.kill("SIGTERM");
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
vite.on("exit", (code) => {
  shutdown();
  process.exit(code || 0);
});
