package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/ioutil"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
	"text/template"

	"github.com/tinylib/msgp/gen"
)

// When stuff's going wrong, you'll be glad this is here!
const debugTemp = false

// Ensure that consistent identifiers are generated on a per-method basis by msgp.
//
// Also ensure that no duplicate identifiers appear in a method.
//
// structs are currently processed alphabetically by msgp. this test relies on
// that property.
//
func TestIssue185Idents(t *testing.T) {
	var identCases = []struct {
		tpl             *template.Template
		expectedChanged []string
	}{
		{tpl: issue185IdentsTpl, expectedChanged: []string{"Test1"}},
		{tpl: issue185ComplexIdentsTpl, expectedChanged: []string{"Test2"}},
	}

	methods := []string{"DecodeMsg", "EncodeMsg", "Msgsize", "MarshalMsg", "UnmarshalMsg"}

	for idx, identCase := range identCases {
		// generate the code, extract the generated variable names, mapped to function name
		var tplData issue185TplData
		varsBefore, err := loadVars(identCase.tpl, tplData)
		if err != nil {
			t.Fatalf("%d: could not extract before vars: %v", idx, err)
		}

		// regenerate the code with extra field(s), extract the generated variable
		// names, mapped to function name
		tplData.Extra = true
		varsAfter, err := loadVars(identCase.tpl, tplData)
		if err != nil {
			t.Fatalf("%d: could not extract after vars: %v", idx, err)
		}

		// ensure that all declared variable names inside each of the methods we
		// expect to change have actually changed
		for _, stct := range identCase.expectedChanged {
			for _, method := range methods {
				fn := fmt.Sprintf("%s.%s", stct, method)

				bv, av := varsBefore.Value(fn), varsAfter.Value(fn)
				if len(bv) > 0 && len(av) > 0 && reflect.DeepEqual(bv, av) {
					t.Fatalf("%d vars identical! expected vars to change for %s", idx, fn)
				}
				delete(varsBefore, fn)
				delete(varsAfter, fn)
			}
		}

		// all of the remaining keys should not have changed
		for bmethod, bvars := range varsBefore {
			avars := varsAfter.Value(bmethod)

			if !reflect.DeepEqual(bvars, avars) {
				t.Fatalf("%d: vars changed! expected vars identical for %s", idx, bmethod)
			}
			delete(varsBefore, bmethod)
			delete(varsAfter, bmethod)
		}

		if len(varsBefore) > 0 || len(varsAfter) > 0 {
			t.Fatalf("%d: unexpected methods remaining", idx)
		}
	}
}

type issue185TplData struct {
	Extra bool
}

func TestIssue185Overlap(t *testing.T) {
	var overlapCases = []struct {
		tpl  *template.Template
		data issue185TplData
	}{
		{tpl: issue185IdentsTpl, data: issue185TplData{Extra: false}},
		{tpl: issue185IdentsTpl, data: issue185TplData{Extra: true}},
		{tpl: issue185ComplexIdentsTpl, data: issue185TplData{Extra: false}},
		{tpl: issue185ComplexIdentsTpl, data: issue185TplData{Extra: true}},
	}

	for idx, o := range overlapCases {
		// regenerate the code with extra field(s), extract the generated variable
		// names, mapped to function name
		mvars, err := loadVars(o.tpl, o.data)
		if err != nil {
			t.Fatalf("%d: could not extract after vars: %v", idx, err)
		}

		identCnt := 0
		for fn, vars := range mvars {
			sort.Strings(vars)

			// Loose sanity check to make sure the tests expectations aren't broken.
			// If the prefix ever changes, this needs to change.
			for _, v := range vars {
				if v[0] == 'z' {
					identCnt++
				}
			}

			for i := 0; i < len(vars)-1; i++ {
				if vars[i] == vars[i+1] {
					t.Fatalf("%d: duplicate var %s in function %s", idx, vars[i], fn)
				}
			}
		}

		// one last sanity check: if there aren't any vars that start with 'z',
		// this test's expectations are unsatisfiable.
		if identCnt == 0 {
			t.Fatalf("%d: no generated identifiers found", idx)
		}
	}
}

