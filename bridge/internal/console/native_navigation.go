package console

import _ "embed"

// NativeSpaceNavigationScript is shared by page loading and the native shell.
// Loading it with the Console avoids Windows Wails URL-window JS injection and
// runtime-ready dependencies. The script installs at most once per document.
//
//go:embed static/native-navigation.js
var NativeSpaceNavigationScript string
