package console

import _ "embed"

// NativeSpaceNavigationScript is shared by page loading and the native shell.
// Loading it with the Room and Console avoids Windows Wails URL-window JS
// injection and runtime-ready dependencies. It installs once per document.
//
//go:embed static/native-navigation.js
var NativeSpaceNavigationScript string
