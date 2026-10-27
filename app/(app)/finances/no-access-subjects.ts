// What a NoAccess page can be about ("You can't see …"), each translated.
export const noAccessSubjects = ["1099s", "contractors", "expenses", "inventory", "this expense (only the person who added it can change it)", "this page", "vendors"] as const;
export type NoAccessSubject = (typeof noAccessSubjects)[number];
