package recurrence

import (
	"time"

	rrule "github.com/teambition/rrule-go"
)

type rRuleRecurrenceParser struct{}

func (p *rRuleRecurrenceParser) Parse(expr string) (Recurrence, error) {
	rule, err := rrule.StrToRRule(expr)
	if err != nil {
		return nil, err
	}

	var schedule Recurrence = &RRuleRecurrence{rule: rule}
	return schedule, nil
}

func (p *rRuleRecurrenceParser) MustParse(expr string) Recurrence {
	schedule, err := p.Parse(expr)
	if err != nil {
		panic(err)
	}
	return schedule
}

func NewRRuleParser() RecurrenceParser {
	return &rRuleRecurrenceParser{}
}

type RRuleRecurrence struct {
	rule *rrule.RRule
}

func (r *RRuleRecurrence) Next(fromTime time.Time) time.Time {
	if fromTime.IsZero() {
		return time.Time{}
	}

	next := r.rule.After(fromTime, false)
	if next.IsZero() {
		return time.Time{}
	}

	return next.In(fromTime.Location())
}

func (r *RRuleRecurrence) Last(fromTime time.Time) time.Time {
	if fromTime.IsZero() {
		return time.Time{}
	}

	last := r.rule.Before(fromTime, false)
	if last.IsZero() {
		return time.Time{}
	}

	return last.In(fromTime.Location())
}

func (r *RRuleRecurrence) NextN(fromTime time.Time, n uint) []time.Time {
	if fromTime.IsZero() || n == 0 {
		return []time.Time{}
	}

	result := make([]time.Time, 0, n)
	t := fromTime
	for range n {
		next := r.Next(t)
		if next.IsZero() {
			break
		}
		result = append(result, next)
		t = next
	}

	return result
}
