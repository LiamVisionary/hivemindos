import assert from "node:assert/strict";

import {
  isMacosProtectedAppDataPath,
  isPathInside,
  macosProtectedAppDataRoots,
} from "./lib/macos-privacy-paths.mjs";

const home = "/Users/example";

assert.equal(isPathInside(`${home}/Library/Application Support/App/config.json`, `${home}/Library/Application Support`), true);
assert.equal(isPathInside(`${home}/Library/Application Supportish/App/config.json`, `${home}/Library/Application Support`), false);

assert.deepEqual(macosProtectedAppDataRoots(home), [
  `${home}/Library/Application Support`,
  `${home}/Library/Containers`,
  `${home}/Library/Group Containers`,
  `${home}/Library/Mail`,
  `${home}/Library/Messages`,
  `${home}/Library/Safari`,
  `${home}/Library/Calendars`,
  `${home}/Library/Reminders`,
]);

assert.equal(
  isMacosProtectedAppDataPath(`${home}/Library/Application Support/Syncthing/config.xml`, {
    home,
    platformName: "darwin",
    env: {},
  }),
  true,
);
assert.equal(
  isMacosProtectedAppDataPath(`${home}/Library/Containers/com.example/Data/file`, {
    home,
    platformName: "darwin",
    env: {},
  }),
  true,
);
assert.equal(
  isMacosProtectedAppDataPath(`${home}/Documents/code/project/package.json`, {
    home,
    platformName: "darwin",
    env: {},
  }),
  false,
);
assert.equal(
  isMacosProtectedAppDataPath(`${home}/Library/Application Support/Syncthing/config.xml`, {
    home,
    platformName: "linux",
    env: {},
  }),
  false,
);
assert.equal(
  isMacosProtectedAppDataPath(`${home}/Library/Application Support/Syncthing/config.xml`, {
    home,
    platformName: "darwin",
    env: { AGENT_TELEMETRY_ALLOW_APP_DATA_READS: "1" },
  }),
  false,
);

console.log("macos privacy path guard passed");
