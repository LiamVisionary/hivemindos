package main

// File-receive endpoint for HivemindOS Link.
//
// Writes a single file pushed over the tailnet to <dir>/<name> on this
// machine. It rides the same peer proxy + self-user gate as the shell service,
// so the dashboard's "Send file" button reaches any machine the Shell button
// reaches — no system sshd or Tailscale SSH required.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const (
	fileReceivePath     = "/_hivemind/file"
	fileReceiveMaxBytes = 200 << 20 // 200 MiB
)

type fileReceiveResult struct {
	OK    bool   `json:"ok"`
	Path  string `json:"path,omitempty"`
	Bytes int64  `json:"bytes,omitempty"`
	Error string `json:"error,omitempty"`
}

func writeFileReceiveJSON(w http.ResponseWriter, status int, body fileReceiveResult) {
	w.Header().Set("content-type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// serveFileReceive moves a single file across the link in either direction.
// PUT/POST writes the request body to <dir>/<name>; GET streams an absolute
// path from this machine back to the authenticated peer.
func serveFileReceive() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			serveFileRead(w, r)
			return
		}
		if r.Method != http.MethodPut && r.Method != http.MethodPost {
			writeFileReceiveJSON(w, http.StatusMethodNotAllowed, fileReceiveResult{Error: "method not allowed"})
			return
		}
		name := sanitizeFileReceiveName(r.URL.Query().Get("name"))
		if name == "" {
			writeFileReceiveJSON(w, http.StatusBadRequest, fileReceiveResult{Error: "invalid or missing file name"})
			return
		}
		dir, err := expandFileReceiveDir(r.URL.Query().Get("dir"))
		if err != nil {
			writeFileReceiveJSON(w, http.StatusBadRequest, fileReceiveResult{Error: "could not resolve destination: " + err.Error()})
			return
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			writeFileReceiveJSON(w, http.StatusInternalServerError, fileReceiveResult{Error: "could not create destination folder: " + err.Error()})
			return
		}
		outPath := filepath.Join(dir, name)
		f, err := os.OpenFile(outPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
		if err != nil {
			writeFileReceiveJSON(w, http.StatusInternalServerError, fileReceiveResult{Error: "could not open destination file: " + err.Error()})
			return
		}
		limited := http.MaxBytesReader(w, r.Body, fileReceiveMaxBytes)
		n, copyErr := io.Copy(f, limited)
		closeErr := f.Close()
		if copyErr != nil {
			_ = os.Remove(outPath)
			status := http.StatusInternalServerError
			msg := copyErr.Error()
			if strings.Contains(msg, "request body too large") {
				status = http.StatusRequestEntityTooLarge
				msg = "file exceeds the 200MB limit"
			}
			writeFileReceiveJSON(w, status, fileReceiveResult{Error: msg})
			return
		}
		if closeErr != nil {
			_ = os.Remove(outPath)
			writeFileReceiveJSON(w, http.StatusInternalServerError, fileReceiveResult{Error: "could not finish writing file: " + closeErr.Error()})
			return
		}
		writeFileReceiveJSON(w, http.StatusOK, fileReceiveResult{OK: true, Path: outPath, Bytes: n})
	})
}

func serveFileRead(w http.ResponseWriter, r *http.Request) {
	path, err := expandFileReadPath(r.URL.Query().Get("path"))
	if err != nil {
		writeFileReceiveJSON(w, http.StatusBadRequest, fileReceiveResult{Error: err.Error()})
		return
	}
	file, err := os.Open(path)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, os.ErrNotExist) {
			status = http.StatusNotFound
		} else if errors.Is(err, os.ErrPermission) {
			status = http.StatusForbidden
		}
		writeFileReceiveJSON(w, status, fileReceiveResult{Error: "could not read source file"})
		return
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		writeFileReceiveJSON(w, http.StatusInternalServerError, fileReceiveResult{Error: "could not inspect source file"})
		return
	}
	if !info.Mode().IsRegular() {
		writeFileReceiveJSON(w, http.StatusBadRequest, fileReceiveResult{Error: "source path is not a regular file"})
		return
	}
	if info.Size() > fileReceiveMaxBytes {
		writeFileReceiveJSON(w, http.StatusRequestEntityTooLarge, fileReceiveResult{Error: "file exceeds the 200MB limit"})
		return
	}

	name := sanitizeFileReceiveName(info.Name())
	if disposition := mime.FormatMediaType("attachment", map[string]string{"filename": name}); disposition != "" {
		w.Header().Set("content-disposition", disposition)
	}
	w.Header().Set("cache-control", "no-store")
	http.ServeContent(w, r, name, info.ModTime(), file)
}

// sanitizeFileReceiveName reduces an arbitrary name to a single basename so a
// pushed file can only ever land directly inside dir, never traverse out of it.
func sanitizeFileReceiveName(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	// Strip both separator styles regardless of host OS, then take the base.
	if idx := strings.LastIndexAny(raw, `/\`); idx >= 0 {
		raw = raw[idx+1:]
	}
	base := strings.TrimSpace(filepath.Base(raw))
	if base == "" || base == "." || base == ".." || base == string(filepath.Separator) {
		return ""
	}
	return base
}

func expandFileReceiveDir(raw string) (string, error) {
	dir := strings.TrimSpace(raw)
	if dir == "" {
		dir = "~/Downloads"
	}
	if dir == "~" || strings.HasPrefix(dir, "~/") || strings.HasPrefix(dir, `~\`) {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		if dir == "~" {
			return home, nil
		}
		return filepath.Join(home, dir[2:]), nil
	}
	return dir, nil
}

func expandFileReadPath(raw string) (string, error) {
	path := strings.TrimSpace(raw)
	if path == "" {
		return "", fmt.Errorf("missing source path")
	}
	if path == "~" || strings.HasPrefix(path, "~/") || strings.HasPrefix(path, `~\`) {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("could not resolve source path")
		}
		if path == "~" {
			path = home
		} else {
			path = filepath.Join(home, path[2:])
		}
	}
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("source path must be absolute")
	}
	return filepath.Clean(path), nil
}
