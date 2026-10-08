import { defineCollection, z } from 'astro:content';

// 文章集合。新增文章 = 在 src/content/posts/ 下加一个 .md 文件，
// 顶部按下面的字段写好 frontmatter 即可。
const posts = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    author: z.string().default('Compounding Blue'),
    pillar: z.string().optional(),      // 所属栏目 / 支柱，如「四支柱框架」「估值纪律」
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),  // true = 不发布（人工闸门用）
  }),
});

export const collections = { posts };
