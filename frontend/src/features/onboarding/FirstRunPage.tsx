// SPEC §6.9 First run — the one screen in this wave with no kit composition, so
// it is composed in the established house style rather than transcribed: plain
// factual voice, no emoji, sentence case, cards with a hairline and never a
// shadow, terracotta reserved for the action. See CONTRACT-W8.md §5.4.
//
// SPEC §6.9: "After the magic link is confirmed and before anything else, one
// screen." One screen means one screen — no carousel, no permission prompts.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ds";
import { DISPLAY_NAME_MAX } from "@/domain";
import { getRepo } from "@/data";
import { apiClient } from "@/shared/api";
import { Field } from "@/features/forms/Field";
import { needsDisplayName, useSelf, useSessionEmail, useSetDisplayName } from "@/features/household/hooks";
import { suggestNameFromEmail } from "./nameSuggestion";

const NAME_INPUT_ID = "first-run-name";

export function FirstRunPage() {
  const navigate = useNavigate();

  const selfQuery = useSelf();
  const sessionEmail = useSessionEmail();
  const setDisplayName = useSetDisplayName();

  // SPEC §6.9 / §5: "Start a household" is the one place a server-side
  // household gets created. `id` is the household this device already
  // created locally on first DB open (W5's stub) — sending it here, instead
  // of letting the server mint its own, is what keeps the local and server
  // rows the same id (SPEC §9: client-generated, no dependency on
  // server-assigned ids) rather than needing a mapping between two. The
  // route is idempotent for a caller who already has a household, so
  // re-submitting (e.g. revisiting /welcome) is harmless.
  const provisionHousehold = useMutation({
    mutationFn: async (displayName: string) => {
      const householdId = await getRepo().currentHouseholdId();
      await apiClient("/household", {
        method: "POST",
        body: JSON.stringify({ id: householdId, displayName }),
      });
    },
  });

  const [name, setName] = useState("");
  // Stops recomputing the suggestion the moment the person edits the field, so a
  // late-resolving session cannot overwrite what they typed. The suggestion is
  // "an editable suggestion" (SPEC §5), not a value we keep forcing back.
  const hasEditedName = useRef(false);

  useEffect(() => {
    if (hasEditedName.current || !selfQuery.data) return;
    const self = selfQuery.data;
    setName(needsDisplayName(self) ? suggestNameFromEmail(sessionEmail) : self.displayName);
  }, [selfQuery.data, sessionEmail]);

  const trimmed = name.trim();

  // SPEC §5: "Skippable only if the user has no household yet and is alone" —
  // which is exactly the situation this screen exists in, so both routes forward
  // stay open with an empty name. The name becomes mandatory at the point of the
  // first invite, which HouseholdPage enforces via `needsDisplayName`.
  async function saveNameIfGiven() {
    if (trimmed.length > 0) {
      await setDisplayName.mutateAsync(trimmed);
    }
  }

  async function handleStartHousehold() {
    await saveNameIfGiven();
    try {
      await provisionHousehold.mutateAsync(trimmed);
    } catch {
      // No error UI is specified for this screen (mirrors JoinHouseholdPage);
      // staying put lets the person retry rather than entering the app with
      // sync silently broken.
      return;
    }
    navigate({ to: "/today" });
  }

  async function handleHaveCode() {
    await saveNameIfGiven();
    navigate({ to: "/household/join" });
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
        style={{
          flex: 1,
          padding: "32px 22px 0",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          overflowY: "auto",
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: "-0.01em",
              lineHeight: 1.1,
              color: "var(--ink-1)",
            }}
          >
            What should we call you?
          </h1>
          <p style={{ margin: "10px 0 0", fontSize: 15, color: "var(--ink-2)", lineHeight: 1.5 }}>
            Shown against every dose you log, so the rest of the household can see who gave what.
            You can change it later.
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Field
            id={NAME_INPUT_ID}
            label="Your name"
            maxLength={DISPLAY_NAME_MAX}
            placeholder="e.g. Roman"
            value={name}
            onChange={(e) => {
              hasEditedName.current = true;
              setName(e.target.value);
            }}
          />
          <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
            {trimmed.length} / {DISPLAY_NAME_MAX} · your email is never shown to anyone
          </span>
        </div>
      </div>

      <div
        style={{
          padding: "12px 22px 22px",
          borderTop: "1px solid var(--line)",
          background: "var(--surface)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <Button
          type="button"
          variant="ink"
          size="lg"
          block
          disabled={setDisplayName.isPending || provisionHousehold.isPending}
          onClick={handleStartHousehold}
        >
          Start a household
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="md"
          block
          disabled={setDisplayName.isPending}
          onClick={handleHaveCode}
        >
          I have a join code
        </Button>
      </div>
    </div>
  );
}
