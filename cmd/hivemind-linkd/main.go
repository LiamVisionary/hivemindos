package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/envknob"
	"tailscale.com/tsnet"
)

const appProxyContextCookie = "hivemind_link_app_proxy"
const appProxyContextQuery = "__hive_app_proxy"
const defaultLogMaxBytes = 2 * 1024 * 1024
const defaultStatusTimeout = 3 * time.Second

type config struct {
	hostname        string
	stateDir        string
	listenAddr      string
	control         string
	target          string
	authKey         string
	controlURL      string
	logFile         string
	logMax          int64
	tailDebug       bool
	runWebClient    bool
	disablePortlist bool
	statusTimeout   time.Duration
}

func defaultHostname() string {
	host, err := os.Hostname()
	if err != nil || strings.TrimSpace(host) == "" {
		host = "machine"
	}
	return linkHostnameFromHost(host)
}

func linkHostnameFromHost(host string) string {
	host = strings.TrimSuffix(host, ".local")
	if runtime.GOOS == "darwin" {
		host = regexp.MustCompile(`-\d+$`).ReplaceAllString(host, "")
	}
	clean := regexp.MustCompile(`[^a-zA-Z0-9-]+`).ReplaceAllString(strings.ToLower(host), "-")
	clean = strings.Trim(clean, "-")
	if clean == "" {
		clean = "machine"
	}
	return "hivemindos-" + clean
}

func defaultStateDir(_ string) string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return filepath.Join(".hivemindos", "link", "default")
	}
	return filepath.Join(home, ".hivemindos", "link", "default")
}

func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func parseConfig() config {
	hostname := env("HIVE_LINK_HOSTNAME", defaultHostname())
	cfg := config{}
	flag.StringVar(&cfg.hostname, "hostname", hostname, "Tailscale hostname for this HivemindOS Link node")
	flag.StringVar(&cfg.stateDir, "state-dir", env("HIVE_LINK_STATE_DIR", defaultStateDir(hostname)), "directory for embedded Tailscale state")
	flag.StringVar(&cfg.listenAddr, "listen", env("HIVE_LINK_LISTEN", ":8787"), "Tailnet listen address for the collector proxy")
	flag.StringVar(&cfg.control, "control", env("HIVE_LINK_CONTROL", "127.0.0.1:8788"), "local control/status API address")
	flag.StringVar(&cfg.target, "target", env("HIVE_LINK_TARGET", "http://127.0.0.1:8787"), "local collector URL to proxy")
	flag.StringVar(&cfg.authKey, "auth-key", env("HIVE_LINK_AUTH_KEY", ""), "optional Tailscale auth key for headless linking")
	flag.StringVar(&cfg.controlURL, "tailscale-control-url", env("HIVE_LINK_TAILSCALE_CONTROL_URL", ""), "optional custom Tailscale control URL")
	flag.StringVar(&cfg.logFile, "log-file", defaultLogFile(), "optional capped log file for daemon diagnostics")
	flag.Int64Var(&cfg.logMax, "log-max-bytes", defaultLogMaxBytesFromEnv(), "maximum active daemon log size in bytes")
	flag.BoolVar(&cfg.tailDebug, "tailscale-debug-logs", defaultTailscaleDebugLogs(), "include verbose embedded Tailscale logs")
	flag.BoolVar(&cfg.runWebClient, "run-web-client", defaultBoolFromEnv("HIVE_LINK_RUN_WEB_CLIENT", false), "expose Tailscale's embedded web client for this app node")
	flag.BoolVar(&cfg.disablePortlist, "disable-portlist", defaultBoolFromEnv("HIVE_LINK_DISABLE_PORTLIST", true), "disable Tailscale's macOS portlist polling helpers")
	flag.DurationVar(&cfg.statusTimeout, "status-timeout", defaultStatusTimeoutFromEnv(), "maximum time spent waiting for embedded Tailscale status")
	flag.Parse()
	return cfg
}

func defaultBoolFromEnv(key string, fallback bool) bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	switch value {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func defaultTailscaleDebugLogs() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("HIVE_LINK_TAILSCALE_DEBUG_LOGS")))
	return value == "1" || value == "true" || value == "yes" || value == "on"
}

