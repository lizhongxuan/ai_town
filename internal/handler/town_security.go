package handler

import (
	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// T-006: Security baseline — CSP, Token boundary, raw text display risk acceptance
//
// - CSP headers prevent XSS via inline scripts
// - admin-token risk is documented (accepted for trusted admin environment)
// - Raw text display is the accepted default (no sanitization/summarization)
// ---------------------------------------------------------------------------

// TownCSP is a Gin middleware that sets Content-Security-Policy headers
// for Town-related responses.
func TownCSP() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("Content-Security-Policy",
			"default-src 'self'; "+
				"script-src 'self'; "+
				"style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' data: blob:; "+
				"connect-src 'self' ws: wss:; "+
				"font-src 'self'; "+
				"object-src 'none'; "+
				"frame-ancestors 'self'")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "SAMEORIGIN")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Next()
	}
}
