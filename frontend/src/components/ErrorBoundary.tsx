import { Component, type ErrorInfo, type ReactNode } from "react";
import { currentTranslator } from "@/i18n/current";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// This screen renders when everything else has already failed, so it must
// never itself throw. A class component cannot call `useT()` (no hooks), and
// this runs outside any guaranteed-mounted `<LocaleProvider>` (the boundary
// can sit above it, or the provider itself could be what threw) — so it uses
// the non-React `currentTranslator()` accessor instead, and — the load-
// bearing part — wraps that call in try/catch with a hard-coded English
// fallback. `currentTranslator()` is documented as tolerant of a throwing
// `localStorage` (I18N-DESIGN.md §2.1/§2.5), but this degrades safely even if
// that contract is ever violated, rather than trusting it blindly here of all
// places.
function boundaryCopy(): { title: string; tryAgain: string } {
  try {
    const tr = currentTranslator();
    return { title: tr.t("errorBoundary.title"), tryAgain: tr.t("errorBoundary.tryAgain") };
  } catch {
    return { title: "Something went wrong", tryAgain: "Try again" };
  }
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.error) {
      const copy = boundaryCopy();
      return (
        <div className="flex min-h-screen items-center justify-center p-8">
          <div className="text-center">
            <p className="text-lg font-semibold text-red-600">{copy.title}</p>
            <p className="mt-2 text-sm text-gray-500">{this.state.error.message}</p>
            <button
              className="mt-4 text-sm text-blue-600 underline"
              onClick={() => this.setState({ error: null })}
            >
              {copy.tryAgain}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
