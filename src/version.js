export const version = process.env.GIT_SHA ?? `dev-${new Date().toISOString()}`;
export const startedAt = new Date().toISOString();