func defaultLogFile() string {
	if value := strings.TrimSpace(os.Getenv("HIVE_LINK_LOG_FILE")); value != "" {
		return value
	}
	if runtime.GOOS != "darwin" || !strings.Contains(os.Getenv("XPC_SERVICE_NAME"), "hivemindos.linkd") {
		return ""
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return ""
	}
	return filepath.Join(home, "Library", "Logs", "hivemindos-linkd.err.log")
}

func defaultLogMaxBytesFromEnv() int64 {
	value := strings.TrimSpace(os.Getenv("HIVE_LINK_LOG_MAX_BYTES"))
	if value == "" {
		return defaultLogMaxBytes
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed <= 0 {
		return defaultLogMaxBytes
	}
	if parsed > defaultLogMaxBytes {
		return defaultLogMaxBytes
	}
	return parsed
}

func defaultStatusTimeoutFromEnv() time.Duration {
	value := strings.TrimSpace(os.Getenv("HIVE_LINK_STATUS_TIMEOUT"))
	if value == "" {
		return defaultStatusTimeout
	}
	parsed, err := time.ParseDuration(value)
	if err != nil || parsed <= 0 {
		return defaultStatusTimeout
	}
	if parsed > 30*time.Second {
		return 30 * time.Second
	}
	return parsed
}

type cappedLogWriter struct {
	mu       sync.Mutex
	path     string
	maxBytes int64
}

func newCappedLogWriter(path string, maxBytes int64) *cappedLogWriter {
	return &cappedLogWriter{path: path, maxBytes: maxBytes}
}

func (writer *cappedLogWriter) Write(p []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()

	originalLen := len(p)
	if writer.maxBytes <= 0 {
		writer.maxBytes = defaultLogMaxBytes
	}
	if err := writer.rotateIfNeeded(int64(len(p))); err != nil {
		return 0, err
	}
	file, err := os.OpenFile(writer.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, err
	}
	defer file.Close()

	if int64(len(p)) > writer.maxBytes {
		p = p[int64(len(p))-writer.maxBytes:]
	}
	written, err := file.Write(p)
	if err != nil {
		return written, err
	}
	if written != len(p) {
		return written, io.ErrShortWrite
	}
	if int64(written) > writer.maxBytes {
		return written, writer.truncateToMax()
	}
	return originalLen, nil
}

func (writer *cappedLogWriter) rotateIfNeeded(incoming int64) error {
	info, err := os.Stat(writer.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.Size()+incoming <= writer.maxBytes {
		return nil
	}
	rotated := writer.path + ".1"
	_ = os.Remove(rotated)
	if err := os.Rename(writer.path, rotated); err != nil {
		return err
	}
	return trimFile(rotated, writer.maxBytes)
}

func (writer *cappedLogWriter) truncateToMax() error {
	return trimFile(writer.path, writer.maxBytes)
}

func trimFile(path string, maxBytes int64) error {
	if maxBytes <= 0 {
		return nil
	}
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil || info.Size() <= maxBytes {
		return err
	}
	file, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return err
	}
	defer file.Close()

	if _, err := file.Seek(-maxBytes, io.SeekEnd); err != nil {
		return err
	}
	buf, err := io.ReadAll(file)
	if err != nil {
		return err
	}
	if err := file.Truncate(0); err != nil {
		return err
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return err
	}
	_, err = file.Write(buf)
	return err
}

func configureLogging(cfg config) {
	if strings.TrimSpace(cfg.logFile) == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(cfg.logFile), 0o700); err != nil {
		log.Printf("create log dir: %v", err)
		return
	}
	log.SetOutput(newCappedLogWriter(cfg.logFile, cfg.logMax))
}

func tailscaleLogf(debug bool) func(string, ...any) {
	return func(format string, args ...any) {
		message := fmt.Sprintf(format, args...)
		if !shouldLogTailscale(message, debug) {
			return
		}
		log.Print("tailscale: " + message)
	}
}

func shouldLogTailscale(message string, debug bool) bool {
	if debug {
		return true
	}
	noisePatterns := []string{
		"[v2]",
		"Handshake did not complete",
		"Sending handshake initiation",
		"Receiving keepalive packet",
		"sending TSMP disco key advertisement",
		"does not know about peer",
	}
	for _, pattern := range noisePatterns {
		if strings.Contains(message, pattern) {
			return false
		}
	}
	return true
}

