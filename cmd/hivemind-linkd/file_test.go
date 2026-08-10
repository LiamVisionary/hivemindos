package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func decodeFileReceiveResult(t *testing.T, recorder *httptest.ResponseRecorder) fileReceiveResult {
	t.Helper()
	var result fileReceiveResult
	if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
		t.Fatalf("decode response: %v; body = %q", err, recorder.Body.String())
	}
	return result
}

func TestFileEndpointReadsRegularFile(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "artifact.txt")
	if err := os.WriteFile(path, []byte("remote artifact\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest(http.MethodGet, "/_hivemind/file?path="+path, nil)
	recorder := httptest.NewRecorder()
	serveFileReceive().ServeHTTP(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()
	bytes, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200; body = %s", response.StatusCode, bytes)
	}
	if string(bytes) != "remote artifact\n" {
		t.Fatalf("body = %q", bytes)
	}
	if disposition := response.Header.Get("content-disposition"); !strings.Contains(disposition, "artifact.txt") {
		t.Fatalf("content-disposition = %q", disposition)
	}
}

func TestFileEndpointRejectsRelativeReadPath(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/_hivemind/file?path=relative.txt", nil)
	recorder := httptest.NewRecorder()
	serveFileReceive().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "absolute") {
		t.Fatalf("body = %q", recorder.Body.String())
	}
}

func TestFileEndpointRejectsDirectoryRead(t *testing.T) {
	path := t.TempDir()
	request := httptest.NewRequest(http.MethodGet, "/_hivemind/file?path="+path, nil)
	recorder := httptest.NewRecorder()
	serveFileReceive().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "regular file") {
		t.Fatalf("body = %q", recorder.Body.String())
	}
}

func TestMacDownloadsWriteRequiresSetupReadiness(t *testing.T) {
	home := t.TempDir()
	config := fileReceiveConfig{
		platform:             "darwin",
		homeDir:              home,
		downloadsReadyMarker: filepath.Join(home, ".hivemindos", "link", "downloads-ready"),
	}
	request := httptest.NewRequest(http.MethodPut, "/_hivemind/file?dir=~/Downloads&name=blocked.txt", strings.NewReader("blocked"))
	recorder := httptest.NewRecorder()
	serveFileReceive(config).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusPreconditionRequired {
		t.Fatalf("status = %d, want 428; body = %s", recorder.Code, recorder.Body.String())
	}
	result := decodeFileReceiveResult(t, recorder)
	if result.Code != "downloads_access_not_prepared" {
		t.Fatalf("code = %q", result.Code)
	}
	if _, err := os.Stat(filepath.Join(home, "Downloads", "blocked.txt")); !os.IsNotExist(err) {
		t.Fatalf("blocked destination was touched: %v", err)
	}
}

func TestLocalSetupPreparesDownloadsAndReturnsVerifiedWriteReceipt(t *testing.T) {
	home := t.TempDir()
	marker := filepath.Join(home, ".hivemindos", "link", "downloads-ready")
	config := fileReceiveConfig{platform: "darwin", homeDir: home, downloadsReadyMarker: marker}

	statusRequest := httptest.NewRequest(http.MethodGet, "/_hivemind/file/readiness?dir=~/Downloads", nil)
	statusRecorder := httptest.NewRecorder()
	serveFileReceiveReadiness(config, false).ServeHTTP(statusRecorder, statusRequest)
	status := decodeFileReceiveResult(t, statusRecorder)
	if status.Ready == nil || *status.Ready {
		t.Fatalf("initial readiness = %#v, want false", status.Ready)
	}

	prepareRequest := httptest.NewRequest(http.MethodPost, "/_hivemind/file/readiness?dir=~/Downloads", nil)
	prepareRecorder := httptest.NewRecorder()
	serveFileReceiveReadiness(config, true).ServeHTTP(prepareRecorder, prepareRequest)
	prepared := decodeFileReceiveResult(t, prepareRecorder)
	if prepareRecorder.Code != http.StatusOK || prepared.Ready == nil || !*prepared.Ready {
		t.Fatalf("prepare status = %d result = %#v", prepareRecorder.Code, prepared)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatalf("readiness marker missing: %v", err)
	}
	probes, err := filepath.Glob(filepath.Join(home, "Downloads", ".hivemindos-access-check-*"))
	if err != nil || len(probes) != 0 {
		t.Fatalf("temporary setup probes were not removed: %v %v", probes, err)
	}

	payload := "verified remote bytes\n"
	writeRequest := httptest.NewRequest(http.MethodPut, "/_hivemind/file?dir=~/Downloads&name=ready.txt", strings.NewReader(payload))
	writeRecorder := httptest.NewRecorder()
	serveFileReceive(config).ServeHTTP(writeRecorder, writeRequest)
	written := decodeFileReceiveResult(t, writeRecorder)
	expectedDigest := sha256.Sum256([]byte(payload))
	if writeRecorder.Code != http.StatusOK || written.Bytes != int64(len(payload)) || written.SHA256 != hex.EncodeToString(expectedDigest[:]) {
		t.Fatalf("write status = %d result = %#v", writeRecorder.Code, written)
	}
	if bytes, err := os.ReadFile(filepath.Join(home, "Downloads", "ready.txt")); err != nil || string(bytes) != payload {
		t.Fatalf("destination mismatch: %q %v", bytes, err)
	}
}

func TestPeerCannotTriggerDownloadsPreparation(t *testing.T) {
	home := t.TempDir()
	config := fileReceiveConfig{
		platform:             "darwin",
		homeDir:              home,
		downloadsReadyMarker: filepath.Join(home, ".hivemindos", "link", "downloads-ready"),
	}
	request := httptest.NewRequest(http.MethodPost, "/_hivemind/file/readiness?dir=~/Downloads", nil)
	recorder := httptest.NewRecorder()
	serveFileReceiveReadiness(config, false).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405; body = %s", recorder.Code, recorder.Body.String())
	}
	if _, err := os.Stat(config.downloadsReadyMarker); !os.IsNotExist(err) {
		t.Fatalf("peer preparation created marker: %v", err)
	}
}
