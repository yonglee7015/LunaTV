/**
 * 通用的豆瓣数据获取函数
 * @param url 请求的URL
 * @returns Promise<T> 返回指定类型的数据
 */

/**
 * 根据 NEXT_PUBLIC_DOUBAN_PROXY_TYPE 返回可达的豆瓣域名前缀。
 * 服务端直连 m.douban.com 常超时，配置为 cmliussss CDN 时切换到对应镜像域名。
 */
export function getDoubanBaseHost(): string {
  const type = process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'direct';
  if (type === 'cmliussss-cdn-tencent') return 'm.douban.cmliussss.net';
  if (type === 'cmliussss-cdn-ali') return 'm.douban.cmliussss.com';
  return 'm.douban.com';
}

export async function fetchDoubanData<T>(url: string): Promise<T> {
  // 添加超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

  // 设置请求选项，包括信号和头部
  const fetchOptions = {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Referer: 'https://movie.douban.com/',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://movie.douban.com',
    },
  };

  try {
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}
