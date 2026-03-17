package handler

import (
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/zhaoxinyi02/ClawPanel/internal/config"
)

// ---------------------------------------------------------------------------
// T-107: Plugin skeleton — read-only extension points
//
// Plugins can:
//   - Declare permissions (read-only by default)
//   - Access authorized data only
//   - NOT access local files or sensitive APIs
//
// Plugin types:
//   - theme: visual theme customization
//   - card: read-only info cards
//   - summary: observation summary widgets
//
// Unsigned or non-whitelisted plugins are rejected.
// ---------------------------------------------------------------------------

// TownPlugin represents a registered plugin.
type TownPlugin struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Type        string   `json:"type"` // theme, card, summary
	Version     string   `json:"version"`
	Permissions []string `json:"permissions"` // e.g. ["town:read"]
	Signed      bool     `json:"signed"`
	Enabled     bool     `json:"enabled"`
}

var (
	townPluginsMu sync.RWMutex
	townPlugins   = make(map[string]*TownPlugin)
	townPluginWL  = map[string]bool{} // whitelist
)

// RegisterTownPlugin registers a plugin if it passes validation.
func RegisterTownPlugin(plugin TownPlugin) error {
	townPluginsMu.Lock()
	defer townPluginsMu.Unlock()

	// Reject unsigned and non-whitelisted plugins
	if !plugin.Signed && !townPluginWL[plugin.ID] {
		return errTownPluginRejected
	}

	// Validate permissions — only read permissions allowed for now
	for _, perm := range plugin.Permissions {
		if perm != TownScopeRead && perm != TownScopeRecommendations {
			return errTownPluginPermDenied
		}
	}

	plugin.Enabled = true
	townPlugins[plugin.ID] = &plugin
	return nil
}

var (
	errTownPluginRejected   = townPluginError("未签名或未白名单插件被拒绝")
	errTownPluginPermDenied = townPluginError("插件请求了不允许的权限")
)

type townPluginError string

func (e townPluginError) Error() string { return string(e) }

// GetTownPlugins returns a Gin handler listing registered plugins.
func GetTownPlugins(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.IsTownV3Enabled() {
			c.JSON(http.StatusOK, gin.H{"ok": false, "code": "town.disabled"})
			return
		}

		townPluginsMu.RLock()
		defer townPluginsMu.RUnlock()

		list := make([]TownPlugin, 0, len(townPlugins))
		for _, p := range townPlugins {
			list = append(list, *p)
		}

		c.JSON(http.StatusOK, gin.H{"ok": true, "plugins": list})
	}
}

// RegisterTownPluginHandler handles plugin registration via API.
// POST /api/town/plugins/register
func RegisterTownPluginHandler(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.IsTownV3Enabled() {
			c.JSON(http.StatusOK, gin.H{"ok": false, "code": "town.disabled"})
			return
		}

		var plugin TownPlugin
		if err := c.ShouldBindJSON(&plugin); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "无效的插件数据"})
			return
		}

		if err := RegisterTownPlugin(plugin); err != nil {
			c.JSON(http.StatusForbidden, gin.H{"ok": false, "error": err.Error()})
			return
		}

		c.JSON(http.StatusOK, gin.H{"ok": true, "plugin": plugin})
	}
}
