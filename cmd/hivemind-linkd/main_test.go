package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestDefaultStateDirIsHostnameIndependent(t *testing.T) {
	got := defaultStateDir("hivemindos-example-host")
	want := filepath.Join(".hivemindos", "link", "default")
	if !strings.HasSuffix(got, want) {
		t.Fatalf("defaultStateDir suffix = %q, want %q", got, want)
	}
	if strings.Contains(got, "example-host") {
		t.Fatalf("defaultStateDir should not include mutable hostname: %q", got)
	}
}

func TestLinkHostnameFromHostStripsMacOSConflictSuffix(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("macOS hostname conflict suffixes are only stripped on Darwin")
	}
	got := linkHostnameFromHost("Liams-MacBook-Pro-6.local")
	if got != "hivemindos-liams-macbook-pro" {
		t.Fatalf("linkHostnameFromHost = %q, want %q", got, "hivemindos-liams-macbook-pro")
	}
}

func TestCappedLogWriterKeepsActiveLogUnderLimit(t *testing.T) {
	path := filepath.Join(t.TempDir(), "hivemind-linkd.err.log")
	writer := newCappedLogWriter(path, 64)

	if n, err := writer.Write([]byte(strings.Repeat("a", 48))); err != nil || n != 48 {
		t.Fatalf("first write = %d, %v; want 48, nil", n, err)
	}
	if n, err := writer.Write([]byte(strings.Repeat("b", 48))); err != nil || n != 48 {
		t.Fatalf("second write = %d, %v; want 48, nil", n, err)
	}
	if n, err := writer.Write([]byte(strings.Repeat("c", 96))); err != nil || n != 96 {
		t.Fatalf("oversized write = %d, %v; want 96, nil", n, err)
	}

	active, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if active.Size() > 64 {
		t.Fatalf("active log size = %d, want <= 64", active.Size())
	}
	rotated, err := os.Stat(path + ".1")
	if err != nil {
		t.Fatal(err)
	}
	if rotated.Size() > 64 {
		t.Fatalf("rotated log size = %d, want <= 64", rotated.Size())
	}
}

func TestDefaultLogMaxBytesIsAgentFriendly(t *testing.T) {
	if defaultLogMaxBytes != 2*1024*1024 {
		t.Fatalf("defaultLogMaxBytes = %d, want 2 MiB", defaultLogMaxBytes)
	}
}

func TestShouldLogTailscaleFiltersHandshakeChatter(t *testing.T) {
	noisy := []string{
		"wg: [v2] [QDmc2] - Handshake did not complete after 5 seconds, retrying (try 2)",
		"wg: [v2] [QDmc2] - Sending handshake initiation",
		"wg: [v2] [/63gV] - Receiving keepalive packet",
		"wgengine: sending TSMP disco key advertisement to 203.0.113.10",
		"magicsock: derp-28 does not know about peer [QDmc2], removing route",
	}
	for _, message := range noisy {
		if shouldLogTailscale(message, false) {
			t.Fatalf("expected noisy Tailscale message to be filtered: %q", message)
		}
		if !shouldLogTailscale(message, true) {
			t.Fatalf("expected debug mode to keep Tailscale message: %q", message)
		}
	}
	if !shouldLogTailscale("control: client.Login(8)", false) {
		t.Fatal("expected non-noisy Tailscale status log to be kept")
	}
}

func TestAppProxyRefererTarget(t *testing.T) {
	request := httptest.NewRequest("GET", "http://127.0.0.1:8788/_next/static/chunks/app.js", nil)
	request.Header.Set("Referer", "http://127.0.0.1:8788/peer/100.84.93.114%3A8787/app-proxy/8788/")

	hostPort, prefix, ok := appProxyRefererTarget(request)
	if !ok {
		t.Fatal("expected app-proxy referer to produce a fallback target")
	}
	if hostPort != "100.84.93.114:8787" {
		t.Fatalf("hostPort = %q, want %q", hostPort, "100.84.93.114:8787")
	}
	if prefix != "/app-proxy/8788" {
		t.Fatalf("prefix = %q, want %q", prefix, "/app-proxy/8788")
	}
}

