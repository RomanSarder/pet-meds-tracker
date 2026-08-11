// SPEC §6.5 — Household: members, the live join code, leaving. Transcribed
// from <SCRATCH>/kit/HouseholdScreen.jsx; only the data source changes. See
// CONTRACT-W8.md §5.1 for the exact mapping.
import { useRef, useState, type CSSProperties, type ReactElement } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { Button, Card, IconButton, PetAvatar, ScreenHeader, SectionLabel } from "@/components/ds";
import { displayNameFor, now, type JoinCode, type User } from "@/domain";
import { useToast } from "@/app/Toast";
import { useDoseEvents } from "@/features/courses/hooks";
import { joinMeta } from "@/features/pets/format";
import { useTranslator, type Translator } from "@/i18n";
import {
  leaveDeletesHousehold,
  needsDisplayName,
  useIssueJoinCode,
  useLeaveHousehold,
  useLiveJoinCode,
  useMembers,
  useRefreshMembers,
  useRemoveMember,
  useSelf,
} from "./hooks";
import { dosesLoggedThisWeek, memberLine } from "./memberLine";
import { YourNamePanel } from "./YourNamePanel";

const MENU_ITEM_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  minHeight: 44,
  padding: "0 16px",
  fontSize: 15,
  color: "var(--ink-1)",
  cursor: "pointer",
  userSelect: "none",
};

const MENU_POPUP_STYLE: CSSProperties = {
  minWidth: 220,
  padding: "6px 0",
  background: "var(--surface)",
  border: "1px solid var(--line-quiet)",
  borderRadius: "var(--radius-md, 12px)",
  fontFamily: "var(--font-sans)",
};

const DIALOG_BACKDROP_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.4)",
};

const DIALOG_POPUP_STYLE: CSSProperties = {
  position: "fixed",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "min(340px, calc(100vw - 32px))",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  padding: 20,
  background: "var(--surface)",
  border: "1px solid var(--line-quiet)",
  borderRadius: "var(--radius-lg, 16px)",
  fontFamily: "var(--font-sans)",
};

const DIALOG_TITLE_STYLE: CSSProperties = { fontSize: 17, fontWeight: 600, color: "var(--ink-1)" };
const DIALOG_DESCRIPTION_STYLE: CSSProperties = { fontSize: 13, color: "var(--ink-3)", margin: 0, lineHeight: 1.5 };
const DIALOG_ACTIONS_STYLE: CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 };

/** "Expires in 23 h · single use" / "Expires in under an hour · single use". SPEC §5. */
function expiryLabel(code: JoinCode, at: Date, tr: Translator): string {
  const msLeft = new Date(code.expiresAt).getTime() - at.getTime();
  const hours = Math.floor(msLeft / (60 * 60 * 1000));
  return hours >= 1
    ? tr.t("household.expiry.hours", { hours })
    : tr.t("household.expiry.underHour");
}

interface MemberRowProps {
  member: User;
  name: string;
  line: string;
  isSelf: boolean;
  divider: boolean;
  onEdit: () => void;
  onRequestRemove: () => void;
  tr: Translator;
}

function MemberRow({
  member,
  name,
  line,
  isSelf,
  divider,
  onEdit,
  onRequestRemove,
  tr,
}: MemberRowProps): ReactElement {
  const { t } = tr;
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      ref={rowRef}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 16px",
        borderTop: divider ? "1px solid var(--line-quiet)" : "none",
      }}
    >
      <PetAvatar name={name} tint={member.tint} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-1)" }}>{name}</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 1 }}>{line}</div>
      </div>
      {isSelf ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("household.editYourName")}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "0 4px",
            minHeight: "var(--tap-min)",
            display: "flex",
            alignItems: "center",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--accent)",
            fontFamily: "inherit",
          }}
        >
          {t("household.edit")}
        </button>
      ) : (
        <Menu.Root open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <Menu.Trigger
            render={
              <IconButton
                icon="ellipsis"
                variant="plain"
                size={40}
                style={{ minWidth: 44, minHeight: 44, flexShrink: 0 }}
                label={t("household.moreOptionsFor", { name })}
              />
            }
          />
          <Menu.Portal>
            <Menu.Positioner anchor={rowRef} sideOffset={4} align="end">
              <Menu.Popup style={MENU_POPUP_STYLE}>
                <Menu.Item
                  style={MENU_ITEM_STYLE}
                  onClick={() => {
                    setMenuOpen(false);
                    onRequestRemove();
                  }}
                >
                  {t("household.removeFromHousehold")}
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
    </div>
  );
}

