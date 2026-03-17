package handler

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/zhaoxinyi02/ClawPanel/internal/config"
)

// ---------------------------------------------------------------------------
// T-005: Event ingestion auth & scope skeleton
//
// Town event ingestion paths require at least one of:
//   - JWT with appropriate scope (town:write or town:run:create)
//   - HMAC signature in X-Town-Signature header
//   - Source IP in configured whitelist
//
// Scopes (reserved for future RBAC expansion):
//   town:read          - read snapshot, runs, logs
//   town:write         - update office members, push events
//   town:run:create    - create runs
//   town:agent:reset   - reset agent sessions
//   town:recommendations - access recommendations
//   town:plugins       - manage plugins
//   town:audit:read    - read audit logs
// ---------------------------------------------------------------------------

// TownScopes defines the known scope constants.
const (
	TownScopeRead            = "town:read"
	TownScopeWrite           = "town:write"
	TownScopeRunCreate       = "town:run:create"
	TownScopeAgentReset      = "town:agent:reset"
	TownScopeRecommendations = "town:recommendations"
	TownScopePlugins         = "town:plugins"
	TownScopeAuditRead       = "town:audit:read"
)

// TownEventAuth is a Gin middleware that validates event ingestion requests.
// It checks for HMAC signature or falls back to the existing JWT auth.
// If TOWN_EVENT_HMAC_SECRET is set, X-Town-Signature is required for
// observation event endpoints.
func TownEventAuth(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Check HMAC signature if secret is configured
		hmacSecret := townEventHMACSecret()
		if hmacSecret != "" {
			sig := c.GetHeader("X-Town-Signature")
			if sig != "" {
				body, err := c.GetRawData()
				if err != nil {
					c.JSON(http.StatusBadRequest, gin.H{
						"ok":    false,
						"code":  "town.auth.body_read_failed",
						"error": "无法读取请求体",
					})
					c.Abort()
					return
				}
				if !verifyTownHMAC(body, sig, hmacSecret) {
					c.JSON(http.StatusForbidden, gin.H{
						"ok":    false,
						"code":  "town.auth.hmac_invalid",
						"error": "HMAC 签名无效",
					})
					c.Abort()
					return
				}
				// Re-inject body for downstream handlers
				c.Request.Body = newReadCloser(body)
				c.Set("town_auth_method", "hmac")
				c.Next()
				return
			}
		}

		// Check IP whitelist
		if isTownIPWhitelisted(c.ClientIP()) {
			c.Set("town_auth_method", "ip_whitelist")
			c.Next()
			return
		}

		// Fall through to existing JWT auth (already applied by parent group)
		c.Set("town_auth_method", "jwt")
		c.Next()
	}
}

// verifyTownHMAC checks the HMAC-SHA256 signature.
func verifyTownHMAC(body []byte, signature, secret string) bool {
	sig, err := hex.DecodeString(strings.TrimPrefix(signature, "sha256="))
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := mac.Sum(nil)
	return hmac.Equal(sig, expected)
}

// townEventHMACSecret returns the HMAC secret for event ingestion, if configured.
func townEventHMACSecret() string {
	return strings.TrimSpace(townEnvOrDefault("TOWN_EVENT_HMAC_SECRET", ""))
}

// isTownIPWhitelisted checks if the client IP is in the configured whitelist.
func isTownIPWhitelisted(clientIP string) bool {
	raw := strings.TrimSpace(townEnvOrDefault("TOWN_EVENT_IP_WHITELIST", ""))
	if raw == "" {
		return false
	}
	for _, allowed := range strings.Split(raw, ",") {
		if strings.TrimSpace(allowed) == clientIP {
			return true
		}
	}
	return false
}

// newReadCloser wraps a byte slice as an io.ReadCloser for re-injecting request body.
func newReadCloser(data []byte) *townBodyReader {
	return &townBodyReader{data: data}
}

type townBodyReader struct {
	data []byte
	pos  int
}

func (r *townBodyReader) Read(p []byte) (int, error) {
	if r.pos >= len(r.data) {
		return 0, io.EOF
	}
	n := copy(p, r.data[r.pos:])
	r.pos += n
	if r.pos >= len(r.data) {
		return n, io.EOF
	}
	return n, nil
}

func (r *townBodyReader) Close() error { return nil }

// townEnvOrDefault reads an environment variable with a fallback.
func townEnvOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
