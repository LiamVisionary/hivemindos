import fs from "node:fs";

export function atomicWriteFileSync(file, payload) {
  const temporaryFile = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, payload, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryFile, file);
  } finally {
    try {
      fs.unlinkSync(temporaryFile);
    } catch {
      // Rename removes the temporary path; cleanup only matters on failure.
    }
  }
}
