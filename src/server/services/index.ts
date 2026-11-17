/**
 * The service layer's public surface (SPEC §4, §8.1): the only module of src/server/services/ that code outside it may
 * import.
 */
import type { Db } from "@/server/db/client";
import { mintKey, resolveActor } from "./actor";
import { createWriter } from "./pipeline";
import {
  getDecision,
  getTask,
  listActivity,
  listDecisions,
  listTasks,
  listUpdates,
  listWorkspace,
  listWorkspaceShell,
  myWork,
} from "./reads";
import {
  createLessonPlan,
  getLesson,
  listLessons,
  updateLessonPlan,
  withLessonsAsk,
  type LessonServices,
} from "./lessons";
import { listGithubPrs } from "./github";
import {
  createRaidItemPlan,
  getRaidItem,
  listRaid,
  updateRaidItemPlan,
  type RaidServices,
} from "./raid";
import { revertPlan } from "./revert";
import type { IssuedKey, ServiceDeps, Services as CoreServices } from "./types";
import { withDecidedWebhook } from "./webhook";
import {
  bootstrapOwnerKeyPlan,
  createTaskPlan,
  decidePlan,
  issueKeyPlan,
  postProgressPlan,
  requestDecisionPlan,
  revokeKeyPlan,
  setRequirementPlan,
} from "./writes";

export function serviceDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps {
  return {
    now: overrides.now ?? (() => new Date()),
    mintKey: overrides.mintKey ?? mintKey,
    fetch: overrides.fetch ?? ((input, init) => fetch(input, init)),
    webhook: overrides.webhook ?? null,
  };
}

export function createServices(db: Db, deps: Partial<ServiceDeps> = {}): Services {
  const resolved = serviceDeps(deps);
  const write = createWriter(db, resolved);
  return {
    resolveActor: (authHeader) => resolveActor(db, authHeader),
    listWorkspace: () => listWorkspace(db),
    listWorkspaceShell: () => listWorkspaceShell(db),
    listUpdates: (query) => listUpdates(db, query),
    listActivity: (query) => listActivity(db, query),
    listDecisions: (query) => listDecisions(db, query),
    listTasks: (query) => listTasks(db, query),
    getDecision: (decisionId) => getDecision(db, decisionId),
    getTask: (taskId) => getTask(db, taskId),
    myWork: (actor, agentId) => myWork(db, actor, agentId),
    listGithubPrs: (query) => listGithubPrs(db, query),
    createTask: (actor, input, opts = {}) => write.create(actor, input, opts, createTaskPlan),
    postProgress: (actor, taskId, input, opts = {}) =>
      write.update(actor, input, opts, withLessonsAsk(postProgressPlan(taskId, opts.via))),
    setRequirement: (actor, taskId, input, opts = {}) =>
      write.update(actor, input, opts, setRequirementPlan(taskId)),
    requestDecision: (actor, input, opts = {}) =>
      write.create(actor, input, opts, requestDecisionPlan),
    decide: (actor, decisionId, input, opts = {}) =>
      write.update(actor, input, opts, withDecidedWebhook(decidePlan(decisionId), resolved)),
    issueKey: (actor, agentId, label) => write.keys(actor, { agentId, label }, issueKeyPlan),
    revokeKey: (actor, keyId) => write.keys(actor, { keyId }, revokeKeyPlan),
    revertActivity: async (actor, activityId, opts = {}) =>
      write.update(actor, { activityId }, opts, await revertPlan(db, actor, activityId)),
    listRaid: (query) => listRaid(db, query),
    getRaidItem: (id) => getRaidItem(db, id),
    createRaidItem: (actor, input, opts = {}) =>
      write.create(actor, input, opts, createRaidItemPlan),
    updateRaidItem: (actor, id, input, opts = {}) =>
      write.update(actor, input, opts, updateRaidItemPlan(id)),
    listLessons: (query) => listLessons(db, query),
    getLesson: (id) => getLesson(db, id),
    createLesson: (actor, input, opts = {}) => write.create(actor, input, opts, createLessonPlan),
    updateLesson: (actor, id, input, opts = {}) =>
      write.update(actor, input, opts, updateLessonPlan(id)),
  };
}

/**
 * Shadows the `Services` of `export type * from "./types"` below, so every importer also sees the RAID and lesson
 * methods.
 */
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
export { webhookConfig, type WebhookConfig } from "./webhook";
export {
  recordGithubSnapshot,
  listOpenGithubPrs,
  githubPrQueryInput,
  GITHUB_PR_STATES,
  type GithubSnapshot,
  type GithubRepoInput,
  type GithubPrInput,
  type GithubPrState,
  type GithubPrQueryInput,
  type GithubPrCounts,
  type GithubPrsPage,
} from "./github";
export {
  issueKeyInput,
  createTaskInput,
  postProgressInput,
  setRequirementInput,
  requestDecisionInput,
  decideInput,
  updateQueryInput,
  taskQueryInput,
  activityQueryInput,
  decisionQueryInput,
  type CreateTaskInput,
  type PostProgressInput,
  type SetRequirementInput,
  type RequestDecisionInput,
  type DecideInput,
  type UpdateQueryInput,
  type TaskQueryInput,
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
