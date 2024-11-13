package ctxkeys

// Keys used for storing/retrieving user information in the context of a request after authentication.
type UserIDKey struct{}
type UsernameKey struct{}
type VarsKey struct{}
type ExpiryKey struct{}
type TokenIDKey struct{}
type TokenIssuedAtKey struct{}
