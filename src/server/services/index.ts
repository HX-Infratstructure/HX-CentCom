/**
 * The service layer's public surface (SPEC §4, §8.1): the only module of src/server/services/ that code outside it may
 * import.
 */
import type { Db } from "@/server/db/client";
import { mintKey, resolveActor } from "./actor";
import { createWriter } from "./pipeline";
import { listActivity, listDecisions, listUpdates, listWorkspace } from "./reads";
import {
  createLessonPlan,
  listLessons,
  updateLessonPlan,
  withLessonsAsk,
  type LessonServices,
} from "./lessons";
import { createRaidItemPlan, listRaid, updateRaidItemPlan, type RaidServices } from "./raid";
import type { IssuedKey, ServiceDeps, Services as CoreServices } from "./types";
import {
  bootstrapOwnerKeyPlan,
  decidePlan,
  issueKeyPlan,
  postProgressPlan,
  requestDecisionPlan,
  revokeKeyPlan,
  setRequirementPlan,
} from "./writes";

export function serviceDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps {
  return { now: overrides.now ?? (() => new Date()), mintKey: overrides.mintKey ?? mintKey };
}

export function createServices(db: Db, deps: Partial<ServiceDeps> = {}): Services {
  const write = createWriter(db, serviceDeps(deps));
  return {
    resolveActor: (authHeader) => resolveActor(db, authHeader),
    listWorkspace: () => listWorkspace(db),
    listUpdates: (query) => listUpdates(db, query),
    listActivity: (query) => listActivity(db, query),
    listDecisions: (query) => listDecisions(db, query),
    postProgress: (actor, taskId, input, opts = {}) =>
      write.update(actor, input, opts, withLessonsAsk(postProgressPlan(taskId))),
    setRequirement: (actor, taskId, input, opts = {}) =>
      write.update(actor, input, opts, setRequirementPlan(taskId)),
    requestDecision: (actor, input, opts = {}) =>
      write.create(actor, input, opts, requestDecisionPlan),
    decide: (actor, decisionId, input, opts = {}) =>
      write.update(actor, input, opts, decidePlan(decisionId)),
    issueKey: (actor, agentId, label) => write.keys(actor, { agentId, label }, issueKeyPlan),
    revokeKey: (actor, keyId) => write.keys(actor, { keyId }, revokeKeyPlan),
    listRaid: (query) => listRaid(db, query),
    createRaidItem: (actor, input, opts = {}) =>
      write.create(actor, input, opts, createRaidItemPlan),
    updateRaidItem: (actor, id, input, opts = {}) =>
      write.update(actor, input, opts, updateRaidItemPlan(id)),
    listLessons: (query) => listLessons(db, query),
    createLesson: (actor, input, opts = {}) => write.create(actor, input, opts, createLessonPlan),
    updateLesson: (actor, id, input, opts = {}) =>
      write.update(actor, input, opts, updateLessonPlan(id)),
  };
}

/** Shadows the `Services` of `export type * from "./types"` below, so every importer sees B4's methods too. */
export type Services = CoreServices & RaidServices & LessonServices;

/**
 * Operator only (the key CLI that holds DATABASE_URL): issues the first owner key while no owner key is active,
 * else `forbidden`. Later keys go through `issueKey`. Not on `Services`, so no request path reaches it.
 */
export function bootstrapOwnerKey(
  db: Db,
  input: { readonly agentId: string; readonly label: string },
  deps: Partial<ServiceDeps> = {},
): Promise<IssuedKey> {
  return createWriter(db, serviceDeps(deps)).bootstrap(input, bootstrapOwnerKeyPlan);
}

export { hashKey, type Actor } from "./actor";
export { groupForStatus } from "./writes";
export {
  ServiceError,
  isServiceError,
  ERROR_STATUS,
  type ErrorCode,
  type Issue,
  type ServiceErrorBody,
} from "./errors";
export { POLICY } from "./policy";
export {
  recordGithubSnapshot,
  listOpenGithubPrs,
  type GithubSnapshot,
  type GithubRepoInput,
  type GithubPrInput,
  type GithubPrState,
} from "./github";
export {
  issueKeyInput,
  postProgressInput,
  setRequirementInput,
  requestDecisionInput,
  decideInput,
  updateQueryInput,
  activityQueryInput,
  decisionQueryInput,
  type PostProgressInput,
  type SetRequirementInput,
  type RequestDecisionInput,
  type DecideInput,
  type UpdateQueryInput,
  type ActivityQueryInput,
  type DecisionQueryInput,
} from "./inputs";
export {
  createRaidItemInput,
  updateRaidItemInput,
  raidQueryInput,
  type RaidItem,
  type RaidWrite,
  type RaidPage,
  type RaidCounts,
  type CreateRaidItemInput,
  type UpdateRaidItemInput,
  type RaidQueryInput,
} from "./raid";
export {
  createLessonInput,
  updateLessonInput,
  lessonQueryInput,
  type Lesson,
  type LessonWrite,
  type LessonsPage,
  type LessonCounts,
  type CreateLessonInput,
  type UpdateLessonInput,
  type LessonQueryInput,
} from "./lessons";
export {
  RAID_TYPES,
  RAID_STATUSES,
  SEVERITIES,
  VALIDATION_STATES,
  LESSON_STATUSES,
  RAID_TYPE_FIELDS,
  SOURCE_REF_PATTERN,
  BLOCKING_REF_PATTERN,
  type RaidType,
  type RaidStatus,
  type Severity,
  type ValidationState,
  type LessonStatus,
} from "@/server/db/schema-raid";
export type * from "./types";
