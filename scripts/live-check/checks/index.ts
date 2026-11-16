import type { LiveCheck } from "../types.ts";
import { checks as boards } from "./boards.ts";
import { checks as overview } from "./overview.ts";
import { checks as tasks } from "./tasks.ts";

export const allChecks: readonly LiveCheck[] = [...tasks, ...overview, ...boards];
