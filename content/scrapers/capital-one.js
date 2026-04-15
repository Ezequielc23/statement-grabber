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

    // "January 15, 2026" or "Jan 15, 2026"
    let m = s.match(/(\w{3,9})\s+(\d{1,2}),?\s+(\d{4})/i);
    if (m) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo) return `${m[3]}-${mo}`;
    }

    // "01/15/2026" or "1/15/26"
    m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (m) {
      const yr = m[3].length === 2 ? "20" + m[3] : m[3];
      return `${yr}-${m[1].padStart(2, "0")}`;
    }

    // "2026-01"
    m = s.match(/(\d{4})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}`;

    // "January 2026"
    m = s.match(/(\w{3,9})\s+(\d{4})/i);
    if (m) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo) return `${m[2]}-${mo}`;
    }

    return null;
  }

  function getAccountName() {
    // Capital One shows account name in breadcrumbs, headers, or tab labels
    const selectors = [
      '[data-testid="account-name"]',
      '[data-testid="accountName"]',
      ".account-name",
      ".account-header h1",
      ".account-header h2",
      'nav[aria-label="Account"] .active',
      ".breadcrumb .current",
      '[class*="AccountName"]',
      '[class*="account-title"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const t = el.textContent.trim();
        if (t) return t;
      }
    }
    // Try the page title as last resort
    const title = document.title || "";
    const titleMatch = title.match(/^(.+?)[\s\-|]+Capital One/i);
    if (titleMatch) return titleMatch[1].trim();
    return "Capital One Account";
  }

  const scraper = {
    findStatements: async () => {
      const statements = [];
      const seen = new Set();
      const accountName = getAccountName();

      // Strategy 1: Direct PDF links in statement list items
      // Capital One often uses a list of statement rows with embedded <a> tags to PDFs
      document.querySelectorAll([
        'a[href*="statement"][href*=".pdf"]',
        'a[href*="/statements/"][href*=".pdf"]',
        'a[href*="document"][href*=".pdf"]',
        'a[href*="/documents/"]',
        'a[data-testid*="statement"]',
        'a[data-testid*="download"]',
      ].join(", ")).forEach(a => {
        const url = a.href;
        if (!url || seen.has(url)) return;
        seen.add(url);
        const text = (a.textContent || "").trim() + " " + (a.getAttribute("aria-label") || "");
        const date = extractDate(text) || extractDate(url) || "unknown";
        statements.push({
          url, date, accountName,
          format: /\.pdf/i.test(url) ? "pdf" : "pdf",
          label: text.substring(0, 80).trim(),
        });
      });

      // Strategy 2: Statement rows in a table or card layout
      // Capital One wraps statements in list items or table rows
      document.querySelectorAll([
        '[data-testid*="statement-row"]',
        '[data-testid*="statementRow"]',
        '[class*="statement-row"]',
        '[class*="StatementRow"]',
        'li[class*="statement"]',
        'tr[class*="statement"]',
        '[class*="document-row"]',
        '[role="listitem"][class*="statement"]',
      ].join(", ")).forEach(row => {
        const link = row.querySelector('a[href]') || row.querySelector('button[data-href]');
        if (!link) return;
        const url = link.href || link.getAttribute("data-href") || "";
        if (!url || seen.has(url)) return;
        seen.add(url);
        const rowText = (row.textContent || "").trim();
        const date = extractDate(rowText) || "unknown";
        statements.push({
          url, date, accountName, format: "pdf",
          label: rowText.substring(0, 80),
        });
      });

      // Strategy 3: Buttons that trigger statement downloads via data attributes
      document.querySelectorAll([
        'button[data-testid*="download"]',
        'button[data-testid*="statement"]',
        'button[aria-label*="Download"]',
        'button[aria-label*="statement"]',
        '[role="button"][data-url]',
        '[role="button"][data-href]',
      ].join(", ")).forEach(btn => {
        const url = btn.getAttribute("data-url") || btn.getAttribute("data-href") || "";
        if (!url || seen.has(url)) return;
        seen.add(url);
        const text = (btn.textContent || "").trim() + " " + (btn.getAttribute("aria-label") || "");
        statements.push({
          url, date: extractDate(text) || "unknown", accountName, format: "pdf",
          label: text.substring(0, 80).trim(),
        });
      });

      // Strategy 4: Walk all links inside containers that look like statement sections
      const sectionSelectors = [
        '[data-testid="statements-section"]',
        '[data-testid="documents-section"]',
        '#statements', '#documents',
        'section[aria-label*="Statement"]',
        'section[aria-label*="Document"]',
        '[class*="statements-container"]',
        '[class*="StatementsContainer"]',
      ];
      for (const sel of sectionSelectors) {
        const section = document.querySelector(sel);
        if (!section) continue;
        section.querySelectorAll("a[href]").forEach(a => {
          const url = a.href;
          if (!url || seen.has(url)) return;
          seen.add(url);
          const text = a.closest("li, tr, [role='listitem'], [class*='row']")?.textContent || a.textContent || "";
          statements.push({
            url, date: extractDate(text) || "unknown", accountName,
            format: /\.pdf/i.test(url) ? "pdf" : "pdf",
            label: text.trim().substring(0, 80),
          });
        });
      }

      return statements;
    },
  };

  if (window.__registerScraper) {
    window.__registerScraper("capital-one", scraper);
  }
})();
