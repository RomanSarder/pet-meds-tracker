import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/renderWithProviders";
import { createMemoryRepo } from "@/data/memoryRepo";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { PetsPage } from "@/features/pets/PetsPage";
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

describe("setLocale — round trip and cross-screen re-render", () => {
  it("switching back to Ukrainian after English also persists across a reload", async () => {
    const user = userEvent.setup();
    const { unmount: unmount1 } = render(
      <LocaleProvider initialLocale="uk">
        <Probe />
      </LocaleProvider>,
    );

    await user.click(screen.getByText("go-en"));
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    unmount1();

    // Reload #1: lands on the persisted English.
    document.documentElement.lang = "";
    const { unmount: unmount2 } = render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("en");

    // Switch back to Ukrainian, then reload again.
    await user.click(screen.getByText("go-uk"));
    expect(screen.getByTestId("locale").textContent).toBe("uk");
    expect(screen.getByTestId("today").textContent).toBe("Сьогодні");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("uk");
    expect(document.documentElement.lang).toBe("uk");
    unmount2();

    // Reload #2: the switch back also survived, not just the first switch.
    document.documentElement.lang = "";
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("uk");
    expect(document.documentElement.lang).toBe("uk");
  });

  // I18N-DESIGN.md §2.7 / SPEC §12: "Switching language re-renders every
  // screen." A single Probe component proves the hook re-renders; it does
  // not prove a SECOND, independent screen sharing the same provider
  // re-renders too — a bug scoped to one screen's own subscription could
  // still pass that narrower test. This mounts two real, unrelated screens
  // (Settings, which owns the control, and Pets, which does not) under one
  // provider and flips the language from Settings' own UI.
  it("re-renders a second, unrelated screen sharing the same provider, not just the control's own screen", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <SettingsPage />
        <PetsPage />
      </>,
      { repo: createMemoryRepo(), locale: "uk" },
    );

    expect(await screen.findByText("Налаштування")).toBeInTheDocument();
    expect(await screen.findByText("Тварини")).toBeInTheDocument();
    expect(screen.getByText("Домогосподарство · 2 особи")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "English" }));

    // Settings' own screen updated…
    expect(await screen.findByText("Settings")).toBeInTheDocument();
    expect(screen.queryByText("Налаштування")).not.toBeInTheDocument();
    // …and so did Pets, which has no idea the language control exists.
    expect(await screen.findByText("Pets")).toBeInTheDocument();
    expect(screen.queryByText("Тварини")).not.toBeInTheDocument();
    expect(screen.getByText("Household · 2 people")).toBeInTheDocument();
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
