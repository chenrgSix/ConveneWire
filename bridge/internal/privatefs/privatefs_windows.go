//go:build windows

package privatefs

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const fileFullControl = 0x1f01ff

func currentOwner() (*windows.SID, error) {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return nil, err
	}
	return user.User.Sid, nil
}

func privateDescriptor(directory bool) (*windows.SECURITY_DESCRIPTOR, error) {
	owner, err := currentOwner()
	if err != nil {
		return nil, err
	}
	flags := ""
	if directory {
		flags = "OICI"
	}
	// Explicit owner avoids the Administrators-group default on elevated tokens.
	return windows.SecurityDescriptorFromString("O:" + owner.String() + "D:P(A;" + flags + ";FA;;;" + owner.String() + ")(A;" + flags + ";FA;;;SY)")
}

func validDescriptor(sd *windows.SECURITY_DESCRIPTOR, directory bool) bool {
	user, err := currentOwner()
	if err != nil || sd == nil {
		return false
	}
	owner, _, err := sd.Owner()
	if err != nil || owner == nil || !owner.Equals(user) {
		return false
	}
	control, _, err := sd.Control()
	if err != nil || control&windows.SE_DACL_PROTECTED == 0 {
		return false
	}
	acl, _, err := sd.DACL()
	if err != nil || acl == nil || acl.AceCount < 1 || acl.AceCount > 2 {
		return false
	}
	seen := map[string]bool{}
	for i := uint32(0); i < uint32(acl.AceCount); i++ {
		var ace *windows.ACCESS_ALLOWED_ACE
		if windows.GetAce(acl, i, &ace) != nil || ace == nil || ace.Header.AceType != windows.ACCESS_ALLOWED_ACE_TYPE || ace.Mask != fileFullControl {
			return false
		}
		allowedFlags := uint8(0)
		if directory {
			allowedFlags = windows.OBJECT_INHERIT_ACE | windows.CONTAINER_INHERIT_ACE
		}
		if ace.Header.AceFlags & ^allowedFlags != 0 {
			return false
		}
		sid := (*windows.SID)(unsafe.Pointer(&ace.SidStart))
		if !sid.IsValid() || (!sid.Equals(user) && !sid.IsWellKnown(windows.WinLocalSystemSid)) || seen[sid.String()] {
			return false
		}
		seen[sid.String()] = true
	}
	return seen[user.String()]
}

func inspectHandle(handle windows.Handle, directory, private bool) error {
	var info windows.ByHandleFileInformation
	if windows.GetFileInformationByHandle(handle, &info) != nil || info.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 ||
		(info.FileAttributes&windows.FILE_ATTRIBUTE_DIRECTORY != 0) != directory || (!directory && info.NumberOfLinks != 1) {
		return ErrProtection
	}
	kind, err := windows.GetFileType(handle)
	if err != nil || kind != windows.FILE_TYPE_DISK {
		return ErrProtection
	}
	if private {
		sd, err := windows.GetSecurityInfo(handle, windows.SE_FILE_OBJECT, windows.OWNER_SECURITY_INFORMATION|windows.DACL_SECURITY_INFORMATION)
		if err != nil || !validDescriptor(sd, directory) {
			return ErrProtection
		}
	}
	return nil
}

func pathName(target string) (string, error) {
	absolute, err := filepath.Abs(target)
	volume := filepath.VolumeName(absolute)
	// Network shares, device namespaces and alternate streams are not private stores.
	if err != nil || len(volume) != 2 || volume[1] != ':' || strings.ContainsAny(absolute[2:], ":\x00") {
		return "", ErrProtection
	}
	return absolute, nil
}

