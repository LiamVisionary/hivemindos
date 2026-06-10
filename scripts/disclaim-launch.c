// disclaim-launch — tiny launcher used by `pnpm tauri:dev` (via scripts/dev-codesign-runner.sh).
//
// WHY THIS EXISTS
//   macOS attributes a process's file access (TCC) to its "responsible process", which is
//   decided by HOW it was launched. A binary launched from a terminal (which is what
//   `tauri dev` does) inherits the *Terminal's* responsibility — so the agent's file writes
//   are checked against Terminal's folder permissions (none), and fail with EPERM, no prompt.
//   A binary launched by Finder/LaunchServices (the release app) is "disclaimed" and becomes
//   its OWN responsible process, so its own grant applies and the one-click Allow prompt works.
//
//   This launcher replicates the Finder/LaunchServices behaviour for dev: it posix_spawns the
//   target with `responsibility_spawnattrs_setdisclaim`, so the dev app becomes its own TCC
//   responsible process — identical to prod. It then forwards termination signals and mirrors
//   the child's exit status, so Tauri's dev watcher keeps managing the process normally.
//
// Build: cc -O2 -o dev-disclaim-launch disclaim-launch.c
// Use:   dev-disclaim-launch /path/to/HivemindOS [args...]

#include <spawn.h>
#include <sys/wait.h>
#include <signal.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>

extern char **environ;

// Private libSystem API. Disclaiming makes the spawned process its own TCC responsible
// process (the same effect as a Finder/LaunchServices launch) instead of inheriting the
// caller's (here: the Terminal running `pnpm tauri:dev`).
extern int responsibility_spawnattrs_setdisclaim(posix_spawnattr_t *attrs, int disclaim);

static pid_t g_child = 0;

static void forward_signal(int sig) {
  if (g_child > 0) {
    kill(g_child, sig);
  }
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s <program> [args...]\n", argv[0]);
    return 2;
  }

  posix_spawnattr_t attr;
  posix_spawnattr_init(&attr);
  responsibility_spawnattrs_setdisclaim(&attr, 1);

  pid_t pid = 0;
  int rc = posix_spawn(&pid, argv[1], NULL, &attr, &argv[1], environ);
  posix_spawnattr_destroy(&attr);
  if (rc != 0) {
    fprintf(stderr, "disclaim-launch: posix_spawn(%s) failed: %d\n", argv[1], rc);
    return 127;
  }

  g_child = pid;
  signal(SIGTERM, forward_signal);
  signal(SIGINT, forward_signal);
  signal(SIGHUP, forward_signal);

  int status = 0;
  while (waitpid(pid, &status, 0) < 0) {
    // retry on EINTR
  }
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 0;
}
