import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { root: '.', setupFiles: ['tests/setup-lang.ts'], include: ['tests/**/*.test.ts'], testTimeout: 30000, env: { JEV_DISABLED: '1', SH_LLM_DISABLED: '1', SH_CHAT_PACING: '0' } },
});
