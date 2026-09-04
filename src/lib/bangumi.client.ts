'use client';

export interface BangumiCalendarData {
  weekday: {
    en: string;
  };
  items: {
    id: number;
    name: string;
    name_cn: string;
    rating: {
      score: number;
    };
    air_date: string;
    images: {
      large: string;
      common: string;
      medium: string;
      small: string;
      grid: string;
    };
  }[];
}

// 修复图片 CDN 地址
function rewriteImages(data: BangumiCalendarData[]): BangumiCalendarData[] {
  return data.map(day => ({
    ...day,
    items: day.items.map(item => ({
      ...item,
      images: Object.fromEntries(
        Object.entries(item.images).map(([key, url]) => [
          key,
          typeof url === 'string'
            ? url.replace('http://lain.bgm.tv/', 'https://lain.bgm38.tv/')
                .replace('https://lain.bgm.tv/', 'https://lain.bgm38.tv/')
            : url,
        ])
      ) as typeof item.images,
    })),
  }));
}

export async function GetBangumiCalendarData(): Promise<BangumiCalendarData[]> {
  // 直接使用服务端 AniList 接口（含可达图床），绕过不可达的 bgm.tv 图床
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch('/api/bangumi/calendar', {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`获取番剧日历失败: HTTP ${response.status}`);
    }
    const data = await response.json();
    return rewriteImages(data);
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
