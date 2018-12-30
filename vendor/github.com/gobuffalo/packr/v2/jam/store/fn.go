package store

import (
	"errors"

	"github.com/gobuffalo/packr/v2/jam/parser"
)

var _ Store = &FnStore{}

type FnStore struct {
	FileNamesFn func(*parser.Box) ([]string, error)
	FilesFn     func(*parser.Box) ([]*parser.File, error)
	PackFn      func(*parser.Box) error
	CleanFn     func(*parser.Box) error
}

func (f *FnStore) FileNames(box *parser.Box) ([]string, error) {
	if f.FileNamesFn == nil {
		return []string{}, errors.New("FileNames not implemented")
	}
	return f.FileNames(box)
}

func (f *FnStore) Files(box *parser.Box) ([]*parser.File, error) {
	if f.FilesFn == nil {
		return []*parser.File{}, errors.New("Files not implemented")
	}
	return f.FilesFn(box)
}

func (f *FnStore) Pack(box *parser.Box) error {
	if f.PackFn == nil {
		return errors.New("Pack not implemented")
	}
	return f.PackFn(box)
}

func (f *FnStore) Clean(box *parser.Box) error {
	if f.CleanFn == nil {
		return errors.New("Clean not implemented")
	}
	return f.Clean(box)
}
