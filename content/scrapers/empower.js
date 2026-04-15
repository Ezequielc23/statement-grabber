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

    // Quarterly format: "Q1 2026", "Q2 2025"
    m = s.match(/Q(\d)\s+(\d{4})/i);
    if (m) {
      const quarterMonth = { "1": "01", "2": "04", "3": "07", "4": "10" };
      return `${m[2]}-${quarterMonth[m[1]] || "01"}`;
    }

    return null;
  }

  function getAccountName() {
    // Empower shows plan/account names in headers, breadcrumbs, or account switcher
    const selectors = [
      '[data-testid="account-name"]',
      '[class*="account-name"]',
      '[class*="AccountName"]',
      '[class*="plan-name"]',
      '[class*="PlanName"]',
      'h1[class*="account"]',
      'h2[class*="account"]',
      '[class*="account-header"] h1',
      '.breadcrumb .current',
      '[aria-current="page"]',
      '[class*="account-selector"] [class*="selected"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const t = el.textContent.trim();
        if (t) return t;
      }
    }
    const title = document.title || "";
    const titleMatch = title.match(/^(.+?)[\s\-|]+Empower/i);
    if (titleMatch) return titleMatch[1].trim();
    return "Empower Account";
  }

  const scraper = {
    findStatements: async () => {
      const statements = [];
      const seen = new Set();
      const accountName = getAccountName();

      // Strategy 1: Direct PDF links to statements/documents
      // Empower has retirement statements, quarterly reports, tax documents
      document.querySelectorAll([
        'a[href*="statement"][href*=".pdf"]',
        'a[href*="/documents/"][href*=".pdf"]',
        'a[href*="/statements/"]',
        'a[href*="quarterly"][href*=".pdf"]',
        'a[href*="document"][href*=".pdf"]',
        'a[data-testid*="statement"]',
        'a[data-testid*="document"]',
        'a[data-testid*="download"]',
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

      // Strategy 2: Document rows in Empower's table/list views
      // Empower often uses data tables for documents with type, date, and download columns
      document.querySelectorAll([
        '[data-testid*="document-row"]',
        '[data-testid*="statement-row"]',
        '[class*="document-row"]',
        '[class*="DocumentRow"]',
        '[class*="statement-row"]',
        'tr[class*="document"]',
        'tr[class*="statement"]',
        '[class*="document-list"] li',
        '[class*="DocumentList"] li',
        'table[class*="document"] tbody tr',
        'table[class*="statement"] tbody tr',
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

      // Strategy 3: Download buttons (Empower uses icon buttons for PDF downloads)
      document.querySelectorAll([
        'button[aria-label*="Download"]',
        'button[aria-label*="download"]',
        'button[aria-label*="View document"]',
        'button[aria-label*="View statement"]',
        'button[data-testid*="download"]',
        '[role="button"][data-url]',
        '[role="button"][data-href]',
        'a[download]',
      ].join(", ")).forEach(btn => {
        const url = btn.getAttribute("data-url") || btn.getAttribute("data-href") || btn.href || btn.getAttribute("download") || "";
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

      // Strategy 4: Walk document/statement section containers
      const sectionSelectors = [
        '[data-testid="documents-section"]',
        '[data-testid="statements-section"]',
        '[data-testid="documents-list"]',
        '[class*="documents-container"]',
        '[class*="DocumentsContainer"]',
        '#documents', '#statements',
        'section[aria-label*="Documents"]',
        'section[aria-label*="Statements"]',
        '[class*="retirement-documents"]',
        '[class*="RetirementDocuments"]',
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
            accountName, format: "pdf",
            label: text.substring(0, 80),
          });
        });
      }

      return statements;
    },
  };

  if (window.__registerScraper) {
    window.__registerScraper("empower", scraper);
  }
})();
