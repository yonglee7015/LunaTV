import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const SCRYPT_COST = 16384; // N
const BLOCK_SIZE = 8; // r
const PARALLELIZATION = 1; // p

/**
 * 对密码进行加盐哈希，返回格式: `salt:hash`
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_COST,
    r: BLOCK_SIZE,
    p: PARALLELIZATION,
  }).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * 验证密码是否匹配存储的哈希值
 * 支持加盐哈希格式: `salt:hash` (新格式)
 * 旧格式明文密码已不推荐，应立即迁移
 */
export function verifyPassword(
  password: string,
  storedValue: string
): boolean {
  // 判断是否为加盐哈希格式 (salt:hash, salt 32 hex chars, hash 128 hex chars)
  const parts = storedValue.split(':');
  if (
    parts.length === 2 &&
    parts[0].length === SALT_LENGTH * 2 &&
    parts[1].length === KEY_LENGTH * 2
  ) {
    const [salt, storedHash] = parts;
    const hash = scryptSync(password, salt, KEY_LENGTH, {
      N: SCRYPT_COST,
      r: BLOCK_SIZE,
      p: PARALLELIZATION,
    });
    const storedHashBuf = Buffer.from(storedHash, 'hex');
    return timingSafeEqual(hash, storedHashBuf);
  }

  // 旧格式：明文密码 - 使用 timingSafeEqual 防止时序攻击
  // 建议：应在登录成功后立即触发密码哈希迁移
  const providedBuf = Buffer.from(password);
  const storedBuf = Buffer.from(storedValue);

  // 检查长度是否匹配，防止长度泄露
  if (providedBuf.length !== storedBuf.length) {
    // 创建等长缓冲区进行假比较，防止时序泄露
    const dummyBuf = Buffer.alloc(storedBuf.length);
    try {
      timingSafeEqual(providedBuf.length > 0 ? providedBuf : dummyBuf, dummyBuf);
    } catch {
      // 比较失败，返回 false
    }
    return false;
  }

  try {
    return timingSafeEqual(providedBuf, storedBuf);
  } catch {
    return false;
  }
}

/**
 * 判断存储的密码值是否已经是加盐哈希格式
 */
export function isHashed(storedValue: string): boolean {
  const parts = storedValue.split(':');
  return (
    parts.length === 2 &&
    parts[0].length === SALT_LENGTH * 2 &&
    parts[1].length === KEY_LENGTH * 2
  );
}
