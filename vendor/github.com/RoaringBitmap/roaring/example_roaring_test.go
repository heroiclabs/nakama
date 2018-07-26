package roaring

import (
	"bytes"
	"fmt"
	"testing"
)

// Example_roaring demonstrates how to use the roaring library.
func TestExample_roaring060(t *testing.T) {
	// example inspired by https://github.com/fzandona/goroar
	fmt.Println("==roaring==")
	rb1 := BitmapOf(1, 2, 3, 4, 5, 100, 1000)
	fmt.Println(rb1.String())

	rb2 := BitmapOf(3, 4, 1000)
	fmt.Println(rb2.String())

	rb3 := New()
	fmt.Println(rb3.String())

	fmt.Println("Cardinality: ", rb1.GetCardinality())
	if rb1.GetCardinality() != 7 {
		t.Errorf("Bad cardinality: %v", rb1.GetCardinality())
	}

	fmt.Println("Contains 3? ", rb1.Contains(3))
	if !rb1.Contains(3) {
		t.Errorf("Should contain 3.")
	}

	rb1.And(rb2)

	rb3.Add(1)
	rb3.Add(5)

	rb3.Or(rb1)

	// prints 1, 3, 4, 5, 1000
	i := rb3.Iterator()
	for i.HasNext() {
		fmt.Println(i.Next())
	}
	fmt.Println()

	// next we include an example of serialization
	buf := new(bytes.Buffer)
	size, err := rb1.WriteTo(buf)
	if err != nil {
		fmt.Println("Failed writing")
		t.Errorf("Failed writing")

	} else {
		fmt.Println("Wrote ", size, " bytes")
	}
	newrb := New()
	_, err = newrb.ReadFrom(buf)
	if err != nil {
		fmt.Println("Failed reading")
		t.Errorf("Failed reading")

	}
	if !rb1.Equals(newrb) {
		fmt.Println("I did not get back to original bitmap?")
		t.Errorf("Bad serialization")

	} else {
		fmt.Println("I wrote the content to a byte stream and read it back.")
	}
}

// Example_roaring demonstrates how to use the roaring library with run containers.
func TestExample2_roaring061(t *testing.T) {

	r1 := New()
	for i := uint32(100); i < 1000; i++ {
		r1.Add(i)
	}
	if !r1.Contains(500) {
		t.Errorf("should contain 500")
	}
	rb2 := r1.Clone()
	// compute how many bits there are:
	cardinality := r1.GetCardinality()

	// if your bitmaps have long runs, you can compress them by calling
	// run_optimize
	size := r1.GetSizeInBytes()
	r1.RunOptimize()
	if cardinality != r1.GetCardinality() {
		t.Errorf("RunOptimize should not change cardinality.")
	}
	compactSize := r1.GetSizeInBytes()
	if compactSize >= size {
		t.Errorf("Run optimized size should be smaller.")
	}
	if !r1.Equals(rb2) {
		t.Errorf("RunOptimize should not affect equality.")
	}
	fmt.Print("size before run optimize: ", size, " bytes, and after: ", compactSize, " bytes.\n")
	rb3 := New()
	rb3.AddRange(1, 10000000)
	r1.Or(rb3)
	if !r1.Equals(rb3) {
		t.Errorf("union with large run should give back contained set")
	}
	rb1 := r1.Clone()
	rb1.AndNot(rb3)
	if !rb1.IsEmpty() {
		t.Errorf("And not with large should clear...")
	}
	for i := uint32(0); i < 10000; i += 3 {
		rb1.Add(i)
	}
	rb1.AndNot(rb3)
	rb1card := rb1.GetCardinality()
	if rb1card != 1 {
		//rb1.RunOptimize()
		//fmt.Printf("\n rb1 = %s\n", rb1)
		t.Errorf("Only the value 0 should survive the andNot; rb1card = %v", rb1card)
	}
}
