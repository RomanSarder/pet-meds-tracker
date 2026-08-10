// Join a household (SPEC §5 step 2-4, §6.5). Transcribed from
// <SCRATCH>/kit/JoinHouseholdScreen.jsx — layout, ordering, spacing and copy
// are the kit's; only the data source and the six placeholder boxes (which
// the kit hard-codes as static spans) become real behaviour. See
// CONTRACT-W8.md §5.3.
import { useEffect, useRef, useState, type KeyboardEvent, type ClipboardEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button, Card, PetAvatar } from "@/components/ds";
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from "@/domain";
import { Field } from "@/features/forms/Field";
import { speciesLabel } from "@/features/pets/format";
import { suggestNameFromEmail } from "@/features/onboarding/nameSuggestion";
import { needsDisplayName, useJoinPreview, useRedeemJoinCode, useSelf, useSessionEmail } from "./hooks";
import { JoinCodeRejectedError, joinCodeRejectionMessage, type JoinCodeRejection } from "./joinCode";
import { createTranslator } from "@/i18n";

// TODO(wave3): replace enTr with a real translator when the household feature
// is localized.
const enTr = createTranslator("en");

const NAME_INPUT_ID = "join-household-name";
const EMPTY_CHARS: string[] = Array(JOIN_CODE_LENGTH).fill("");

export function JoinHouseholdPage() {
  const navigate = useNavigate();

  const selfQuery = useSelf();
  const sessionEmail = useSessionEmail();
  const redeemJoinCode = useRedeemJoinCode();

  const [name, setName] = useState("");
  const hasEditedName = useRef(false);
  const [chars, setChars] = useState<string[]>(EMPTY_CHARS);
  const [rejection, setRejection] = useState<JoinCodeRejection | null>(null);
  // SPEC §5: "the client must surface a failure" for anything the server
  // refuses that is not itself a redemption rejection (network down, an
  // unexpected server error) — distinct from `rejection`, which is reserved
  // for the four reasons the server actually names.
  const [joinFailed, setJoinFailed] = useState(false);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const code = chars.join("");
  const previewQuery = useJoinPreview(code);
  const preview = previewQuery.data ?? null;

  // Pre-fill from the self row, or — while it still carries the placeholder
  // name — from the email-derived suggestion (SPEC §5, CONTRACT-W8.md
  // §5.3). Keeps recomputing as `self`/`sessionEmail` resolve, but stops the
  // moment the person edits the field themselves.
  useEffect(() => {
    if (hasEditedName.current || !selfQuery.data) return;
    const self = selfQuery.data;
    setName(needsDisplayName(self) ? suggestNameFromEmail(sessionEmail) : self.displayName);
  }, [selfQuery.data, sessionEmail]);

  function setChar(index: number, char: string) {
    setChars((prev) => {
      const next = [...prev];
      next[index] = char;
      return next;
    });
  }

  function handleCharChange(index: number, raw: string) {
    const char = raw.trim().slice(-1).toUpperCase();
    if (char && !JOIN_CODE_ALPHABET.includes(char)) {
      return;
    }
    setChar(index, char);
    if (char && index < JOIN_CODE_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && chars[index] === "" && index > 0) {
      inputRefs.current[index - 1]?.focus();
      setChar(index - 1, "");
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData
      .getData("text")
      .toUpperCase()
      .split("")
      .filter((c) => JOIN_CODE_ALPHABET.includes(c));
    if (pasted.length === 0) return;
    e.preventDefault();
    const next = [...EMPTY_CHARS];
    for (let i = 0; i < Math.min(pasted.length, JOIN_CODE_LENGTH); i++) {
      next[i] = pasted[i];
    }
    setChars(next);
    inputRefs.current[Math.min(pasted.length, JOIN_CODE_LENGTH) - 1]?.focus();
  }

  async function handleJoin() {
    setRejection(null);
    setJoinFailed(false);
    try {
      // SPEC §5: redemption is decided server-side (single use, 24h expiry,
      // "a newer code was issued") — the display name travels in the same
      // round trip (`RedeemJoinCodeBody.displayName`) rather than a second,
      // separate write.
      await redeemJoinCode.mutateAsync({ code, displayName: name });
      navigate({ to: "/today" });
    } catch (err) {
      if (err instanceof JoinCodeRejectedError) {
        setRejection(err.reason);
        return;
      }
      // The server refused for some other reason (network down, an
      // unexpected error) — surfaced rather than silently proceeding as if
      // the join had worked.
      setJoinFailed(true);
    }
  }

  const codeComplete = code.length === JOIN_CODE_LENGTH;
  const joinDisabled = !codeComplete || redeemJoinCode.isPending;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 22px 16px",
        }}
      >
        <span style={{ fontSize: 22, fontWeight: 800, color: "var(--ink-1)" }}>
          Join a household
        </span>
        <button
          type="button"
          onClick={() => navigate({ to: "/household" })}
          aria-label="Close"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 20,
            color: "var(--ink-3)",
            padding: 0,
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
        <div style={{ fontSize: 15, color: "var(--ink-2)", lineHeight: 1.5 }}>
          Enter the six-character code from the person who set up the pets.
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <Field
            id={NAME_INPUT_ID}
            label="Your name"
            maxLength={24}
            placeholder="e.g. Roman"
            value={name}
            onChange={(e) => {
              hasEditedName.current = true;
              setName(e.target.value);
            }}
          />
          <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
            Shown against every dose you log. You can change it later.
          </span>
        </div>

        <div style={{ display: "flex", gap: 8, fontVariantNumeric: "tabular-nums" }}>
          {chars.map((char, i) => (
            <input
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              aria-label={`Code character ${i + 1}`}
              value={char}
              maxLength={1}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              onFocus={(e) => e.target.select()}
              onChange={(e) => handleCharChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={handlePaste}
              style={{
                flex: 1,
                height: 60,
                minWidth: "var(--tap-min)",
                borderRadius: "var(--radius-sm)",
                border: char ? "2px solid var(--accent)" : "1px solid var(--line-strong)",
                background: "var(--surface)",
                color: "var(--ink-1)",
                fontSize: 26,
                fontWeight: 800,
                textAlign: "center",
                fontFamily: "var(--font-sans)",
              }}
            />
          ))}
        </div>

        <Card tone="quiet">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-2)" }}>
              You will get access to
            </div>
            {preview && preview.length > 0 ? (
              preview.map((pet) => (
                <div key={pet.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <PetAvatar name={pet.name} tint={pet.tint} size={34} />
                  <span style={{ fontSize: 15, color: "var(--ink-1)" }}>
                    {pet.name} · {speciesLabel(pet.species, enTr)}
                  </span>
                </div>
              ))
            ) : (
              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
                Enter the code to see what you are joining
              </span>
            )}
          </div>
        </Card>
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
        {rejection ? (
          <div role="alert" style={{ fontSize: 13, color: "var(--alert)" }}>
            {joinCodeRejectionMessage(rejection)}
          </div>
        ) : joinFailed ? (
          <div role="alert" style={{ fontSize: 13, color: "var(--alert)" }}>
            Something went wrong. Try again.
          </div>
        ) : null}
        <Button
          type="button"
          variant="ink"
          size="lg"
          block
          disabled={joinDisabled}
          onClick={handleJoin}
        >
          Join household
        </Button>
      </div>
    </div>
  );
}
