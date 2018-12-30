package builder

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"text/template"

	"github.com/pkg/errors"
	"golang.org/x/sync/errgroup"
)

var DebugLog func(string, ...interface{})

func init() {
	DebugLog = func(string, ...interface{}) {}
}

var invalidFilePattern = regexp.MustCompile(`(_test|-packr).go$`)

// Builder scans folders/files looking for `packr.NewBox` and then compiling
// the required static files into `<package-name>-packr.go` files so they can
// be built into Go binaries.
type Builder struct {
	context.Context
	RootPath       string
	IgnoredBoxes   []string
	IgnoredFolders []string
	pkgs           map[string]pkg
	moot           *sync.Mutex
	Compress       bool
}

// Run the builder.
func (b *Builder) Run() error {
	wg := &errgroup.Group{}
	root, err := filepath.EvalSymlinks(b.RootPath)
	if err != nil {
		return errors.WithStack(err)
	}
	err = filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if info == nil {
			return filepath.SkipDir
		}

		base := strings.ToLower(filepath.Base(path))
		if strings.HasPrefix(base, "_") {
			return filepath.SkipDir
		}
		for _, f := range b.IgnoredFolders {
			if strings.ToLower(f) == base {
				if info.IsDir() {
					return filepath.SkipDir
				} else {
					return nil
				}
			}
		}
		if !info.IsDir() {
			wg.Go(func() error {
				return b.process(path)
			})
		}
		return nil
	})
	if err != nil {
		return errors.WithStack(err)
	}
	if err := wg.Wait(); err != nil {
		return errors.WithStack(err)
	}
	return b.dump()
}

func (b *Builder) dump() error {
	for _, p := range b.pkgs {
		name := filepath.Join(p.Dir, "a_"+p.Name+"-packr.go")
		f, err := os.Create(name)
		defer f.Close()
		if err != nil {
			return errors.WithStack(err)
		}
		t, err := template.New("").Parse(tmpl)

		if err != nil {
			return errors.WithStack(err)
		}
		err = t.Execute(f, p)
		if err != nil {
			return errors.WithStack(err)
		}
	}
	return nil
}

func (b *Builder) process(path string) error {
	ext := filepath.Ext(path)
	if ext != ".go" || invalidFilePattern.MatchString(path) {
		return nil
	}

	v := newVisitor(path)
	if err := v.Run(); err != nil {
		return errors.WithStack(err)
	}

	pk := pkg{
		Dir:   filepath.Dir(path),
		Boxes: []box{},
		Name:  v.Package,
	}

	for _, n := range v.Boxes {
		var ignored bool
		for _, i := range b.IgnoredBoxes {
			if n == i {
				// this is an ignored box
				ignored = true
				break
			}
		}
		if ignored {
			continue
		}
		bx := &box{
			Name:     n,
			Files:    []file{},
			compress: b.Compress,
		}
		DebugLog("building box %s\n", bx.Name)
		p := filepath.Join(pk.Dir, bx.Name)
		if err := bx.Walk(p); err != nil {
			return errors.WithStack(err)
		}
		if len(bx.Files) > 0 {
			pk.Boxes = append(pk.Boxes, *bx)
		}
		DebugLog("built box %s with %q\n", bx.Name, bx.Files)
	}

	if len(pk.Boxes) > 0 {
		b.addPkg(pk)
	}
	return nil
}

func (b *Builder) addPkg(p pkg) {
	b.moot.Lock()
	defer b.moot.Unlock()
	if _, ok := b.pkgs[p.Name]; !ok {
		b.pkgs[p.Name] = p
		return
	}
	pp := b.pkgs[p.Name]
	pp.Boxes = append(pp.Boxes, p.Boxes...)
	b.pkgs[p.Name] = pp
}

// New Builder with a given context and path
func New(ctx context.Context, path string) *Builder {
	return &Builder{
		Context:        ctx,
		RootPath:       path,
		IgnoredBoxes:   []string{},
		IgnoredFolders: []string{"vendor", ".git", "node_modules", ".idea"},
		pkgs:           map[string]pkg{},
		moot:           &sync.Mutex{},
	}
}
