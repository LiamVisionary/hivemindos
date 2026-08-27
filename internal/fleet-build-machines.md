# Fleet build machines

HivemindOS can assign a connected Hive computer to build work without turning its general remote shell into a build scheduler. Assignment, runner connection, release selection, and publication are separate states with separate recovery paths.

## Operator flow

1. Open **Fleet**, select a connected computer, then open **Machine settings → Builds**.
2. Claim the machine from **Authority** if this hub does not already manage it.
3. Turn on **Use this machine for builds**, choose project and/or release work, keep parallel jobs at one until the machine has measured headroom, and save.
4. On a remote Apple silicon Mac, enable **HivemindOS macOS releases** and save. If the Builds panel asks for GitHub, connect it there and return to the still-open machine settings.
5. Choose **Connect release jobs**, then wait for the card to report both the machine service and release scheduler as ready. **Verify connection** completes selection if registration finished after the first request.

Assignment is stored by the target collector in its existing machine policy. A version 1 policy migrates to version 2 with all build permissions off. No upgrade can opt a machine into builds implicitly.

## Authority and transport

- The authenticated dashboard route accepts only Fleet collector URLs.
- The target collector requires a loopback caller or a Hivemind Link request stamped with the verified Tailnet owner and node identity.
- Only the machine's claimed master hub can change build policy or connect or disconnect a runner.
- Release setup refuses the hub's own local collector. A release computer must be assigned remotely.
- The hub uses the existing shared GitHub connection server-side; the browser never receives its credential. Runner registration and removal approvals are short-lived. They are sent directly to the selected collector and are never written to policy, runner state, logs, responses, or Shared Brain Memory.

## Runner installation contract

Managed runner setup currently supports Apple silicon macOS. Windows and Linux machines can be assigned for future project routing, but HivemindOS desktop release jobs continue to use hosted Windows and Linux runners and Azure Windows signing.

The hub asks GitHub for the current compatible runner package and checksum. The collector accepts only an HTTPS archive from the official Actions runner release path, verifies the SHA-256 digest, rejects path traversal in the archive, configures argument by argument without a shell, and installs the per-user service under the private HivemindOS build-runner directory. Registration omits GitHub's generic `self-hosted`, OS, and architecture labels so unrelated jobs cannot select this release-only Mac, and disables runner self-updates so the verified package cannot change between reviewed enrollments. The repository selector is derived by the server; a browser request cannot substitute an arbitrary download or command.

Managed macOS setup also installs a per-user launch service that holds Apple's AC-power-only system-sleep assertion while the release runner is connected. The display may still sleep, and unplugging the Mac releases the protection. **Verify connection** repairs a missing assertion or stopped runner; disconnect removes the assertion before retaining the runner recovery copy. Release orchestration also builds the hosted standalone before probing the Mac, then starts a bounded three-hour AC-only assertion in that probe as defense in depth for machines enrolled before the managed service existed. This prevents the protected Mac from disappearing between scheduler jobs without changing battery sleep policy or requiring an administrator password.

GitHub requires a runner with automatic updates disabled to be refreshed within 30 days of a new runner release. Refresh this protected machine by disconnecting and reconnecting release jobs from Fleet; that downloads and verifies GitHub's then-current package before the next candidate. Do not replace the runner folder manually or enable self-updates as a shortcut.

Because a Hive builder is persistent rather than a disposable hosted runner, every macOS release job snapshots the user's existing keychain search list before importing its temporary signing identity. An unconditional final step restores that list and deletes the temporary certificate and keychain even when compilation, signing, notarization, smoke testing, or artifact upload fails.

Each machine receives a stable opaque label derived from its Hive machine identity. The source workflow reads the repository's selected macOS label. If none is selected it uses the hosted macOS runner; if a selected Hive runner later goes offline, source resolution fails quickly instead of leaving a release queued indefinitely.

## Candidate and promotion flow

The release process has two outward states:

1. **Tauri Release Candidate** verifies that the exact 40-character source SHA already has a successful complete CI workflow, builds the shared embedded web payload once, builds platform packages, signs and notarizes them, and seals their names, sizes, and SHA-256 hashes in `release-candidate.json`.
2. **Tauri Release Promotion** takes a successful candidate run id inside the `desktop-release` environment, verifies the originating workflow and every recorded artifact, then creates the source tag and release. GitHub's current private-repository plan cannot enforce environment reviewers, so the workflow allows only the repository owner and requires the owner to type `promote-<candidate-run-id>` before it starts. Promotion never recompiles.

Linux native test compilation is part of CI rather than the packaging critical path. Hosted Windows and Linux each run Complete Hub and Link as separate parallel jobs with product-specific Rust caches. macOS keeps Hub and Link together because a single protected Mac runner deliberately accepts only one release job at a time.

The shared architecture-independent dashboard remains on hosted Linux so the protected Mac does not build Windows or Linux payloads. Private-repository standard Linux runners provide 8 GB RAM. The standalone job therefore caps V8 at 5,120 MB and its complete process tree at 6,500 MB, prints detected physical memory, and refuses hosts below 7,500 MB before installing or compiling. Embedded builds use Turbopack's full snapshot eviction, shared plugin worker threads, and one-at-a-time static generation to stay inside that ceiling. Do not raise those limits above the runner's physical memory; select a reviewed larger Linux runner or reduce measured peak usage instead.

## Recovery

- Turning build assignment off stops eligibility but does not remove the runner service.
- **Disconnect release jobs** stops and unregisters the runner, then renames its folder to a timestamped recovery copy instead of deleting it.
- If registration fails after extraction, the incomplete directory is renamed with a `.failed-<timestamp>` suffix and a later connection can start cleanly.
- Clearing or changing the repository's selected macOS label returns future candidates to the hosted macOS fallback. An assigned but unselected runner cannot receive the release job.
- A candidate is immutable and retained for 14 days. Re-run promotion with the same candidate when only publication failed; rebuild only when an artifact, source, signing, or notarization gate failed.

## Verification boundary

Local tests cover schema migration, master-hub enforcement, collector health and status, archive and checksum guards, token non-persistence, recoverable disconnect, GitHub package-shape handling, candidate hashing and tamper detection, workflow syntax, and release contracts. These tests do not claim an actual macOS package was built on the development Mac. Final infrastructure proof requires one connected remote Apple silicon runner, one candidate run at an exact green CI SHA, receipt of the job on that runner, and a promotion of the same candidate without compilation.
