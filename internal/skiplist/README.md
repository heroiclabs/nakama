skiplist
===============

reference from redis [zskiplist](https://github.com/antirez/redis)


Usage
===============

~~~Go

package main

import (
	"fmt"
	"github.com/gansidui/skiplist"
	"log"
)

type User struct {
	score float64
	id    string
}

func (u *User) Less(other interface{}) bool {
	if u.score > other.(*User).score {
		return true
	}
	if u.score == other.(*User).score && len(u.id) > len(other.(*User).id) {
		return true
	}
	return false
}

func main() {
	us := make([]*User, 7)
	us[0] = &User{6.6, "hi"}
	us[1] = &User{4.4, "hello"}
	us[2] = &User{2.2, "world"}
	us[3] = &User{3.3, "go"}
	us[4] = &User{1.1, "skip"}
	us[5] = &User{2.2, "list"}
	us[6] = &User{3.3, "lang"}

	// insert
	sl := skiplist.New()
	for i := 0; i < len(us); i++ {
		sl.Insert(us[i])
	}

	// traverse
	for e := sl.Front(); e != nil; e = e.Next() {
		fmt.Println(e.Value.(*User).id, "-->", e.Value.(*User).score)
	}
	fmt.Println()

	// rank
	rank1 := sl.GetRank(&User{2.2, "list"})
	rank2 := sl.GetRank(&User{6.6, "hi"})
	if rank1 != 6 || rank2 != 1 {
		log.Fatal()
	}
	if e := sl.GetElementByRank(2); e.Value.(*User).score != 4.4 || e.Value.(*User).id != "hello" {
		log.Fatal()
	}
}

/* output:

hi --> 6.6
hello --> 4.4
lang --> 3.3
go --> 3.3
world --> 2.2
list --> 2.2
skip --> 1.1

*/

~~~


License
===============

MIT