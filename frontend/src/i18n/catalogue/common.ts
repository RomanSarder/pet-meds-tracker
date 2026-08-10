// Cross-cutting strings shared by more than one screen: the tab-bar labels
// (Wave 1, AppShell), plus — assigned to the Wave 3C builder — everything
// outside a single feature domain: sign-in/verify (`auth/*.tsx`), the
// account-switch guard (`features/account/AccountSwitchPage.tsx`), the
// top-level error boundary, backup file errors and the shared API-client
// network error. These don't share a feature domain with each other, so
// `common.ts` — already the catalogue's cross-cutting bucket — is where they
// live rather than inventing a one-off catalogue file per tiny surface.
import type { Formatters } from "../formatters";

export interface CommonMessages {
  "nav.today": () => string;
  "nav.pets": () => string;
  "nav.supplies": () => string;

  // --- auth: SignInPage.tsx / VerifyPage.tsx -------------------------------
  /**
   * The small brand mark shown above the sign-in/verify card. A product
   * name, not prose — identical in both catalogues on purpose (same
   * reasoning as `settings.languageNameUk/En`: routed through the catalogue
   * only so the page holds no literal, not because it is meant to change
   * per language).
   */
  "auth.brand": () => string;
  "auth.signIn.title": () => string;
  "auth.signIn.checkInbox": () => string;
  /**
   * SPEC §12 flag: the page wraps the submitted address in a bold `<span>`
   * right after this prefix and appends a period — see
   * `auth/SignInPage.tsx`. Rendering that address at all is a pre-existing
   * violation of "no email address may render anywhere"; see the wave
   * return for detail. Kept as a prefix-only key (rather than interpolating
   * the address into the string) so the original bold emphasis around the
   * email survives the move to the catalogue unchanged — behaviour and
   * layout preserved, wording only.
   */
  "auth.signIn.sentToPrefix": () => string;
  "auth.signIn.description": () => string;
  "auth.signIn.emailLabel": () => string;
  "auth.signIn.emailPlaceholder": () => string;
  "auth.signIn.sending": () => string;
  "auth.signIn.sendLink": () => string;
  "auth.signIn.linksExpire": () => string;
  "auth.signIn.resendIn": (p: { seconds: number }) => string;
  "auth.signIn.resendLink": () => string;
  "auth.signIn.useDifferentEmail": () => string;
  /** Shared fallback error copy — used by both SignInPage and VerifyPage. */
  "auth.genericError": () => string;
  "auth.verify.signingIn": () => string;
  "auth.verify.verifyingLink": () => string;
  "auth.verify.success": () => string;
  "auth.verify.redirecting": () => string;
  "auth.verify.linkNotValid": () => string;
  "auth.verify.linkExpired": () => string;
  "auth.verify.backToSignIn": () => string;

  // --- account: AccountSwitchPage.tsx --------------------------------------
  "account.switch.title": () => string;
  "account.switch.description": () => string;
  "account.switch.signOut": () => string;
  "account.switch.backupThenContinue": () => string;
  "account.switch.backupError": () => string;
  "account.switch.sessionUnavailable": () => string;

  // --- components/ErrorBoundary.tsx ----------------------------------------
  "errorBoundary.title": () => string;
  "errorBoundary.tryAgain": () => string;

  // --- data/backupFile.ts: thrown, then echoed verbatim as toast/alert copy ---
  "backup.invalidJson": () => string;
  "backup.notABackup": () => string;
  "backup.readError": () => string;

  // --- shared/api.ts --------------------------------------------------------
  "api.networkError": () => string;
}

