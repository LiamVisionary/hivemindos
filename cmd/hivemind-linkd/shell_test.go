package main

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"os/exec"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

// Shell-less hosts (Windows builds, -shell=false) must answer shell API
// requests with a JSON envelope, never fall through to the collector proxy —
// its plain-text "hivemind-linkd proxy error: ..." body crashed the dashboard
// terminal's JSON parsing.
func TestServeShellUnavailableSpeaksJSON(t *testing.T) {
	recorder := httptest.NewRecorder()
	serveShellUnavailable(recorder, httptest.NewRequest("POST", shellPathPrefix+"sessions/x/command", nil))
	if recorder.Code != 501 {
		t.Fatalf("status = %d, want 501", recorder.Code)
	}
	if ct := recorder.Header().Get("content-type"); ct != "application/json" {
		t.Fatalf("content-type = %q, want application/json", ct)
	}
	var payload struct {
		OK    bool   `json:"ok"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatalf("body is not JSON: %v (%q)", err, recorder.Body.String())
	}
	if payload.OK || payload.Error == "" {
		t.Fatalf("payload = %+v, want ok=false with an error message", payload)
	}
}

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
