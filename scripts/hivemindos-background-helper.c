#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char *argv[]) {
  if (argc < 2) {
    fprintf(stderr, "[hivemindos] usage: %s <program> [args...]\n", argv[0]);
    return 64;
  }

  execv(argv[1], &argv[1]);

  int error = errno;
  fprintf(stderr, "[hivemindos] failed to launch %s: %s\n", argv[1],
          strerror(error));
  return error == ENOENT ? 127 : 126;
}
