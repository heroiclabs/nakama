package store

import (
	"github.com/gobuffalo/packr/v2"
	"github.com/gobuffalo/packr/v2/file/resolver"
)

var _ = func() error {
	const gk = DISK_GLOBAL_KEY
	g := packr.New(gk, "")

	hgr, err := resolver.NewHexGzip(map[string]string{
		"4abf3a9b652ecec6b347eb6acb7ce363": "1f8b08000000000000fff2750c72775508cecc2d28cecfe302040000fffffb1d273b0e000000",
		"5cfc8f95f98237a10affc14a76e3e20b": "1f8b08000000000000fff2757477f7745508cecc2d28cecfe302040000ffffb09167470f000000",
		"6d8be986fa35821e7e869fbb118e51ba": "1f8b08000000000000fff2f0f7750d5208cecc2d28cecfe302040000fffffb2ef0a60e000000",
		"99e5497ae5f5988fafafbcd15ed74d22": "1f8b08000000000000fff2f10c765408cecc2d28cecfe302040000ffffab9bc93e0d000000",
		"bb006aa6261a80f6c52c640f713659c1": "1f8b08000000000000ff72720c0a5108cecc2d28cecfe302040000ffff89742ac20d000000",
	})
	if err != nil {
		return err
	}
	g.DefaultResolver = hgr
	func() {
		b := packr.New("simpsons", "")
		b.SetResolver("kids/bart.txt", packr.Pointer{ForwardBox: gk, ForwardPath: "bb006aa6261a80f6c52c640f713659c1"})
		b.SetResolver("kids/lisa.txt", packr.Pointer{ForwardBox: gk, ForwardPath: "99e5497ae5f5988fafafbcd15ed74d22"})
		b.SetResolver("kids/maggie.txt", packr.Pointer{ForwardBox: gk, ForwardPath: "5cfc8f95f98237a10affc14a76e3e20b"})
		b.SetResolver("parents/homer.txt", packr.Pointer{ForwardBox: gk, ForwardPath: "6d8be986fa35821e7e869fbb118e51ba"})
		b.SetResolver("parents/marge.txt", packr.Pointer{ForwardBox: gk, ForwardPath: "4abf3a9b652ecec6b347eb6acb7ce363"})
	}()
	return nil
}()
