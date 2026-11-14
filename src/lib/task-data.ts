import { queryOptions } from "@tanstack/react-query";
import { listWorkspace } from "./tasks.functions";

export const tasksQuery = queryOptions({
  queryKey: ["task-workspace"],
  queryFn: () => listWorkspace(),
  refetchInterval: 30000,
});