// `f` is unused by this domain today but kept in the signature so every
// domain factory has the same shape (`(f: Formatters) => <Domain>Messages`).
export const enCommon = (_f: Formatters): CommonMessages => ({
  "nav.today": () => "Today",
  "nav.pets": () => "Pets",
  "nav.supplies": () => "Supplies",

  "auth.brand": () => "Pet Tracker",
  "auth.signIn.title": () => "Sign in",
  "auth.signIn.checkInbox": () => "Check your inbox",
  "auth.signIn.sentToPrefix": () => "We sent a sign-in link to",
  "auth.signIn.description": () => "Enter your email to receive a sign-in link.",
  "auth.signIn.emailLabel": () => "Email address",
  "auth.signIn.emailPlaceholder": () => "you@example.com",
  "auth.signIn.sending": () => "Sending…",
  "auth.signIn.sendLink": () => "Send link",
  "auth.signIn.linksExpire": () => "Links expire after 15 minutes.",
  "auth.signIn.resendIn": (p) => `Resend in ${p.seconds}s`,
  "auth.signIn.resendLink": () => "Resend link",
  "auth.signIn.useDifferentEmail": () => "Use a different email",
  "auth.genericError": () => "Something went wrong. Please try again.",
  "auth.verify.signingIn": () => "Signing you in…",
  "auth.verify.verifyingLink": () => "Verifying your link.",
  "auth.verify.success": () => "You're signed in",
  "auth.verify.redirecting": () => "Redirecting you now…",
  "auth.verify.linkNotValid": () => "Link not valid",
  "auth.verify.linkExpired": () => "This link has expired or has already been used.",
  "auth.verify.backToSignIn": () => "Back to sign in",

  "account.switch.title": () => "Another account's data is on this device",
  "account.switch.description": () =>
    "This device still holds pet records that have not been backed up to the server, and they belong to the account that used it last. Signing in here would replace them.",
  "account.switch.signOut": () => "Sign out and leave it alone",
  "account.switch.backupThenContinue": () => "Download a backup, then continue",
  "account.switch.backupError": () => "Could not download a backup.",
  "account.switch.sessionUnavailable": () =>
    "We could not confirm which account is signing in, so only signing out is available here.",

  "errorBoundary.title": () => "Something went wrong",
  "errorBoundary.tryAgain": () => "Try again",

  "backup.invalidJson": () => "That file isn't valid JSON.",
  "backup.notABackup": () => "That file doesn't look like a Pet Meds backup.",
  "backup.readError": () => "Could not read the file.",

  "api.networkError": () => "Could not reach the server.",
});

export const ukCommon = (_f: Formatters): CommonMessages => ({
  "nav.today": () => "Сьогодні",
  "nav.pets": () => "Улюбленці",
  "nav.supplies": () => "Запаси",

  "auth.brand": () => "Pet Tracker",
  "auth.signIn.title": () => "Увійти",
  "auth.signIn.checkInbox": () => "Перевірте пошту",
  "auth.signIn.sentToPrefix": () => "Ми надіслали посилання для входу на",
  "auth.signIn.description": () => "Введіть email, щоб отримати посилання для входу.",
  "auth.signIn.emailLabel": () => "Електронна пошта",
  "auth.signIn.emailPlaceholder": () => "you@example.com",
  "auth.signIn.sending": () => "Надсилання…",
  "auth.signIn.sendLink": () => "Надіслати посилання",
  "auth.signIn.linksExpire": () => "Посилання дійсне 15 хвилин.",
  "auth.signIn.resendIn": (p) => `Повторно через ${p.seconds} с`,
  "auth.signIn.resendLink": () => "Надіслати ще раз",
  "auth.signIn.useDifferentEmail": () => "Використати іншу пошту",
  "auth.genericError": () => "Щось пішло не так. Спробуйте ще раз.",
  "auth.verify.signingIn": () => "Виконується вхід…",
  "auth.verify.verifyingLink": () => "Перевірка посилання.",
  "auth.verify.success": () => "Ви увійшли",
  "auth.verify.redirecting": () => "Перенаправлення…",
  "auth.verify.linkNotValid": () => "Посилання недійсне",
  "auth.verify.linkExpired": () => "Термін дії цього посилання минув або воно вже використане.",
  "auth.verify.backToSignIn": () => "Повернутися до входу",

  "account.switch.title": () => "На цьому пристрої є дані іншого облікового запису",
  "account.switch.description": () =>
    "На цьому пристрої досі зберігаються записи про тварин, які не було збережено на сервері, і вони належать обліковому запису, що використовувався тут востаннє. Вхід зараз замінить їх.",
  "account.switch.signOut": () => "Вийти й залишити як є",
  "account.switch.backupThenContinue": () => "Завантажити резервну копію й продовжити",
  "account.switch.backupError": () => "Не вдалося завантажити резервну копію.",
  "account.switch.sessionUnavailable": () =>
    "Не вдалося підтвердити, який обліковий запис входить, тому доступний лише вихід.",

  "errorBoundary.title": () => "Щось пішло не так",
  "errorBoundary.tryAgain": () => "Спробувати ще раз",

  "backup.invalidJson": () => "Цей файл не є коректним JSON.",
  "backup.notABackup": () => "Цей файл не схожий на резервну копію Pet Meds.",
  "backup.readError": () => "Не вдалося прочитати файл.",

  "api.networkError": () => "Не вдалося з'єднатися із сервером.",
});
