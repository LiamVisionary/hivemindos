# obra/superpowers Packaging Audit

- Upstream: `https://github.com/obra/superpowers`
- Release: `v6.1.1`
- Commit: `d884ae04edebef577e82ff7c4e143debd0bbec99`
- License: MIT
- Decision: conditionally approved for the selected packaged methods only

The upstream repository was inspected as inert source before packaging. A focused static audit of the selected upstream paths reported zero high-risk findings and two medium caution matches caused by a generic function-call placeholder in plan examples. The HivemindOS adaptation renames that placeholder; the final packaged directory passes the same heuristic audit with zero high, medium, or low findings. The HivemindOS skill-directory audit still runs when a user installs the pack.

HivemindOS does not package or execute the upstream plugin bootstrap, runtime hooks, installation scripts, or brainstorming web server. It also excludes `using-superpowers`, `writing-skills`, the visual companion resources, and an application-specific TypeScript example. The retained shell helpers are documentation-time aids and do not run during pack installation.

Each imported skill receives a HivemindOS policy preface. That preface scopes upstream global language to explicitly selected tasks, preserves HivemindOS and project authority, and removes any implied permission to commit, push, merge, delete, deploy, publish, spend, or launch agents.

To refresh the pinned source, update the source registry deliberately, rerun the third-party audit, import with `node scripts/import-packaged-skills.mjs superpowers`, inspect the diff, and verify `skills-lock.json`.
