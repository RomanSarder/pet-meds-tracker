// The kit's `Field` is a display `div`; this promotes it to a real `<input>`
// bound to a real `<label>` — see CONTRACT.md §3.
import { useId, type ComponentProps, type CSSProperties } from "react";

export interface FieldProps extends Omit<ComponentProps<"input">, "style"> {
  label: string;
  /** Shown under the box; also sets aria-invalid and aria-describedby. */
  error?: string | null;
  style?: CSSProperties;
}

export function Field({ label, error, style, id, ...inputProps }: FieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, ...style }}>
      <label
        htmlFor={inputId}
        style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}
      >
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={errorId}
        style={{
          height: 48,
          borderRadius: "var(--radius-md)",
          border: error ? "1px solid var(--alert-line)" : "1px solid var(--line-strong)",
          background: "var(--surface)",
          padding: "0 14px",
          fontSize: 16,
          color: "var(--ink-1)",
          fontFamily: "var(--font-sans)",
          width: "100%",
          boxSizing: "border-box",
        }}
        {...inputProps}
      />
      {error ? (
        <div id={errorId} style={{ fontSize: 13, color: "var(--alert)" }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
