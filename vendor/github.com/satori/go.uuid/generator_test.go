// Copyright (C) 2013-2018 by Maxim Bublis <b@codemonkey.ru>
//
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

package uuid

import (
	"crypto/rand"
	"fmt"
	"net"
	"time"

	. "gopkg.in/check.v1"
)

type faultyReader struct {
	callsNum   int
	readToFail int // Read call number to fail
}

func (r *faultyReader) Read(dest []byte) (int, error) {
	r.callsNum++
	if (r.callsNum - 1) == r.readToFail {
		return 0, fmt.Errorf("io: reader is faulty")
	}
	return rand.Read(dest)
}

type genTestSuite struct{}

var _ = Suite(&genTestSuite{})

func (s *genTestSuite) TestNewV1(c *C) {
	u1, err := NewV1()
	c.Assert(err, IsNil)
	c.Assert(u1.Version(), Equals, V1)
	c.Assert(u1.Variant(), Equals, VariantRFC4122)

	u2, err := NewV1()
	c.Assert(err, IsNil)
	c.Assert(u1, Not(Equals), u2)
}

func (s *genTestSuite) TestNewV1EpochStale(c *C) {
	g := &rfc4122Generator{
		epochFunc: func() time.Time {
			return time.Unix(0, 0)
		},
		hwAddrFunc: defaultHWAddrFunc,
		rand:       rand.Reader,
	}
	u1, err := g.NewV1()
	c.Assert(err, IsNil)
	u2, err := g.NewV1()
	c.Assert(err, IsNil)
	c.Assert(u1, Not(Equals), u2)
}

func (s *genTestSuite) TestNewV1FaultyRand(c *C) {
	g := &rfc4122Generator{
		epochFunc:  time.Now,
		hwAddrFunc: defaultHWAddrFunc,
		rand:       &faultyReader{},
	}
	u1, err := g.NewV1()
	c.Assert(err, NotNil)
	c.Assert(u1, Equals, Nil)
}

func (s *genTestSuite) TestNewV1MissingNetworkInterfaces(c *C) {
	g := &rfc4122Generator{
		epochFunc: time.Now,
		hwAddrFunc: func() (net.HardwareAddr, error) {
			return []byte{}, fmt.Errorf("uuid: no hw address found")
		},
		rand: rand.Reader,
	}
	_, err := g.NewV1()
	c.Assert(err, IsNil)
}

func (s *genTestSuite) TestNewV1MissingNetInterfacesAndFaultyRand(c *C) {
	g := &rfc4122Generator{
		epochFunc: time.Now,
		hwAddrFunc: func() (net.HardwareAddr, error) {
			return []byte{}, fmt.Errorf("uuid: no hw address found")
		},
		rand: &faultyReader{
			readToFail: 1,
		},
	}
	u1, err := g.NewV1()
	c.Assert(err, NotNil)
	c.Assert(u1, Equals, Nil)
}

func (s *genTestSuite) BenchmarkNewV1(c *C) {
	for i := 0; i < c.N; i++ {
		NewV1()
	}
}

func (s *genTestSuite) TestNewV2(c *C) {
	u1, err := NewV2(DomainPerson)
	c.Assert(err, IsNil)
	c.Assert(u1.Version(), Equals, V2)
	c.Assert(u1.Variant(), Equals, VariantRFC4122)

	u2, err := NewV2(DomainGroup)
	c.Assert(err, IsNil)
	c.Assert(u2.Version(), Equals, V2)
	c.Assert(u2.Variant(), Equals, VariantRFC4122)

	u3, err := NewV2(DomainOrg)
	c.Assert(err, IsNil)
	c.Assert(u3.Version(), Equals, V2)
	c.Assert(u3.Variant(), Equals, VariantRFC4122)
}

func (s *genTestSuite) TestNewV2FaultyRand(c *C) {
	g := &rfc4122Generator{
		epochFunc:  time.Now,
		hwAddrFunc: defaultHWAddrFunc,
		rand:       &faultyReader{},
	}
	u1, err := g.NewV2(DomainPerson)
	c.Assert(err, NotNil)
	c.Assert(u1, Equals, Nil)
}

func (s *genTestSuite) BenchmarkNewV2(c *C) {
	for i := 0; i < c.N; i++ {
		NewV2(DomainPerson)
	}
}

func (s *genTestSuite) TestNewV3(c *C) {
	u1 := NewV3(NamespaceDNS, "www.example.com")
	c.Assert(u1.Version(), Equals, V3)
	c.Assert(u1.Variant(), Equals, VariantRFC4122)
	c.Assert(u1.String(), Equals, "5df41881-3aed-3515-88a7-2f4a814cf09e")

	u2 := NewV3(NamespaceDNS, "example.com")
	c.Assert(u2, Not(Equals), u1)

	u3 := NewV3(NamespaceDNS, "example.com")
	c.Assert(u3, Equals, u2)

	u4 := NewV3(NamespaceURL, "example.com")
	c.Assert(u4, Not(Equals), u3)
}

func (s *genTestSuite) BenchmarkNewV3(c *C) {
	for i := 0; i < c.N; i++ {
		NewV3(NamespaceDNS, "www.example.com")
	}
}

func (s *genTestSuite) TestNewV4(c *C) {
	u1, err := NewV4()
	c.Assert(err, IsNil)
	c.Assert(u1.Version(), Equals, V4)
	c.Assert(u1.Variant(), Equals, VariantRFC4122)

	u2, err := NewV4()
	c.Assert(err, IsNil)
	c.Assert(u1, Not(Equals), u2)
}

func (s *genTestSuite) TestNewV4FaultyRand(c *C) {
	g := &rfc4122Generator{
		epochFunc:  time.Now,
		hwAddrFunc: defaultHWAddrFunc,
		rand:       &faultyReader{},
	}
	u1, err := g.NewV4()
	c.Assert(err, NotNil)
	c.Assert(u1, Equals, Nil)
}

func (s *genTestSuite) BenchmarkNewV4(c *C) {
	for i := 0; i < c.N; i++ {
		NewV4()
	}
}

func (s *genTestSuite) TestNewV5(c *C) {
	u1 := NewV5(NamespaceDNS, "www.example.com")
	c.Assert(u1.Version(), Equals, V5)
	c.Assert(u1.Variant(), Equals, VariantRFC4122)
	c.Assert(u1.String(), Equals, "2ed6657d-e927-568b-95e1-2665a8aea6a2")

	u2 := NewV5(NamespaceDNS, "example.com")
	c.Assert(u2, Not(Equals), u1)

	u3 := NewV5(NamespaceDNS, "example.com")
	c.Assert(u3, Equals, u2)

	u4 := NewV5(NamespaceURL, "example.com")
	c.Assert(u4, Not(Equals), u3)
}

func (s *genTestSuite) BenchmarkNewV5(c *C) {
	for i := 0; i < c.N; i++ {
		NewV5(NamespaceDNS, "www.example.com")
	}
}
