const AMAZON_BASE_URL = 'https://www.amazon.in';
const PAGE_TIMEOUT_MS = 25000;

async function waitForPage(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (tab.status === 'complete') return;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('Amazon page took too long to load.'));
    }, PAGE_TIMEOUT_MS);
    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function selectBestProduct(query, candidates) {
  const normalizedQuery = normalize(query);
  const queryTokens = normalizedQuery.split(' ').filter((token) => token.length > 2 && !['the', 'and', 'for', 'with', 'book', 'edition'].includes(token));
  return candidates
    .map((candidate) => {
      const title = normalize(candidate.title);
      let score = queryTokens.filter((token) => title.includes(token)).length * 3;
      if (title.includes(normalizedQuery)) score += 20;
      if (/paperback/i.test(candidate.details)) score += 2;
      if (/indian edition|india/i.test(candidate.details)) score += 1;
      return { ...candidate, score };
    })
    .sort((left, right) => right.score - left.score)[0];
}

function inspectSearchPage() {
  const pageText = document.body.innerText;
  if (/captcha|robot check|enter the characters you see below/i.test(pageText)) {
    return { error: 'Amazon requested a CAPTCHA. Open Amazon India and complete it, then try again.' };
  }
  const candidates = [...document.querySelectorAll('[data-component-type="s-search-result"]')]
    .map((card) => {
      const link = card.querySelector('h2 a[href*="/dp/"], a.a-link-normal.s-no-outline[href*="/dp/"]');
      const title = card.querySelector('h2 span')?.innerText?.trim();
      return link && title ? { url: link.href, title, details: card.innerText } : null;
    })
    .filter(Boolean);
  return candidates.length ? { candidates } : { error: 'No matching Amazon product page was found.' };
}

function inspectProductPage() {
  const pageText = document.body.innerText;
  if (/captcha|robot check|enter the characters you see below/i.test(pageText)) {
    return { error: 'Amazon requested a CAPTCHA. Open Amazon India and complete it, then try again.' };
  }
  const detailsText = [
    '#detailBullets_feature_div', '#productDetails_techSpec_section_1',
    '#productDetails_detailBullets_sections1', '#productDetails_db_sections', '#productDetails_bookDetails_section'
  ].map((selector) => document.querySelector(selector)?.innerText || '').filter(Boolean).join(' ');
  const match = detailsText.match(/ISBN\s*-?\s*13\s*[:\s]+((?:978|979)(?:[-\s]?\d){10})/i);
  if (!match) return { error: 'The selected product page does not list an ISBN-13 in Product Details.' };
  const isbn = match[1].replace(/\D/g, '');
  if (!/^(978|979)\d{10}$/.test(isbn)) return { error: 'Amazon returned an invalid ISBN-13.' };
  const sum = [...isbn.slice(0, 12)].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(isbn[12])
    ? { isbn }
    : { error: 'Amazon returned an ISBN with an invalid check digit.' };
}

async function runInTab(tabId, func) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func });
  return result;
}

async function findBook(title) {
  const searchUrl = `${AMAZON_BASE_URL}/s?k=${encodeURIComponent(`${title} paperback Indian edition`)}&i=stripbooks`;
  const tab = await chrome.tabs.create({ url: searchUrl, active: false });
  try {
    await waitForPage(tab.id);
    const searchResult = await runInTab(tab.id, inspectSearchPage);
    if (searchResult.error) return { query: title, isbn_13: null, message: searchResult.error };
    const product = selectBestProduct(title, searchResult.candidates);
    await chrome.tabs.update(tab.id, { url: product.url });
    await waitForPage(tab.id);
    const productResult = await runInTab(tab.id, inspectProductPage);
    return productResult.isbn
      ? { query: title, isbn_13: productResult.isbn }
      : { query: title, isbn_13: null, message: productResult.error };
  } catch (error) {
    return { query: title, isbn_13: null, message: error.message || 'Unable to load Amazon.' };
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'LOOK_UP_BOOKS') return;
  (async () => {
    const results = [];
    for (const title of message.books) results.push(await findBook(title));
    sendResponse({ results });
  })();
  return true;
});
