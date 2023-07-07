package skiplist

import (
	"math/rand"
)

const SKIPLIST_MAXLEVEL = 32
const SKIPLIST_BRANCH = 4

type skiplistLevel struct {
	forward *Element
	span    int
}

type Element struct {
	Value Interface
	level []*skiplistLevel
}

// Next returns the next skiplist element or nil.
func (e *Element) Next() *Element {
	return e.level[0].forward
}

// newElement returns an initialized element.
func newElement(level int, v Interface) *Element {
	slLevels := make([]*skiplistLevel, level)
	for i := 0; i < level; i++ {
		slLevels[i] = new(skiplistLevel)
	}

	return &Element{
		Value: v,
		level: slLevels,
	}
}

// randomLevel returns a random level.
func randomLevel(r *rand.Rand) int {
	level := 1
	for (r.Int31()&0xFFFF)%SKIPLIST_BRANCH == 0 {
		level += 1
	}

	if level < SKIPLIST_MAXLEVEL {
		return level
	} else {
		return SKIPLIST_MAXLEVEL
	}
}
