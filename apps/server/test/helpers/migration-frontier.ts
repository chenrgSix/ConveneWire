// Explicit expected migration frontier; update when adding a production migration.
// Keeping it independent of directory discovery catches missing/skipped versions.
export const expectedSchemaVersion = 98;
export function migrationVersionsAfter(previous: number): number[] {
  return Array.from({ length: expectedSchemaVersion - previous }, (_, index) => previous + index + 1);
}
