import { useLayoutEffect, type RefObject } from "react";

export function useComposerHeight(ref: RefObject<HTMLTextAreaElement | null>, content: string, scope: string) {
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    const resize = () => {
      input.style.height = "0px";
      const height = Math.min(160, Math.max(42, input.scrollHeight));
      input.style.height = `${height}px`;
      input.style.overflowY = input.scrollHeight > height ? "auto" : "hidden";
    };
    resize();
    let width = input.clientWidth;
    const observer = typeof window.ResizeObserver === "function" ? new window.ResizeObserver(() => {
      if (input.clientWidth === width) return;
      width = input.clientWidth;
      resize();
    }) : null;
    observer?.observe(input);
    return () => observer?.disconnect();
  }, [ref, content, scope]);
}
