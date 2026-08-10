// Owned by the Household wave. Every user-facing string from
// `features/household/**` — `HouseholdPage.tsx`, `JoinHouseholdPage.tsx`,
// `YourNamePanel.tsx`, `memberLine.ts` and `joinCode.ts`'s five rejection
// messages — lives here.
//
// Three things deliberately do NOT appear here, because they are not words:
//   - display names, household names, pet names and join codes, which are
//     DATA (SPEC §10a/§12) and are interpolated verbatim, never translated
//     or case-mapped by a locale-aware function;
//   - the signed-in email address (SPEC §12's one sanctioned exception),
//     which is DATA;
//   - dates ("12 Jun"), which come from `tr.fmt.dayMonth`, never from a
//     hand-written month table.
import type { Formatters } from "../formatters";

export interface HouseholdMessages {
  // --- HouseholdPage.tsx: page chrome -------------------------------------
  "household.back": () => string;
  "household.backToPets": () => string;
  "household.title": () => string;
  /** "N person" / "N people" — joined with `household.subtitleSuffix` via " · ". */
  "household.peopleCount": (p: { count: number }) => string;
  "household.subtitleSuffix": () => string;
  "household.section.people": () => string;
  "household.section.invite": () => string;
  "household.edit": () => string;
  /** `aria-label` on the self row's edit control. */
  "household.editYourName": () => string;
  /** `aria-label`/menu trigger; `name` is DATA. */
  "household.moreOptionsFor": (p: { name: string }) => string;
  "household.removeFromHousehold": () => string;
  "household.addNameBeforeInviting": () => string;
  "household.setYourName": () => string;
  "household.inviteBody": () => string;
  /** `role="group"` `aria-label`; `code` is DATA, rendered verbatim. */
  "household.joinCodeAriaLabel": (p: { code: string }) => string;
  /** "Expires in {hours} h · single use". `hours` is a clock duration, not pluralised. */
  "household.expiry.hours": (p: { hours: number }) => string;
  "household.expiry.underHour": () => string;
  "household.copyCode": () => string;
  "household.newCode": () => string;
  "household.createCode": () => string;
  "household.codeCopiedToast": () => string;
  "household.everyoneSameAccess": () => string;
  "household.leaveHousehold": () => string;
  "household.deleteHousehold": () => string;
  "household.cancel": () => string;
  "household.remove": () => string;
  /** `name` is DATA. */
  "household.removeConfirm.title": (p: { name: string }) => string;
  "household.removeConfirm.description": () => string;
  "household.leaveConfirm.title": () => string;
  "household.leaveConfirm.deleteWarning": () => string;
  "household.leaveConfirm.normalWarning": () => string;

  // --- JoinHouseholdPage.tsx -----------------------------------------------
  "household.join.title": () => string;
  "household.close": () => string;
  "household.join.instructions": () => string;
  "household.join.yourNameLabel": () => string;
  "household.join.namePlaceholder": () => string;
  "household.join.nameCaption": () => string;
  /** `aria-label` on each of the six code boxes, 1-indexed. */
  "household.join.codeCharacterAriaLabel": (p: { n: number }) => string;
  "household.join.youWillGetAccessTo": () => string;
  "household.join.enterCodePrompt": () => string;
  "household.join.genericFailure": () => string;
  "household.join.submit": () => string;

  // --- YourNamePanel.tsx -----------------------------------------------------
  "household.yourName.title": () => string;
  /** Preview fallback when the field is empty/whitespace-only. */
  "household.yourName.namePlaceholderFallback": () => string;
  /** "In this household since {date}"; `date` is already localized by `tr.fmt.dayMonth`. */
  "household.yourName.inHouseholdSince": (p: { date: string }) => string;
  "household.yourName.displayNameLabel": () => string;
  /** `others` is `memberLine.otherMemberNamesLabel`'s already-localized output (DATA names inside it). */
  "household.yourName.usageCaption": (p: { others: string }) => string;
  "household.yourName.howItWillLook": () => string;
  /** The "how it will look" preview card's specimen row. Identical in both
   *  catalogues on purpose: it is a medication name + dose amount + unit,
   *  none of which are ever translated (SPEC §10a) — routed through the
   *  catalogue only so the component holds no literal. */
  "household.yourName.previewMedication": () => string;
  "household.yourName.previewStatus": () => string;
  /** "by {name}"; `name` is DATA. */
  "household.yourName.byName": (p: { name: string }) => string;
  /** "Signed in as {email}. " — note the trailing space, concatenated
   *  directly against `emailNeverShown` with no separator, matching the
   *  original template. `email` is DATA (SPEC §12's one sanctioned exception). */
  "household.yourName.signedInAs": (p: { email: string }) => string;
  "household.yourName.emailNeverShown": () => string;
  "household.yourName.save": () => string;

