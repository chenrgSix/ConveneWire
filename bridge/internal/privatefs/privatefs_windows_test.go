//go:build windows

package privatefs

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestWindowsProtectionExistsBeforeContentWrite(t *testing.T) {
	target := filepath.Join(t.TempDir(), "empty-private")
	file, release, err := createFile(target)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	defer file.Close()
	if err := inspectHandle(windows.Handle(file.Fd()), false, true); err != nil {
		t.Fatal(err)
	}
	info, _ := file.Stat()
	if info.Size() != 0 {
		t.Fatal("validation did not precede writing")
	}
	if err := os.Rename(filepath.Dir(target), filepath.Dir(target)+"-moved"); err == nil {
		t.Fatal("parent replaced while private handle held")
	}
}

func TestWindowsDescriptorRejectsForeignNullBroadOrInheritedAuthority(t *testing.T) {
	owner, err := currentOwner()
	if err != nil {
		t.Fatal(err)
	}
	id := owner.String()
	for _, value := range []string{
		"O:SYD:P(A;;FA;;;" + id + ")",
		"O:" + id + "D:P(A;;FA;;;WD)",
		"O:" + id + "D:P(A;;FA;;;" + id + ")(A;;FR;;;BU)",
		"O:" + id + "D:(A;;FA;;;" + id + ")",
		"O:" + id + "D:P(A;ID;FA;;;" + id + ")",
		"O:" + id + "D:P",
		"O:" + id,
	} {
		sd, err := windows.SecurityDescriptorFromString(value)
		if err != nil {
			t.Fatal(err)
		}
		if validDescriptor(sd, false) {
			t.Fatalf("accepted unsafe descriptor: %s", value)
		}
	}
}

func TestWindowsRejectsWidenedFileAndExistingDirectoryWithoutRepair(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "private")
	if err := EnsureDirectory(dir); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(dir, "candidate")
	if err := WriteFile(target, []byte("untouched")); err != nil {
		t.Fatal(err)
	}
	owner, _ := currentOwner()
	sd, err := windows.SecurityDescriptorFromString("O:" + owner.String() + "D:P(A;;FA;;;" + owner.String() + ")(A;;FR;;;WD)")
	if err != nil {
		t.Fatal(err)
	}
	acl, _, _ := sd.DACL()
	for _, item := range []string{target, dir} {
		if err := windows.SetNamedSecurityInfo(item, windows.SE_FILE_OBJECT,
			windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
			t.Fatal(err)
		}
	}
	before, err := windows.GetNamedSecurityInfo(dir, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ReadFile(target, 64); err == nil {
		t.Fatal("read weakened private file")
	}
	if err := EnsureDirectory(dir); err == nil {
		t.Fatal("reused or silently repaired weak private directory")
	}
	actual, err := windows.GetNamedSecurityInfo(dir, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil || actual.String() != before.String() {
		t.Fatalf("directory ACL was changed: %v %v", actual, err)
	}
	data, _ := os.ReadFile(target)
	if string(data) != "untouched" {
		t.Fatal("content changed")
	}
}

func TestWindowsRejectsJunctionAncestorsAndHardlinks(t *testing.T) {
	root := t.TempDir()
	dir, junction := filepath.Join(root, "private"), filepath.Join(root, "junction")
	if err := EnsureDirectory(dir); err != nil {
		t.Fatal(err)
	}
	if output, err := exec.Command("cmd.exe", "/c", "mklink", "/J", junction, dir).CombinedOutput(); err != nil {
		t.Fatalf("junction fixture failed: %v %s", err, output)
	}
	defer os.Remove(junction)
	if err := EnsureDirectory(junction); err == nil {
		t.Fatal("accepted junction directory")
	}
	if err := WriteFile(filepath.Join(junction, "candidate"), []byte("private")); err == nil {
		t.Fatal("followed junction ancestor")
	}
	target, alias := filepath.Join(dir, "original"), filepath.Join(root, "alias")
	if err := WriteFile(target, []byte("keep")); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(target, alias); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadFile(target, 64); err == nil {
		t.Fatal("accepted hardlinked private file")
	}
	if _, err := ReadFile(filepath.Join(junction, "original"), 64); err == nil {
		t.Fatal("read through junction ancestor")
	}
}

func TestWindowsRejectsDeviceNetworkAndAlternateStreamPaths(t *testing.T) {
	for _, value := range []string{`\\server\share\candidate`, `\\?\C:\candidate`, `C:\candidate:stream`} {
		if _, err := pathName(value); err == nil {
			t.Fatalf("accepted unsupported private path %s", value)
		}
	}
}
