const site = 'https://lab.mpsteam.cn';

const urls = [
  `${site}/`,
  `${site}/race/`,
  `${site}/throw-battle/`,
  `${site}/little-travel-cat/`,
  `${site}/fidget-wheel/`,
];

export const prerender = true;

export function GET() {
  const lastmod = new Date().toISOString();
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${url}</loc>
    <lastmod>${lastmod}</lastmod>
  </url>`
  )
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}
