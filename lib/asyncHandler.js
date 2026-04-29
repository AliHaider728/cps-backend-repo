/**
 * lib/asyncHandler.js
 * Utility for wrapping async route handlers
 */

export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};