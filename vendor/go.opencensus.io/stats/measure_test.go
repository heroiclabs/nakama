package stats

import (
	"strings"
	"testing"
)

func TestCheckMeasureName(t *testing.T) {
	tests := []struct {
		name    string
		view    string
		wantErr bool
	}{
		{
			name:    "valid measure name",
			view:    "my.org/measures/response_size",
			wantErr: false,
		},
		{
			name:    "long name",
			view:    strings.Repeat("a", 256),
			wantErr: true,
		},
		{
			name:    "name with non-ASCII",
			view:    "my.org/measures/\007",
			wantErr: true,
		},
		{
			name:    "no emoji for you!",
			view:    "💩",
			wantErr: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := checkName(tt.view); (err != nil) != tt.wantErr {
				t.Errorf("checkName() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func Test_FindMeasure(t *testing.T) {
	mf1, err := Float64("MF1", "desc MF1", "unit")
	if err != nil {
		t.Errorf("stats.Float64(\"MF1\", \"desc MF1\") got error %v, want no error", err)
	}
	mf2, err := Float64("MF2", "desc MF2", "unit")
	if err != nil {
		t.Errorf("stats.Float64(\"MF2\", \"desc MF2\") got error %v, want no error", err)
	}
	mi1, err := Int64("MI1", "desc MI1", "unit")
	if err != nil {
		t.Errorf("stats.Int64(\"MI1\", \"desc MI1\") got error %v, want no error", err)
	}

	type testCase struct {
		label string
		name  string
		m     Measure
	}

	tcs := []testCase{
		{
			"0",
			mf1.Name(),
			mf1,
		},
		{
			"1",
			"MF1",
			mf1,
		},
		{
			"2",
			mf2.Name(),
			mf2,
		},
		{
			"3",
			"MF2",
			mf2,
		},
		{
			"4",
			mi1.Name(),
			mi1,
		},
		{
			"5",
			"MI1",
			mi1,
		},
		{
			"6",
			"other",
			nil,
		},
	}

	for _, tc := range tcs {
		m := FindMeasure(tc.name)
		if m != tc.m {
			t.Errorf("FindMeasure(%q) got measure %v; want %v", tc.label, m, tc.m)
		}
	}
}
