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
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseBookQuery(query) {
  const parts = query.split(/\s+(?:by|—|-)\s+/i);
  return { title: parts[0].trim(), author: parts.slice(1).join(' ').trim() };
}

function importantTokens(value) {
  return normalize(value).split(' ').filter((token) => token.length > 2 && !['the', 'and', 'for', 'with', 'book', 'edition', 'novel'].includes(token));
}

function tokenCoverage(tokens, haystack) {
  if (!tokens.length) return 1;
  return tokens.filter((token) => haystack.includes(token)).length / tokens.length;
}

function scoreProduct(query, candidate) {
  const wanted = parseBookQuery(query);
  const titleTokens = importantTokens(wanted.title);
  const authorTokens = importantTokens(wanted.author);
  const title = normalize(candidate.title);
  const facts = normalize(`${candidate.authors || ''} ${candidate.details || ''}`);
  const titleCoverage = tokenCoverage(titleTokens, title);
  const authorCoverage = tokenCoverage(authorTokens, facts);
  let score = titleCoverage * 80 + authorCoverage * 55;
  if (title === normalize(wanted.title)) score += 45;
  if (!wanted.author && title.startsWith(normalize(wanted.title))) score += 20;
  if (wanted.author && facts.includes(normalize(wanted.author))) score += 35;
  if (/paperback|hardcover/i.test(candidate.details || '')) score += 4;
  if (/summary|workbook|journal|planner|study guide|key takeaways|audiobook|kindle|box set/i.test(candidate.title) &&
      !/summary|workbook|journal|planner|study guide|key takeaways|audiobook|kindle|box set/i.test(query)) score -= 80;
  if (!wanted.author && /box set|collection|combo|pack of|set of|bundle|complete series/i.test(candidate.title)) score -= 100;
  return { ...candidate, score, titleCoverage, authorCoverage };
}

function rankProducts(query, candidates) {
  return candidates.map((candidate) => scoreProduct(query, candidate)).sort((left, right) => right.score - left.score);
}

function isVerifiedMatch(product) {
  const requestedAuthor = parseBookQuery(product.query).author;
  return requestedAuthor
    ? product.titleCoverage >= 0.7 && product.authorCoverage >= 0.5
    : product.titleCoverage >= 0.9;
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
      const authors = [...card.querySelectorAll('.a-row .a-size-base.a-link-normal, .a-row .a-size-base')]
        .map((element) => element.innerText?.trim()).filter(Boolean).join(' ');
      return link && title ? { url: link.href, title, authors, details: card.innerText } : null;
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
    '#detailBullets_feature_div', '#detailBulletsWrapper_feature_div', '#productDetails_techSpec_section_1',
    '#productDetails_detailBullets_sections1', '#productDetails_db_sections', '#productDetails_bookDetails_section',
    '#bookDetails_feature_div', '#productDetailsTable'
  ].map((selector) => document.querySelector(selector)?.innerText || '').filter(Boolean).join(' ');
  const title = document.querySelector('#productTitle')?.innerText?.trim() || '';
  const authors = document.querySelector('#bylineInfo')?.innerText?.trim() || '';
  const structuredMetadata = [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((script) => script.textContent || '').join(' ');
  const allDetails = `${detailsText} ${structuredMetadata} ${document.body.innerText}`
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, ' ');
  const isbnMatches = [...allDetails.matchAll(/ISBN\s*(?:-|–|—)?\s*13\s*[^0-9]{0,24}((?:978|979)(?:[\s-]*\d){10})/gi)];
  for (const match of isbnMatches) {
    const isbn = match[1].replace(/\D/g, '');
    if (!/^(978|979)\d{10}$/.test(isbn)) continue;
    const sum = [...isbn.slice(0, 12)].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
    if ((10 - (sum % 10)) % 10 === Number(isbn[12])) return { isbn, title, authors };
  }
  return { title, authors, error: 'The selected product page does not list a valid ISBN-13.' };
}

async function runInTab(tabId, func) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func });
  return result;
}

async function findBook(title) {
  const searchUrl = `${AMAZON_BASE_URL}/s?k=${encodeURIComponent(`${title} paperback`)}&i=stripbooks`;
  const tab = await chrome.tabs.create({ url: searchUrl, active: false });
  try {
    await waitForPage(tab.id);
    const searchResult = await runInTab(tab.id, inspectSearchPage);
    if (searchResult.error) return { query: title, isbn_13: null, message: searchResult.error };
    const products = rankProducts(title, searchResult.candidates).slice(0, 3);
    const verified = [];
    for (const candidate of products) {
      await chrome.tabs.update(tab.id, { url: candidate.url });
      await waitForPage(tab.id);
      const productResult = await runInTab(tab.id, inspectProductPage);
      if (!productResult.isbn) continue;
      const scoredProduct = scoreProduct(title, {
        ...candidate,
        title: productResult.title || candidate.title,
        authors: productResult.authors || candidate.authors,
      });
      scoredProduct.query = title;
      if (isVerifiedMatch(scoredProduct)) verified.push({ ...scoredProduct, isbn: productResult.isbn });
    }
    const bestMatch = verified.sort((left, right) => right.score - left.score)[0];
    return bestMatch
      ? { query: title, isbn_13: bestMatch.isbn }
      : { query: title, isbn_13: null, message: 'Amazon listings did not provide a closely matching title and author with an ISBN-13.' };
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
