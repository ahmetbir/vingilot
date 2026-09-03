package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testKey = "0123456789abcdef0123456789abcdef0123456789abcdef"

func post(t *testing.T, h http.Handler, key string, body any) *httptest.ResponseRecorder {
	t.Helper()
	buf, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", "/v1/feedback", bytes.NewReader(buf))
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestWrongKeyIsRefusedBeforeTheBodyIsRead(t *testing.T) {
	st := &store{dir: t.TempDir()}
	h := public(st, testKey)
	if rec := post(t, h, "", map[string]string{"text": "hi"}); rec.Code != 401 {
		t.Fatalf("no key: %d", rec.Code)
	}
	if rec := post(t, h, "nope", map[string]string{"text": "hi"}); rec.Code != 401 {
		t.Fatalf("wrong key: %d", rec.Code)
	}
	if list, _ := st.list("", false); len(list) != 0 {
		t.Fatalf("a refused post was stored: %+v", list)
	}
}

func TestAReportRoundTripsThroughTheAdminDoor(t *testing.T) {
	st := &store{dir: t.TempDir()}
	pub, adm := public(st, testKey), admin(st)

	png := append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 64)...)
	rec := post(t, pub, testKey, map[string]any{
		"text":                  "tab isimleri gidiyor",
		"context":               map[string]string{"version": "1.3.0"},
		"screenshot_png_base64": "data:image/png;base64," + base64.StdEncoding.EncodeToString(png),
	})
	if rec.Code != 201 {
		t.Fatalf("post: %d %s", rec.Code, rec.Body.String())
	}
	var made struct{ ID string }
	_ = json.Unmarshal(rec.Body.Bytes(), &made)
	if !validID(made.ID) {
		t.Fatalf("id shape: %q", made.ID)
	}

	req := httptest.NewRequest("GET", "/admin/feedback?unacked=1", nil)
	out := httptest.NewRecorder()
	adm.ServeHTTP(out, req)
	var list []Report
	_ = json.Unmarshal(out.Body.Bytes(), &list)
	if len(list) != 1 || list[0].Text != "tab isimleri gidiyor" || !list[0].Screenshot {
		t.Fatalf("list: %s", out.Body.String())
	}

	shot := httptest.NewRecorder()
	adm.ServeHTTP(shot, httptest.NewRequest("GET", "/admin/feedback/"+made.ID+"/screenshot.png", nil))
	if shot.Code != 200 || !bytes.Equal(shot.Body.Bytes(), png) {
		t.Fatalf("screenshot: %d", shot.Code)
	}

	ack := httptest.NewRecorder()
	adm.ServeHTTP(ack, httptest.NewRequest("POST", "/admin/feedback/"+made.ID+"/ack", nil))
	if ack.Code != 204 {
		t.Fatalf("ack: %d", ack.Code)
	}
	again := httptest.NewRecorder()
	adm.ServeHTTP(again, httptest.NewRequest("GET", "/admin/feedback?unacked=1", nil))
	if strings.TrimSpace(again.Body.String()) != "[]" {
		t.Fatalf("acked report still listed: %s", again.Body.String())
	}
}

func TestTwoReportsInOneSecondStayOrdered(t *testing.T) {
	st := &store{dir: t.TempDir()}
	h := public(st, testKey)
	for _, text := range []string{"first", "second", "third"} {
		if rec := post(t, h, testKey, map[string]string{"text": text}); rec.Code != 201 {
			t.Fatal(rec.Code)
		}
	}
	list, _ := st.list("", false)
	if len(list) != 3 || list[0].Text != "first" || list[2].Text != "third" {
		t.Fatalf("order: %+v", list)
	}
	after, _ := st.list(list[0].ID, false)
	if len(after) != 2 || after[0].Text != "second" {
		t.Fatalf("after: %+v", after)
	}
}

func TestAScreenshotThatIsNotAPNGIsRefused(t *testing.T) {
	st := &store{dir: t.TempDir()}
	h := public(st, testKey)
	rec := post(t, h, testKey, map[string]any{
		"text":                  "x",
		"screenshot_png_base64": base64.StdEncoding.EncodeToString([]byte("GIF89a....")),
	})
	if rec.Code != 400 {
		t.Fatalf("gif accepted: %d", rec.Code)
	}
}

func TestEmptyReportIsRefused(t *testing.T) {
	st := &store{dir: t.TempDir()}
	if rec := post(t, public(st, testKey), testKey, map[string]string{"text": "   "}); rec.Code != 400 {
		t.Fatal(rec.Code)
	}
}
