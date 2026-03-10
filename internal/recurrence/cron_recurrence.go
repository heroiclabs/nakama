package recurrence

import (
	"github.com/heroiclabs/nakama/v3/internal/cronexpr"
)

type cronRecurrenceParser struct{}

func (p *cronRecurrenceParser) Parse(expr string) (Recurrence, error) {
	cronExpr, err := cronexpr.Parse(expr)
	if err != nil {
		return nil, err
	}
	return cronExpr, nil
}

func (p *cronRecurrenceParser) MustParse(expr string) Recurrence {
	cronExpr := cronexpr.MustParse(expr)
	return cronExpr
}

func NewCronParser() RecurrenceParser {
	return &cronRecurrenceParser{}
}
