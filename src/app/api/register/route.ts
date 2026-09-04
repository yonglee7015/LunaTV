/* eslint-disable no-console, @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// 开放自助注册：普通用户输入用户名+密码即可注册账号
export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    const name = username.trim();
    if (!name) {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json(
        { error: '密码至少 6 位' },
        { status: 400 }
      );
    }

    // 不能占用站长账号
    if (name === process.env.USERNAME) {
      return NextResponse.json(
        { error: '该用户名已被占用' },
        { status: 409 }
      );
    }

    // 用户名是否已存在
    const exists = await db.checkUserExist(name);
    if (exists) {
      return NextResponse.json(
        { error: '该用户名已被注册' },
        { status: 409 }
      );
    }

    // 注册用户（存入密码哈希 + 用户集合）
    await db.registerUser(name, password);

    // 同步写入配置中的用户列表，便于后台权限管理
    try {
      const config = await getConfig();
      if (!config.UserConfig) config.UserConfig = { Users: [] };
      if (!config.UserConfig.Users) config.UserConfig.Users = [];
      if (!config.UserConfig.Users.some((u) => u.username === name)) {
        config.UserConfig.Users.push({
          username: name,
          role: 'user',
          banned: false,
        });
        await db.saveAdminConfig(config);
      }
    } catch (e) {
      console.warn('注册后同步用户列表失败（不影响登录）:', e);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('注册接口异常:', error);
    return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 });
  }
}
