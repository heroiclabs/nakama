# Generic KVStore implementation tests

These are a set of common tests that should pass on any correct KVStore implementation.

Each test function in this package has the form:

    func CommonTest<name>(t *testing.T, s store.KVStore) {...}

A KVStore implementation test should use the same name, including its own KVStore name in the test function.  It should instantiate an instance of the store, and pass the testing.T and store to the common function.

The common test functions should *NOT* close the KVStore.  The KVStore test implementation should close the store and cleanup any state.