// Pin every ancestor without write/delete sharing. Reparse traversal and replacing
// an ancestor during the child create/read window cannot redirect private bytes.
func lockParents(target string) (string, func(), error) {
	absolute, err := pathName(target)
	if err != nil {
		return "", nil, err
	}
	var handles []windows.Handle
	release := func() {
		for i := len(handles) - 1; i >= 0; i-- {
			windows.CloseHandle(handles[i])
		}
	}
	var paths []string
	for parent := filepath.Dir(absolute); ; parent = filepath.Dir(parent) {
		paths = append(paths, parent)
		if filepath.Dir(parent) == parent {
			break
		}
	}
	for i := len(paths) - 1; i >= 0; i-- {
		name, err := windows.UTF16PtrFromString(paths[i])
		if err != nil {
			release()
			return "", nil, err
		}
		handle, err := windows.CreateFile(name, windows.FILE_READ_ATTRIBUTES|windows.READ_CONTROL, windows.FILE_SHARE_READ, nil,
			windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
		if err != nil {
			release()
			return "", nil, err
		}
		handles = append(handles, handle)
		if err := inspectHandle(handle, true, false); err != nil {
			release()
			return "", nil, err
		}
		var flags uint32
		if windows.GetVolumeInformationByHandle(handle, nil, 0, nil, nil, &flags, nil, 0) != nil || flags&windows.FILE_PERSISTENT_ACLS == 0 {
			release()
			return "", nil, ErrProtection
		}
	}
	return absolute, release, nil
}

func attributes(sd *windows.SECURITY_DESCRIPTOR) *windows.SecurityAttributes {
	return &windows.SecurityAttributes{Length: uint32(unsafe.Sizeof(windows.SecurityAttributes{})), SecurityDescriptor: sd}
}

func EnsureDirectory(target string) error { return ensureDirectory(target, false) }

// CreateDirectory creates its protected DACL before any private child is written.
func CreateDirectory(target string) error { return ensureDirectory(target, true) }

func ensureDirectory(target string, exclusive bool) error {
	absolute, release, err := lockParents(target)
	if err != nil {
		return err
	}
	defer release()
	sd, err := privateDescriptor(true)
	if err != nil {
		return err
	}
	name, err := windows.UTF16PtrFromString(absolute)
	if err != nil {
		return err
	}
	if err := windows.CreateDirectory(name, attributes(sd)); err != nil && (exclusive || !errors.Is(err, windows.ERROR_ALREADY_EXISTS)) {
		return err
	}
	handle, err := windows.CreateFile(name, windows.FILE_READ_ATTRIBUTES|windows.READ_CONTROL, windows.FILE_SHARE_READ, nil,
		windows.OPEN_EXISTING, windows.FILE_FLAG_BACKUP_SEMANTICS|windows.FILE_FLAG_OPEN_REPARSE_POINT, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(handle)
	return inspectHandle(handle, true, true)
}

func createFile(target string) (*os.File, func(), error) {
	return privateFile(target, true)
}

func openFile(target string) (*os.File, func(), error) {
	return privateFile(target, false)
}

func privateFile(target string, create bool) (*os.File, func(), error) {
	absolute, release, err := lockParents(target)
	if err != nil {
		return nil, nil, err
	}
	name, err := windows.UTF16PtrFromString(absolute)
	if err != nil {
		release()
		return nil, nil, err
	}
	desired, disposition := uint32(windows.GENERIC_READ|windows.READ_CONTROL), uint32(windows.OPEN_EXISTING)
	var security *windows.SecurityAttributes
	if create {
		sd, err := privateDescriptor(false)
		if err != nil {
			release()
			return nil, nil, err
		}
		security = attributes(sd)
		desired, disposition = windows.GENERIC_WRITE|windows.READ_CONTROL, windows.CREATE_NEW
	}
	handle, err := windows.CreateFile(name, desired, windows.FILE_SHARE_READ, security, disposition,
		windows.FILE_FLAG_OPEN_REPARSE_POINT|windows.FILE_FLAG_BACKUP_SEMANTICS, 0)
	if err != nil {
		release()
		return nil, nil, err
	}
	if err := inspectHandle(handle, false, true); err != nil {
		windows.CloseHandle(handle)
		if create {
			windows.DeleteFile(name)
		}
		release()
		return nil, nil, err
	}
	return os.NewFile(uintptr(handle), absolute), release, nil
}