func newProxy(target *url.URL, lc *local.Client) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(target)
	original := proxy.Director
	proxy.Director = func(r *http.Request) {
		original(r)
		r.Header.Del("x-hivemind-link-user")
		r.Header.Del("x-hivemind-link-node")
		r.Header.Del("x-tailscale-user")
		r.Header.Del("x-tailscale-node")
		if lc == nil {
			return
		}
		who, err := lc.WhoIs(r.Context(), r.RemoteAddr)
		if err != nil {
			return
		}
		r.Header.Set("x-hivemind-link-user", who.UserProfile.LoginName)
		r.Header.Set("x-tailscale-user", who.UserProfile.LoginName)
		if who.Node != nil {
			r.Header.Set("x-hivemind-link-node", who.Node.ComputedName)
			r.Header.Set("x-tailscale-node", who.Node.ComputedName)
		}
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		http.Error(w, fmt.Sprintf("hivemind-linkd proxy error: %v", err), http.StatusBadGateway)
	}
	return proxy
}

func statusPayload(ctx context.Context, lc *local.Client, timeout time.Duration) map[string]any {
	if lc == nil {
		return map[string]any{"ok": false, "error": "local tailscale client unavailable"}
	}
	if timeout <= 0 {
		timeout = defaultStatusTimeout
	}
	statusCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	status, err := lc.Status(statusCtx)
	if err != nil {
		return map[string]any{"ok": false, "error": err.Error()}
	}
	return map[string]any{
		"ok":             status.BackendState == "Running",
		"backendState":   status.BackendState,
		"authUrl":        status.AuthURL,
		"magicDnsSuffix": status.MagicDNSSuffix,
		"self":           status.Self,
		"peer":           status.Peer,
	}
}

func servePeerProxy(ts *tsnet.Server) http.HandlerFunc {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network string, addr string) (net.Conn, error) {
			return ts.Dial(ctx, network, addr)
		},
	}
	return func(w http.ResponseWriter, r *http.Request) {
		rest := strings.TrimPrefix(r.URL.Path, "/peer/")
		parts := strings.SplitN(rest, "/", 2)
		hostPort, err := url.PathUnescape(parts[0])
		if err != nil || hostPort == "" {
			http.Error(w, "missing peer host", http.StatusBadRequest)
			return
		}
		if _, _, err := net.SplitHostPort(hostPort); err != nil {
			http.Error(w, "peer host must include a port", http.StatusBadRequest)
			return
		}
		outPath := "/"
		if len(parts) == 2 {
			outPath += parts[1]
		}
		outRawPath := peerRawOutPath(r.URL.EscapedPath())
		appProxyPrefix := ""
		if appProxyMatch := regexp.MustCompile(`^(/app-proxy/\d+)(?:/.*)?$`).FindStringSubmatch(outPath); len(appProxyMatch) == 2 {
			appProxyPrefix = appProxyMatch[1]
		}
		if appProxyPrefix != "" {
			setAppProxyContextCookie(w, hostPort, appProxyPrefix)
			if shouldRedirectAppProxyHTML(r, outPath, appProxyPrefix) {
				http.Redirect(w, r, appProxyRedirectPath(r, outPath, appProxyPrefix), http.StatusTemporaryRedirect)
				return
			}
		}
		proxy := &httputil.ReverseProxy{
			Director: func(out *http.Request) {
				out.URL.Scheme = "http"
				out.URL.Host = hostPort
				out.URL.Path = outPath
				out.URL.RawPath = outRawPath
				out.Host = hostPort
				out.RequestURI = ""
				out.Header.Del("Accept-Encoding")
				out.Header.Del("Origin")
			},
			ModifyResponse: func(res *http.Response) error {
				if appProxyPrefix == "" {
					return nil
				}
				return rewritePeerHTMLResponse(res, hostPort, appProxyPrefix)
			},
			Transport: transport,
			ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
				http.Error(w, fmt.Sprintf("hivemind-linkd peer proxy error: %v", err), http.StatusBadGateway)
			},
		}
		proxy.ServeHTTP(w, r)
	}
}

