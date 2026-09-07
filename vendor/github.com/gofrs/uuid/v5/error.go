package uuid

import "fmt"

// Error is a custom error type for UUID-related errors
type Error string

// The strings defined in the errors is matching the previous behavior before
// the custom error type was implemented. The reason is that some people might
// be relying on the exact string representation to handle errors in their code.
const (
	// ErrInvalidFormat is returned when the UUID string representation does not
	// match the expected format. See also ErrIncorrectFormatInString.
	ErrInvalidFormat = Error("uuid: invalid UUID format")

	// ErrIncorrectFormatInString can be returned instead of ErrInvalidFormat.
	// A separate error type is used because of how errors used to be formatted
	// before custom error types were introduced.
	ErrIncorrectFormatInString = Error("uuid: incorrect UUID format in string")

	// ErrIncorrectLength is returned when the UUID does not have the
	// appropriate string length for parsing the UUID.
	ErrIncorrectLength = Error("uuid: incorrect UUID length")

	// ErrIncorrectByteLength indicates the UUID byte slice length is invalid.
	ErrIncorrectByteLength = Error("uuid: UUID must be exactly 16 bytes long")

	// ErrNoHwAddressFound is returned when a hardware (MAC) address cannot be
	// found for UUID generation.
	ErrNoHwAddressFound = Error("uuid: no HW address found")

	// ErrTypeConvertError is returned for type conversion operation fails.
	ErrTypeConvertError = Error("uuid: cannot convert")

	// ErrInvalidVersion indicates an unsupported or invalid UUID version.
	ErrInvalidVersion = Error("uuid:")

	// ErrV8FieldLength indicates a V8 custom field has incorrect length.
	ErrV8FieldLength = Error("uuid: V8 field has incorrect length")
)

// Wrapped errors for backward compatibility. These wrap ErrIncorrectFormatInString
// so code like errors.Is(err, uuid.ErrIncorrectFormatInString) continues to work.
var (
	// ErrInvalidBraces is returned when braced format has invalid braces.
	ErrInvalidBraces = fmt.Errorf("%w: invalid braces", ErrIncorrectFormatInString)

	// ErrInvalidURNPrefix is returned when URN format has invalid prefix.
	ErrInvalidURNPrefix = fmt.Errorf("%w: invalid URN prefix", ErrIncorrectFormatInString)

	// ErrInvalidDashes is returned when canonical format has dashes not in expected positions.
	ErrInvalidDashes = fmt.Errorf("%w: dashes were not in expected positions", ErrIncorrectFormatInString)
)

// Error returns the string representation of the UUID error.
func (e Error) Error() string {
	return string(e)
}
