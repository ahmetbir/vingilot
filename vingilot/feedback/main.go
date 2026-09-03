// Vingilot feedback drop — the owner's reports, with screenshots, on a box
// only he and this project can reach (2026-09-03).
//
// Two listeners, because the two callers are authenticated differently:
//
//   - PUBLIC (behind nginx, key required): the app POSTs a report. One key,
//     one owner, so a bearer token is the whole policy. Read from a file the
//     box holds at 0600 — never an argument, never an environment line in a
//     compose file.
//   - ADMIN (127.0.0.1 only, no key): the session pulls reports over ssh.
//     Authentication is the ssh key; nothing here re-invents it, and the
//     bearer never has to leave the box for a read.
//
// Storage is the filesystem: one JSON record and one PNG per report, named by
// a monotonic id, so `ls` is the index and a file is the export. No database
// for a mailbox with one sender.
//
// Bounded on purpose (CLAUDE.md, review rule 4): a body cap, a screenshot cap,
// and a store cap after which POSTs are refused with 507 rather than the disk
// being filled on a box with 7 GB free.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	maxBody       = 12 << 20  // JSON with an inline base64 PNG
	maxShot       = 8 << 20   // decoded screenshot bytes
	maxStore      = 512 << 20 // refuse writes past this, not fill the disk
	maxText       = 20_000
	idAlphabetLen = 14 // yyyymmddHHMMSS
)

// Report is what the app sends, and what the admin side reads back.
type Report struct {
	ID         string            `json:"id"`
	ReceivedAt time.Time         `json:"received_at"`
	Text       string            `json:"text"`
	Context    map[string]string `json:"context,omitempty"`
	Screenshot bool              `json:"screenshot"`
	Acked      bool              `json:"acked"`
}

type inbound struct {
	Text       string            `json:"text"`
	Context    map[string]string `json:"context"`
	Screenshot string            `json:"screenshot_png_base64"`
}

type store struct {
	dir string
	mu  sync.Mutex
	// last id issued this second, so two reports in one second stay ordered.
	lastID string
}

func (s *store) newID(now time.Time) string {
	base := now.UTC().Format("20060102150405")
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.HasPrefix(s.lastID, base) {
		n, _ := strconv.Atoi(strings.TrimPrefix(s.lastID, base+"-"))
		s.lastID = fmt.Sprintf("%s-%02d", base, n+1)
	} else {
		s.lastID = base + "-00"
	}
	return s.lastID
}

