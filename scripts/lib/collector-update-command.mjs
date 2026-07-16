import { dirname } from "node:path";

function shellSingleQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function collectorUpdateCommand({ appDir, collectorOnly, logPath }) {
  const modeArgument = collectorOnly ? " --collector-only" : "";
  return [
    `mkdir -p ${shellSingleQuote(dirname(logPath))}`,
    `cd ${shellSingleQuote(appDir)}`,
    `./scripts/update-hivemindos.sh${modeArgument} >> ${shellSingleQuote(logPath)} 2>&1`,
  ].join(" && ");
}
