package pgxpprof

import (
	"bytes"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// DeltaPprofHandler returns an HTTP handler that writes pgxpprof's delta pprof.
//
// If the request includes a seconds query parameter, the handler waits that long
// before writing the profile. Grafana Alloy adds this parameter when scraping a
// profile.custom endpoint with delta = true.
func DeltaPprofHandler(obs *Profiler) http.Handler {
	return &deltaPprofHandler{obs: obs}
}

type deltaPprofHandler struct {
	obs *Profiler
	mu  sync.Mutex
}

func (h *deltaPprofHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	wait, err := pprofWaitDuration(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Serialize scrapes because each response consumes the profiler's delta.
	h.mu.Lock()
	defer h.mu.Unlock()

	if wait > 0 {
		timer := time.NewTimer(wait)
		select {
		case <-timer.C:
		case <-r.Context().Done():
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			return
		}
	}

	var buf bytes.Buffer
	if err := h.obs.writeDeltaPprof(&buf); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	if _, err := w.Write(buf.Bytes()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func pprofWaitDuration(r *http.Request) (time.Duration, error) {
	raw := r.URL.Query().Get("seconds")
	if raw == "" {
		return 0, nil
	}
	seconds, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || seconds < 0 {
		return 0, fmt.Errorf("invalid seconds query parameter %q", raw)
	}
	const maxSeconds = int64((1<<63 - 1) / int64(time.Second))
	if seconds > maxSeconds {
		return 0, fmt.Errorf("seconds query parameter %q is too large", raw)
	}
	return time.Duration(seconds) * time.Second, nil
}
