import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
// `@/test` has no barrel (index) file yet, so this imports the concrete
// module directly rather than the bare `@/test` specifier the brief
// describes — see the final report for why.
import { renderWithProviders, userEvent } from "@/test/renderWithProviders";
import { Field } from "./Field";

describe("Field", () => {
  // The router underlying `renderWithProviders` resolves its first match
  // asynchronously (see renderWithProviders.test.tsx), so the first query in
  // every test must be a `findBy*`, not a `getBy*`.

  it("uses the label as the input's accessible name", async () => {
    renderWithProviders(<Field label="Weight" />);
    expect(await screen.findByLabelText("Weight")).toBeInstanceOf(HTMLInputElement);
  });

  it("updates the value when typing", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Field label="Weight" />);
    const input = await screen.findByLabelText("Weight");
    await user.type(input, "1.9");
    expect(input).toHaveValue("1.9");
  });

  it("renders the error message and marks the input invalid when error is set", async () => {
    renderWithProviders(<Field label="Weight" error="Required" />);
    const input = await screen.findByLabelText("Weight");
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("does not mark the input invalid when error is absent", async () => {
    renderWithProviders(<Field label="Weight" />);
    const input = await screen.findByLabelText("Weight");
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});