func appProxyRefererTarget(r *http.Request) (string, string, bool) {
	referer := strings.TrimSpace(r.Referer())
	if referer == "" {
		return "", "", false
	}
	refererURL, err := url.Parse(referer)
	if err != nil {
		return "", "", false
	}
	if hostPort, appProxyPrefix, ok := decodeAppProxyContext(refererURL.Query().Get(appProxyContextQuery)); ok {
		return hostPort, appProxyPrefix, true
	}
	rest := strings.TrimPrefix(refererURL.Path, "/peer/")
	if rest == refererURL.Path {
		return "", "", false
	}
	parts := strings.SplitN(rest, "/", 2)
	hostPort, err := url.PathUnescape(parts[0])
	if err != nil || hostPort == "" {
		return "", "", false
	}
	if _, _, err := net.SplitHostPort(hostPort); err != nil {
		return "", "", false
	}
	if len(parts) != 2 {
		return "", "", false
	}
	peerPath := "/" + parts[1]
	appProxyMatch := regexp.MustCompile(`^(/app-proxy/\d+)(?:/.*)?$`).FindStringSubmatch(peerPath)
	if len(appProxyMatch) != 2 {
		return "", "", false
	}
	return hostPort, appProxyMatch[1], true
}

func validateAppProxyTarget(hostPort string, appProxyPrefix string) bool {
	if _, _, err := net.SplitHostPort(hostPort); err != nil {
		return false
	}
	return regexp.MustCompile(`^/app-proxy/\d+$`).MatchString(appProxyPrefix)
}

func encodeAppProxyContext(hostPort string, appProxyPrefix string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(hostPort + "|" + appProxyPrefix))
}

func decodeAppProxyContext(value string) (string, string, bool) {
	if strings.TrimSpace(value) == "" {
		return "", "", false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		return "", "", false
	}
	parts := strings.SplitN(string(decoded), "|", 2)
	if len(parts) != 2 || !validateAppProxyTarget(parts[0], parts[1]) {
		return "", "", false
	}
	return parts[0], parts[1], true
}

func appProxyQueryTarget(r *http.Request) (string, string, bool) {
	return decodeAppProxyContext(r.URL.Query().Get(appProxyContextQuery))
}

func appProxyCookieTarget(r *http.Request) (string, string, bool) {
	cookie, err := r.Cookie(appProxyContextCookie)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return "", "", false
	}
	return decodeAppProxyContext(cookie.Value)
}

func appProxyFallbackTarget(r *http.Request) (string, string, bool, bool) {
	if hostPort, appProxyPrefix, ok := appProxyQueryTarget(r); ok {
		return hostPort, appProxyPrefix, true, true
	}
	if hostPort, appProxyPrefix, ok := appProxyRefererTarget(r); ok {
		return hostPort, appProxyPrefix, true, true
	}
	if hostPort, appProxyPrefix, ok := appProxyCookieTarget(r); ok {
		return hostPort, appProxyPrefix, true, false
	}
	return "", "", false, false
}

func servePeerRefererFallback(ts *tsnet.Server) http.HandlerFunc {
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network string, addr string) (net.Conn, error) {
			return ts.Dial(ctx, network, addr)
		},
	}
	return func(w http.ResponseWriter, r *http.Request) {
		hostPort, appProxyPrefix, ok, fromReferer := appProxyFallbackTarget(r)
		if !ok {
			http.NotFound(w, r)
			return
		}
		if fromReferer {
			setAppProxyContextCookie(w, hostPort, appProxyPrefix)
		}
		proxy := &httputil.ReverseProxy{
			Director: func(out *http.Request) {
				out.URL.Scheme = "http"
				out.URL.Host = hostPort
				out.URL.Path = appProxyPrefix + r.URL.Path
				out.URL.RawPath = appProxyPrefix + r.URL.EscapedPath()
				out.URL.RawQuery = appProxyForwardRawQuery(r.URL.Query())
				out.Host = hostPort
				out.RequestURI = ""
				out.Header.Del("Accept-Encoding")
				out.Header.Del("Origin")
			},
			ModifyResponse: func(res *http.Response) error {
				return rewritePeerHTMLResponse(res, hostPort, appProxyPrefix)
			},
			Transport: transport,
			ErrorHandler: func(w http.ResponseWriter, _ *http.Request, err error) {
				http.Error(w, fmt.Sprintf("hivemind-linkd peer proxy error: %v", err), http.StatusBadGateway)
			},
		}
		proxy.ServeHTTP(w, r)
	}
}

