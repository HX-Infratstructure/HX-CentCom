<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

## Workspace architecture
- Shared workspace chrome lives in src/components/workspace.tsx; content stays in TanStack file routes so dashboard and timeline use one navigation system.
- Task reads use public read-only server functions and Query loaders; progress writes require verified authentication plus explicit task_editors membership so account creation never grants project write access.
- Task progress history is recorded by a database trigger with each update so chart progress and update logs cannot diverge.
- Draft planning dates are labeled explicitly and unreported active-task progress is never presented as a measured percentage.
- Owner decisions, requirement coverage, and GitHub PR/repo heads are read through the single public task-workspace server function; overview numbers are computed from it in src/lib/task-data.ts so displayed counts cannot drift from data.
- GitHub sync runs as a cron-authenticated server route writing github_prs/github_repos with the admin client; task progress writes are limited by RLS to the editor's mapped agent.
