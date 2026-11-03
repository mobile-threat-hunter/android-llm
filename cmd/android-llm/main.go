// android-llm local launcher.
//
// Bundles the integrated console (shell index.html + dexllm-web, axmlllm-web,
// apkllm-web and the Pyodide runtime axmlllm-web needs) into one executable.
// Double-click the .exe → an in-process HTTP server binds to a random loopback
// port and the default browser opens the console. Closing the console window
// (or Ctrl+C) stops the server. No network access is needed after download.
//
// A real HTTP origin is required: the engines run in Web Workers and fetch
// wasm, both of which browsers refuse under file://.

package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os/exec"
	"runtime"
	"time"
)

// static/ is assembled by build.sh — see README.md.
//
//go:embed static
var staticFS embed.FS

func main() {
	_ = mime.AddExtensionType(".wasm", "application/wasm")
	_ = mime.AddExtensionType(".mjs", "text/javascript")
	_ = mime.AddExtensionType(".json", "application/json")

	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("embedded fs: %v", err)
	}

	mux := http.NewServeMux()
	mux.Handle("/", noCache(http.FileServer(http.FS(sub))))

	// Loopback only (no LAN exposure of the sample being analyzed), OS-assigned
	// port (no collision with anything on a fixed port).
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	url := fmt.Sprintf("http://127.0.0.1:%d/", ln.Addr().(*net.TCPAddr).Port)

	fmt.Println("┌──────────────────────────────────────────────────────────────")
	fmt.Println("│ Android LLM Suite — dexllm · axmlllm · apkllm (local)")
	fmt.Println("│")
	fmt.Printf("│   Serving at  %s\n", url)
	fmt.Println("│   Stop with   Ctrl+C  (or close this window)")
	fmt.Println("└──────────────────────────────────────────────────────────────")

	go func() {
		time.Sleep(150 * time.Millisecond)
		if err := openBrowser(url); err != nil {
			fmt.Printf("(could not auto-open browser: %v — paste the URL above)\n", err)
		}
	}()

	server := &http.Server{Handler: mux}
	if err := server.Serve(ln); err != nil && err != http.ErrServerClosed {
		log.Fatalf("serve: %v", err)
	}
}

// Always re-deliver so a relaunch with a newer bundle never serves stale files.
// No COOP/COEP: every engine is a single-threaded build.
func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, max-age=0")
		h.ServeHTTP(w, r)
	})
}

func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		// the empty "" is the window title; without it `start` takes the URL as the title
		cmd = exec.Command("cmd", "/c", "start", "", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}
