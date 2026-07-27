package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

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
