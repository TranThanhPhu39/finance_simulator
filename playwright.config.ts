import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'apps/web/test',testMatch:'*.spec.ts',workers:1,timeout:90000,
  use:{baseURL:process.env.WEB_URL??'http://127.0.0.1:5173',viewport:{width:1440,height:1000},headless:true,trace:'retain-on-failure'},
  outputDir:'.runtime/playwright-results',reporter:'list'});
