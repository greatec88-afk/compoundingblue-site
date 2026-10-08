import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 站点正式域名。部署到 Cloudflare Pages 后若用其他域名，改这里即可。
export default defineConfig({
  site: 'https://compoundingblue.com',
  integrations: [sitemap()],
});
