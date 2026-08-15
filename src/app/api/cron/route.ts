/* eslint-disable no-console,@typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig, refineConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { fetchVideoDetail } from '@/lib/fetchVideoDetail';
import { refreshLiveChannels } from '@/lib/live';
import { SearchResult } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * CSRF protection: Verify cron secret if configured
 */
function verifyCronSecret(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;

  // If no secret is configured, allow the request (backward compatibility)
  if (!cronSecret) {
    console.warn('⚠️  CRON_SECRET not configured. Set CRON_SECRET env var for security.');
    return true;
  }

  const providedSecret = request.headers.get('X-Cron-Secret');
  if (!providedSecret) {
    console.error('❌ Cron request missing X-Cron-Secret header');
    return false;
  }

  // Use constant-time comparison to prevent timing attacks
  const secretBuffer = Buffer.from(cronSecret);
  const providedBuffer = Buffer.from(providedSecret);

  if (secretBuffer.length !== providedBuffer.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < secretBuffer.length; i++) {
    mismatch |= secretBuffer[i] ^ providedBuffer[i];
  }

  return mismatch === 0;
}

export async function GET(request: NextRequest) {
  console.log(`Cron request from: ${request.headers.get('user-agent')}`);

  // Verify CSRF token
  if (!verifyCronSecret(request)) {
    console.error('❌ Cron request denied: invalid or missing secret');
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    console.log('✅ Cron job triggered:', new Date().toISOString());

    // Run cron job in background (don't wait for completion)
    cronJob().catch((err) => {
      console.error('❌ Cron job error:', err);
    });

    return NextResponse.json({
      success: true,
      message: 'Cron job started',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Cron job failed to start:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Failed to start cron job',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

async function cronJob() {
  await refreshConfig();
  await refreshAllLiveChannels();
  await refreshRecordAndFavorites();
}

async function refreshAllLiveChannels() {
  const config = await getConfig();

  // 并发刷新所有启用的直播源，使用 Promise.allSettled 确保一个失败不影响其他
  const refreshPromises = (config.LiveConfig || [])
    .filter(liveInfo => !liveInfo.disabled)
    .map(async (liveInfo) => {
      try {
        const nums = await refreshLiveChannels(liveInfo);
        liveInfo.channelNumber = nums;
        return { status: 'fulfilled', value: liveInfo };
      } catch (error) {
        console.error(`❌ 刷新直播源失败 [${liveInfo.name || liveInfo.key}]:`, error);
        liveInfo.channelNumber = 0;
        return { status: 'rejected', reason: error };
      }
    });

  // 等待所有刷新任务完成，即使某些失败
  const results = await Promise.allSettled(refreshPromises);

  // 统计成功和失败
  const fulfilled = results.filter(r => r.status === 'fulfilled').length;
  const rejected = results.filter(r => r.status === 'rejected').length;

  console.log(`✅ 直播源刷新完成: ${fulfilled} 成功, ${rejected} 失败`);

  // 保存配置
  await db.saveAdminConfig(config);
}

async function refreshConfig() {
  let config = await getConfig();
  if (config && config.ConfigSubscribtion && config.ConfigSubscribtion.URL && config.ConfigSubscribtion.AutoUpdate) {
    try {
      const response = await fetch(config.ConfigSubscribtion.URL);

      if (!response.ok) {
        throw new Error(`请求失败: ${response.status} ${response.statusText}`);
      }

      const configContent = await response.text();

      // 对 configContent 进行 base58 解码
      let decodedContent;
      try {
        const bs58 = (await import('bs58')).default;
        const decodedBytes = bs58.decode(configContent);
        decodedContent = new TextDecoder().decode(decodedBytes);
      } catch (decodeError) {
        console.warn('⚠️  Base58 解码失败:', decodeError);
        throw decodeError;
      }

      try {
        JSON.parse(decodedContent);
      } catch (e) {
        throw new Error('配置文件格式错误，请检查 JSON 语法');
      }
      config.ConfigFile = decodedContent;
      config.ConfigSubscribtion.LastCheck = new Date().toISOString();
      config = refineConfig(config);
      await db.saveAdminConfig(config);
      console.log('✅ 配置刷新成功');
    } catch (e) {
      console.error('❌ 刷新配置失败:', e);
    }
  } else {
    console.log('ℹ️  跳过刷新：未配置订阅地址或自动更新');
  }
}

async function refreshRecordAndFavorites() {
  try {
    const users = await db.getAllUsers();
    if (process.env.USERNAME && !users.includes(process.env.USERNAME)) {
      users.push(process.env.USERNAME);
    }
    // 函数级缓存：key 为 `${source}+${id}`，值为 Promise<VideoDetail | null>
    const detailCache = new Map<string, Promise<SearchResult | null>>();

    // 获取详情 Promise（带缓存和错误处理）
    const getDetail = async (
      source: string,
      id: string,
      fallbackTitle: string
    ): Promise<SearchResult | null> => {
      const key = `${source}+${id}`;
      let promise = detailCache.get(key);
      if (!promise) {
        promise = fetchVideoDetail({
          source,
          id,
          fallbackTitle: fallbackTitle.trim(),
        })
          .then((detail) => {
            const successPromise = Promise.resolve(detail);
            detailCache.set(key, successPromise);
            return detail;
          })
          .catch((err) => {
            console.error(`❌ 获取视频详情失败 (${source}+${id}):`, err);
            return null;
          });
        detailCache.set(key, promise);
      }
      return promise;
    };

    // 并发限制工具
    const runWithConcurrency = async <T>(
      tasks: (() => Promise<T>)[],
      concurrency: number
    ): Promise<T[]> => {
      const results: T[] = [];
      let index = 0;
      const worker = async () => {
        while (index < tasks.length) {
          const i = index++;
          results[i] = await tasks[i]();
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
      return results;
    };

    // 处理单个用户的播放记录和收藏
    const processUser = async (user: string) => {
      console.log(`ℹ️  开始处理用户: ${user}`);

      // 播放记录
      try {
        const playRecords = await db.getAllPlayRecords(user);
        const entries = Object.entries(playRecords);
        const totalRecords = entries.length;
        let processedRecords = 0;

        const tasks = entries.map(([key, record]) => async () => {
          try {
            const [source, id] = key.split('+');
            if (!source || !id) {
              console.warn(`⚠️  跳过无效的播放记录键: ${key}`);
              return;
            }

            const detail = await getDetail(source, id, record.title);
            if (!detail) {
              console.warn(`⚠️  跳过无法获取详情的播放记录: ${key}`);
              return;
            }

            const episodeCount = detail.episodes?.length || 0;
            if (episodeCount > 0 && episodeCount !== record.total_episodes) {
              await db.savePlayRecord(user, source, id, {
                title: detail.title || record.title,
                source_name: record.source_name,
                cover: detail.poster || record.cover,
                index: record.index,
                total_episodes: episodeCount,
                play_time: record.play_time,
                year: detail.year || record.year,
                total_time: record.total_time,
                save_time: record.save_time,
                search_title: record.search_title,
              });
              console.log(
                `✅ 更新播放记录: ${record.title} (${record.total_episodes} -> ${episodeCount})`
              );
            }

            processedRecords++;
          } catch (err) {
            console.error(`❌ 处理播放记录失败 (${key}):`, err);
          }
        });

        await runWithConcurrency(tasks, 5);
        console.log(`✅ 播放记录处理完成: ${processedRecords}/${totalRecords}`);
      } catch (err) {
        console.error(`❌ 获取用户播放记录失败 (${user}):`, err);
      }

      // 收藏
      try {
        let favorites = await db.getAllFavorites(user);
        favorites = Object.fromEntries(
          Object.entries(favorites).filter(([_, fav]) => fav.origin !== 'live')
        );
        const favEntries = Object.entries(favorites);
        const totalFavorites = favEntries.length;
        let processedFavorites = 0;

        const tasks = favEntries.map(([key, fav]) => async () => {
          try {
            const [source, id] = key.split('+');
            if (!source || !id) {
              console.warn(`⚠️  跳过无效的收藏键: ${key}`);
              return;
            }

            const favDetail = await getDetail(source, id, fav.title);
            if (!favDetail) {
              console.warn(`⚠️  跳过无法获取详情的收藏: ${key}`);
              return;
            }

            const favEpisodeCount = favDetail.episodes?.length || 0;
            if (favEpisodeCount > 0 && favEpisodeCount !== fav.total_episodes) {
              await db.saveFavorite(user, source, id, {
                title: favDetail.title || fav.title,
                source_name: fav.source_name,
                cover: favDetail.poster || fav.cover,
                year: favDetail.year || fav.year,
                total_episodes: favEpisodeCount,
                save_time: fav.save_time,
                search_title: fav.search_title,
              });
              console.log(
                `✅ 更新收藏: ${fav.title} (${fav.total_episodes} -> ${favEpisodeCount})`
              );
            }

            processedFavorites++;
          } catch (err) {
            console.error(`❌ 处理收藏失败 (${key}):`, err);
          }
        });

        await runWithConcurrency(tasks, 5);
        console.log(`✅ 收藏处理完成: ${processedFavorites}/${totalFavorites}`);
      } catch (err) {
        console.error(`❌ 获取用户收藏失败 (${user}):`, err);
      }
    };

    // 用户间并发处理（限制 3 个用户同时处理）
    const userTasks = users.map((user) => () => processUser(user));
    await runWithConcurrency(userTasks, 3);

    console.log('✅ 刷新播放记录/收藏任务完成');
  } catch (err) {
    console.error('❌ 刷新播放记录/收藏任务启动失败', err);
  }
}
