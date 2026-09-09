package ownership

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestAuthorityPartitionBorrowsRootLeaseAndCannotBecomeAnIndependentOwner(t *testing.T) {
	root := t.TempDir()
	partition := filepath.Join(root, "authorities", "node_fixture001")
	if err := os.MkdirAll(partition, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "authorities", "primary.json"), []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	owner, err := Acquire(root)
	if err != nil {
		t.Fatal(err)
	}
	defer owner.Release()
	if another, err := Acquire(partition); err == nil {
		_ = another.Release()
		t.Fatal("partition bypassed the root owner")
	}
	_, release, err := AcquireContext(WithOwner(context.Background(), owner), partition)
	if err != nil {
		t.Fatal(err)
	}
	if err := release(); err != nil {
		t.Fatal(err)
	}
	if another, err := Acquire(root); err == nil {
		_ = another.Release()
		t.Fatal("borrower released core ownership")
	}
}
