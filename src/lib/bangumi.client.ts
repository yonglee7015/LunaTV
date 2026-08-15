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
  // 直接请求 bgm.tv API（浏览器端可访问）
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://api.bgm.tv/calendar', {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
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
    // 如果浏览器端也失败，回退到服务端 API
    console.warn('浏览器端请求 bgm.tv 失败，回退到服务端 API:', error);
    const response = await fetch('/api/bangumi/calendar');
    if (!response.ok) {
      throw new Error(`获取番剧日历失败: HTTP ${response.status}`);
    }
    const data = await response.json();
    return rewriteImages(data);
  }
}
