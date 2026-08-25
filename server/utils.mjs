export const roundAmount = (value) => {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
};

export const getNow = () => new Date().toISOString();

export const makeError = (code, message) => Object.assign(new Error(message), { code });
