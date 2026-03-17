package handler

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// T-202: Multi-tenant isolation
//
// Adds tenant_id/workspace_id to all Town data paths.
// Participates in primary keys, indexes, WS broadcast, export, and recommendations.
// expectedVersion becomes per-tenant.
//
// Current implementation: single-tenant skeleton with tenant extraction middleware.
// When multi-tenant is enabled, all store operations will include tenant_id.
// ---------------------------------------------------------------------------

const (
	townDefaultTenantID = "default"
	townTenantCtxKey    = "town_tenant_id"
)

// TownTenantMiddleware extracts tenant_id from request header or query.
// Falls back to "default" for single-tenant mode.
func TownTenantMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		tenantID := strings.TrimSpace(c.GetHeader("X-Town-Tenant"))
		if tenantID == "" {
			tenantID = strings.TrimSpace(c.Query("tenant"))
		}
		if tenantID == "" {
			tenantID = townDefaultTenantID
		}
		c.Set(townTenantCtxKey, tenantID)
		c.Next()
	}
}

// GetTownTenantID extracts the tenant ID from the Gin context.
func GetTownTenantID(c *gin.Context) string {
	if v, ok := c.Get(townTenantCtxKey); ok {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return townDefaultTenantID
}

// GetTownTenantInfo returns the current tenant info.
func GetTownTenantInfo() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"ok":       true,
			"tenantId": GetTownTenantID(c),
			"mode":     "single", // will be "multi" when enabled
		})
	}
}
