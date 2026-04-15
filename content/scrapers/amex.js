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
      '[data-testid="card-product-name"]',
      '[class*="card-product-name"]',
      '[class*="CardProductName"]',
      ".account-header h2",
      'h1[class*="account"]',
      '[data-module-name="axp-account-summary"] h2',
      '[class*="AccountName"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const t = el.textContent.trim();
        if (t) return t;
      }
    }
    const title = document.title || "";
    const titleMatch = title.match(/^(.+?)[\s\-|]+American Express/i);
    if (titleMatch) return titleMatch[1].trim();
    return "AMEX Account";
  }

  const scraper = {
    findStatements: async () => {
      const statements = [];
      const seen = new Set();
      const accountName = getAccountName();

      // Strategy 1: AMEX React SPA uses data-testid attributes heavily
      document.querySelectorAll([
        'a[data-testid*="statement"]',
        'a[data-testid*="Statement"]',
        'a[data-testid*="download"]',
        'a[data-testid*="document"]',
        'a[href*="/document/"]',
        'a[href*="statement"]',
        'a[href*=".pdf"]',
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

      // Strategy 2: Statement rows in the statements table
      // AMEX renders statement periods as rows with closing date and download action
      document.querySelectorAll([
        '[data-testid*="statement-row"]',
        '[data-testid*="StatementRow"]',
        '[class*="statement-row"]',
        '[class*="StatementsListItem"]',
        'tr[class*="statement"]',
        '[class*="statement-list"] li',
        '[class*="StatementsList"] li',
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

      // Strategy 3: Icon-based download buttons (AMEX uses SVG icons next to dates)
      document.querySelectorAll([
        'button[aria-label*="Download"]',
        'button[aria-label*="download"]',
        'button[aria-label*="Statement"]',
        '[role="button"][aria-label*="PDF"]',
        'a[aria-label*="Download statement"]',
      ].join(", ")).forEach(btn => {
        const url = btn.getAttribute("data-url") || btn.getAttribute("data-href") || btn.href || "";
        if (!url || seen.has(url)) return;
        seen.add(url);
        const parentRow = btn.closest("li, tr, [class*='row'], [class*='Row'], [data-testid]");
        const text = parentRow ? parentRow.textContent.trim() : (btn.getAttribute("aria-label") || "");
        statements.push({
          url, date: extractDate(text) || "unknown",
          accountName, format: "pdf",
          label: text.substring(0, 80),
        });
      });

      // Strategy 4: Walk statement container sections
      const sectionSelectors = [
        '[data-testid="statements-container"]',
        '[data-testid="statements-list"]',
        '[data-module-name*="statement"]',
        '#statements', '#Statements',
        'section[aria-label*="Statements"]',
        '[class*="statements-section"]',
        '[class*="StatementsSection"]',
      ];
      for (const sel of sectionSelectors) {
        const section = document.querySelector(sel);
        if (!section) continue;
        section.querySelectorAll("a[href]").forEach(a => {
          const url = a.href;
          if (!url || seen.has(url)) return;
          seen.add(url);
          const row = a.closest("li, tr, [role='listitem'], [class*='row']");
          const text = row ? row.textContent.trim() : a.textContent.trim();
          statements.push({
            url, date: extractDate(text) || "unknown",
            accountName, format: /\.pdf/i.test(url) ? "pdf" : "pdf",
            label: text.substring(0, 80),
          });
        });
      }

      return statements;
    },
  };

  if (window.__registerScraper) {
    window.__registerScraper("amex", scraper);
  }
})();
