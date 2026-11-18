package apigrpc_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRPCAuthenticationInOpenAPI(t *testing.T) {
	data, err := os.ReadFile("apigrpc.swagger.json")
	require.NoError(t, err)
	var spec struct {
		SecurityDefinitions map[string]struct{ Type, Name, In string }
		Paths               map[string]map[string]struct{ Security []map[string][]string }
	}
	require.NoError(t, json.Unmarshal(data, &spec))
	key := spec.SecurityDefinitions["HttpKeyAuth"]
	require.Equal(t, "apiKey", key.Type)
	require.Equal(t, "http_key", key.Name)
	require.Equal(t, "query", key.In)
	for _, method := range []string{"get", "post"} {
		t.Run(method, func(t *testing.T) {
			require.ElementsMatch(t, []map[string][]string{
				{"HttpKeyAuth": {}}, {"BasicAuth": {}}, {"BearerJwt": {}},
			}, spec.Paths["/v2/rpc/{id}"][method].Security)
		})
	}
}
