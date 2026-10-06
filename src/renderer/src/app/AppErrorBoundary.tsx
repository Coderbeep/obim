import { Component, type ErrorInfo, type ReactNode } from "react";

import { RecoveryState } from "@renderer/shared/ui/RecoveryState";

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Obim could not render the application:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="flex h-screen items-center justify-center bg-[var(--surface-canvas)] p-6">
        <RecoveryState
          title="Obim couldn't display this workspace"
          description="Your files have not been removed. Reload the app to restore the interface; any note that had already saved remains on disk."
          actionLabel="Reload Obim"
          onAction={() => window.location.reload()}
        />
      </main>
    );
  }
}
