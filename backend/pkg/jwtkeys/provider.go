package jwtkeys

type KeyProvider interface {
	ResolveKey(kid string) ([]byte, error)
	LegacyKey() []byte
}
