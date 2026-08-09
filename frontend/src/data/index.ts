// Single seam between the app and its storage layer. Every call site in the
// app is `getRepo().listPets()` etc. — never `new MemoryRepo()` or
// `new IdbRepo()` directly — so that W1 (slice 2) can flip the default below
// from `createMemoryRepo()` to `createIdbRepo()` in this one file, and the
// change is invisible to every UI worker.
import { createIdbRepo } from "./idbRepo";
import type { Repo } from "./repo.types";

export type { Repo, RemoteChanges, ApplyReport } from "./repo.types";
export { createMemoryRepo } from "./memoryRepo";
export { DuplicateDoseError, RetractWindowExpiredError } from "./errors";
export { createIdbRepo } from "./idbRepo";
export { liveDoseEvent, liveDoseEvents } from "./doseEvents";

let repo: Repo | null = null;

export function getRepo(): Repo {
  if (!repo) {
    repo = createIdbRepo();
  }
  return repo;
}

export function setRepo(r: Repo): void {
  repo = r;
}
