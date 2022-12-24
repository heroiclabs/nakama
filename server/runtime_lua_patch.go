package server

import (
	"github.com/gofrs/uuid"
	"go.uber.org/zap"
)

type RuntimeLuaModulePatchRegistry interface {
	Subscribe(uuid.UUID, chan *RuntimeLuaModule)

	Unsubscribe(id uuid.UUID)
}

type LocalRuntimeLuaModulePatchRegistry struct {
	*MapOf[uuid.UUID, chan *RuntimeLuaModule]

	logger *zap.Logger
}

func (mp *LocalRuntimeLuaModulePatchRegistry) Post(module *RuntimeLuaModule) {
	mp.Range(func(key uuid.UUID, ch chan *RuntimeLuaModule) bool {
		// Captuer error in case the channel is closed
		defer func() {
			if x := recover(); x != nil {
				mp.Delete(key)
				mp.logger.Info("Removed Lua module hotfix channel",
					zap.String("mid", key.String()))
			}
		}()
		// Send module to the channel
		select {
		case ch <- module:
			mp.logger.Info("Hotfixing Lua module",
				zap.String("module", module.Name),
				zap.String("mid", key.String()))
		default:
			mp.logger.Warn("Failed to send module to Lua module hotfix channel",
				zap.String("module", module.Name),
				zap.String("mid", key.String()))
		}
		return true
	})
}

func (mp *LocalRuntimeLuaModulePatchRegistry) Subscribe(id uuid.UUID, ch chan *RuntimeLuaModule) {
	mp.Store(id, ch)
	mp.logger.Info("Subscribed to Lua module hotfixes", zap.String("mid", id.String()))
}

func (mp *LocalRuntimeLuaModulePatchRegistry) Unsubscribe(id uuid.UUID) {
	mp.Delete(id)
	mp.logger.Info("Unsubscribed Lua module hotfix channel", zap.String("mid", id.String()))
}
