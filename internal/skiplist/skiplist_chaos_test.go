package skiplist

import (
	"fmt"
	"math/rand"
	"sort"
	"testing"

	"github.com/stretchr/testify/require"
)

func randString(t *testing.T, rnd *rand.Rand) string {
	b := make([]byte, 16)
	_, err := rnd.Read(b)
	require.NoError(t, err)

	return fmt.Sprintf("%X-%X-%X-%X-%X", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

type testInterface struct {
	id  string
	val int
}

func (ti testInterface) Less(other interface{}) bool {
	otherTi := other.(testInterface)

	if ti.val < otherTi.val {
		return true
	}

	if ti.val > otherTi.val {
		return false
	}

	return ti.id < otherTi.id
}

func TestSkiplistChaos(t *testing.T) {
	rnd := rand.New(rand.NewSource(0))
	iterations := 20

	for i := 0; i < iterations; i++ {
		numUsers := rnd.Intn(2000) + 100
		users := make([]string, numUsers)

		for j := 0; j < numUsers; j++ {
			users[j] = randString(t, rnd)
		}

		numOps := rnd.Intn(100_000) + 100
		ops := make([]testInterface, numOps)

		for j := 0; j < numOps; j++ {
			id := users[rnd.Intn(numUsers)]
			ops[j] = testInterface{
				id:  id,
				val: rnd.Intn(999) + 1,
			}
		}

		numLists := rnd.Intn(47) + 3
		lists := make([]*SkipList, numLists)
		userOps := make([]map[string]testInterface, numLists)

		fmt.Printf("** iteration=%v, users=%v, ops=%v, lists=%v\n", i, numUsers, numOps, numLists)

		// Populate lists
		for j := 0; j < numLists; j++ {
			rnd.Shuffle(len(ops), func(i, j int) {
				ops[i], ops[j] = ops[j], ops[i]
			})

			userOps[j] = make(map[string]testInterface, numUsers)

			lists[j] = New()
			for _, op := range ops {
				oldOp, ok := userOps[j][op.id]
				if ok {
					lists[j].Delete(oldOp)
					op.val += oldOp.val
				}

				lists[j].Insert(op)
				userOps[j][op.id] = op
			}
		}

		// Now verify
		for j, sl := range lists {
			listOps := make([]testInterface, 0, len(ops))

			for _, op := range userOps[j] {
				listOps = append(listOps, op)
			}

			sort.Slice(listOps, func(i, j int) bool {
				return listOps[i].Less(listOps[j])
			})

			for idx, op := range listOps {
				rank := idx + 1

				listRank := sl.GetRank(op)
				require.Equal(t, rank, listRank, "list %d, unexpected rank for op %+v", j, op)
			}
		}
	}
}
