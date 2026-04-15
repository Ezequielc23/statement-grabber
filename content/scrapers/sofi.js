(function() {
  "use strict";

  const MONTHS = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
    jan: "01", feb: "02", mar: "03", apr: "04",
    jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };

  function extractDate(text) {
    if (!text) return null;
    const s = text.trim();

    let m = s.match(/(\w{3,9})\s+(\d{1,2}),?\s+(\d{4})/i);
    if (m) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo) return `${m[3]}-${mo}`;
    }

    m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      const yr = m[3].length === 2 ? "20" + m[3] : m[3];
      return `${yr}-${m[1].padStart(2, "0")}`;
    }

    m = s.match(/(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;

    m = s.match(/(\w{3,9})\s+(\d{4})/i);
    if (m) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo) return `${m[2]}-${mo}`;
    }

    return null;
  }

  function getAccountName() {
    const selectors = [
      '[data-testid="account-name"]',
      '[class*="account-name"]',
      '[class*="AccountName"]',
      '[class*="product-name"]',
      'h1[class*="account"]',
      'h2[class*="account"]',
      ".account-header h1",
      '[class*="account-title"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const t = el.textContent.trim();
        if (t) return t;
      }
    }
    const title = document.title || "";
    const titleMatch = title.match(/^(.+?)[\s\-|]+SoFi/i);
    if (titleMatch) return titleMatch[1].trim();
    return "SoFi Account";
  }

  const scraper = {
    findStatements: async () => {
      const statements = [];
      const seen = new Set();
      const accountName = getAccountName();

      // Strategy 1: Direct links to statement PDFs
      // SoFi's documents page lists statements with PDF download links
      document.querySelectorAll([
        'a[href*="statement"][href*=".pdf"]',
        'a[href*="/documents/"][href*=".pdf"]',
        'a[href*="/statements/"]',
        'a[data-testid*="statement"]',
        'a[data-testid*="document-download"]',
        'a[href*="monthly-statement"]',
      ].join(", ")).forEach(a => {
        const url = a.href;
        if (!url || seen.has(url)) return;
        seen.add(url);
        const text = (a.textContent || "").trim() + " " + (a.getAttribute("aria-label") || "");
        statements.push({
          url, date: extractDate(text) || extractDate(url) || "unknown",
          accountName, format: "pdf",
          label: text.substring(0, 80).trim(),
        });
      });

      // Strategy 2: SoFi React SPA often renders document rows with date and action buttons
      document.querySelectorAll([
        '[data-testid*="document-row"]',
        '[data-testid*="statement-row"]',
        '[class*="document-row"]',
        '[class*="DocumentRow"]',
        '[class*="statement-item"]',
        '[class*="StatementItem"]',
        '[class*="document-list"] li',
        '[class*="DocumentList"] li',
      ].join(", ")).forEach(row => {
        const link = row.querySelector('a[href], button[data-href], button[data-url]');
        if (!link) return;
        const url = link.href || link.getAttribute("data-href") || link.getAttribute("data-url") || "";
        if (!url || seen.has(url)) return;
        seen.add(url);
        const rowText = (row.textContent || "").trim();
        statements.push({
          url, date: extractDate(rowText) || "unknown",
          accountName, format: "pdf",
          label: rowText.substring(0, 80),
        });
      });

      // Strategy 3: Download buttons inside document cards
      document.querySelectorAll([
        'button[aria-label*="Download"]',
        'button[aria-label*="statement"]',
        'button[data-testid*="download"]',
        '[role="button"][aria-label*="PDF"]',
      ].join(", ")).forEach(btn => {
        const url = btn.getAttribute("data-url") || btn.getAttribute("data-href") || btn.href || "";
        if (!url || seen.has(url)) return;
        seen.add(url);
        const parentRow = btn.closest("li, tr, [class*='row'], [class*='card'], [data-testid]");
        const text = parentRow ? parentRow.textContent.trim() : (btn.getAttribute("aria-label") || "");
        statements.push({
          url, date: extractDate(text) || "unknown",
          accountName, format: "pdf",
          label: text.substring(0, 80),
        });
      });

      // Strategy 4: Walk documents/statements section containers
      const sectionSelectors = [
        '[data-testid="documents-section"]',
        '[data-testid="statements-section"]',
        '[class*="documents-container"]',
        '[class*="DocumentsContainer"]',
        '#documents', '#statements',
        'section[aria-label*="Documents"]',
        'section[aria-label*="Statements"]',
        '[class*="statements-list"]',
      ];
      for (const sel of sectionSelectors) {
        const section = document.querySelector(sel);
        if (!section) continue;
        section.querySelectorAll("a[href]").forEach(a => {
          const url = a.href;
          if (!url || seen.has(url)) return;
          seen.add(url);
          const row = a.closest("li, tr, [role='listitem'], [class*='row'], [class*='card']");
          const text = row ? row.textContent.trim() : a.textContent.trim();
          statements.push({
            url, date: extractDate(text) || "unknown",
            accountName, format: "pdf",
            label: text.substring(0, 80),
          });
        });
      }

      return statements;
    },
  };

  if (window.__registerScraper) {
    window.__registerScraper("sofi", scraper);
  }
})();