func setAppProxyContextCookie(w http.ResponseWriter, hostPort string, appProxyPrefix string) {
	http.SetCookie(w, &http.Cookie{
		Name:     appProxyContextCookie,
		Value:    encodeAppProxyContext(hostPort, appProxyPrefix),
		Path:     "/",
		MaxAge:   300,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func shouldRedirectAppProxyHTML(r *http.Request, outPath string, appProxyPrefix string) bool {
	if r.Method != http.MethodGet || appProxyPrefix == "" || !strings.HasPrefix(outPath, appProxyPrefix) {
		return false
	}
	accept := strings.ToLower(r.Header.Get("accept"))
	if accept != "" && !strings.Contains(accept, "text/html") {
		return false
	}
	appPath := strings.TrimPrefix(outPath, appProxyPrefix)
	return appPath == "" || appPath == "/" || strings.HasSuffix(appPath, "/")
}

func appProxyRedirectPath(r *http.Request, outPath string, appProxyPrefix string) string {
	appPath := strings.TrimPrefix(outPath, appProxyPrefix)
	if appPath == "" {
		appPath = "/"
	}
	values := r.URL.Query()
	values.Set(appProxyContextQuery, encodeAppProxyContext(appProxyHostPortFromPath(r.URL.Path), appProxyPrefix))
	if encoded := values.Encode(); encoded != "" {
		appPath += "?" + encoded
	}
	return appPath
}

func appProxyHostPortFromPath(path string) string {
	rest := strings.TrimPrefix(path, "/peer/")
	parts := strings.SplitN(rest, "/", 2)
	hostPort, err := url.PathUnescape(parts[0])
	if err != nil {
		return ""
	}
	return hostPort
}

func peerRawOutPath(escapedPath string) string {
	rest := strings.TrimPrefix(escapedPath, "/peer/")
	if rest == escapedPath {
		return ""
	}
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) != 2 {
		return "/"
	}
	return "/" + parts[1]
}

func appProxyForwardRawQuery(values url.Values) string {
	forward := make(url.Values, len(values))
	for key, entries := range values {
		if key == appProxyContextQuery {
			continue
		}
		forward[key] = append([]string(nil), entries...)
	}
	return forward.Encode()
}

func rewritePeerHTMLResponse(res *http.Response, hostPort string, appProxyPrefix string) error {
	res.Header.Del("Content-Security-Policy")
	res.Header.Del("Content-Security-Policy-Report-Only")
	res.Header.Del("X-Frame-Options")
	contentType := strings.ToLower(res.Header.Get("content-type"))
	if !strings.Contains(contentType, "text/html") {
		return nil
	}
	body, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if err := res.Body.Close(); err != nil {
		return err
	}
	rewritten := rewritePeerRootHTML(string(body), hostPort, appProxyPrefix)
	res.Body = io.NopCloser(strings.NewReader(rewritten))
	res.ContentLength = int64(len(rewritten))
	res.Header.Set("Content-Length", fmt.Sprintf("%d", len(rewritten)))
	return nil
}

func rewritePeerRootHTML(html string, hostPort string, appProxyPrefix string) string {
	prefix := "/peer/" + escapePeerPathSegment(hostPort) + appProxyPrefix
	replacements := []struct {
		old string
		new string
	}{
		{`src="/`, `src="` + prefix + `/`},
		{`href="/`, `href="` + prefix + `/`},
		{`action="/`, `action="` + prefix + `/`},
		{`poster="/`, `poster="` + prefix + `/`},
		{`src='/`, `src='` + prefix + `/`},
		{`href='/`, `href='` + prefix + `/`},
		{`action='/`, `action='` + prefix + `/`},
		{`poster='/`, `poster='` + prefix + `/`},
		{`\"/_next/`, `\"` + prefix + `/_next/`},
		{`\"/favicon`, `\"` + prefix + `/favicon`},
	}
	for _, replacement := range replacements {
		html = strings.ReplaceAll(html, replacement.old, replacement.new)
	}
	html = rewritePeerRelativeHTMLAttrs(html, prefix)
	html = regexp.MustCompile(`(<script src=["'][^"']*/_next/static/chunks/[^"']+["']) async=""`).ReplaceAllString(html, "$1")
	html = injectAppPortalScript(html, hostPort, appProxyPrefix)
	return html
}

func rewritePeerRelativeHTMLAttrs(html string, prefix string) string {
	attrPattern := regexp.MustCompile(`(?i)(\s(?:src|href|action|poster)=)(["'])([^"'#/][^"']*)`)
	return attrPattern.ReplaceAllStringFunc(html, func(match string) string {
		parts := attrPattern.FindStringSubmatch(match)
		if len(parts) != 4 {
			return match
		}
		value := parts[3]
		if strings.Contains(value, ":") || strings.HasPrefix(value, "data:") || strings.HasPrefix(value, "mailto:") || strings.HasPrefix(value, "tel:") {
			return match
		}
		value = strings.TrimPrefix(value, "./")
		return parts[1] + parts[2] + prefix + "/" + value + parts[2]
	})
}

func escapePeerPathSegment(value string) string {
	return strings.ReplaceAll(url.PathEscape(value), ":", "%3A")
}

func injectAppPortalScript(html string, hostPort string, appProxyPrefix string) string {
	if strings.Contains(html, "hivemind-app-portal-shim") || !validateAppProxyTarget(hostPort, appProxyPrefix) {
		return html
	}
	script := appPortalScript(hostPort, appProxyPrefix)
	lower := strings.ToLower(html)
	for _, marker := range []string{"</head>", "</body>"} {
		if index := strings.Index(lower, marker); index >= 0 {
			return html[:index] + script + html[index:]
		}
	}
	return script + html
}

func appPortalScript(hostPort string, appProxyPrefix string) string {
	currentPort := strings.TrimPrefix(appProxyPrefix, "/app-proxy/")
	contextJSON, _ := json.Marshal(map[string]string{
		"peerPrefix":  "/peer/" + escapePeerPathSegment(hostPort),
		"appPrefix":   appProxyPrefix,
		"currentPort": currentPort,
	})
	return `<script id="hivemind-app-portal-shim">` + `
(() => {
  const ctx = ` + string(contextJSON) + `;
  const localHosts = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
  const appProxyForPort = (port) => ctx.peerPrefix + "/app-proxy/" + port;
  const defaultPort = (protocol) => protocol === "https:" || protocol === "wss:" ? "443" : "80";
  const isRootRelative = (value) => /^\/(?!\/)/.test(value);
  const isHttpLike = (protocol) => ["http:", "https:", "ws:", "wss:"].includes(protocol);
  const localPortFromUrl = (url) => url.port || defaultPort(url.protocol);
  const alreadyPortal = (value) => value.startsWith(ctx.peerPrefix + "/app-proxy/") || value.startsWith("/peer/");
  function rewriteString(value) {
    if (typeof value !== "string" || value === "" || value.startsWith("data:") || value.startsWith("blob:")) return value;
    if (alreadyPortal(value)) return value;
    let url;
    try {
      url = new URL(value, window.location.href);
    } catch {
      return value;
    }
    if (!isHttpLike(url.protocol)) return value;
    const rootRelative = isRootRelative(value);
    const sameOrigin = url.origin === window.location.origin;
    const localHost = localHosts.has(url.hostname);
    if (!rootRelative && !sameOrigin && !localHost) return value;
    let port = ctx.currentPort;
    if (!rootRelative && localHost && !value.startsWith(window.location.origin)) {
      port = localPortFromUrl(url);
    }
    const target = appProxyForPort(port) + url.pathname + url.search + url.hash;
    if (url.protocol === "ws:" || url.protocol === "wss:") {
      return (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host + target;
    }
    return target;
  }
  function rewriteSrcset(value) {
    if (typeof value !== "string" || value === "") return value;
    return value.split(",").map((candidate) => {
      const parts = candidate.trim().split(/\s+/);
      if (!parts[0]) return candidate;
      parts[0] = rewriteString(parts[0]);
      return parts.join(" ");
    }).join(", ");
  }
  function cacheBustedURL(value) {
    const rewritten = rewriteString(value);
    if (typeof rewritten !== "string" || rewritten === "" || rewritten.startsWith("data:") || rewritten.startsWith("blob:")) return rewritten;
    try {
      const url = new URL(rewritten, window.location.href);
      url.searchParams.set("__hive_bust", String(Date.now()));
      if (url.origin === window.location.origin) return url.pathname + url.search + url.hash;
      return url.toString();
    } catch {
      return rewritten;
    }
  }
  function wireImageErrorRetry(element) {
    if (!element || element.tagName !== "IMG" || element.__hivemindPortalImageRetry) return;
    element.__hivemindPortalImageRetry = true;
    element.addEventListener("error", () => {
      const current = element.getAttribute("src") || element.currentSrc || "";
      const busted = cacheBustedURL(current);
      if (busted && busted !== current) element.setAttribute("src", busted);
    }, { once: true });
  }
  function rewriteInput(input) {
    if (typeof input === "string") return rewriteString(input);
    if (input instanceof URL) return new URL(rewriteString(input.toString()), window.location.href);
    if (typeof Request !== "undefined" && input instanceof Request) {
      const rewritten = rewriteString(input.url);
      return rewritten === input.url ? input : new Request(rewritten, input);
    }
    return input;
  }
  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function(input, init) {
      return originalFetch.call(this, rewriteInput(input), init);
    };
  }
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return originalOpen.call(this, method, rewriteString(String(url)), ...rest);
  };
  const OriginalWebSocket = window.WebSocket;
  if (OriginalWebSocket) {
    window.WebSocket = new Proxy(OriginalWebSocket, {
      construct(target, args) {
        args[0] = rewriteString(String(args[0]));
        return Reflect.construct(target, args);
      },
      apply(target, thisArg, args) {
        args[0] = rewriteString(String(args[0]));
        return Reflect.apply(target, thisArg, args);
      },
    });
  }
  const OriginalEventSource = window.EventSource;
  if (OriginalEventSource) {
    window.EventSource = new Proxy(OriginalEventSource, {
      construct(target, args) {
        args[0] = rewriteString(String(args[0]));
        return Reflect.construct(target, args);
      },
    });
  }
  if (navigator.sendBeacon) {
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => originalSendBeacon(rewriteString(String(url)), data);
  }
  const originalWindowOpen = window.open;
  if (originalWindowOpen) {
    window.open = function(url, target, features) {
      return originalWindowOpen.call(window, url ? rewriteString(String(url)) : url, target, features);
    };
  }
  document.addEventListener("click", (event) => {
    const anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    const rewritten = rewriteString(anchor.getAttribute("href") || "");
    if (rewritten !== anchor.getAttribute("href")) anchor.setAttribute("href", rewritten);
  }, true);
  const urlAttributes = new Set(["src", "href", "poster", "data-full-src", "data-preview-src"]);
  const observedAttributes = ["src", "srcset", "href", "poster", "data-full-src", "data-preview-src"];
  function rewriteElementUrls(element) {
    if (!element || element.nodeType !== 1) return;
    for (const attr of urlAttributes) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const rewritten = rewriteString(value);
      if (rewritten !== value) element.setAttribute(attr, rewritten);
    }
    const srcset = element.getAttribute("srcset");
    if (srcset) {
      const rewritten = rewriteSrcset(srcset);
      if (rewritten !== srcset) element.setAttribute("srcset", rewritten);
    }
    wireImageErrorRetry(element);
  }
  const originalSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function(name, value) {
    const attr = String(name).toLowerCase();
    if (urlAttributes.has(attr)) {
      value = rewriteString(String(value));
    } else if (attr === "srcset") {
      value = rewriteSrcset(String(value));
    }
    return originalSetAttribute.call(this, name, value);
  };
  function patchURLProperty(proto, property, rewriter) {
    if (!proto) return;
    const descriptor = Object.getOwnPropertyDescriptor(proto, property);
    if (!descriptor || !descriptor.set || !descriptor.get || !descriptor.configurable) return;
    Object.defineProperty(proto, property, {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        return descriptor.get.call(this);
      },
      set(value) {
        return descriptor.set.call(this, rewriter(String(value)));
      },
    });
  }
  patchURLProperty(window.HTMLImageElement && HTMLImageElement.prototype, "src", rewriteString);
  patchURLProperty(window.HTMLImageElement && HTMLImageElement.prototype, "srcset", rewriteSrcset);
  patchURLProperty(window.HTMLSourceElement && HTMLSourceElement.prototype, "src", rewriteString);
  patchURLProperty(window.HTMLSourceElement && HTMLSourceElement.prototype, "srcset", rewriteSrcset);
  patchURLProperty(window.HTMLVideoElement && HTMLVideoElement.prototype, "poster", rewriteString);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        rewriteElementUrls(mutation.target);
        continue;
      }
      for (const node of mutation.addedNodes) {
        rewriteElementUrls(node);
        if (node && node.querySelectorAll) {
          node.querySelectorAll("img,source,video,a,[data-full-src],[data-preview-src],[srcset]").forEach(rewriteElementUrls);
        }
      }
    }
  });
  const observeRoot = () => {
    if (!document.documentElement) return;
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: observedAttributes });
    rewriteElementUrls(document.documentElement);
    document.documentElement.querySelectorAll("img,source,video,a,[data-full-src],[data-preview-src],[srcset]").forEach(rewriteElementUrls);
  };
  if (document.documentElement) observeRoot();
  else document.addEventListener("DOMContentLoaded", observeRoot, { once: true });
})();
` + `</script>`
}

func serveControl(ctx context.Context, ln net.Listener, lc *local.Client, ts *tsnet.Server, statusTimeout time.Duration) *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "service": "hivemind-linkd"})
	})
	mux.HandleFunc("/status", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("content-type", "application/json")
		_ = json.NewEncoder(w).Encode(statusPayload(ctx, lc, statusTimeout))
	})
	mux.HandleFunc("/peer/", servePeerProxy(ts))
	mux.HandleFunc("/", servePeerRefererFallback(ts))
	server := &http.Server{Addr: ln.Addr().String(), Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Printf("control API error: %v", err)
		}
	}()
	return server
}

