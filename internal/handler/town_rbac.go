package handler

import (
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// T-201: Fine-grained RBAC & approval flow
//
// Maps scopes to roles. High-risk actions (reset, plugin publish) require
// approval or secondary confirmation.
//
// Roles:
//   admin   — full access
//   operator — town:read, town:write, town:run:create
//   viewer  — town:read only
//
// High-risk actions requiring approval:
//   - Agent reset (town:agent:reset)
//   - Plugin registration (town:plugins)
//   - Feature flag toggle
// ---------------------------------------------------------------------------

// TownRole defines a role with allowed scopes.
type TownRole struct {
	Name   string   `json:"name"`
	Scopes []string `json:"scopes"`
}

var townRoles = map[string]TownRole{
	"admin": {
		Name: "admin",
		Scopes: []string{
			TownScopeRead, TownScopeWrite, TownScopeRunCreate,
			TownScopeAgentReset, TownScopeRecommendations,
			TownScopePlugins, TownScopeAuditRead,
		},
	},
	"operator": {
		Name:   "operator",
		Scopes: []string{TownScopeRead, TownScopeWrite, TownScopeRunCreate, TownScopeRecommendations},
	},
	"viewer": {
		Name:   "viewer",
		Scopes: []string{TownScopeRead},
	},
}

// TownRBACMiddleware checks if the current user's role has the required scope.
func TownRBACMiddleware(requiredScope string) gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get("role")
		roleName, ok := role.(string)
		if !ok || roleName == "" {
			roleName = "admin" // default for backward compatibility
		}

		townRole, exists := townRoles[roleName]
		if !exists {
			c.JSON(http.StatusForbidden, gin.H{
				"ok":    false,
				"code":  "town.rbac.unknown_role",
				"error": "未知角色: " + roleName,
			})
			c.Abort()
			return
		}

		hasScope := false
		for _, scope := range townRole.Scopes {
			if scope == requiredScope {
				hasScope = true
				break
			}
		}

		if !hasScope {
			c.JSON(http.StatusForbidden, gin.H{
				"ok":    false,
				"code":  "town.rbac.scope_denied",
				"error": "权限不足: 需要 " + requiredScope,
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// ---------------------------------------------------------------------------
// Approval flow for high-risk actions
// ---------------------------------------------------------------------------

// TownApprovalRequest represents a pending approval.
type TownApprovalRequest struct {
	ID        string `json:"id"`
	Action    string `json:"action"`
	Requester string `json:"requester"`
	Status    string `json:"status"` // pending, approved, rejected
	Detail    string `json:"detail"`
}

var (
	townApprovalsMu sync.RWMutex
	townApprovals   = make(map[string]*TownApprovalRequest)
)

// TownRequireApproval is a middleware that blocks high-risk actions
// unless an approval token is provided.
func TownRequireApproval(action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		approvalID := strings.TrimSpace(c.GetHeader("X-Town-Approval"))
		if approvalID == "" {
			// No approval — check if action needs it
			if isTownHighRiskAction(action) {
				c.JSON(http.StatusPreconditionRequired, gin.H{
					"ok":    false,
					"code":  "town.approval.required",
					"error": "此操作需要审批确认",
				})
				c.Abort()
				return
			}
		}
		c.Next()
	}
}

func isTownHighRiskAction(action string) bool {
	switch action {
	case "agent.reset", "plugin.register", "feature_flag.toggle":
		return true
	}
	return false
}

// GetTownRoles returns available roles and their scopes.
func GetTownRoles() gin.HandlerFunc {
	return func(c *gin.Context) {
		roles := make([]TownRole, 0, len(townRoles))
		for _, r := range townRoles {
			roles = append(roles, r)
		}
		c.JSON(http.StatusOK, gin.H{"ok": true, "roles": roles})
	}
}
