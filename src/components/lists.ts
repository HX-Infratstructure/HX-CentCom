import {
  ACTIVITY_ENTITY_LABELS,
  DECISION_STATUS_LABELS,
  GATE_TYPE_LABELS,
  LESSON_STATUS_LABELS,
  PR_STATE_LABELS,
  RAID_STATUS_LABELS,
  RAID_TYPE_LABELS,
  SEVERITY_LABELS,
  UPDATE_SOURCE_LABELS,
} from "./model";
import { facet, listSearch } from "./list-search";

/**
 * The URL contract of every list that SPEC 6 and 6.1 say can pass about 20 rows. Adding a list is one entry here. A
 * key shared by two lists (`agent`, `task`) is the same facet kind in both, so it has one meaning on every route.
 */
export const lists = {
  overviewFeed: listSearch({
    facets: { agent: facet.agent(), task: facet.open("Task") },
  }),
  // On /tasks the agent filter is page-wide: `board.agent` filters the board, the timeline and this log alike.
  updateLog: listSearch({
    facets: {
      task: facet.open("Task"),
      source: facet.closed("Source", UPDATE_SOURCE_LABELS),
      posted: facet.days("Posted"),
    },
  }),
  // SPEC 6 asks for "agent, program"; no program column exists, so the board reads `repository` (CC1, B2 step 2).
  board: listSearch({
    facets: { agent: facet.agent(), repo: facet.open("Repository") },
  }),
  decisions: listSearch({
    facets: {
      type: facet.closed("Type", GATE_TYPE_LABELS),
      status: facet.closed("Status", DECISION_STATUS_LABELS),
    },
  }),
  raid: listSearch({
    facets: {
      type: facet.closed("Type", RAID_TYPE_LABELS, "tabs"),
      severity: facet.closed("Severity", SEVERITY_LABELS),
      status: facet.closed("Status", RAID_STATUS_LABELS),
      owner: facet.agent("Owner"),
      task: facet.open("Task"),
    },
  }),
  lessons: listSearch({
    facets: { status: facet.closed("Status", LESSON_STATUS_LABELS), tag: facet.open("Tag") },
  }),
  activity: listSearch({
    facets: { actor: facet.agent("Actor"), entity: facet.closed("Record", ACTIVITY_ENTITY_LABELS) },
  }),
  prs: listSearch({
    facets: { repo: facet.open("Repository"), state: facet.closed("State", PR_STATE_LABELS) },
  }),
};