export function HouseholdPage(): ReactElement {
  const navigate = useNavigate();
  const toast = useToast();
  const tr = useTranslator();
  const { t } = tr;

  // Pulls the server's roster into the local store before the People list is
  // read out of it — members are the one thing the sync cycle does not carry,
  // so without this a person who redeemed a join code never appears here.
  useRefreshMembers();

  const membersQuery = useMembers();
  const selfQuery = useSelf();
  const liveCodeQuery = useLiveJoinCode();
  const doseEventsQuery = useDoseEvents({});

  const issueCode = useIssueJoinCode();
  const removeMember = useRemoveMember();
  const leaveHousehold = useLeaveHousehold();

  const [nameOverlayOpen, setNameOverlayOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<User | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  const members = membersQuery.data ?? [];
  const self = selfQuery.data ?? null;
  const events = doseEventsQuery.data ?? [];
  const liveCode = liveCodeQuery.data ?? null;
  const at = now();

  const peopleCount = members.length;
  const subtitle = joinMeta([
    t("household.peopleCount", { count: peopleCount }),
    t("household.subtitleSuffix"),
  ]);

  const willDeleteHousehold = leaveDeletesHousehold(members);
  const removeTargetName = removeTarget ? displayNameFor(removeTarget.id, members) : "";

  async function handleCopyCode() {
    if (!liveCode) return;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(liveCode.code);
      toast.show({ message: t("household.codeCopiedToast") });
    }
  }

  async function handleLeaveConfirm() {
    await leaveHousehold.mutateAsync();
    setLeaveConfirmOpen(false);
    navigate({ to: "/welcome" });
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 22px 12px" }}>
        <button
          onClick={() => navigate({ to: "/pets" })}
          aria-label={t("household.back")}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 22,
            color: "var(--ink-2)",
            padding: 0,
          }}
        >
          ‹
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-2)" }}>
          {t("household.backToPets")}
        </span>
      </div>
      <ScreenHeader title={t("household.title")} subtitle={subtitle} />
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 22px 22px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <SectionLabel>{t("household.section.people")}</SectionLabel>
        <Card pad={0}>
          {members.map((member, i) => {
            const isSelf = self ? member.id === self.id : member.isSelf;
            const name = displayNameFor(member.id, members);
            const line = memberLine(
              {
                isSelf,
                joinedAt: member.joinedAt,
                dosesThisWeek: dosesLoggedThisWeek(events, member.id, at),
              },
              tr,
            );
            return (
              <MemberRow
                key={member.id}
                member={member}
                name={name}
                line={line}
                isSelf={isSelf}
                divider={i > 0}
                onEdit={() => setNameOverlayOpen(true)}
                onRequestRemove={() => setRemoveTarget(member)}
                tr={tr}
              />
            );
          })}
        </Card>

        <SectionLabel>{t("household.section.invite")}</SectionLabel>
        {needsDisplayName(self) ? (
          <Card>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                alignItems: "center",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5, maxWidth: 280 }}>
                {t("household.addNameBeforeInviting")}
              </div>
              <Button variant="primary" size="md" onClick={() => setNameOverlayOpen(true)}>
                {t("household.setYourName")}
              </Button>
            </div>
          </Card>
        ) : (
          <Card>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                alignItems: "center",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5, maxWidth: 280 }}>
                {t("household.inviteBody")}
              </div>
              {liveCode ? (
                <>
                  <div
                    role="group"
                    aria-label={t("household.joinCodeAriaLabel", { code: liveCode.code })}
                    style={{ display: "flex", gap: 8, fontVariantNumeric: "tabular-nums" }}
                  >
                    {liveCode.code.split("").map((c, i) => (
                      <span
                        key={i}
                        style={{
                          width: 44,
                          height: 56,
                          borderRadius: "var(--radius-sm)",
                          background: "var(--accent-tint)",
                          color: "var(--accent-ink)",
                          fontSize: 26,
                          fontWeight: 800,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                    {expiryLabel(liveCode, at, tr)}
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <Button
                      variant="primary"
                      size="sm"
                      style={{ minHeight: "var(--tap-min)" }}
                      onClick={handleCopyCode}
                    >
                      {t("household.copyCode")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      style={{ minHeight: "var(--tap-min)" }}
                      onClick={() => issueCode.mutate()}
                    >
                      {t("household.newCode")}
                    </Button>
                  </div>
                </>
              ) : (
                <Button variant="primary" size="md" onClick={() => issueCode.mutate()}>
                  {t("household.createCode")}
                </Button>
              )}
            </div>
          </Card>
        )}

        <Card tone="dashed" pad={14}>
          <div style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.5 }}>
            {t("household.everyoneSameAccess")}
          </div>
        </Card>

        <div style={{ paddingTop: 4 }}>
          <Button
            variant="secondary"
            size="md"
            block
            onClick={() => setLeaveConfirmOpen(true)}
          >
            {t("household.leaveHousehold")}
          </Button>
        </div>
      </div>

      {nameOverlayOpen && <YourNamePanel onClose={() => setNameOverlayOpen(false)} />}

      <Dialog.Root
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop style={DIALOG_BACKDROP_STYLE} />
          <Dialog.Popup style={DIALOG_POPUP_STYLE}>
            <Dialog.Title style={DIALOG_TITLE_STYLE}>
              {t("household.removeConfirm.title", { name: removeTargetName })}
            </Dialog.Title>
            <Dialog.Description style={DIALOG_DESCRIPTION_STYLE}>
              {t("household.removeConfirm.description")}
            </Dialog.Description>
            <div style={DIALOG_ACTIONS_STYLE}>
              <Dialog.Close
                render={
                  <Button type="button" size="md" variant="secondary">
                    {t("household.cancel")}
                  </Button>
                }
              />
              <Button
                type="button"
                size="md"
                variant="danger"
                onClick={() => {
                  if (removeTarget) {
                    removeMember.mutate(removeTarget.id);
                  }
                  setRemoveTarget(null);
                }}
              >
                {t("household.remove")}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={leaveConfirmOpen} onOpenChange={setLeaveConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop style={DIALOG_BACKDROP_STYLE} />
          <Dialog.Popup style={DIALOG_POPUP_STYLE}>
            <Dialog.Title style={DIALOG_TITLE_STYLE}>{t("household.leaveConfirm.title")}</Dialog.Title>
            <Dialog.Description style={DIALOG_DESCRIPTION_STYLE}>
              {willDeleteHousehold
                ? t("household.leaveConfirm.deleteWarning")
                : t("household.leaveConfirm.normalWarning")}
            </Dialog.Description>
            <div style={DIALOG_ACTIONS_STYLE}>
              <Dialog.Close
                render={
                  <Button type="button" size="md" variant="secondary">
                    {t("household.cancel")}
                  </Button>
                }
              />
              <Button type="button" size="md" variant="danger" onClick={handleLeaveConfirm}>
                {willDeleteHousehold ? t("household.deleteHousehold") : t("household.leaveHousehold")}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
