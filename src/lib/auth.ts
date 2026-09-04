import { NextRequest } from 'next/server';

// 从cookie获取认证信息 (服务端使用)
export function getAuthInfoFromCookie(request: NextRequest): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
} | null {
  const authCookie = request.cookies.get('auth');

  if (!authCookie) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(authCookie.value);
    const authData = JSON.parse(decoded);
    return authData;
  } catch (error) {
    return null;
  }
}

// 从cookie获取认证信息 (客户端使用)
export function getAuthInfoFromBrowserCookie(): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
  role?: 'owner' | 'admin' | 'user';
} | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // 解析 document.cookie
    const cookies = document.cookie.split(';').reduce((acc, cookie) => {
      const trimmed = cookie.trim();
      const firstEqualIndex = trimmed.indexOf('=');

      if (firstEqualIndex > 0) {
        const key = trimmed.substring(0, firstEqualIndex);
        const value = trimmed.substring(firstEqualIndex + 1);
        if (key && value) {
          acc[key] = value;
        }
      }

      return acc;
    }, {} as Record<string, string>);

    const authCookie = cookies['auth'];
    if (!authCookie) {
      return null;
    }

    // 兼容不同编码方案（服务端可能对 cookie 进行 encodeURIComponent，浏览器 cookie 再编码一次导致双重编码）
    let decoded = authCookie;

    // 检查是否以 'v1:' 开头（版本控制）
    if (decoded.startsWith('v1:')) {
      decoded = decoded.substring(3);
    } else if (decoded.startsWith('v0:')) {
      decoded = decoded.substring(3);
    }

    // 反复解码直到能解析为合法 JSON（处理单/双重编码）
    let parsed: { password?: string; username?: string; signature?: string; timestamp?: number; role?: 'owner' | 'admin' | 'user' } | null = null;
    for (let i = 0; i < 3; i++) {
      try {
        parsed = JSON.parse(decoded);
        break;
      } catch {
        // 解码失败，尝试再 decode 一次
        try {
          decoded = decodeURIComponent(decoded);
        } catch {
          break;
        }
      }
    }

    if (!parsed) {
      // 最后的兜底：若仍未解析成功，尝试对原文直接 parse
      try {
        parsed = JSON.parse(authCookie);
      } catch {
        return null;
      }
    }

    return parsed;
  } catch (error) {
    return null;
  }
}