func TestAppProxyRefererTargetRejectsNonPeerReferer(t *testing.T) {
	request := httptest.NewRequest("GET", "http://127.0.0.1:8788/_next/static/chunks/app.js", nil)
	request.Header.Set("Referer", "http://127.0.0.1:8788/status")

	if _, _, ok := appProxyRefererTarget(request); ok {
		t.Fatal("expected non-peer referer to be rejected")
	}
}

func TestAppProxyRefererTargetUsesRootContextQuery(t *testing.T) {
	request := httptest.NewRequest("GET", "http://127.0.0.1:8788/_next/static/chunks/app.js", nil)
	request.Header.Set("Referer", "http://127.0.0.1:8788/?"+appProxyContextQuery+"="+encodeAppProxyContext("100.84.93.114:8787", "/app-proxy/8788"))

	hostPort, prefix, ok := appProxyRefererTarget(request)
	if !ok {
		t.Fatal("expected app-proxy referer query to produce a fallback target")
	}
	if hostPort != "100.84.93.114:8787" {
		t.Fatalf("hostPort = %q, want %q", hostPort, "100.84.93.114:8787")
	}
	if prefix != "/app-proxy/8788" {
		t.Fatalf("prefix = %q, want %q", prefix, "/app-proxy/8788")
	}
}

func TestAppProxyCookieTarget(t *testing.T) {
	request := httptest.NewRequest("GET", "http://127.0.0.1:8788/comfy/api/object_info", nil)
	request.AddCookie(&http.Cookie{
		Name:  appProxyContextCookie,
		Value: encodeAppProxyContext("100.84.93.114:8787", "/app-proxy/8788"),
	})

	hostPort, prefix, ok := appProxyCookieTarget(request)
	if !ok {
		t.Fatal("expected app-proxy cookie to produce a fallback target")
	}
	if hostPort != "100.84.93.114:8787" {
		t.Fatalf("hostPort = %q, want %q", hostPort, "100.84.93.114:8787")
	}
	if prefix != "/app-proxy/8788" {
		t.Fatalf("prefix = %q, want %q", prefix, "/app-proxy/8788")
	}
}

func TestRewritePeerRootHTML(t *testing.T) {
	html := `<script type="module" src="/mobile/assets/index.js"></script><link rel="stylesheet" href='./assets/index.css'><link rel="stylesheet" href='user.css'><script src="/_next/static/chunks/app.js" async=""></script><script>self.__next_f.push([1,":HL[\"/_next/static/chunks/app.css\",\"style\"]"])</script>`
	rewritten := rewritePeerRootHTML(html, "100.84.93.114:8787", "/app-proxy/8788")

	if rewritten == html {
		t.Fatal("expected root asset paths to be rewritten")
	}
	wantScript := `src="/peer/100.84.93.114%3A8787/app-proxy/8788/mobile/assets/index.js"`
	if !strings.Contains(rewritten, wantScript) {
		t.Fatalf("rewritten HTML missing %q:\n%s", wantScript, rewritten)
	}
	wantStyle := `href='/peer/100.84.93.114%3A8787/app-proxy/8788/assets/index.css'`
	if !strings.Contains(rewritten, wantStyle) {
		t.Fatalf("rewritten HTML missing %q:\n%s", wantStyle, rewritten)
	}
	wantBareStyle := `href='/peer/100.84.93.114%3A8787/app-proxy/8788/user.css'`
	if !strings.Contains(rewritten, wantBareStyle) {
		t.Fatalf("rewritten HTML missing %q:\n%s", wantBareStyle, rewritten)
	}
	wantFlight := `\"/peer/100.84.93.114%3A8787/app-proxy/8788/_next/static/chunks/app.css`
	if !strings.Contains(rewritten, wantFlight) {
		t.Fatalf("rewritten HTML missing %q:\n%s", wantFlight, rewritten)
	}
	if strings.Contains(rewritten, `/_next/static/chunks/app.js" async=""`) {
		t.Fatalf("rewritten HTML should remove async from Next chunk scripts:\n%s", rewritten)
	}
	if !strings.Contains(rewritten, `id="hivemind-app-portal-shim"`) {
		t.Fatalf("rewritten HTML missing portal shim:\n%s", rewritten)
	}
	if !strings.Contains(rewritten, `"peerPrefix":"/peer/100.84.93.114%3A8787"`) {
		t.Fatalf("portal shim missing peer prefix:\n%s", rewritten)
	}
	if !strings.Contains(rewritten, `"currentPort":"8788"`) {
		t.Fatalf("portal shim missing current app port:\n%s", rewritten)
	}
	for _, want := range []string{"MutationObserver", "HTMLImageElement", "data-preview-src", "rewriteSrcset", "wireImageErrorRetry", "__hive_bust"} {
		if !strings.Contains(rewritten, want) {
			t.Fatalf("portal shim missing media URL rewrite hook %q:\n%s", want, rewritten)
		}
	}
}

