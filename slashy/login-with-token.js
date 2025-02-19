import puppeteer from 'puppeteer';

const tokenArg = process.argv[2] || '';
if (!tokenArg) {
  console.log('[ERROR] No token provided as argument');
  process.exit(1);
}

(async () => {
  try {
    const browser = await puppeteer.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ],
    });

    const page = await browser.newPage();

    // Insert token into localStorage
    await page.evaluateOnNewDocument((theToken) => {
      Object.defineProperty(window, 'localStorage', {
        value: window.localStorage,
        configurable: true,
        enumerable: true,
        writable: true
      });
      window.localStorage.setItem('token', `"${theToken}"`);
    }, tokenArg);

    await page.goto('https://discord.com/channels/@me', { waitUntil: 'networkidle2' });
    console.log('[INFO] If the token is valid, Discord should be logged in now.');
  } catch (err) {
    console.log(`[ERROR] ${err.message}`);
  }
})();
