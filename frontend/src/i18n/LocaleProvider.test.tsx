import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LOCALE_STORAGE_KEY, readStoredLocale } from "./locale";
import { LocaleProvider, useLocale, useT, useTranslator } from "./LocaleProvider";

function Probe() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="today">{t("nav.today")}</span>
      <button onClick={() => setLocale("en")}>go-en</button>
      <button onClick={() => setLocale("uk")}>go-uk</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "";
});

describe("LocaleProvider resolution", () => {
  it("with no stored preference and no initialLocale, resolves to Ukrainian (DEFAULT_LOCALE)", () => {
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("uk");
    expect(screen.getByTestId("today").textContent).toBe("Сьогодні");
  });

  it("a stored 'en' resolves to English when no initialLocale is given", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("en");
  });

  it("a junk stored value falls back to Ukrainian", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "fr");
    expect(readStoredLocale()).toBeNull();
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("uk");
  });

  it("initialLocale overrides storage", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "uk");
    render(
      <LocaleProvider initialLocale="en">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("en");
  });

  it("sets document.documentElement.lang on mount", () => {
    render(
      <LocaleProvider initialLocale="en">
        <Probe />
      </LocaleProvider>,
    );
    expect(document.documentElement.lang).toBe("en");
  });
});

describe("setLocale", () => {
  it("persists to localStorage, re-renders the tree, and updates document.documentElement.lang; a remount still reads the stored language", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <LocaleProvider initialLocale="uk">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("uk");

    await user.click(screen.getByText("go-en"));

    expect(screen.getByTestId("locale").textContent).toBe("en");
    expect(screen.getByTestId("today").textContent).toBe("Today");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");

    // Simulate a reload: unmount, then render fresh with no initialLocale.
    unmount();
    document.documentElement.lang = "";
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});

describe("useTranslator outside a provider", () => {
  function Bare() {
    useTranslator();
    return null;
  }

  it("throws a clear developer-facing error", () => {
    // Expected: React logs the thrown error to console.error even when the
    // test catches it — suppress that expected noise for this one assertion.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<Bare />)).toThrow(/LocaleProvider/);
    } finally {
      spy.mockRestore();
    }
  });
});
