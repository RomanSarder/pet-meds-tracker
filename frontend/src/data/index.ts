// Single seam between the app and its storage layer. Every call site in the
// app is `getRepo().listPets()` etc. — never `new MemoryRepo()` or
// `new IdbRepo()` directly — so that W1 (slice 2) can flip the default below
// from `createMemoryRepo()` to `createIdbRepo()` in this one file, and the
// change is invisible to every UI worker.
import { fixtures } from "@/domain";
import { createMemoryRepo } from "./memoryRepo";
import type { Repo } from "./repo.types";

export type { Repo } from "./repo.types";
export { createMemoryRepo, RetractWindowExpiredError } from "./memoryRepo";

let repo: Repo | null = null;

export function getRepo(): Repo {
  if (!repo) {
    repo = createMemoryRepo(fixtures);
  }
  return repo;
}

export function setRepo(r: Repo): void {
  repo = r;
}
