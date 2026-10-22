const booksInput = document.querySelector('#books');
const findButton = document.querySelector('#find');
const status = document.querySelector('#status');
const results = document.querySelector('#results');

function escapeHtml(value) {
  const element = document.createElement('span');
  element.textContent = value;
  return element.innerHTML;
}

function renderRows(items) {
  const rows = items.map((item) => {
    const value = item.isbn_13
      ? `<span class="found">${escapeHtml(item.isbn_13)}</span>`
      : `<span class="missing">${escapeHtml(item.message || 'Not found')}</span>`;
    return `<tr><td>${escapeHtml(item.query)}</td><td>${value}</td></tr>`;
  }).join('');
  results.innerHTML = `<table><thead><tr><th>Book</th><th>ISBN-13</th></tr></thead><tbody>${rows}</tbody></table>`;
}

findButton.addEventListener('click', async () => {
  const books = booksInput.value.split('\n').map((book) => book.trim()).filter(Boolean);
  if (!books.length) {
    status.textContent = 'Enter at least one book title.';
    return;
  }

  findButton.disabled = true;
  results.innerHTML = '';
  status.textContent = 'Searching Amazon India…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'LOOK_UP_BOOKS', books });
    renderRows(response.results);
    status.textContent = 'Lookup complete.';
  } catch (error) {
    status.textContent = error.message || 'The lookup could not be completed.';
  } finally {
    findButton.disabled = false;
  }
});
