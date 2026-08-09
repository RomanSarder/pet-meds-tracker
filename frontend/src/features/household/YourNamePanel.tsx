// SPEC §6.5 "Your name" — the display name every logged dose is attributed
// to. There is no `/household/name` route (router.ts is frozen), so this
// renders as a full-screen overlay from `HouseholdPage` — SPEC §6 calls it a
// "modal full screen". Transcribed from <SCRATCH>/kit/YourNameScreen.jsx.
import { useState } from "react";
import { Button, Card, PetAvatar } from "@/components/ds";
import { DISPLAY_NAME_MAX, displayNameFor } from "@/domain";
import type { User } from "@/domain";
import { useMembers, useSelf, useSessionEmail, useSetDisplayName } from "./hooks";
import { formatJoinedDate, otherMemberNamesLabel } from "./memberLine";

export interface YourNamePanelProps {
  onClose: () => void;
}

/**
 * Waits for the self row before mounting the form. The field's initial value is
 * `useState(self.displayName)` in the inner component rather than an effect that
 * seeds it afterwards: an effect-based seed lands *after* the first paint, so
 * anything typed in that gap gets clobbered — and a background refetch (every
 * mutation here invalidates the household prefix) would clobber it again.
 * Mounting on data makes both races structurally impossible.
 */
export function YourNamePanel({ onClose }: YourNamePanelProps) {
  const selfQuery = useSelf();
  const self = selfQuery.data ?? null;
  if (!self) {
    return null;
  }
  return <YourNameForm self={self} onClose={onClose} />;
}

function YourNameForm({ self, onClose }: YourNamePanelProps & { self: User }) {
  const membersQuery = useMembers();
  const email = useSessionEmail();
  const setDisplayName = useSetDisplayName();

  const members = membersQuery.data ?? [];

  const [name, setName] = useState(self.displayName);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= DISPLAY_NAME_MAX;
  const previewName = trimmed || "Someone";

  const otherNames = members
    .filter((m) => m.id !== self.id)
    .map((m) => displayNameFor(m.id, members));
  const othersLabel = otherMemberNamesLabel(otherNames);

  async function handleSave() {
    if (!canSave) return;
    await setDisplayName.mutateAsync(name);
    onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your name"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        background: "var(--surface)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 22px 16px",
        }}
      >
        <span style={{ fontSize: 22, fontWeight: 800, color: "var(--ink-1)" }}>Your name</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 20,
            color: "var(--ink-3)",
            padding: 0,
            minWidth: "var(--tap-min)",
            minHeight: "var(--tap-min)",
          }}
        >
          ✕
        </button>
      </div>
      <div
        style={{
          flex: 1,
          padding: "0 22px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          overflowY: "auto",
        }}
      >
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 14 }}>
          <PetAvatar name={previewName} tint={self.tint} size={52} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-1)" }}>
              {previewName}
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
              {`In this household since ${formatJoinedDate(self.joinedAt)}`}
            </div>
          </div>
        </div>
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
            Display name
          </span>
          <div
            style={{
              height: 48,
              borderRadius: "var(--radius-md)",
              border: "2px solid var(--accent)",
              background: "var(--surface)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "0 14px",
            }}
          >
            <input
              value={name}
              maxLength={DISPLAY_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              aria-label="Display name"
              style={{
                flex: 1,
                minWidth: 0,
                border: "none",
                outline: "none",
                background: "transparent",
                fontFamily: "inherit",
                fontSize: 16,
                color: "var(--ink-1)",
              }}
            />
            <span
              style={{ fontSize: 13, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}
            >
              {name.length} / {DISPLAY_NAME_MAX}
            </span>
          </div>
          <span style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
            Shown against every dose you log. {othersLabel} will see the new name everywhere,
            including on doses you logged before.
          </span>
        </div>
        <Card tone="quiet">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
              How it will look
            </span>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div
                style={{
                  width: 46,
                  flexShrink: 0,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--ink-3)",
                  fontVariantNumeric: "tabular-nums",
                  paddingTop: 1,
                }}
              >
                08:04
              </div>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  marginTop: 6,
                  flexShrink: 0,
                  background: "var(--ok)",
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-1)" }}>
                  Metacam 0.4 ml
                </div>
                <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
                  Given · after food
                </div>
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--ink-3)",
                  whiteSpace: "nowrap",
                  paddingTop: 2,
                }}
              >
                by {previewName}
              </div>
            </div>
          </div>
        </Card>
        <div style={{ flexShrink: 0, fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
          {email ? `Signed in as ${email}. ` : ""}
          Your email is never shown to anyone in the household.
        </div>
      </div>
      <div
        style={{
          padding: "12px 22px 22px",
          borderTop: "1px solid var(--line)",
          background: "var(--surface)",
        }}
      >
        <Button
          type="button"
          variant="ink"
          size="lg"
          block
          disabled={!canSave || setDisplayName.isPending}
          onClick={handleSave}
        >
          Save name
        </Button>
      </div>
    </div>
  );
}
