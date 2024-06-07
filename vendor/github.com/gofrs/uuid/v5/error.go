package uuid

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
)

// Error returns the string representation of the UUID error.
func (e Error) Error() string {
	return string(e)
}
