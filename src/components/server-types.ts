/**
 * The seam between the server and the component layer. It is the only file in src/components
 * that names `@/server/*`, it imports only the service layer's public surface (SPEC 8.1), and
 * every line is type-only, so no drizzle or service code reaches the browser bundle.
 */
import type {
  ActivityEntry,
  Agent,
  DecideInput,
  Decision,
  Requirement,
  Task,
  TaskUpdate,
} from "@/server/services";

export type {
  ActivityEntry,
  Agent,
  DecideInput,
  Decision,
  DecisionCounts,
  DecisionsPage,
  ErrorCode,
  Issue,
  Lesson,
  LessonCounts,
  LessonStatus,
  LessonsPage,
  Page,
  Progress,
  PullRequest,
  RaidCounts,
  RaidItem,
  RaidPage,
  RaidStatus,
  RaidType,
  RepoHead,
  Requirement,
  ServiceErrorBody,
  Severity,
  StatusLabel,
  Task,
  TaskUpdate,
  UpdateCounts,
  UpdatesPage,
  ValidationState,
  Workspace,
} from "@/server/services";

// The public surface exports rows, not the schema's closed unions, so each union is read off
// the row that carries it.
export type AgentRole = Agent["role"];
export type TaskGroup = Task["group"];
export type BlockedOn = Task["blocked_on"];
export type UpdateKind = TaskUpdate["kind"];
export type UpdateSource = NonNullable<TaskUpdate["source"]>;
export type UpdateLink = TaskUpdate["links"][number];
export type RequirementState = Requirement["state"];
export type GateType = Decision["gate_type"];
export type DecisionStatus = Decision["status"];
export type DecisionOption = Decision["options"][number];
export type ActivityEntity = ActivityEntry["entity"];
export type ActivityAction = ActivityEntry["action"];

/** Every timestamptz column arrives as ISO-8601 UTC text (`isoTimestamp` in the schema). */
export type Timestamp = string;
export type OwnerDecisionStatus = DecideInput["status"];
