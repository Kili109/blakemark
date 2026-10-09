import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Desk } from "../src/components/desk";
import "./app.css";

if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout !== "function") {
  AbortSignal.timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  };
}

class Boundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : "The desk failed to start." };
  }

  render() {
    if (this.state.message) {
      return (
        <main className="mx-auto min-h-screen max-w-lg px-4 py-8">
          <p className="text-xs tracking-widest text-accent uppercase">Blakemark</p>
          <h1 className="mt-2 font-display text-3xl">Could not open the desk</h1>
          <p className="mt-3 text-sm text-down">{this.state.message}</p>
        </main>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 },
  },
});

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <QueryClientProvider client={queryClient}>
      <Boundary>
        <Desk />
      </Boundary>
    </QueryClientProvider>,
  );
}
