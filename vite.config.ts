import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const devDataPlugin = {
  name: 'dev-data',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configureServer(server: any) {
    server.middlewares.use((req: any, res: any, next: any) => {
      if (req.url === '/recipes.json' || req.url === '/tags.json') {
        res.setHeader('Content-Type', 'application/json');
        res.end(readFileSync(resolve('dev-data', req.url.slice(1))));
      } else {
        next();
      }
    });
  }
};

export default defineConfig({
  plugins: [sveltekit(), devDataPlugin],
  // Svelte ships separate client and server builds; without the browser condition
  // Vitest resolves the server one and component tests cannot mount.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,
  test: {
    environment: 'jsdom',
    globals: true
  }
});
