import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { ToastProvider, useToast, type ToastHandle } from "./Toast";

type ToastApi = ReturnType<typeof useToast>;

function Harness({ capture }: { capture: (api: ToastApi) => void }) {
  const api = useToast();
  capture(api);
  return null;
}

function renderToastHarness() {
  let api: ToastApi | null = null;
  render(
    <ToastProvider>
      <Harness
        capture={(a) => {
          api = a;
        }}
      />
    </ToastProvider>
  );
  return () => {
    if (!api) throw new Error("toast api was not captured");
    return api;
  };
}

describe("ToastProvider / useToast", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the message passed to show()", () => {
    const getApi = renderToastHarness();

    act(() => {
      getApi().show({ message: "Dose logged" });
    });

    expect(screen.getByText("Dose logged")).toBeInTheDocument();
  });

  it("replaces the current toast when show() is called again", () => {
    const getApi = renderToastHarness();

    act(() => {
      getApi().show({ message: "First" });
    });
    act(() => {
      getApi().show({ message: "Second" });
    });

    expect(screen.queryByText("First")).not.toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("fires onAction when the action button is pressed", () => {
    const getApi = renderToastHarness();
    const onAction = vi.fn();

    act(() => {
      getApi().show({ message: "Dose logged", actionLabel: "Undo", onAction });
    });
    fireEvent.click(screen.getByText("Undo"));

    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("dismisses via the returned handle", () => {
    const getApi = renderToastHarness();
    let handle: ToastHandle | undefined;

    act(() => {
      handle = getApi().show({ message: "Bye" });
    });
    act(() => {
      handle?.dismiss();
    });

    expect(screen.queryByText("Bye")).not.toBeInTheDocument();
  });

  it("auto-dismisses after durationMs", () => {
    vi.useFakeTimers();
    const getApi = renderToastHarness();

    act(() => {
      getApi().show({ message: "Timed out", durationMs: 1_000 });
    });
    expect(screen.getByText("Timed out")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.queryByText("Timed out")).not.toBeInTheDocument();
  });

  it("clears its timer on replacement rather than firing the earlier dismissal", () => {
    vi.useFakeTimers();
    const getApi = renderToastHarness();

    act(() => {
      getApi().show({ message: "First", durationMs: 1_000 });
    });
    act(() => {
      vi.advanceTimersByTime(600);
      getApi().show({ message: "Second", durationMs: 1_000 });
    });
    // The first toast's timer would have fired at 1000ms; if it were not
    // cleared on replacement it would incorrectly clear "Second" too.
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("throws a clear error when useToast is used outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Bare() {
      useToast();
      return null;
    }

    expect(() => render(<Bare />)).toThrow(
      "useToast must be used within a ToastProvider"
    );

    spy.mockRestore();
  });
});
