// Bridges lookup requests between the deployed website and this extension.
window.addEventListener('message', async (event) => {
  if (event.source !== window || event.data?.source !== 'ISBN_SCRAPER_WEB') return;

  if (event.data.type === 'ISBN_EXTENSION_PING') {
    window.postMessage({ source: 'ISBN_SCRAPER_EXTENSION', type: 'ISBN_EXTENSION_READY' }, window.location.origin);
    return;
  }

  if (event.data.type !== 'ISBN_EXTENSION_LOOKUP') return;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'LOOK_UP_BOOKS', books: event.data.books });
    window.postMessage({
      source: 'ISBN_SCRAPER_EXTENSION',
      type: 'ISBN_EXTENSION_RESULTS',
      requestId: event.data.requestId,
      results: response.results
    }, window.location.origin);
  } catch (error) {
    window.postMessage({
      source: 'ISBN_SCRAPER_EXTENSION',
      type: 'ISBN_EXTENSION_ERROR',
      requestId: event.data.requestId,
      message: error.message || 'The extension could not complete the lookup.'
    }, window.location.origin);
  }
});
