const crypto = require('crypto');
const storage = require('./storage');

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

// Hash password using crypto.scrypt with a random 16-byte salt
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

// Timing-safe password verification
function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(key, 'hex');
  return crypto.timingSafeEqual(derivedKey, keyBuffer);
}

// Create new secure session
async function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  await storage.setSession(token, username, expiresAt);
  return { token, expiresAt };
}

// Invalidate session
async function destroySession(token) {
  if (token) {
    await storage.deleteSession(token);
  }
}

// Validate session
async function validateSession(token) {
  if (!token) return null;
  return await storage.getSession(token);
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  validateSession
};
