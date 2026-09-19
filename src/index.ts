import { createApp } from './app';
import { config } from './config';

createApp().listen(config.port, () => {
  console.log(`Events API listening on http://localhost:${config.port}/api/v1`);
});