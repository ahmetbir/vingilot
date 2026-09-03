package main

import (
	"crypto/subtle"
	"encoding/base64"
	"io"
	"strings"
)

func constantTimeEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// decodeBase64 accepts standard or URL-safe alphabets, with or without
// padding, and a data: URL prefix — every way a webview hands a PNG over.
func decodeBase64(s string) ([]byte, error) {
	if i := strings.Index(s, ","); i != -1 && strings.HasPrefix(s, "data:") {
		s = s[i+1:]
	}
	s = strings.TrimSpace(s)
	enc := base64.StdEncoding
	if strings.ContainsAny(s, "-_") {
		enc = base64.URLEncoding
	}
	if !strings.HasSuffix(s, "=") && len(s)%4 != 0 {
		enc = enc.WithPadding(base64.NoPadding)
	}
	return io.ReadAll(base64.NewDecoder(enc, strings.NewReader(s)))
}

func isPNG(b []byte) bool {
	return len(b) > 8 && string(b[:8]) == "\x89PNG\r\n\x1a\n"
}
