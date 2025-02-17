package lua

import (
	"strconv"
	"testing"
	"time"
)

func TestOsDateFormatUTCWithTwoParam(t *testing.T) {
	t.Setenv("TZ", "Asia/Tokyo")
	ls := NewState()

	g := ls.GetGlobal("os")
	fn := ls.GetField(g, "date")

	int64ptr := func(i int64) *int64 {
		return &i
	}
	cases := []struct {
		Name      string
		Local     time.Time
		Now       time.Time
		Format    string
		Timestamp *int64
	}{
		{
			"UTCWithTwoParam",
			time.Now(),
			time.Now().UTC(),
			"!*t",
			int64ptr(time.Now().UTC().Unix()),
		},
		{
			"LocalWithTwoParam",
			time.Now(),
			time.Now(),
			"*t",
			int64ptr(time.Now().Unix()),
		},
		{
			"UTCWithOnlyFormatParam",
			time.Now(),
			time.Now().UTC(),
			"!*t",
			nil,
		},
		{
			"LocalWithOnlyFormatParam",
			time.Now(),
			time.Now(),
			"*t",
			nil,
		},
	}

	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			args := make([]LValue, 0)
			args = append(args, LString(c.Format))
			if c.Timestamp != nil {
				args = append(args, LNumber(*c.Timestamp))
			}
			err := ls.CallByParam(P{
				Fn:      fn,
				NRet:    1,
				Protect: true,
			}, args...)
			if err != nil {
				t.Fatal(err)
			}

			result := ls.ToTable(-1)

			resultMap := make(map[string]string)
			result.ForEach(func(key LValue, value LValue) {
				resultMap[key.String()] = value.String()
				assertOsDateFields(t, key, value, c.Now)
			})
			t.Logf("%v resultMap=%+v\nnow=%+v\nLocal=%+v\nUTC=%v", c.Name, resultMap, c.Now, c.Local, c.Now.UTC())
		})
	}
}

func TestOsDateFormatLocalWithTwoParam(t *testing.T) {
	t.Setenv("TZ", "Asia/Tokyo")
	ls := NewState()

	g := ls.GetGlobal("os")
	fn := ls.GetField(g, "date")

	nowLocal := time.Now()
	nowUTC := nowLocal.UTC()

	err := ls.CallByParam(P{
		Fn:      fn,
		NRet:    1,
		Protect: true,
	}, LString("*t"), LNumber(nowLocal.Unix()))
	if err != nil {
		t.Fatal(err)
	}

	result := ls.ToTable(-1)

	resultMap := make(map[string]string)
	result.ForEach(func(key LValue, value LValue) {
		t.Logf("key=%v, value=%v", key, value)
		resultMap[key.String()] = value.String()
		assertOsDateFields(t, key, value, nowLocal)
	})
	t.Logf("resultMap=%+v, nowLocal=%+v, nowUTC=%v", resultMap, nowLocal, nowUTC)
}

func assertOsDateFields(t *testing.T, key LValue, value LValue, expect time.Time) {
	switch key.String() {
	case "year":
		if value.String() != strconv.Itoa(expect.Year()) {
			t.Errorf("year=%v, expect.Year=%v", value.String(), expect.Year())
		}
	case "month":
		if value.String() != strconv.Itoa(int(expect.Month())) {
			t.Errorf("month=%v, expect.Month=%v", value.String(), expect.Month())
		}
	case "day":
		if value.String() != strconv.Itoa(expect.Day()) {
			t.Errorf("day=%v, expect.Day=%v", value.String(), expect.Day())
		}
	case "hour":
		if value.String() != strconv.Itoa(expect.Hour()) {
			t.Errorf("hour=%v, expect.Hour=%v", value.String(), expect.Hour())
		}
	case "min":
		if value.String() != strconv.Itoa(expect.Minute()) {
			t.Errorf("min=%v, expect.Minute=%v", value.String(), expect.Minute())
		}
	case "sec":
		if value.String() != strconv.Itoa(expect.Second()) {
			t.Errorf("sec=%v, expect.Second=%v", value.String(), expect.Second())
		}
	}
}