  // --- memberLine.ts -----------------------------------------------------------
  /** "You · joined {date}"; `date` is already localized by `tr.fmt.dayMonth`. */
  "household.memberLine.you": (p: { date: string }) => string;
  /** "Logged {n} doses this week" — a real plural rule; fixes the pre-existing
   *  English "Logged 1 doses this week" bug. */
  "household.memberLine.loggedDoses": (p: { n: number }) => string;
  "household.memberLine.joined": (p: { date: string }) => string;
  "household.otherMembers.everyone": () => string;
  /** The conjunction before the last name, WITH its surrounding spaces
   *  (" and " / " і "), so the caller can concatenate directly. */
  "household.otherMembers.and": () => string;

  // --- joinCode.ts: the five rejection reasons ------------------------------
  "household.joinCode.notFound": () => string;
  "household.joinCode.alreadyUsed": () => string;
  "household.joinCode.expired": () => string;
  "household.joinCode.revoked": () => string;
  "household.joinCode.alreadyInHousehold": () => string;
}

export const enHousehold = (f: Formatters): HouseholdMessages => ({
  "household.back": () => "Back",
  "household.backToPets": () => "Pets",
  "household.title": () => "Household",
  "household.peopleCount": (p) =>
    f.plural(p.count, { one: `${p.count} person`, other: `${p.count} people` }),
  "household.subtitleSuffix": () => "everyone can log and edit",
  "household.section.people": () => "People",
  "household.section.invite": () => "Invite",
  "household.edit": () => "Edit",
  "household.editYourName": () => "Edit your name",
  "household.moreOptionsFor": (p) => `More options for ${p.name}`,
  "household.removeFromHousehold": () => "Remove from household",
  "household.addNameBeforeInviting": () => "Add your name before inviting anyone",
  "household.setYourName": () => "Set your name",
  "household.inviteBody": () =>
    "Give this code to someone in your home. They enter it once and see the same pets, schedules and history.",
  "household.joinCodeAriaLabel": (p) => `Join code ${p.code}`,
  "household.expiry.hours": (p) => `Expires in ${p.hours} h · single use`,
  "household.expiry.underHour": () => "Expires in under an hour · single use",
  "household.copyCode": () => "Copy code",
  "household.newCode": () => "New code",
  "household.createCode": () => "Create a code",
  "household.codeCopiedToast": () => "Code copied",
  "household.everyoneSameAccess": () =>
    "Everyone in a household has the same access. Anyone can add pets, edit courses and log doses; every action is recorded with their name.",
  "household.leaveHousehold": () => "Leave household",
  "household.deleteHousehold": () => "Delete household",
  "household.cancel": () => "Cancel",
  "household.remove": () => "Remove",
  "household.removeConfirm.title": (p) => `Remove ${p.name}?`,
  "household.removeConfirm.description": () =>
    "They will lose access to this household. Doses they already logged stay in history.",
  "household.leaveConfirm.title": () => "Leave household?",
  "household.leaveConfirm.deleteWarning": () =>
    "You are the last member. Leaving will delete this household and everything in it — pets, schedules and history — for good.",
  "household.leaveConfirm.normalWarning": () =>
    "You will lose access to the pets, schedules and history in this household. You can rejoin later with a new invite code.",

  "household.join.title": () => "Join a household",
  "household.close": () => "Close",
  "household.join.instructions": () =>
    "Enter the six-character code from the person who set up the pets.",
  "household.join.yourNameLabel": () => "Your name",
  "household.join.namePlaceholder": () => "e.g. Roman",
  "household.join.nameCaption": () => "Shown against every dose you log. You can change it later.",
  "household.join.codeCharacterAriaLabel": (p) => `Code character ${p.n}`,
  "household.join.youWillGetAccessTo": () => "You will get access to",
  "household.join.enterCodePrompt": () => "Enter the code to see what you are joining",
  "household.join.genericFailure": () => "Something went wrong. Try again.",
  "household.join.submit": () => "Join household",

  "household.yourName.title": () => "Your name",
  "household.yourName.namePlaceholderFallback": () => "Someone",
  "household.yourName.inHouseholdSince": (p) => `In this household since ${p.date}`,
  "household.yourName.displayNameLabel": () => "Display name",
  "household.yourName.usageCaption": (p) =>
    `Shown against every dose you log. ${p.others} will see the new name everywhere, including on doses you logged before.`,
  "household.yourName.howItWillLook": () => "How it will look",
  "household.yourName.previewMedication": () => "Metacam 0.4 ml",
  "household.yourName.previewStatus": () => "Given · after food",
  "household.yourName.byName": (p) => `by ${p.name}`,
  "household.yourName.signedInAs": (p) => `Signed in as ${p.email}. `,
  "household.yourName.emailNeverShown": () => "Your email is never shown to anyone in the household.",
  "household.yourName.save": () => "Save name",

  "household.memberLine.you": (p) => `You · joined ${p.date}`,
  "household.memberLine.loggedDoses": (p) =>
    f.plural(p.n, { one: `Logged ${p.n} dose this week`, other: `Logged ${p.n} doses this week` }),
  "household.memberLine.joined": (p) => `Joined ${p.date}`,
  "household.otherMembers.everyone": () => "Everyone in the household",
  "household.otherMembers.and": () => " and ",

  "household.joinCode.notFound": () => "That code does not match any household.",
  "household.joinCode.alreadyUsed": () => "That code has already been used. Ask for a new one.",
  "household.joinCode.expired": () => "That code has expired. Codes last 24 hours — ask for a new one.",
  "household.joinCode.revoked": () => "That code was replaced by a newer one. Ask for the current code.",
  "household.joinCode.alreadyInHousehold": () => "You are already a member of this household.",
});

