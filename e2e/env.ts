/** Ports of the e2e servers (see playwright.config.ts). */
export const API_PORT = 4417;
export const WEB_PORT = 5299;
/** A second server pair with demo content, as on a first launch (M7). */
export const DEMO_API_PORT = 4418;
export const DEMO_WEB_PORT = 5300;
export const DEMO_BASE_URL = `http://127.0.0.1:${DEMO_WEB_PORT}`;
