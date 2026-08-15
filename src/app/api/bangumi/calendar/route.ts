import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';

export const runtime = 'nodejs';

// 当前季度信息（需要每季更新）
function getCurrentSeason() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 1 && month <= 3) return { season: 'WINTER', year };
  if (month >= 4 && month <= 6) return { season: 'SPRING', year };
  if (month >= 7 && month <= 9) return { season: 'SUMMER', year };
  return { season: 'FALL', year };
}

// 星期映射（AniList 使用英文，需要映射到中文）
const WEEKDAY_MAP: Record<string, string> = {
  SUNDAY: '星期日',
  MONDAY: '星期一',
  TUESDAY: '星期二',
  WEDNESDAY: '星期三',
  THURSDAY: '星期四',
  FRIDAY: '星期五',
  SATURDAY: '星期六',
};

export async function GET() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const { season, year } = getCurrentSeason();

    // 使用 AniList GraphQL API（全球可访问）
    const query = `query($season: MediaSeason, $year: Int) { Page(perPage: 100) { media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC) { title { romaji native } coverImage { large medium } episodes averageScore siteUrl synonyms startDate { day month year } nextAiringEpisode { airingAt timeUntilAiring } status } } }`;

    const response = await fetch('https://graphql.anilist.co', {
      signal: controller.signal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables: { season, year } }),
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`AniList API error! Status: ${response.status}`);
    }

    const result = await response.json();
    const animeList = result.data?.Page?.media || [];

    // 按播出日期分组到星期
    const weekdayGroups: Record<string, any[]> = {};
    const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    weekdays.forEach(w => { weekdayGroups[w] = []; });

    for (const anime of animeList) {
      // 优先使用中文译名（synonyms 中可能包含）
      let nameCn = '';
      const synonyms = anime.synonyms || [];
      // 找可能是中文的译名（不含日文假名和英文字母的）
      for (const syn of synonyms) {
        if (/^[一-鿿！-～\s·]+$/.test(syn) && syn.length > 1) {
          nameCn = syn;
          break;
        }
      }

      const startDate = anime.startDate;
      const airDate = startDate ? `${startDate.year}-${String(startDate.month || 0).padStart(2, '0')}-${String(startDate.day || 0).padStart(2, '0')}` : '';

      // 计算星期
      let weekday = 'MONDAY';
      if (airDate) {
        try {
          const d = new Date(airDate);
          if (!isNaN(d.getTime())) {
            const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
            weekday = days[d.getDay()];
          }
        } catch { /* ignore */ }
      }

      weekdayGroups[weekday].push({
        id: anime.siteUrl ? parseInt(anime.siteUrl.split('/').pop()) : 0,
        url: anime.siteUrl || '',
        type: 2,
        name: anime.title.native || anime.title.romaji,
        name_cn: nameCn || anime.title.romaji,
        summary: '',
        air_date: airDate,
        air_weekday: weekdays.indexOf(weekday) + 1,
        rating: {
          total: 0,
          count: {},
          score: anime.averageScore ? (anime.averageScore / 10).toFixed(1) : 0,
        },
        images: {
          large: anime.coverImage?.large || '',
          common: anime.coverImage?.medium || '',
          medium: anime.coverImage?.medium || '',
          small: anime.coverImage?.medium || '',
          grid: anime.coverImage?.medium || '',
        },
      });
    }

    // 转换为 bgm.tv 日历格式
    const calendarData = weekdays.map(w => ({
      weekday: {
        en: w.charAt(0) + w.slice(1).toLowerCase(),
        cn: WEEKDAY_MAP[w] || w,
        ja: ['月耀日', '火耀日', '水耀日', '木耀日', '金耀日', '土耀日', '日耀日'][weekdays.indexOf(w)] || w,
        id: weekdays.indexOf(w) + 1,
      },
      items: weekdayGroups[w],
    }));

    const cacheTime = await getCacheTime();

    return NextResponse.json(calendarData, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      },
    });
  } catch (error) {
    clearTimeout(timeoutId);
    return NextResponse.json(
      { error: '获取番剧日历失败', details: (error as Error).message },
      { status: 500 }
    );
  }
}
