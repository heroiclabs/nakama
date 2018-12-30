package cmd

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"time"

	"github.com/gobuffalo/packr/v2/jam/parser"
	"github.com/gobuffalo/packr/v2/jam/store"
	"github.com/gobuffalo/packr/v2/plog"
	"github.com/pkg/errors"
)

func pack(args ...string) error {
	if err := clean(args...); err != nil {
		return errors.WithStack(err)
	}
	pwd, err := os.Getwd()
	if err != nil {
		return errors.WithStack(err)
	}

	roots := append(args, pwd)
	p, err := parser.NewFromRoots(roots, &parser.RootsOptions{
		IgnoreImports: globalOptions.IgnoreImports,
	})
	if err != nil {
		return errors.WithStack(err)
	}
	boxes, err := p.Run()
	if err != nil {
		return errors.WithStack(err)
	}

	// reduce boxes - remove ones we don't want
	// MB: current assumption is we want all these
	// boxes, just adding a comment suggesting they're
	// might be a reason to exclude some

	plog.Logger.Debugf("found %d boxes", len(boxes))

	if len(globalOptions.StoreCmd) != 0 {
		return shellPack(boxes)
	}

	var st store.Store = store.NewDisk("", "")

	if globalOptions.Legacy {
		st = store.NewLegacy()
	}

	for _, b := range boxes {
		if b.Name == store.DISK_GLOBAL_KEY {
			continue
		}
		if err := st.Pack(b); err != nil {
			return errors.WithStack(err)
		}
	}
	if cl, ok := st.(io.Closer); ok {
		return cl.Close()
	}
	return nil
}

func shellPack(boxes parser.Boxes) error {
	b, err := json.Marshal(boxes)
	if err != nil {
		return errors.WithStack(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	c := exec.CommandContext(ctx, globalOptions.StoreCmd, string(b))
	c.Stdout = os.Stdout
	c.Stderr = os.Stderr
	return c.Run()
}
