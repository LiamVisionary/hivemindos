package main

// Remote shell service for HivemindOS Link.
//
// Ported from claw-code's shellService: a long-lived non-interactive shell
// per session, driven over plain HTTP (REST commands in, SSE output stream
// out) so it traverses the existing linkd peer proxy without WebSockets.
//
// A 0x01-framed sentinel printed after every user command via an injected
// `printf` lets us (a) update the tracked cwd so the client can show a
// prompt like `~/scripts $`, and (b) know when a command has finished so
// we can emit a `busy: false` state update.

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	ps "github.com/mitchellh/go-ps"
	"tailscale.com/client/local"
)

const (
	shellPathPrefix       = "/_hivemind/shell/"
	shellSentinelPrefix   = "\x01HIVECWD:"
	shellFlushInterval    = 30 * time.Millisecond
	shellMaxLinesPerCmd   = 5000
	shellHistoryKeep      = 600
	shellMaxBodyBytes     = 64 * 1024
	shellHeartbeatPeriod  = 25 * time.Second
	shellSubscriberBuffer = 256
	// shellSpawnTimeout bounds a single cmd.Start(); on macOS a fork can
	// wedge in Apple's post-fork Network.framework handler and never reach
	// exec, so we cap how long we wait before reaping it.
	shellSpawnTimeout = 5 * time.Second
	// shellSpawnBackoff throttles respawns after a failed/timed-out spawn so
	// a client polling an unspawnable session cannot trigger a fork loop.
	shellSpawnBackoff = 10 * time.Second
)

var shellSessionIDPattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,128}$`)

type shellEvent struct {
	Chunk string `json:"chunk"`
	Cwd   string `json:"cwd"`
	Busy  bool   `json:"busy"`
}

type shellSession struct {
	id      string
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	manager *shellManager

	mu                     sync.Mutex
	cwd                    string
	busy                   bool
	exited                 bool
	pending                []string
	outputLinesThisCommand int
	suppressingOutput      bool
	flushTimer             *time.Timer
}

type shellManager struct {
	mu       sync.Mutex
	sessions map[string]*shellSession
	// spawnBackoff records, per session id, the time before which a new
	// spawn must not be attempted after a failed/timed-out spawn. This stops
	// a client that keeps polling an unspawnable session from triggering a
	// tight fork loop (see startShellProcess for the macOS fork-wedge case).
	spawnBackoff map[string]time.Time

	// History and SSE subscribers live on the manager keyed by session id so
	// they survive shell process restarts (e.g. an interrupt that takes the
	// whole process group down): a reconnecting or still-open client keeps
	// its stream and scrollback while ensure() respawns the shell.
	stateMu     sync.Mutex
	history     map[string][]string
	subscribers map[string]map[chan shellEvent]struct{}
}

func newShellManager() *shellManager {
	return &shellManager{
		sessions:     map[string]*shellSession{},
		spawnBackoff: map[string]time.Time{},
		history:      map[string][]string{},
		subscribers:  map[string]map[chan shellEvent]struct{}{},
	}
}

func (m *shellManager) appendHistory(id string, lines []string) {
	m.stateMu.Lock()
	defer m.stateMu.Unlock()
	combined := append(m.history[id], lines...)
	if overflow := len(combined) - shellHistoryKeep; overflow > 0 {
		combined = append([]string(nil), combined[overflow:]...)
	}
	m.history[id] = combined
}

func (m *shellManager) historyFor(id string) []string {
	m.stateMu.Lock()
	defer m.stateMu.Unlock()
	return append([]string(nil), m.history[id]...)
}

func (m *shellManager) publish(id string, event shellEvent) {
	m.stateMu.Lock()
	defer m.stateMu.Unlock()
	for ch := range m.subscribers[id] {
		select {
		case ch <- event:
		default:
			// Slow subscriber: drop the event rather than stall the shell.
		}
	}
}

func (m *shellManager) subscribe(id string) chan shellEvent {
	ch := make(chan shellEvent, shellSubscriberBuffer)
	m.stateMu.Lock()
	defer m.stateMu.Unlock()
	if m.subscribers[id] == nil {
		m.subscribers[id] = map[chan shellEvent]struct{}{}
	}
	m.subscribers[id][ch] = struct{}{}
	return ch
}

func (m *shellManager) unsubscribe(id string, ch chan shellEvent) {
	m.stateMu.Lock()
	defer m.stateMu.Unlock()
	delete(m.subscribers[id], ch)
	if len(m.subscribers[id]) == 0 {
		delete(m.subscribers, id)
	}
}

func pickShell() string {
	preferred := strings.TrimSpace(os.Getenv("SHELL"))
	if regexp.MustCompile(`/(bash|zsh|sh)$`).MatchString(preferred) {
		return preferred
	}
	for _, candidate := range []string{"/bin/bash", "/bin/zsh", "/bin/sh"} {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return "/bin/sh"
}

func (m *shellManager) ensure(id string) (*shellSession, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if existing, ok := m.sessions[id]; ok {
		existing.mu.Lock()
		alive := !existing.exited
		existing.mu.Unlock()
		if alive {
			return existing, nil
		}
	}
	if until, ok := m.spawnBackoff[id]; ok && time.Now().Before(until) {
		return nil, fmt.Errorf("shell spawn backing off until %s after a failed spawn", until.Format(time.RFC3339))
	}
	session, err := m.spawn(id)
	if err != nil {
		m.spawnBackoff[id] = time.Now().Add(shellSpawnBackoff)
		return nil, err
	}
	delete(m.spawnBackoff, id)
	m.sessions[id] = session
	return session, nil
}

func (m *shellManager) get(id string) *shellSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.sessions[id]
}

func (m *shellManager) spawn(id string) (*shellSession, error) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		home = "/"
	}
	shell := pickShell()
	cmd := exec.Command(shell)
	cmd.Dir = home
	cmd.Env = append(os.Environ(),
		"TERM=xterm-256color",
		"PS1=", "PS2=", "PROMPT_COMMAND=",
		"PAGER=cat",
	)
	cmd.SysProcAttr = shellSysProcAttr()
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := startShellProcess(cmd); err != nil {
		return nil, err
	}

	session := &shellSession{
		id:      id,
		cmd:     cmd,
		stdin:   stdin,
		manager: m,
		cwd:     home,
	}
	go session.drain(stdout)
	go session.drain(stderr)
	go session.waitForExit(m)
	log.Printf("shell: spawned %s session %q in %s", shell, id, home)
	return session, nil
}

type shellStartOps struct {
	timeout          time.Duration
	start            func(*exec.Cmd) error
	directChildren   func(int) (map[int]string, error)
	killProcess      func(int) error
	parentExecutable string
}

func shellDirectChildren(parentPID int) (map[int]string, error) {
	processes, err := ps.Processes()
	if err != nil {
		return nil, err
	}
	children := make(map[int]string)
	for _, process := range processes {
		if process.PPid() == parentPID && process.Pid() > 0 {
			children[process.Pid()] = process.Executable()
		}
	}
	return children, nil
}

func killShellProcess(pid int) error {
	process, err := os.FindProcess(pid)
	if err != nil {
		return err
	}
	return process.Kill()
}

func newPreExecChildPIDs(before, after map[int]string, parentExecutable string) []int {
	var result []int
	for pid, executable := range after {
		// Before exec, the forked child still has the daemon's executable name.
		// Do not kill unrelated children that another request started while this
		// shell spawn was wedged.
		if executable != parentExecutable {
			continue
		}
		if _, existed := before[pid]; !existed {
			result = append(result, pid)
		}
	}
	sort.Ints(result)
	return result
}

// startShellProcess runs cmd.Start with a hard timeout so a hung fork/exec
// cannot block the caller or accumulate. On macOS, a process that has loaded
// Network.framework (via the embedded Tailscale node) can deadlock in Apple's
// post-fork handler (nw_settings_child_has_forked -> os_log) before the child
// reaches exec, spinning a full core forever. In that state exec.Cmd.Process is
// still nil, so cleanup must find the newly forked direct child in the process
// table and kill it by its positive PID.
func startShellProcess(cmd *exec.Cmd) error {
	return startShellProcessWith(cmd, shellStartOps{
		timeout:          shellSpawnTimeout,
		start:            func(cmd *exec.Cmd) error { return cmd.Start() },
		directChildren:   shellDirectChildren,
		killProcess:      killShellProcess,
		parentExecutable: filepath.Base(os.Args[0]),
	})
}

func startShellProcessWith(cmd *exec.Cmd, ops shellStartOps) error {
	parentPID := os.Getpid()
	childrenBefore, snapshotErr := ops.directChildren(parentPID)
	done := make(chan error, 1)
	go func() { done <- ops.start(cmd) }()
	timer := time.NewTimer(ops.timeout)
	defer timer.Stop()
	select {
	case err := <-done:
		return err
	case <-timer.C:
		// cmd.Start() wedged (typically the macOS post-fork spin). It has not
		// published cmd.Process yet, but the kernel already exposes the child.
		// A process-table snapshot is safe here because it does not fork.
		if snapshotErr != nil {
			log.Printf("shell: could not snapshot children before spawn: %v", snapshotErr)
		} else if childrenAfter, err := ops.directChildren(parentPID); err != nil {
			log.Printf("shell: could not snapshot children after timed-out spawn: %v", err)
		} else {
			for _, pid := range newPreExecChildPIDs(childrenBefore, childrenAfter, ops.parentExecutable) {
				if err := ops.killProcess(pid); err != nil {
					log.Printf("shell: could not kill timed-out child pid %d: %v", pid, err)
				}
			}
		}
		// If Start unwinds after the forced kill, reap a successfully started
		// process. Reading cmd.Process only after the channel receive avoids a
		// data race with exec.Cmd.Start publishing it.
		go func() {
			if err := <-done; err == nil && cmd.Process != nil {
				_ = shellTerminateGroup(cmd.Process.Pid)
				_, _ = cmd.Process.Wait()
			}
		}()
		return fmt.Errorf("shell spawn timed out after %s (process did not reach exec)", ops.timeout)
	}
}

func (s *shellSession) drain(pipe io.Reader) {
	reader := bufio.NewReaderSize(pipe, 64*1024)
	for {
		line, err := reader.ReadString('\n')
		line = strings.TrimSuffix(line, "\n")
		if line != "" {
			s.mu.Lock()
			s.processLineLocked(line)
			s.mu.Unlock()
		}
		if err != nil {
			return
		}
	}
}

func (s *shellSession) waitForExit(m *shellManager) {
	err := s.cmd.Wait()
	detail := ""
	if err != nil {
		detail = fmt.Sprintf(" (%v)", err)
	}
	s.mu.Lock()
	s.exited = true
	s.busy = false
	s.pending = append(s.pending, "[shell exited"+detail+"]")
	s.flushLocked(true)
	s.mu.Unlock()
	m.mu.Lock()
	if m.sessions[s.id] == s {
		delete(m.sessions, s.id)
	}
	m.mu.Unlock()
}

func shellCwdFromSentinel(line string) (string, bool) {
	idx := strings.Index(line, shellSentinelPrefix)
	if idx < 0 || !strings.HasSuffix(line, "\x01") {
		return "", false
	}
	return line[idx+len(shellSentinelPrefix) : len(line)-1], true
}

// processLineLocked mirrors claw-code's processLine: strip CRs, intercept the
// CWD sentinel, cap per-command output, and batch the rest for the next flush.
func (s *shellSession) processLineLocked(raw string) {
	line := strings.ReplaceAll(raw, "\r", "")
	if line == "" {
		return
	}
	if cwd, ok := shellCwdFromSentinel(line); ok {
		s.cwd = cwd
		s.busy = false
		s.flushLocked(true)
		return
	}
	s.outputLinesThisCommand++
	if s.outputLinesThisCommand > shellMaxLinesPerCmd {
		if !s.suppressingOutput {
			s.suppressingOutput = true
			s.pending = append(s.pending, "[...output truncated — exceeded 5000 lines per command]")
			s.scheduleFlushLocked()
		}
		return
	}
	s.pending = append(s.pending, line)
	s.scheduleFlushLocked()
}

func (s *shellSession) scheduleFlushLocked() {
	if s.flushTimer != nil {
		return
	}
	s.flushTimer = time.AfterFunc(shellFlushInterval, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.flushLocked(false)
	})
}

// flushLocked drains pending lines into history and publishes one batched SSE
// event. forceEvent publishes even with no lines so cwd/busy flips reach the
// client immediately instead of waiting for the next output line.
func (s *shellSession) flushLocked(forceEvent bool) {
	if s.flushTimer != nil {
		s.flushTimer.Stop()
		s.flushTimer = nil
	}
	lines := s.pending
	s.pending = nil
	if len(lines) > 0 {
		s.manager.appendHistory(s.id, lines)
	}
	if len(lines) == 0 && !forceEvent {
		return
	}
	chunk := ""
	if len(lines) > 0 {
		chunk = strings.Join(lines, "\n") + "\n"
	}
	s.manager.publish(s.id, shellEvent{Chunk: chunk, Cwd: s.cwd, Busy: s.busy})
}

func (s *shellSession) run(command string) {
	s.mu.Lock()
	s.pending = append(s.pending, "$ "+command)
	s.outputLinesThisCommand = 0
	s.suppressingOutput = false
	s.busy = true
	s.flushLocked(true)
	s.mu.Unlock()
	// Execute the command, then print the CWD sentinel so we can track
	// directory changes and detect command completion. The two writes are
	// separate lines — the shell runs them sequentially regardless of
	// whether the first one succeeds.
	_, _ = io.WriteString(s.stdin, command+"\n")
	_, _ = io.WriteString(s.stdin, `printf '\001HIVECWD:%s\001\n' "$PWD"`+"\n")
}

func (s *shellSession) sendStdin(data string) {
	_, _ = io.WriteString(s.stdin, data)
}

func (s *shellSession) interrupt() bool {
	if s.cmd.Process == nil {
		return false
	}
	return shellInterruptGroup(s.cmd.Process.Pid) == nil
}

func (s *shellSession) kill() bool {
	if s.cmd.Process == nil {
		return false
	}
	return shellTerminateGroup(s.cmd.Process.Pid) == nil
}

func (s *shellSession) snapshot() (lines []string, cwd string, busy bool, active bool) {
	s.mu.Lock()
	cwd, busy, active = s.cwd, s.busy, !s.exited
	s.mu.Unlock()
	return s.manager.historyFor(s.id), cwd, busy, active
}

func (m *shellManager) shutdownAll() {
	m.mu.Lock()
	sessions := make([]*shellSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.sessions = map[string]*shellSession{}
	m.mu.Unlock()
	for _, session := range sessions {
		_ = session.kill()
	}
}

type shellCommandBody struct {
	Command string `json:"command"`
}

type shellStdinBody struct {
	Data string `json:"data"`
}

func shellJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (m *shellManager) handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, shellPathPrefix)
		if rest == r.URL.Path {
			http.NotFound(w, r)
			return
		}
		parts := strings.Split(strings.Trim(rest, "/"), "/")
		if len(parts) < 2 || len(parts) > 3 || parts[0] != "sessions" || !shellSessionIDPattern.MatchString(parts[1]) {
			http.NotFound(w, r)
			return
		}
		id := parts[1]
		action := ""
		if len(parts) == 3 {
			action = parts[2]
		}
		switch {
		case r.Method == http.MethodGet && action == "":
			m.serveHistory(w, id)
		case r.Method == http.MethodGet && action == "stream":
			m.serveStream(w, r, id)
		case r.Method == http.MethodPost && action == "command":
			var body shellCommandBody
			if !decodeShellBody(w, r, &body) || strings.TrimSpace(body.Command) == "" {
				if strings.TrimSpace(body.Command) == "" {
					shellJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "missing command"})
				}
				return
			}
			session, err := m.ensure(id)
			if err != nil {
				shellJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
				return
			}
			session.run(body.Command)
			shellJSON(w, http.StatusOK, map[string]any{"ok": true})
		case r.Method == http.MethodPost && action == "stdin":
			var body shellStdinBody
			if !decodeShellBody(w, r, &body) || body.Data == "" {
				if body.Data == "" {
					shellJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "missing data"})
				}
				return
			}
			session, err := m.ensure(id)
			if err != nil {
				shellJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
				return
			}
			session.sendStdin(body.Data)
			shellJSON(w, http.StatusOK, map[string]any{"ok": true})
		case r.Method == http.MethodPost && action == "interrupt":
			session := m.get(id)
			ok := session != nil && session.interrupt()
			shellJSON(w, http.StatusOK, map[string]any{"ok": ok})
		case r.Method == http.MethodPost && action == "kill":
			session := m.get(id)
			ok := session != nil && session.kill()
			shellJSON(w, http.StatusOK, map[string]any{"ok": ok})
		default:
			http.NotFound(w, r)
		}
	}
}

func decodeShellBody(w http.ResponseWriter, r *http.Request, target any) bool {
	if err := json.NewDecoder(io.LimitReader(r.Body, shellMaxBodyBytes)).Decode(target); err != nil {
		shellJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid JSON body"})
		return false
	}
	return true
}

func (m *shellManager) serveHistory(w http.ResponseWriter, id string) {
	// Read-only: never spawn a shell for a passive history poll. History and
	// cwd/busy live on the manager and survive without a live process, so a
	// viewer that is only watching cannot trigger a fork.
	session := m.get(id)
	cwd, busy, active := "", false, false
	if session != nil {
		_, cwd, busy, active = session.snapshot()
	}
	shellJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"lines":       m.historyFor(id),
		"cwd":         cwd,
		"busy":        busy,
		"shellActive": active,
	})
}

func (m *shellManager) serveStream(w http.ResponseWriter, r *http.Request, id string) {
	// Read-only: subscribe to the session's event stream without spawning a
	// shell. The subscription is keyed by id on the manager and survives
	// process restarts, so a viewer attaches even before/without a live shell
	// and starts receiving output as soon as a command spawns one.
	flusher, ok := w.(http.Flusher)
	if !ok {
		shellJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "streaming unsupported"})
		return
	}
	ch := m.subscribe(id)
	defer m.unsubscribe(id, ch)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	writeEvent := func(event shellEvent) bool {
		payload, err := json.Marshal(event)
		if err != nil {
			return false
		}
		if _, err := fmt.Fprintf(w, "event: terminal\ndata: %s\n\n", payload); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}

	// Metadata-only opener so the client gets cwd/busy without waiting for
	// the next command. Falls back to empty state when no shell exists yet.
	cwd, busy := "", false
	if session := m.get(id); session != nil {
		_, cwd, busy, _ = session.snapshot()
	}
	if !writeEvent(shellEvent{Cwd: cwd, Busy: busy}) {
		return
	}

	heartbeat := time.NewTicker(shellHeartbeatPeriod)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-ch:
			if !writeEvent(event) {
				return
			}
		case <-heartbeat.C:
			if _, err := io.WriteString(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// requireTailnetSelfUser limits tailnet-facing shell access to nodes owned by
// the same Tailscale user as this link node. Tagged nodes and other users on
// shared tailnets are rejected; tsnet already enforces tailnet membership
// below this.
func requireTailnetSelfUser(lc *local.Client, statusTimeout time.Duration, next http.Handler) http.Handler {
	var mu sync.Mutex
	selfLogin := ""
	resolveSelf := func(r *http.Request) (string, error) {
		mu.Lock()
		defer mu.Unlock()
		if selfLogin != "" {
			return selfLogin, nil
		}
		if statusTimeout <= 0 {
			statusTimeout = defaultStatusTimeout
		}
		ctx, cancel := context.WithTimeout(r.Context(), statusTimeout)
		defer cancel()
		status, err := lc.Status(ctx)
		if err != nil {
			return "", err
		}
		if status.Self == nil {
			return "", fmt.Errorf("link node has no self status")
		}
		profile, ok := status.User[status.Self.UserID]
		if !ok || strings.TrimSpace(profile.LoginName) == "" {
			return "", fmt.Errorf("link node owner unknown")
		}
		selfLogin = profile.LoginName
		return selfLogin, nil
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		who, err := lc.WhoIs(r.Context(), r.RemoteAddr)
		if err != nil || who == nil || who.UserProfile == nil {
			http.Error(w, "shell access requires a tailnet identity", http.StatusForbidden)
			return
		}
		if who.Node != nil && len(who.Node.Tags) > 0 {
			http.Error(w, "shell access is not available to tagged nodes", http.StatusForbidden)
			return
		}
		self, err := resolveSelf(r)
		if err != nil {
			http.Error(w, "shell access unavailable: "+err.Error(), http.StatusServiceUnavailable)
			return
		}
		if !strings.EqualFold(strings.TrimSpace(who.UserProfile.LoginName), self) {
			http.Error(w, "shell access is limited to this node's owner", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
