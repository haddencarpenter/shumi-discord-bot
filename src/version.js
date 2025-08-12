export const version = process.env.GIT_SHA ?? `dev-${new Date().toISOString()}`;
export const shortVersion = version.slice(0, 12);
export const startedAt = new Date().toISOString();