package server

import (
	"github.com/dop251/goja"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
	"testing"
)

func TestJsLoggerInfo(t *testing.T) {
	r := goja.New()
	observer, logs := observer.New(zap.InfoLevel)

	obs := zap.New(observer)
	jsLogger := NewJsLogger(obs)
	jsLoggerVal := r.ToValue(jsLogger.Constructor(r))
	jsLoggerInst, err := r.New(jsLoggerVal)
	if err != nil {
		t.Error("Failed to instantiate jsLogger")
	}
	r.Set("logger", jsLoggerInst)

	SCRIPT := `
var s = 'info';
logger.info('%s log', s);
`
	_, err = r.RunString(SCRIPT)
	if err != nil {
		t.Error("Failed to run JS script")
	}

	assert.Equal(t, 1, logs.Len())
	loggedLog := logs.TakeAll()[0]
	assert.Equal(t, loggedLog.Level, zap.InfoLevel)
	assert.Equal(t, loggedLog.Message, "info log")
}

func TestJsLoggerWarn(t *testing.T) {
	r := goja.New()
	observer, logs := observer.New(zap.WarnLevel)

	obs := zap.New(observer)
	jsLogger := NewJsLogger(obs)
	jsLoggerVal := r.ToValue(jsLogger.Constructor(r))
	jsLoggerInst, err := r.New(jsLoggerVal)
	if err != nil {
		t.Error("Failed to instantiate jsLogger")
	}
	r.Set("logger", jsLoggerInst)

	SCRIPT := `
var s = 'warn';
logger.warn('%s log', s);
`
	_, err = r.RunString(SCRIPT)
	if err != nil {
		t.Error("Failed to run JS script")
	}

	assert.Equal(t, 1, logs.Len())
	loggedLog := logs.TakeAll()[0]
	assert.Equal(t, loggedLog.Level, zap.WarnLevel)
	assert.Equal(t, loggedLog.Message, "warn log")
}

func TestJsLoggerError(t *testing.T) {
	r := goja.New()
	observer, logs := observer.New(zap.ErrorLevel)

	obs := zap.New(observer)
	jsLogger := NewJsLogger(obs)
	jsLoggerVal := r.ToValue(jsLogger.Constructor(r))
	jsLoggerInst, err := r.New(jsLoggerVal)
	if err != nil {
		t.Error("Failed to instantiate jsLogger")
	}
	r.Set("logger", jsLoggerInst)

	SCRIPT := `
var s = 'error';
logger.error('%s log', s);
`
	_, err = r.RunString(SCRIPT)
	if err != nil {
		t.Error("Failed to run JS script")
	}

	assert.Equal(t, 1, logs.Len())
	loggedLog := logs.TakeAll()[0]
	assert.Equal(t, loggedLog.Level, zap.ErrorLevel)
	assert.Equal(t, loggedLog.Message, "error log")
}

func TestJsLoggerDebug(t *testing.T) {
	r := goja.New()
	observer, logs := observer.New(zap.DebugLevel)

	obs := zap.New(observer)
	jsLogger := NewJsLogger(obs)
	jsLoggerVal := r.ToValue(jsLogger.Constructor(r))
	jsLoggerInst, err := r.New(jsLoggerVal)
	if err != nil {
		t.Error("Failed to instantiate jsLogger")
	}
	r.Set("logger", jsLoggerInst)

	SCRIPT := `
var s = 'debug';
logger.debug('%s log', s);
`
	_, err = r.RunString(SCRIPT)
	if err != nil {
		t.Error("Failed to run JS script")
	}

	assert.Equal(t, 1, logs.Len())
	loggedLog := logs.TakeAll()[0]
	assert.Equal(t, loggedLog.Level, zap.DebugLevel)
	assert.Equal(t, loggedLog.Message, "debug log")
}

func TestJsLoggerWithField(t *testing.T) {
	r := goja.New()
	observer, logs := observer.New(zap.InfoLevel)

	obs := zap.New(observer)
	jsLogger := NewJsLogger(obs)
	jsLoggerVal := r.ToValue(jsLogger.Constructor(r))
	jsLoggerInst, err := r.New(jsLoggerVal)
	if err != nil {
		t.Error("Failed to instantiate jsLogger")
	}
	r.Set("logger", jsLoggerInst)

	SCRIPT := `
var s = 'info';
var l = logger.withField('foo', 'bar');
l.info('some log')
`
	_, err = r.RunString(SCRIPT)
	if err != nil {
		t.Error("Failed to run JS script")
	}

	assert.Equal(t, 1, logs.Len())
	loggedLog := logs.TakeAll()[0]
	assert.Equal(t, loggedLog.Message, "some log")
	assert.EqualValues(t, []zap.Field{{Key: "foo", String: "bar", Type: zapcore.StringType}}, loggedLog.Context)
}

func TestJsLoggerWithFields(t *testing.T) {
	r := goja.New()
	observer, logs := observer.New(zap.InfoLevel)

	obs := zap.New(observer)
	jsLogger := NewJsLogger(obs)
	jsLoggerVal := r.ToValue(jsLogger.Constructor(r))
	jsLoggerInst, err := r.New(jsLoggerVal)
	if err != nil {
		t.Error("Failed to instantiate jsLogger")
	}
	r.Set("logger", jsLoggerInst)

	SCRIPT := `
var s = 'info';

var l1 = logger.withField('logger', 'l1');
var l2 = logger.withFields({'logger': 'l2', n: 1});
l1.info('logger one')
l2.info('logger two')
`
	_, err = r.RunString(SCRIPT)
	if err != nil {
		t.Error("Failed to run JS script")
	}

	assert.Equal(t, 2, logs.Len())
	firstLog := logs.All()[0]
	assert.Equal(t, firstLog.Message, "logger one")
	assert.EqualValues(t, []zap.Field{
		{Key: "logger", String: "l1", Type: zapcore.StringType},
	}, firstLog.Context)

	secondLog := logs.All()[1]
	assert.Equal(t, secondLog.Message, "logger two")
	assert.EqualValues(t, []zap.Field{
		{Key: "logger", String: "l2", Type: zapcore.StringType},
		{Key: "n", Integer: 1, Type: zapcore.Int64Type},
	}, secondLog.Context)
}