func main() {
	cfg := parseConfig()
	configureLogging(cfg)
	configureTailscaleEnv(cfg)
	if err := os.MkdirAll(cfg.stateDir, 0o700); err != nil {
		log.Fatalf("create state dir: %v", err)
	}
	target, err := url.Parse(cfg.target)
	if err != nil {
		log.Fatalf("invalid target URL: %v", err)
	}
	controlListener, err := net.Listen("tcp", cfg.control)
	if err != nil {
		log.Fatalf("listen on control API %s before starting embedded tailscale: %v", cfg.control, err)
	}
	defer controlListener.Close()

	ts := &tsnet.Server{
		Hostname:     cfg.hostname,
		Dir:          cfg.stateDir,
		AuthKey:      cfg.authKey,
		RunWebClient: cfg.runWebClient,
		Logf:         tailscaleLogf(cfg.tailDebug),
	}
	if cfg.controlURL != "" {
		ts.ControlURL = cfg.controlURL
	}
	defer ts.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := ts.Start(); err != nil {
		log.Fatalf("start embedded tailscale: %v", err)
	}
	lc, err := ts.LocalClient()
	if err != nil {
		log.Fatalf("embedded tailscale local client: %v", err)
	}
	controlServer := serveControl(ctx, controlListener, lc, ts, cfg.statusTimeout)
	defer controlServer.Shutdown(context.Background()) //nolint:errcheck

	ln, err := ts.Listen("tcp", cfg.listenAddr)
	if err != nil {
		log.Fatalf("listen on Tailnet %s: %v", cfg.listenAddr, err)
	}
	defer ln.Close()

	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()

	log.Printf("hivemind-linkd proxying Tailnet %s to %s as %s", cfg.listenAddr, cfg.target, cfg.hostname)
	if err := http.Serve(ln, newProxy(target, lc)); err != nil && !strings.Contains(err.Error(), "use of closed network connection") && !errors.Is(err, net.ErrClosed) {
		log.Fatalf("serve proxy: %v", err)
	}
}

func configureTailscaleEnv(cfg config) {
	if cfg.disablePortlist {
		envknob.Setenv("TS_DEBUG_DISABLE_PORTLIST", "true")
		return
	}
	envknob.Setenv("TS_DEBUG_DISABLE_PORTLIST", "false")
}
