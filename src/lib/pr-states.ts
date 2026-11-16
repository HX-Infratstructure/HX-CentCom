/**
 * The pull request states in the Pull requests board's order (still moving, landed, ended, left GitHub), which is
 * also the order `listGithubPrs` pages in.
 */
export const PR_STATES = ["open", "merged", "closed", "gone"] as const;
