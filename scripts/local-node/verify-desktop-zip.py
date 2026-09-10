"""Validate desktop ZIP paths before any extraction on a release worker."""
import stat
import sys
import zipfile


def verify_desktop_zip(archive, package):
    seen = set()
    files = set()
    with zipfile.ZipFile(archive) as bundle:
        for entry in bundle.infolist():
            name = entry.filename
            parts = name.rstrip("/").split("/")
            if (not name or any(ord(c) < 32 for c in name) or "\\" in name
                    or ":" in name or any(p in ("", ".", "..") for p in parts)
                    or parts[0] != package or entry.flag_bits & 1):
                raise ValueError("Unsafe desktop ZIP path or encrypted entry")
            key = name.rstrip("/").casefold()
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or key in seen:
                raise ValueError("Duplicate or unsupported desktop ZIP entry")
            if kind == stat.S_IFDIR and not entry.is_dir():
                raise ValueError("Desktop ZIP directory type mismatch")
            seen.add(key)
            if not entry.is_dir():
                files.add(key)
        for name in seen:
            parts = name.split("/")
            if any("/".join(parts[:i]) in files for i in range(1, len(parts))):
                raise ValueError("Desktop ZIP file shadows a directory")
        if not files:
            raise ValueError("Empty desktop ZIP")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: verify-desktop-zip.py ARCHIVE PACKAGE")
    verify_desktop_zip(sys.argv[1], sys.argv[2])
