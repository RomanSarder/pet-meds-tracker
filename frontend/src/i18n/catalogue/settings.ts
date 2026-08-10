// Wave 1 owns this file. Every user-facing literal from
// `features/settings/SettingsPage.tsx` lives here.
import type { Formatters } from "../formatters";

export interface SettingsMessages {
  "settings.title": () => string;
  "settings.signedInAs": (p: { name: string }) => string;
  "settings.signedIn": () => string;
  "settings.loadingSession": () => string;
  "settings.sessionError": () => string;
  "settings.signOut": () => string;
  "settings.backup": () => string;
  "settings.exportJson": () => string;
  "settings.importJson": () => string;
  "settings.chooseBackupFile": () => string;
  "settings.replaceOrMergePrompt": () => string;
  "settings.replaceEverything": () => string;
  "settings.mergeKeepNewest": () => string;
  "settings.importSuccess": () => string;
  "settings.importErrorGeneric": () => string;
  "settings.readErrorGeneric": () => string;
  "settings.exportImportHelp": () => string;
  "settings.language": () => string;
  // Language endonyms — proper nouns. Identical in both catalogues on
  // purpose: the switch always shows "Українська" / "English" regardless of
  // which language is currently active, so the user can always see and pick
  // the other one. Routed through the catalogue (rather than hard-coded in
  // the page) only so the page never contains a literal.
  "settings.languageNameUk": () => string;
  "settings.languageNameEn": () => string;
}

// `f` is unused by this domain today but kept in the signature so every
// domain factory has the same shape (`(f: Formatters) => <Domain>Messages`).
export const enSettings = (_f: Formatters): SettingsMessages => ({
  "settings.title": () => "Settings",
  "settings.signedInAs": (p) => `Signed in as ${p.name}`,
  "settings.signedIn": () => "Signed in",
  "settings.loadingSession": () => "Loading your session…",
  "settings.sessionError": () => "Could not load your session.",
  "settings.signOut": () => "Sign out",
  "settings.backup": () => "Backup",
  "settings.exportJson": () => "Export JSON",
  "settings.importJson": () => "Import JSON",
  "settings.chooseBackupFile": () => "Choose a backup file to import",
  "settings.replaceOrMergePrompt": () =>
    "Replace your whole household with this file, or merge it in and keep whichever copy of each item was edited most recently?",
  "settings.replaceEverything": () => "Replace everything",
  "settings.mergeKeepNewest": () => "Merge (keep newest)",
  "settings.importSuccess": () => "Import complete.",
  "settings.importErrorGeneric": () => "Import failed.",
  "settings.readErrorGeneric": () => "Could not read that file.",
  "settings.exportImportHelp": () =>
    "Export your whole household as a single JSON file, or import one to restore or merge it back in.",
  "settings.language": () => "Language",
  "settings.languageNameUk": () => "Українська",
  "settings.languageNameEn": () => "English",
});

export const ukSettings = (_f: Formatters): SettingsMessages => ({
  "settings.title": () => "Налаштування",
  "settings.signedInAs": (p) => `Увійшли як ${p.name}`,
  "settings.signedIn": () => "Ви увійшли",
  "settings.loadingSession": () => "Завантаження сесії…",
  "settings.sessionError": () => "Не вдалося завантажити сесію.",
  "settings.signOut": () => "Вийти",
  "settings.backup": () => "Резервна копія",
  "settings.exportJson": () => "Експортувати JSON",
  "settings.importJson": () => "Імпортувати JSON",
  "settings.chooseBackupFile": () => "Виберіть файл резервної копії для імпорту",
  "settings.replaceOrMergePrompt": () =>
    "Замінити весь список домогосподарства цим файлом, чи об'єднати дані, залишивши найновішу версію кожного елемента?",
  "settings.replaceEverything": () => "Замінити все",
  "settings.mergeKeepNewest": () => "Об'єднати (залишити найновіше)",
  "settings.importSuccess": () => "Імпорт завершено.",
  "settings.importErrorGeneric": () => "Не вдалося виконати імпорт.",
  "settings.readErrorGeneric": () => "Не вдалося прочитати файл.",
  "settings.exportImportHelp": () =>
    "Експортуйте все домогосподарство одним файлом JSON або імпортуйте файл, щоб відновити чи об'єднати дані.",
  "settings.language": () => "Мова",
  "settings.languageNameUk": () => "Українська",
  "settings.languageNameEn": () => "English",
});
