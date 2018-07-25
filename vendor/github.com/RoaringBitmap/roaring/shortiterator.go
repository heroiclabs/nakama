package roaring

type shortIterable interface {
	hasNext() bool
	next() uint16
}

type shortIterator struct {
	slice []uint16
	loc   int
}

func (si *shortIterator) hasNext() bool {
	return si.loc < len(si.slice)
}

func (si *shortIterator) next() uint16 {
	a := si.slice[si.loc]
	si.loc++
	return a
}

type reverseIterator struct {
	slice []uint16
	loc   int
}

func (si *reverseIterator) hasNext() bool {
	return si.loc >= 0
}

func (si *reverseIterator) next() uint16 {
	a := si.slice[si.loc]
	si.loc--
	return a
}