export const ukHousehold = (f: Formatters): HouseholdMessages => ({
  "household.back": () => "Назад",
  "household.backToPets": () => "Улюбленці",
  "household.title": () => "Домогосподарство",
  // one: 1, 21 → 1 особа; few: 2–4 → 2 особи; many: 5–20 → 5 осіб;
  // other: fractionals → 1.5 особи.
  "household.peopleCount": (p) =>
    f.plural(p.count, {
      one: `${p.count} особа`,
      few: `${p.count} особи`,
      many: `${p.count} осіб`,
      other: `${p.count} особи`,
    }),
  "household.subtitleSuffix": () => "усі можуть записувати дози та редагувати",
  "household.section.people": () => "Люди",
  "household.section.invite": () => "Запросити",
  "household.edit": () => "Редагувати",
  "household.editYourName": () => "Редагувати своє ім'я",
  "household.moreOptionsFor": (p) => `Більше дій для ${p.name}`,
  "household.removeFromHousehold": () => "Видалити з домогосподарства",
  "household.addNameBeforeInviting": () => "Додайте своє ім'я, перш ніж когось запрошувати",
  "household.setYourName": () => "Вказати ім'я",
  "household.inviteBody": () =>
    "Дайте цей код комусь у вашому домі. Він введе його один раз і побачить тих самих улюбленців, графіки та історію.",
  "household.joinCodeAriaLabel": (p) => `Код приєднання ${p.code}`,
  "household.expiry.hours": (p) => `Спливає через ${p.hours} год · одноразовий`,
  "household.expiry.underHour": () => "Спливає менш ніж за годину · одноразовий",
  "household.copyCode": () => "Копіювати код",
  "household.newCode": () => "Новий код",
  "household.createCode": () => "Створити код",
  "household.codeCopiedToast": () => "Код скопійовано",
  "household.everyoneSameAccess": () =>
    "Усі в домогосподарстві мають однаковий доступ. Будь-хто може додавати улюбленців, редагувати курси лікування та записувати дози; кожна дія фіксується з іменем виконавця.",
  "household.leaveHousehold": () => "Покинути домогосподарство",
  "household.deleteHousehold": () => "Видалити домогосподарство",
  "household.cancel": () => "Скасувати",
  "household.remove": () => "Видалити",
  "household.removeConfirm.title": (p) => `Видалити ${p.name}?`,
  "household.removeConfirm.description": () =>
    "Ця людина втратить доступ до домогосподарства. Дози, які вона вже записала, залишаться в історії.",
  "household.leaveConfirm.title": () => "Покинути домогосподарство?",
  "household.leaveConfirm.deleteWarning": () =>
    "Ви останній учасник. Вихід назавжди видалить це домогосподарство і все в ньому — улюбленців, графіки та історію.",
  "household.leaveConfirm.normalWarning": () =>
    "Ви втратите доступ до улюбленців, графіків та історії цього домогосподарства. Ви можете приєднатися знову пізніше за новим кодом запрошення.",

  "household.join.title": () => "Приєднатися до домогосподарства",
  "household.close": () => "Закрити",
  "household.join.instructions": () =>
    "Введіть шестизначний код від людини, яка налаштувала улюбленців.",
  "household.join.yourNameLabel": () => "Ваше ім'я",
  "household.join.namePlaceholder": () => "напр. Оксана",
  "household.join.nameCaption": () =>
    "Показується біля кожної дози, яку ви записуєте. Ви можете змінити його пізніше.",
  "household.join.codeCharacterAriaLabel": (p) => `Символ коду ${p.n}`,
  "household.join.youWillGetAccessTo": () => "Ви отримаєте доступ до",
  "household.join.enterCodePrompt": () => "Введіть код, щоб побачити, до чого ви приєднуєтесь",
  "household.join.genericFailure": () => "Щось пішло не так. Спробуйте ще раз.",
  "household.join.submit": () => "Приєднатися до домогосподарства",

  "household.yourName.title": () => "Ваше ім'я",
  "household.yourName.namePlaceholderFallback": () => "Хтось",
  "household.yourName.inHouseholdSince": (p) => `У цьому домогосподарстві з ${p.date}`,
  "household.yourName.displayNameLabel": () => "Відображуване ім'я",
  "household.yourName.usageCaption": (p) =>
    `Показується біля кожної дози, яку ви записуєте. ${p.others} побачить нове ім'я всюди, включно з дозами, які ви записали раніше.`,
  "household.yourName.howItWillLook": () => "Як це виглядатиме",
  "household.yourName.previewMedication": () => "Metacam 0.4 ml",
  "household.yourName.previewStatus": () => "Дано · після їжі",
  "household.yourName.byName": (p) => `від ${p.name}`,
  "household.yourName.signedInAs": (p) => `Ви увійшли як ${p.email}. `,
  "household.yourName.emailNeverShown": () => "Ваш email ніколи не показується нікому в домогосподарстві.",
  "household.yourName.save": () => "Зберегти ім'я",

  "household.memberLine.you": (p) => `Ви · приєдналися ${p.date}`,
  // one: 1, 21 → Записано 1 дозу; few: 2–4 → Записано 2 дози;
  // many: 5–20 → Записано 5 доз; other: fractionals → Записано 1.5 дози.
  "household.memberLine.loggedDoses": (p) =>
    f.plural(p.n, {
      one: `Записано ${p.n} дозу цього тижня`,
      few: `Записано ${p.n} дози цього тижня`,
      many: `Записано ${p.n} доз цього тижня`,
      other: `Записано ${p.n} дози цього тижня`,
    }),
  "household.memberLine.joined": (p) => `Приєдналися ${p.date}`,
  "household.otherMembers.everyone": () => "Усі в домогосподарстві",
  "household.otherMembers.and": () => " і ",

  "household.joinCode.notFound": () => "Цей код не відповідає жодному домогосподарству.",
  "household.joinCode.alreadyUsed": () => "Цей код вже використано. Попросіть новий.",
  "household.joinCode.expired": () => "Термін дії цього коду минув. Код діє 24 години — попросіть новий.",
  "household.joinCode.revoked": () => "Цей код замінено новішим. Попросіть актуальний код.",
  "household.joinCode.alreadyInHousehold": () => "Ви вже є учасником цього домогосподарства.",
});
