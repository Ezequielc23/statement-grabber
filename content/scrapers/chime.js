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

  function extractAccountType(rowText) {
    const lower = (rowText || "").toLowerCase();
    if (lower.includes("checking account")) return "Checking";
    if (lower.includes("savings account")) return "Savings";
    if (lower.includes("credit account")) return "Credit";
    if (lower.includes("checking")) return "Checking";
    if (lower.includes("savings")) return "Savings";
    if (lower.includes("credit")) return "Credit";
    return "Account";
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function findOlderButton() {
    const allClickables = document.querySelectorAll("a, button, [role='button'], [role='link']");
    for (const el of allClickables) {
      const text = (el.textContent || "").trim().toLowerCase();
      if (text === "older" || text === "next" || text === "next page" || text === "load more") {
        if (el.disabled || el.getAttribute("aria-disabled") === "true" ||
            el.classList.contains("disabled") || el.style.pointerEvents === "none") {
          return null;
        }
        return el;
      }
    }
    for (const el of allClickables) {
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      if (aria === "older" || aria === "next page" || aria === "older statements") {
        if (!el.disabled && el.getAttribute("aria-disabled") !== "true") return el;
      }
    }
    return null;
  }

  function getPaginationInfo() {
    const bodyText = document.body.innerText || "";
    const m = bodyText.match(/(\d+)\s+to\s+(\d+)\s+of\s+(\d+)/i);
    if (m) {
      return { from: parseInt(m[1]), to: parseInt(m[2]), total: parseInt(m[3]) };
    }
    return null;
  }

  function scanCurrentPage(seen) {
    const statements = [];

    // Strategy 1: PDF href links
    document.querySelectorAll([
      'a[href*="statement"][href*=".pdf"]',
      'a[href*="/statements/"]',
      'a[href*="/documents/"]',
      'a[href*="download"][href*="statement"]',
      'a[href*=".pdf"]',
      'a[data-testid*="statement"]',
      'a[data-testid*="download"]',
    ].join(", ")).forEach(a => {
      const url = a.href;
      if (!url || seen.has(url)) return;
      seen.add(url);
      const row = a.closest("tr, li, [role='row'], [class*='row'], [class*='item'], div");
      const rowText = row ? row.textContent.trim() : a.textContent.trim();
      const acct = extractAccountType(rowText);
      statements.push({
        url,
        date: extractDate(rowText) || "unknown",
        accountName: acct,
        format: "pdf",
        label: rowText.substring(0, 80),
      });
    });

    // Strategy 2: Statement rows with embedded links
    document.querySelectorAll([
      '[data-testid*="statement"]',
      '[class*="statement-row"]',
      '[class*="StatementRow"]',
      '[class*="statement-item"]',
      '[class*="document-row"]',
      'tr',
      'li',
    ].join(", ")).forEach(row => {
      const rowText = (row.textContent || "").trim();
      if (!/statement|pdf/i.test(rowText)) return;
      if (!extractDate(rowText)) return;

      const link = row.querySelector('a[href], button[data-href], button[data-url]');
      if (link) {
        const url = link.href || link.getAttribute("data-href") || link.getAttribute("data-url") || "";
        if (url && !seen.has(url)) {
          seen.add(url);
          const acct = extractAccountType(rowText);
          statements.push({
            url,
            date: extractDate(rowText) || "unknown",
            accountName: acct,
            format: "pdf",
            label: rowText.substring(0, 80),
          });
        }
      }
    });

    // Strategy 3: Clickable "PDF" elements
    document.querySelectorAll("a, button, [role='button'], [role='link']").forEach(el => {
      const text = (el.textContent || "").trim();
      if (text.toUpperCase() !== "PDF" && !/download.*pdf/i.test(text)) return;

      const url = el.href || el.getAttribute("data-href") || el.getAttribute("data-url") || "";
      if (!url || seen.has(url)) return;

      const row = el.closest("tr, li, [role='row'], [class*='row'], div[class]");
      const rowText = row ? row.textContent.trim() : "";
      const date = extractDate(rowText);
      if (!date) return;

      seen.add(url);
      const acct = extractAccountType(rowText);
      statements.push({
        url,
        date,
        accountName: acct,
        format: "pdf",
        label: `${acct} statement ${date}`,
      });
    });

    return statements;
  }

  const scraper = {
    findStatements: async () => {
      const seen = new Set();
      let allStatements = [];

      allStatements = allStatements.concat(scanCurrentPage(seen));

      const pageInfo = getPaginationInfo();
      if (pageInfo && pageInfo.to < pageInfo.total) {
        let maxPages = Math.ceil(pageInfo.total / (pageInfo.to - pageInfo.from + 1)) + 1;
        let pagesVisited = 1;

        while (pagesVisited < maxPages && pagesVisited < 20) {
          const olderBtn = findOlderButton();
          if (!olderBtn) break;

          olderBtn.click();
          await sleep(2000);

          const newStatements = scanCurrentPage(seen);
          if (newStatements.length === 0) {
            await sleep(2000);
            const retry = scanCurrentPage(seen);
            allStatements = allStatements.concat(retry);
            if (retry.length === 0) break;
          } else {
            allStatements = allStatements.concat(newStatements);
          }

          pagesVisited++;

          const newPageInfo = getPaginationInfo();
          if (newPageInfo && newPageInfo.to >= newPageInfo.total) break;
        }
      }

      return allStatements;
    },
  };

  if (window.__registerScraper) {
    window.__registerScraper("chime", scraper);
  }
})();
