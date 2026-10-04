import { useEffect, useState } from "react";

const narrowQuery = "(max-width: 760px)";

/** Mobile navigation never changes the saved desktop layout preference. */
export function useSidebarNavigation() {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(narrowQuery).matches ?? false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    try { return localStorage.getItem("agent-room.sidebar-collapsed") === "true"; }
    catch { return false; }
  });
  useEffect(() => {
    const media = window.matchMedia?.(narrowQuery);
    if (!media) return;
    const update = () => { setNarrow(media.matches); setMobileOpen(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return {
    narrow,
    collapsed: narrow ? !mobileOpen : desktopCollapsed,
    closeMobile: () => setMobileOpen(false),
    toggle: () => {
      if (narrow) { setMobileOpen((current) => !current); return; }
      setDesktopCollapsed((current) => {
        try { localStorage.setItem("agent-room.sidebar-collapsed", String(!current)); } catch { /* Current layout still works. */ }
        return !current;
      });
    }
  };
}
