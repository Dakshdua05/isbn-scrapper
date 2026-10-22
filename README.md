# ISBN Scrapper

ISBN Scrapper helps you build a list of books and find their ISBN-13 values from Amazon India.

**Live website:** [isbn-scrapper.vercel.app](https://isbn-scrapper.vercel.app)

## What it does

- Search multiple book titles at once.
- Suggest book titles and authors while you type.
- Add a title and author from a suggestion with a click or the arrow keys and Enter.
- Upload an image to extract book titles and authors before looking up ISBNs.
- Create a separate deduplicated list of titles and authors from a photo of book covers or spines.
- Removes repeated entries and quantity labels such as `Qty: 4` or `x 3`.
- Looks up ISBN-13 details from Amazon India through a browser extension, so the lookup runs in your own browser session.

## How to use

1. Open [the live website](https://isbn-scrapper.vercel.app).
2. Type a title in **Book titles** and select a suggestion, or paste one book per line.
3. Optional: choose **Add a picture** to read books from an image.
4. Install the Chrome extension described below.
5. Select **Find ISBNs**.

Each result is displayed as:

```text
Book title by Author — ISBN-13
```

## Install the Chrome extension

The extension opens Amazon India search and product pages in your browser to find ISBN-13 values.

1. Download or clone this repository.
2. Open Chrome and visit `chrome://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked**.
5. Select the [`chrome-extension`](./chrome-extension) folder.
6. Reload the ISBN Scrapper website.

The page shows **Amazon extension connected** when the extension is ready.

## Image book lists

The image-list tool needs a Gemini API key to identify titles and authors accurately.

For a Vercel deployment, add either of these Production environment variables:

```text
GEMINI_API_KEY=your_key_here
```

or

```text
API_key=your_key_here
```

Never commit API keys. `.env` files are excluded by `.gitignore`.

## Run locally

### Requirements

- Python 3.12 or later
- Node.js and the Vercel CLI
- Google Gemini API key for image recognition

### Steps

```bash
git clone https://github.com/Dakshdua05/isbn-scrapper.git
cd isbn-scrapper
python -m venv .venv
```

Activate the environment:

```powershell
.venv\Scripts\Activate.ps1
```

Install Python packages:

```bash
pip install -r requirements.txt
```

Create a `.env` file containing your Gemini key, then start Vercel locally:

```bash
vercel dev
```

Open the local URL printed by Vercel, commonly `http://localhost:3000`.

## Deploy on Vercel

1. Import this GitHub repository into Vercel.
2. Add `GEMINI_API_KEY` in **Project Settings → Environment Variables** if using image analysis.
3. Deploy.
4. Install the included Chrome extension and update its allowed website address if you use a different domain.

## Project structure

```text
api/
  scraper.py          Amazon ISBN lookup API route
  image_books.py      Gemini image title and author extraction
  suggest.py          Book-title suggestions through Open Library
chrome-extension/
  background.js       Amazon India browser lookup logic
  bridge.js           Website-to-extension connection
  manifest.json       Chrome extension settings
public/
  index.html          Website interface
vercel.json           Vercel routes and cache settings
```

## Notes

- ISBNs can differ by edition, format, and region. Review the title and author before using a result.
- Amazon may temporarily limit automated requests. The extension uses the browser session to reduce server-side blocking.
- Book suggestions use the free Open Library search API.