func loadVars(tpl *template.Template, tplData interface{}) (vars extractedVars, err error) {
	tempDir, err := ioutil.TempDir("", "msgp-")
	if err != nil {
		err = fmt.Errorf("could not create temp dir: %v", err)
		return
	}

	if !debugTemp {
		defer os.RemoveAll(tempDir)
	} else {
		fmt.Println(tempDir)
	}
	tfile := filepath.Join(tempDir, "msg.go")
	genFile := newFilename(tfile, "")

	if err = goGenerateTpl(tempDir, tfile, tpl, tplData); err != nil {
		err = fmt.Errorf("could not generate code: %v", err)
		return
	}

	vars, err = extractVars(genFile)
	if err != nil {
		err = fmt.Errorf("could not extract after vars: %v", err)
		return
	}

	return
}

type varVisitor struct {
	vars []string
	fset *token.FileSet
}

func (v *varVisitor) Visit(node ast.Node) (w ast.Visitor) {
	gen, ok := node.(*ast.GenDecl)
	if !ok {
		return v
	}
	for _, spec := range gen.Specs {
		if vspec, ok := spec.(*ast.ValueSpec); ok {
			for _, n := range vspec.Names {
				v.vars = append(v.vars, n.Name)
			}
		}
	}
	return v
}

type extractedVars map[string][]string

func (e extractedVars) Value(key string) []string {
	if v, ok := e[key]; ok {
		return v
	}
	panic(fmt.Errorf("unknown key %s", key))
}

func extractVars(file string) (extractedVars, error) {
	fset := token.NewFileSet()

	f, err := parser.ParseFile(fset, file, nil, 0)
	if err != nil {
		return nil, err
	}

	vars := make(map[string][]string)
	for _, d := range f.Decls {
		switch d := d.(type) {
		case *ast.FuncDecl:
			sn := ""
			switch rt := d.Recv.List[0].Type.(type) {
			case *ast.Ident:
				sn = rt.Name
			case *ast.StarExpr:
				sn = rt.X.(*ast.Ident).Name
			default:
				panic("unknown receiver type")
			}

			key := fmt.Sprintf("%s.%s", sn, d.Name.Name)
			vis := &varVisitor{fset: fset}
			ast.Walk(vis, d.Body)
			vars[key] = vis.vars
		}
	}
	return vars, nil
}

func goGenerateTpl(cwd, tfile string, tpl *template.Template, tplData interface{}) error {
	outf, err := os.OpenFile(tfile, os.O_CREATE|os.O_RDWR|os.O_TRUNC, 0600)
	if err != nil {
		return err
	}
	defer outf.Close()

	if err := tpl.Execute(outf, tplData); err != nil {
		return err
	}

	mode := gen.Encode | gen.Decode | gen.Size | gen.Marshal | gen.Unmarshal

	return Run(tfile, mode, false)
}

var issue185IdentsTpl = template.Must(template.New("").Parse(`
package issue185

//go:generate msgp

type Test1 struct {
	Foo string
	Bar string
	{{ if .Extra }}Baz []string{{ end }}
	Qux string
}

type Test2 struct {
	Foo string
	Bar string
	Baz string
}
`))

var issue185ComplexIdentsTpl = template.Must(template.New("").Parse(`
package issue185

//go:generate msgp

type Test1 struct {
	Foo string
	Bar string
	Baz string
}

type Test2 struct {
	Foo string
	Bar string
	Baz []string
	Qux map[string]string
	Yep map[string]map[string]string
	Quack struct {
		Quack struct {
			Quack struct {
				{{ if .Extra }}Extra []string{{ end }}
				Quack string
			}
		}
	}
	Nup struct {
		Foo string
		Bar string
		Baz []string
		Qux map[string]string
		Yep map[string]map[string]string
	}
	Ding struct {
		Dong struct {
			Dung struct {
				Thing string
			}
		}
	}
}

type Test3 struct {
	Foo string
	Bar string
	Baz string
}
`))
