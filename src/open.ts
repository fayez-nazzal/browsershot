import { spawnSync } from "node:child_process";

export function openFile(path: string, warn: (message: string) => void): void {
  let command: string[];
  if (process.platform === "darwin") {
    command = ["open", path];
  } else if (process.platform === "linux") {
    command = ["xdg-open", path];
  } else if (process.platform === "win32") {
    command = ["cmd", "/c", "start", "", path];
  } else {
    warn(`cannot auto-open files on ${process.platform}`);
    return;
  }
  const result = spawnSync(command[0]!, command.slice(1), { stdio: "ignore" });
  if (result.error != null || result.status !== 0) {
    const message = result.error != null ? result.error.message : `command exited with status ${result.status}`;
    warn(`could not open ${path}: ${message}`);
  }
}
