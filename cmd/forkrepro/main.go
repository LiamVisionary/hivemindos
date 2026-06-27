package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"syscall"
	"time"

	"tailscale.com/tsnet"
)

// Reproduces the macOS nw_settings_child_has_forked fork-wedge: load
// Network.framework via tsnet, then fork+exec a child and see if it returns.
func main() {
	// Bring up tsnet just enough to load Network.framework (no login needed;
	// the framework loads during server construction / first network touch).
	srv := &tsnet.Server{Dir: "/tmp/forkrepro/state", Hostname: "forkrepro", Ephemeral: true}
	// Up() will block on auth; we only need the network stack loaded, so start
	// it in the background and give it a moment.
	go func() { _, _ = srv.Up(context.Background()) }()
	time.Sleep(3 * time.Second)
	_ = srv

	fmt.Println("tsnet loaded; attempting fork+exec...")
	cmd := exec.Command("/bin/sh", "-c", "echo CHILD_RAN_OK")
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	done := make(chan error, 1)
	go func() { done <- cmd.Run() }()
	select {
	case err := <-done:
		fmt.Printf("RESULT: child returned err=%v\n", err)
	case <-time.After(6 * time.Second):
		fmt.Println("RESULT: WEDGED (child did not return in 6s)")
	}
}
