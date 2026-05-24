// 真正啟動的進入點；單元測試 import createApp 而不啟動 listen
import { createApp } from './app';
import { getLogger } from './lib/logger';

const port = Number(process.env.PORT ?? 8080);
const app = createApp();
const log = getLogger();

app.listen(port, () => {
  log.info({ port }, '[backend] listening');
});
