import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_VIEW, loadView, saveView, type ViewState } from "@/lib/view";

const ViewContext = createContext<{
  view: ViewState;
  patch: (next: Partial<ViewState>) => void;
  reset: () => void;
} | null>(null);

export function ViewProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewState>(() => loadView());
  useEffect(() => {
    saveView(view);
  }, [view]);
  const patch = (next: Partial<ViewState>) => setView((current) => ({ ...current, ...next }));
  const reset = () => setView(DEFAULT_VIEW);
  return <ViewContext.Provider value={{ view, patch, reset }}>{children}</ViewContext.Provider>;
}

export function useView() {
  const ctx = useContext(ViewContext);
  if (!ctx) throw new Error("View is only available inside the desk");
  return ctx;
}
