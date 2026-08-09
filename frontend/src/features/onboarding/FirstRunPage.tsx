// SPEC §6.9 First run — the one screen in this wave with no kit composition, so
// it is composed in the established house style rather than transcribed: plain
// factual voice, no emoji, sentence case, cards with a hairline and never a
// shadow, terracotta reserved for the action. See CONTRACT-W8.md §5.4.
//
// SPEC §6.9: "After the magic link is confirmed and before anything else, one
// screen." One screen means one screen — no carousel, no permission prompts.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ds";
import { DISPLAY_NAME_MAX } from "@/domain";
import { Field } from "@/features/forms/Field";
import { needsDisplayName, useSelf, useSessionEmail, useSetDisplayName } from "@/features/household/hooks";
import { suggestNameFromEmail } from "./nameSuggestion";

const NAME_INPUT_ID = "first-run-name";

export function FirstRunPage() {
  const navigate = useNavigate();

  const selfQuery = useSelf();
  const sessionEmail = useSessionEmail();
  const setDisplayName = useSetDisplayName();

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
          disabled={setDisplayName.isPending}
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
