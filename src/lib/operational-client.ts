const TEST_CLIENT_NAME = /^z/i;

export function isOperationalClientName(value: unknown): boolean {
  return typeof value === "string" && !TEST_CLIENT_NAME.test(value.trim());
}