func (s *store) size() (int64, error) {
	var total int64
	err := filepath.WalkDir(s.dir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !d.IsDir() {
			if info, err := d.Info(); err == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total, err
}

func (s *store) put(r Report, png []byte) error {
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return err
	}
	if png != nil {
		if err := os.WriteFile(filepath.Join(s.dir, r.ID+".png"), png, 0o600); err != nil {
			return err
		}
	}
	buf, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	// Written whole then renamed, so a reader never sees half a record.
	tmp := filepath.Join(s.dir, r.ID+".json.tmp")
	if err := os.WriteFile(tmp, buf, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(s.dir, r.ID+".json"))
}

func (s *store) get(id string) (Report, error) {
	var r Report
	buf, err := os.ReadFile(filepath.Join(s.dir, id+".json"))
	if err != nil {
		return r, err
	}
	return r, json.Unmarshal(buf, &r)
}

// list answers every report with an id after `after`, oldest first.
func (s *store) list(after string, unackedOnly bool) ([]Report, error) {
	entries, err := os.ReadDir(s.dir)
	if errors.Is(err, fs.ErrNotExist) {
		return []Report{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []Report{}
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".json") {
			continue
		}
		id := strings.TrimSuffix(name, ".json")
		if id <= after {
			continue
		}
		r, err := s.get(id)
		if err != nil {
			continue
		}
		if unackedOnly && r.Acked {
			continue
		}
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func (s *store) ack(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, err := s.get(id)
	if err != nil {
		return err
	}
	r.Acked = true
	return s.put(r, nil)
}

func validID(id string) bool {
	if len(id) != idAlphabetLen+3 {
		return false
	}
	for i, c := range id {
		switch {
		case i == idAlphabetLen:
			if c != '-' {
				return false
			}
		case c < '0' || c > '9':
			return false
		}
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// public is the app's door: one route, key-gated.
func public(st *store, key string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /v1/feedback", func(w http.ResponseWriter, r *http.Request) {
		if !bearerOK(r, key) {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "bad key"})
			return
		}
		if used, err := st.size(); err == nil && used > maxStore {
			writeJSON(w, http.StatusInsufficientStorage, map[string]string{"error": "store full"})
			return
		}
		var in inbound
		body := http.MaxBytesReader(w, r.Body, maxBody)
		if err := json.NewDecoder(body).Decode(&in); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad json: " + err.Error()})
			return
		}
		in.Text = strings.TrimSpace(in.Text)
		if in.Text == "" && in.Screenshot == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "empty report"})
			return
		}
		if len(in.Text) > maxText {
			in.Text = in.Text[:maxText]
		}
		var png []byte
		if in.Screenshot != "" {
			dec, err := decodeBase64(in.Screenshot)
			if err != nil || len(dec) > maxShot || !isPNG(dec) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "screenshot must be a PNG under 8 MB"})
				return
			}
			png = dec
		}
		now := time.Now()
		rep := Report{
			ID:         st.newID(now),
			ReceivedAt: now.UTC(),
			Text:       in.Text,
			Context:    in.Context,
			Screenshot: png != nil,
		}
		if err := st.put(rep, png); err != nil {
			log.Printf("put %s: %v", rep.ID, err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "store"})
			return
		}
		log.Printf("report %s (%d chars, screenshot=%v)", rep.ID, len(rep.Text), rep.Screenshot)
		writeJSON(w, http.StatusCreated, map[string]string{"id": rep.ID})
	})
	return mux
}

// admin is the session's door: loopback only, read and ack.
func admin(st *store) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /admin/feedback", func(w http.ResponseWriter, r *http.Request) {
		after := r.URL.Query().Get("after")
		if after != "" && !validID(after) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "bad after"})
			return
		}
		list, err := st.list(after, r.URL.Query().Get("unacked") == "1")
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, list)
	})
	mux.HandleFunc("GET /admin/feedback/{id}/screenshot.png", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !validID(id) {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(st.dir, id+".png"))
	})
	mux.HandleFunc("POST /admin/feedback/{id}/ack", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !validID(id) {
			http.NotFound(w, r)
			return
		}
		if err := st.ack(id); err != nil {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	return mux
}

func bearerOK(r *http.Request, key string) bool {
	h := r.Header.Get("Authorization")
	const p = "Bearer "
	if len(h) <= len(p) || !strings.EqualFold(h[:len(p)], p) {
		return false
	}
	return constantTimeEqual(strings.TrimSpace(h[len(p):]), key)
}

func main() {
	keyFile := env("FEEDBACK_KEY_FILE", "/run/feedback/key")
	raw, err := os.ReadFile(keyFile)
	if err != nil {
		log.Fatalf("key file %s: %v", keyFile, err)
	}
	key := strings.TrimSpace(string(raw))
	if len(key) < 32 {
		log.Fatalf("key in %s is too short to be one", keyFile)
	}

	st := &store{dir: env("FEEDBACK_DIR", "/data")}

	pub := &http.Server{
		Addr:              env("FEEDBACK_PUBLIC_ADDR", ":8080"),
		Handler:           public(st, key),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      30 * time.Second,
	}
	adm := &http.Server{
		Addr:              env("FEEDBACK_ADMIN_ADDR", ":9871"),
		Handler:           admin(st),
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		log.Printf("public on %s, admin on %s, store %s", pub.Addr, adm.Addr, st.dir)
		if err := pub.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	go func() {
		if err := adm.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
	}()
	<-ctx.Done()
	shut, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = pub.Shutdown(shut)
	_ = adm.Shutdown(shut)
}

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
