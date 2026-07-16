package main

import (
	"errors"
	"os"
	"os/exec"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestShellDirectChildrenFindsRunningChild(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("remote shells are unavailable on Windows")
	}
	cmd := exec.Command("/bin/sleep", "30")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}()

	children, err := shellDirectChildren(os.Getpid())
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := children[cmd.Process.Pid]; !ok {
		t.Fatalf("direct children %v do not include pid %d", children, cmd.Process.Pid)
	}
}

func TestStartShellProcessTimeoutKillsNewDirectChildWithoutProcessHandle(t *testing.T) {
	releaseStart := make(chan struct{})
	defer close(releaseStart)

	snapshots := []map[int]string{
		{41: "hivemind-linkd"},
		{41: "hivemind-linkd", 77: "hivemind-linkd", 88: "node"},
	}
	var killed []int
	ops := shellStartOps{
		timeout: 10 * time.Millisecond,
		start: func(*exec.Cmd) error {
			<-releaseStart
			return errors.New("start released after timeout")
		},
		directChildren: func(int) (map[int]string, error) {
			if len(snapshots) == 0 {
				t.Fatal("unexpected extra process snapshot")
			}
			result := snapshots[0]
			snapshots = snapshots[1:]
			return result, nil
		},
		killProcess: func(pid int) error {
			killed = append(killed, pid)
			return nil
		},
		parentExecutable: "hivemind-linkd",
	}

	err := startShellProcessWith(&exec.Cmd{}, ops)
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("startShellProcessWith error = %v, want timeout", err)
	}
	if !reflect.DeepEqual(killed, []int{77}) {
		t.Fatalf("killed pids = %v, want only new direct child 77", killed)
	}
}