func TestInjectAppPortalScriptAvoidsDuplicate(t *testing.T) {
	html := `<html><head><script id="hivemind-app-portal-shim"></script></head><body>ok</body></html>`
	rewritten := injectAppPortalScript(html, "100.84.93.114:8787", "/app-proxy/8788")

	if count := strings.Count(rewritten, `id="hivemind-app-portal-shim"`); count != 1 {
		t.Fatalf("portal shim count = %d, want 1:\n%s", count, rewritten)
	}
}

func TestRewritePeerHTMLResponseRemovesFrameBlockingHeaders(t *testing.T) {
	recorder := httptest.NewRecorder()
	recorder.Header().Set("Content-Type", "text/html")
	recorder.Header().Set("Content-Security-Policy", "default-src 'self'")
	recorder.Header().Set("X-Frame-Options", "DENY")
	recorder.WriteString(`<html><body>ok</body></html>`)

	response := recorder.Result()
	if err := rewritePeerHTMLResponse(response, "100.84.93.114:8787", "/app-proxy/8788"); err != nil {
		t.Fatal(err)
	}
	if got := response.Header.Get("Content-Security-Policy"); got != "" {
		t.Fatalf("Content-Security-Policy = %q, want empty", got)
	}
	if got := response.Header.Get("X-Frame-Options"); got != "" {
		t.Fatalf("X-Frame-Options = %q, want empty", got)
	}
}

func TestAppProxyRedirectPath(t *testing.T) {
	request := httptest.NewRequest("GET", "http://127.0.0.1:8788/peer/100.84.93.114%3A8787/app-proxy/8788/?tab=workbench", nil)
	request.Header.Set("Accept", "text/html")
	context := encodeAppProxyContext("100.84.93.114:8787", "/app-proxy/8788")

	if !shouldRedirectAppProxyHTML(request, "/app-proxy/8788/", "/app-proxy/8788") {
		t.Fatal("expected app-proxy HTML route to redirect to the app path")
	}
	wantRoot := "/?" + appProxyContextQuery + "=" + context + "&tab=workbench"
	if got := appProxyRedirectPath(request, "/app-proxy/8788/", "/app-proxy/8788"); got != wantRoot {
		t.Fatalf("redirect path = %q, want %q", got, wantRoot)
	}
	wantMobile := "/mobile/?" + appProxyContextQuery + "=" + context + "&tab=workbench"
	if got := appProxyRedirectPath(request, "/app-proxy/8788/mobile/", "/app-proxy/8788"); got != wantMobile {
		t.Fatalf("mobile redirect path = %q, want %q", got, wantMobile)
	}
}

func TestAppProxyRedirectRejectsStaticAssets(t *testing.T) {
	request := httptest.NewRequest("GET", "http://127.0.0.1:8788/peer/100.84.93.114%3A8787/app-proxy/8788/_next/static/chunks/app.js", nil)
	request.Header.Set("Accept", "application/javascript")

	if shouldRedirectAppProxyHTML(request, "/app-proxy/8788/_next/static/chunks/app.js", "/app-proxy/8788") {
		t.Fatal("expected static app-proxy asset to stay proxied")
	}
}

func TestPeerRawOutPathPreservesEncodedSlash(t *testing.T) {
	rawPath := peerRawOutPath("/peer/100.84.93.114%3A8787/app-proxy/8788/comfy/api/userdata/workflows%2FBig%20Love.json")

	want := "/app-proxy/8788/comfy/api/userdata/workflows%2FBig%20Love.json"
	if rawPath != want {
		t.Fatalf("raw path = %q, want %q", rawPath, want)
	}
}
