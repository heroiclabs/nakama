package recurrence

import (
	"github.com/heroiclabs/nakama/v3/internal/cronexpr"
)

type CronRecurrenceParser struct{}

func (p *CronRecurrenceParser) Parse(expr string) (*Recurrence, error) {
	cronExpr, err := cronexpr.Parse(expr)
	if err != nil {
		return nil, err
	}
	var schedule Recurrence = cronExpr
	return &schedule, nil
}

func (p *CronRecurrenceParser) MustParse(expr string) *Recurrence {
	cronExpr := cronexpr.MustParse(expr)
	var schedule Recurrence = cronExpr
	return &schedule
}
