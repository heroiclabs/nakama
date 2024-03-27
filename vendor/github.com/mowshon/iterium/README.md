<h1 id="iterium">🚀 Iterium - Generic Channel-based Iterators</h1>

The **Iterium** package is a powerful toolkit for creating and manipulating generic iterators in Golang. Inspired by the popular Python **itertools** library, Iterium provides a variety of functions for working with iterators in different ways.

Iterium is designed to be easy to use and flexible, with a clear and concise API that enables you to create iterators that meet your specific needs. Whether you're working with strings, arrays, slices, or any other data type. **Iterium** makes it easy to traverse, filter, and manipulate your data with ease.

---------
### Contents
- [Decrypting the MD5 hash in Golang](https://github.com/mowshon/iterium#user-content-md5)
    - [Benchmark](https://github.com/mowshon/iterium#user-content-benchmark)
- [Iterator architecture](https://github.com/mowshon/iterium#user-content-structure)
- [Creating an Iterator](https://github.com/mowshon/iterium#user-content-new)
- [Getting data from an iterator](https://github.com/mowshon/iterium#user-content-get)
- [Combinatoric iterators](https://github.com/mowshon/iterium#user-content-combinatorics)
    - 🟢 [Product() - Cartesian Product](https://github.com/mowshon/iterium#user-content-product)
    - 🟢 [Permutations()](https://github.com/mowshon/iterium#user-content-permutations)
    - 🟢 [Combinations()](https://github.com/mowshon/iterium#user-content-combinations)
    - 🟢 [CombinationsWithReplacement()](https://github.com/mowshon/iterium#user-content-combinations-with-replacement)
- [Infinite iterators](https://github.com/mowshon/iterium#user-content-infinite)
    - 🔴 [Count()](https://github.com/mowshon/iterium#user-content-count)
    - 🔴 [Cycle()](https://github.com/mowshon/iterium#user-content-cycle)
    - 🔴 [Repeat()](https://github.com/mowshon/iterium#user-content-repeat)
- [Finite iterators](https://github.com/mowshon/iterium#user-content-finite)
    - 🔵 [Range()](https://github.com/mowshon/iterium#user-content-range)
    - 🔵 [Map()](https://github.com/mowshon/iterium#user-content-map)
    - 🔵 [StarMap()](https://github.com/mowshon/iterium#user-content-starmap)
    - 🔵 [Filter()](https://github.com/mowshon/iterium#user-content-filter)
    - 🔵 [FilterFalse()](https://github.com/mowshon/iterium#user-content-filter-false)
    - 🔵 [Accumulate()](https://github.com/mowshon/iterium#user-content-accumulate)
    - 🔵 [TakeWhile()](https://github.com/mowshon/iterium#user-content-take-while)
    - 🔵 [DropWhile()](https://github.com/mowshon/iterium#user-content-drop-while)
- [Create your own iterator](https://github.com/mowshon/iterium#user-content-custom)
---------

**Iterium** provides a powerful set of tools for fast and easy data processing and transformations.

<h2 id="md5">Decrypting the MD5 hash in Golang</h2>

Before we move on to explore each iterator in particular, let me give you a small example of **decrypting an md5 hash in a few lines of code** using **Iterium**. Assume that our password consists only of **lower-case Latin letters** and we don't know exactly its length, but assume no more than 6 characters. 

```golang
// result of md5("qwerty") = d8578edf8458ce06fbc5bb76a58c5ca4
passHash := "d8578edf8458ce06fbc5bb76a58c5ca4"

for passLength := range Range(1, 7).Chan() {
    fmt.Println("Password Length:", passLength)

    // Merge a slide into a string.
    // []string{"a", "b", "c"} => "abc"
    join := func(product []string) string {
        return strings.Join(product, "")
    }

    // Check the hash of a raw password with an unknown hash.
    sameHash := func(rawPassword string) bool {
        hash := md5.Sum([]byte(rawPassword))
        return hex.EncodeToString(hash[:]) == passHash
    }

    // Combine iterators to achieve the goal...
    decrypt := FirstTrue(Map(Product(AsciiLowercase, passLength), join), sameHash)

    if result, err := decrypt.Next(); err == nil {
        fmt.Println("Raw password:", result)
        break
    }
}
```

Output:

```
Raw password: qwerty
```

Let's look at what's going on here. The main thing we are interested in is the line:

```golang
decrypt := FirstTrue(Map(Product(ascii, passLength), join), sameHash)
```

- Initially the `Product` iterator **generates all possible combinations** of Latin letters from a certain length, and returns a slice like `[]string{"p", "a", "s", "s"}`. [AsciiLowercase](https://github.com/mowshon/iterium/blob/main/string.go) is a slice of all lowercase Latin letters.;
- Sending `Product` iterator to `Map` iterator which will use a closure-function to merge the slice into a string, like `[]string{"a", "b"} => "ab"`;
- Sending the obtained iterator from `Map` to the `FirstTrue` iterator, which returns the first value from `Map` that returned **true** after applying the `sameHash()` function to it;
- The `sameHash()` function turns the received string from the `Map` iterator into an md5 hash and checks if it matches with the unknown hash.

<h2 id="benchmark">Benchmark ⏰</h2>

One of the special features of this package (compared to the python module) is the ability to **know the exact number of combinations** before running the process.

```golang
Product([]string{"a", "b", "c", "d"}, 10).Count() # 1048576 possible combinations
```

#### 🔑 How many total combinations of possible passwords did it take to crack a 6-character md5 hash?

```
Password Length: 1, total combinations: 26
Password Length: 2, total combinations: 676
Password Length: 3, total combinations: 17576
Password Length: 4, total combinations: 456976
Password Length: 5, total combinations: 11881376
Password Length: 6, total combinations: 308915776
```

```
goos: linux
goarch: amd64
pkg: github.com/mowshon/iterium
cpu: AMD Ryzen 5 3600 6-Core Processor              
BenchmarkDecryptMD5Hash

Raw password: qwerty
BenchmarkDecryptMD5Hash-12             1  254100234180 ns/op
```

The hash was cracked in `4.23` minutes. This is just using the capabilities of the iterium package.

<h2 id="structure">Iterator architecture</h2>

Each iterator corresponds to the following interface:

```golang
// Iter is the iterator interface with all the necessary methods.
type Iter[T any] interface {
    IsInfinite() bool
    SetInfinite(bool)
    Next() (T, error)
    Chan() chan T
    Close()
    Slice() ([]T, error)
    Count() int64
}
```
Description of the methods:
- `IsInfinite()` returns the iterator infinite state;
- `SetInfinite()` update the infinity state of the iterator;
- `Chan()` returns the iterator channel;
- `Next()` returns the next value or error from the iterator channel;
- `Close()` closes the iterator channel;
- `Count()` returns the number of possible values the iterator can return;
- `Slice()` turns the iterator into a slice of values;

<h2 id="new">Creating an Iterator</h2>

You can use the function `iterium.New(1, 2, 3)` or `iterium.New("a", "b", "c")` to create a new iterator.

```golang
package main

import (
    "github.com/mowshon/iterium"
)

type Store struct {
    price float64
}

func main() {
    iterOfInt := iterium.New(1, 2, 3)
    iterOfString := iterium.New("A", "B", "C")
    iterOfStruct := iterium.New(Store{10.5}, Store{5.1}, Store{0.15})
    iterOfFunc := iterium.New(
        func(x int) int {return x + 1},
        func(y int) int {return y * 2},
        func(z int) int {return z / 3},
    )
}
```

<h2 id="get">Getting data from an iterator</h2>

There are two ways to retrieve data from an iterator. The first way is to use the `Next()` method or read values from the iterator channel `range iter.Chan()`.

Using the `Next()` method:
```golang
func main() {
    iterOfInt := iterium.New(1, 2, 3)

    for {
        value, err := iterOfInt.Next()
        if err != nil {
            break
        }
        
        fmt.Println(value)
    }
}
```

Reading from the channel:

```golang
func main() {
    iterOfInt := iterium.New(1, 2, 3)

    for value := range iterOfInt.Chan() {
        fmt.Println(value)
    }
}
```

<h1 id="combinatorics">Combinatoric iterators</h1>

Combinatoric iterators are a powerful tool for solving problems that involve generating all possible combinations or permutations of a slice of elements, and are widely used in a range of fields and applications.

<h2 id="product">🟢 iterium.Product([]T, length) - Cartesian Product</h2>

The iterator generates a **Cartesian product** depending on the submitted slice of values and the required length. The **Cartesian product** is a mathematical concept that refers to the set of all possible ordered pairs formed by taking one element from each of two sets. 

In the case of `iterium.Product()`, the Cartesian product is formed by taking one element from each of the input slice.

```golang
product := iterium.Product([]string{"A", "B", "C", "D"}, 2)
toSlice, _ := product.Slice()

fmt.Println("Total:", product.Count())
fmt.Println(toSlice)
```

Output:

```
Total: 16

[
    [A, A] [A, B] [A, C] [A, D] [B, A] [B, B] [B, C] [B, D]
    [C, A] [C, B] [C, C] [C, D] [D, A] [D, B] [D, C] [D, D]
]
```

<h2 id="permutations">🟢 iterium.Permutations([]T, length)</h2>

`Permutations()` returns an iterator that generates all possible permutations of a given slice. A permutation is an arrangement of elements in a specific order, where each arrangement is different from all others.

```golang
permutations := iterium.Permutations([]string{"A", "B", "C", "D"}, 2)
toSlice, _ := permutations.Slice()

fmt.Println("Total:", permutations.Count())
fmt.Println(toSlice)
```

Result:

```
Total: 12

[
    [A, B] [A, C] [A, D] [B, A] [B, C] [B, D]
    [C, B] [C, A] [C, D] [D, B] [D, C] [D, A]
]
```

<h2 id="combinations">🟢 iterium.Combinations([]T, length)</h2>

`Combinations()` returns an iterator that generates all possible combinations of a given length from a given slice. A combination is a selection of items from a slice, such that the order in which the items are selected does not matter. 

```golang
combinations := iterium.Combinations([]string{"A", "B", "C", "D"}, 2)
toSlice, _ := combinations.Slice()

fmt.Println("Total:", combinations.Count())
fmt.Println(toSlice)
```

Output:

```
Total: 6

[
    [A, B] [A, C] [A, D] [B, C] [B, D] [C, D]
]
```

<h2 id="combinations-with-replacement">🟢 iterium.CombinationsWithReplacement([]T, length)</h2>

`CombinationsWithReplacement()` generates all possible combinations of a given slice, **including the repeated elements**.

```golang
result := iterium.CombinationsWithReplacement([]string{"A", "B", "C", "D"}, 2)
toSlice, _ := result.Slice()

fmt.Println("Total:", result.Count())
fmt.Println(toSlice)
```

Output:

```
Total: 10

[
    [A, A] [A, B] [A, C] [A, D] [B, B]
    [B, C] [B, D] [C, C] [C, D] [D, D]
]
```

<h1 id="infinite">Infinite iterators</h1>

Infinite iterators are a type of iterator that generate an **endless sequence of values**, without ever reaching an endpoint. Unlike finite iterators, which generate a fixed number of values based on the size of a given iterable data structure, infinite iterators continue to generate values indefinitely, until they are stopped or interrupted.

<h2 id="count">🔴 iterium.Count(start, step)</h2>

`Count()` returns an iterator that generates an infinite stream of values, starting from a specified number and incrementing by a specified step.

```golang
stream := iterium.Count(0, 3)

// Retrieve the first 5 values from the iterator.
for i := 0; i <= 5; i++ {
    value, err := stream.Next()
    if err != nil {
        break
    }

    fmt.Println(value)
}

stream.Close()
```

Output:

```
0, 3, 6, 9, 12, 15
```

<h2 id="cycle">🔴 iterium.Cycle(Iterator)</h2>

`Cycle()` returns an iterator that cycles endlessly through an iterator. Note that since `iterium.Cycle()` generates an infinite stream of values, you should be careful not to use it in situations where you do not want to generate an infinite loop. Also, if the iterator passed to `Cycle()` is empty, the iterator will not generate any values **and will immediately close the channel**.

```golang
cycle := iterium.Cycle(iterium.Range(3))

for i := 0; i <= 11; i++ {
    value, err := cycle.Next()
    if err != nil {
        break
    }

    fmt.Print(value, ", ")
}
```

Output:

```
0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2
```

<h2 id="repeat">🔴 iterium.Repeat(value, n)</h2>

`Repeat()` returns an iterator that repeats a specified value **infinitely** `n = -1` or a **specified number of times** `n = 50`.

Here's an example code snippet that demonstrates how to use `iterium.Repeat()`:

```golang
type User struct {
    Username string
}

func main() {
    // To receive an infinite iterator, you 
    // need to specify a length of -1
    users := iterium.Repeat(User{"mowshon"}, 3)
    slice, _ := users.Slice()

    fmt.Println(slice)
    fmt.Println(slice[1].Username)
}
```

Output:

```
[ User{mowshon}, User{mowshon}, User{mowshon} ]
mowshon
```

<h1 id="finite">Finite iterators</h1>

Finite iterators return iterators that terminate as soon as any of the input sequences they iterate over are exhausted.

<h2 id="range">🔵 iterium.Range(start, stop, step)</h2>

`Range()` generates a sequence of numbers. It takes up to three arguments:

```golang
iterium.Range(end) # starts from 0 to the end with step = +1
iterium.Range(start, end) # step is +1
iterium.Range(start, end, step)
```

- `start`: (optional) Starting number of the sequence. Defaults to 0 if not provided.
- `stop`: (required) Ending number of the sequence.
- `step`: (optional) Step size of the sequence. Defaults to 1 if not provided.

Here's an example code snippet that demonstrates how to use `iterium.Range()`:

```golang
first, _ := iterium.Range(5).Slice()
second, _ := iterium.Range(-5).Slice()
third, _ := iterium.Range(0, 10, 2).Slice()
float, _ := iterium.Range(0.0, 10.0, 1.5).Slice()

fmt.Println(first)
fmt.Println(second)
fmt.Println(third)
fmt.Println(float)
```

Output:

```
first:  [0, 1, 2, 3, 4]
second: [0, -1, -2, -3, -4]
third:  [0, 2, 4, 6, 8]

float:  [0.0, 1.5, 3.0, 4.5, 6.0, 7.5, 9.0]
```
#### Features 🔥
- **Note** that compared to `range()` from Python, `Range()` from **Iterium** if it receives the first parameter below zero, the `step` automatically becomes `-1` and starts with `0`. In Python such parameters <ins>will return an empty array</ins>.
- **Also**, this iterator is more like `numpy.arange()` as it <ins>can handle the float type</ins>.

<h2 id="map">🔵 iterium.Map(iter, func)</h2>

`Map()` is a function that takes two arguments, a function and another iterator, and returns a new iterator that applies the function to each element of the source iterator, producing the resulting values one at a time.

### Calculating the Fibonacci Number with Iterium
Here is an example code snippet that demonstrates how to use `iterium.Map()` to apply a function to each element from another iterator:

```golang
numbers := iterium.Range(30)
fibonacci := iterium.Map(numbers, func(n int) int {
    f := make([]int, n+1, n+2)
    if n < 2 {
        f = f[0:2]
    }

    f[0] = 0
    f[1] = 1

    for i := 2; i <= n; i++ {
        f[i] = f[i-1] + f[i-2]
    }

    return f[n]
})

slice, _ := fibonacci.Slice()
fmt.Println(slice)
```

Output:

```
[
    0 1 1 2 3 5 8 13 21 34 55 89
    144 233 377 610 987 1597 2584
    4181 6765 10946 17711 28657 46368
    75025 121393 196418 317811 514229
]
```

<h2 id="starmap">🔵 iterium.StarMap(iter, func)</h2>

`StarMap()` takes an iterator of slices and a function as input, and returns an iterator that applies the function to each slice in the iterator, unpacking the slices as function arguments.

Here's an example code snippet that demonstrates how to use `iterium.StarMap()`:

```golang
func pow(a, b float64) float64 {
    return math.Pow(a, b)
}

func main() {
    values := iterium.New([]float64{2, 5}, []float64{3, 2}, []float64{10, 3})
    starmap := iterium.StarMap(values, pow)

    slice, _ := starmap.Slice()
    fmt.Println(slice)
}
```

Output:

```
[32, 9, 1000]
```

**Note** that `iterium.StarMap()` is similar to `iterium.Map()`, but is used when the function to be applied expects two arguments, unlike `Map()` where the function only takes in a single argument.

<h2 id="filter">🔵 iterium.Filter(iter, func)</h2>

`Filter()` is used to filter out elements from an iterator based on a given condition. It returns a new iterator with only the elements that satisfy the condition.

Here is an example of using the `iterium.Filter()` function to filter out even numbers from a list:

```golang
func even(x int) bool {
    return x % 2 == 0
}

func main() {
    numbers := iterium.New(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
    filter := iterium.Filter(numbers, even)

    slice, _ := filter.Slice()
    fmt.Println(slice)
}
```

Output:

```
[2, 4, 6, 8, 10]
```

<h2 id="filter-false">🔵 iterium.FilterFalse(iter, func)</h2>

`FilterFalse()` returns an iterator that contains only the elements from the input iterator for which the given function returns `False`.

Here is an example of using the `iterium.FilterFalse()` function to filter out even numbers from a list:

```golang
func even(x int) bool {
    return x % 2 == 0
}

func main() {
    numbers := iterium.New(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
    filter := iterium.FilterFalse(numbers, even)

    slice, _ := filter.Slice()
    fmt.Println(slice)
}
```

Output:

```
[1, 3, 5, 7, 9]
```

<h2 id="accumulate">🔵 iterium.Accumulate(iter, func)</h2>

`Accumulate()` generates a sequence of accumulated values from an iterator. The function takes two arguments: the iterator and the function that defines how to combine the iterator elements.

Here's an example:

```golang
func sum(x, y int) int {
    return x + y
}

func main() {
    numbers := iterium.New(1, 2, 3, 4, 5)
    filter := iterium.Accumulate(numbers, sum)

    slice, _ := filter.Slice()
    fmt.Println(slice)
}
```

In this example, `Accumulate()` generates an iterator that outputs the accumulated `sum` of elements from the iterator `numbers`. 

Output:

```
[1 3 6 10 15]
```

It also works fine with **strings**:

```golang
func merge(first, second string) string {
    return fmt.Sprintf("%s-%s", first, second)
}

func main() {
    letters := iterium.New("A", "B", "C", "D")
    filter := iterium.Accumulate(letters, merge)

    slice, _ := filter.Slice()
    fmt.Println(slice)
}
```

Output:

```
["A", "A-B", "A-B-C", "A-B-C-D"]
```

<h2 id="take-while">🔵 iterium.TakeWhile(iter, func)</h2>

`TakeWhile()` returns an iterator that generates elements from an iterator while a given predicate function holds `true`. Once the predicate function returns `false` for an element, `TakeWhile()` stops generating elements.

The function takes two arguments: an iterator and a predicate function. The predicate function should take one argument and return a boolean value.

Here's an example:

```golang
func lessThenSix(x int) bool {
    return x < 6
}

func main() {
    numbers := iterium.New(1, 3, 5, 7, 9, 2, 4, 6, 8)
    filter := iterium.TakeWhile(numbers, lessThenSix)

    slice, _ := filter.Slice()
    fmt.Println(slice)
}
```

Output:

```
[1, 3, 5]
```

In this example, `TakeWhile()` generates an iterator that yields elements from the `numbers` iterator while they are less than 6. Once `TakeWhile()` encounters an element that does not satisfy the predicate (in this case, the number 7), it stops generating elements.

Note that `TakeWhile()` does not apply the predicate function to all elements from the iterator, but only until the first element that fails the condition. In other words, `TakeWhile()` returns an iterator with values satisfying the condition up to a certain point.

<h2 id="drop-while">🔵 iterium.DropWhile(iter, func)</h2>

`DropWhile` returns an iterator that generates elements from an iterator after a given predicate function no longer holds `true`. Once the predicate function returns `false` for an element, `DropWhile` starts generating all the remaining elements.

The function takes two arguments: an iterator and predicate function. The predicate function should take one argument and return a boolean value.

Here's an example:

```golang
func lessThenSix(x int) bool {
    return x < 6
}

func main() {
    numbers := iterium.New(1, 3, 5, 7, 9, 2, 4, 6, 8)
    filter := iterium.DropWhile(numbers, lessThenSix)

    slice, _ := filter.Slice()
    fmt.Println(slice)
}
```

Output:

```
[7, 9, 2, 4, 6, 8]
```

In this example, `DropWhile()` generates an iterator that yields elements from the `numbers` iterator after the first element that is greater than or equal to 6.

**Note** that `DropWhile()` applies the predicate function to all elements from the iterator **until it finds the first element that fails the condition**. Once that happens, it starts generating all the remaining elements from the iterator, regardless of whether they satisfy the predicate function.

`DropWhile()` is often used to skip over elements in an iterator that do not satisfy a certain condition, and start processing or generating elements once the condition is met.

<h1 id="custom">Create your own iterator 🛠️</h1>

You can create your own iterators for your unique tasks. Below is an example of how to do this:

```golang
// CustomStuttering is a custom iterator that repeats
// elements from the iterator 3 times.
func CustomStuttering[T any](iterable iterium.Iter[T]) iterium.Iter[T] {
    total := iterable.Count() * 3
    iter := iterium.Instance[T](total, false)

    go func() {
        defer iter.Close()

        for {
            // Here will be the logic of your iterator...
            next, err := iterable.Next()
            if err != nil {
                return
            }

            // Send each value from the iterator
            // three times to a new channel.
            iter.Chan() <- next
            iter.Chan() <- next
            iter.Chan() <- next
        }
    }()

    return iter
}

func main() {
    numbers := iterium.New(1, 2, 3)
    custom := CustomStuttering(numbers)

    slice, _ := custom.Slice()
    fmt.Println(slice)
    fmt.Println("Total:", custom.Count())
}
```

Output:

```
[1, 1, 1, 2, 2, 2, 3, 3, 3]
```
