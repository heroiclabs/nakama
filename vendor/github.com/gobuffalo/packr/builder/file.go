package builder

type file struct {
	Name     string
	Contents string
}

func (f file) String() string {
	return f.Name
}
