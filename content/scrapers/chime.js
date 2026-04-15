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
    // Chime's statements page shows "Checking" or "Savings" as the active account
    // Based on the user's page: "Accounts > Checking" shown in the account selector
    const selectors = [
      '[data-testid="account-name"]',
      '[class*="account-name"]',
      '[class*="AccountName"]',
      'h1[class*="account"]',
      'h2[class*="account"]',
      '[class*="account-header"] h1',
      '[class*="product-name"]',
      '[aria-current="page"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const t = el.textContent.trim();
        if (t && t.length < 50) return t;
      }
    }

    // Look for "Checking" or "Savings" text near the statements area
    const bodyText = document.body.innerText || "";
    if (/Accounts\s*\n?\s*Checking/i.test(bodyText)) return "Checking";
    if (/Accounts\s*\n?\s*Savings/i.test(bodyText)) return "Savings";

    const title = document.title || "";
    const titleMatch = title.match(/^(.+?)[\s\-|]+Chime/i);
    if (titleMatch) return titleMatch[1].trim();
    return "Chime Account";
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Find the "Older" / next-page button on Chime's paginated statements
  function findOlderButton() {
    // Chime shows "Older" as a pagination link/button
    const allClickables = document.querySelectorAll("a, button, [role='button'], [role='link']");
    for (const el of allClickables) {
      const text = (el.textContent || "").trim().toLowerCase();
      if (text === "older" || text === "next" || text === "next page" || text === "load more") {
        // Make sure it's not disabled
        if (el.disabled || el.getAttribute("aria-disabled") === "true" ||
            el.classList.contains("disabled") || el.style.pointerEvents === "none") {
          return null;
        }
        return el;
      }
    }
    // Also check aria-label
    for (const el of allClickables) {
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      if (aria === "older" || aria === "next page" || aria === "older statements") {
        if (!el.disabled && el.getAttribute("aria-disabled") !== "true") return el;
      }
    }
    return null;
  }

  // Parse the pagination info like "1 to 10 of 36"
  function getPaginationInfo() {
    const bodyText = document.body.innerText || "";
    const m = bodyText.match(/(\d+)\s+to\s+(\d+)\s+of\s+(\d+)/i);
    if (m) {
      return { from: parseInt(m[1]), to: parseInt(m[2]), total: parseInt(m[3]) };
    }
    return null;
  }

  // Scan the current page for statement rows
  function scanCurrentPage(accountName, seen) {
    const statements = [];

    // Chime's statement rows: each row has "Month Year", "Checking account statement", "PDF"
    // The PDF text/link is the download trigger
    // Look for rows that contain a date + "statement" + a clickable PDF element

    // Strategy 1: Find all links with PDF hrefs
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
      statements.push({
        url,
        date: extractDate(rowText) || "unknown",
        accountName,
        format: "pdf",
        label: rowText.substring(0, 80),
      });
    });

    // Strategy 2: Statement rows - look for rows containing both a date and "PDF" or "statement"
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
      // Must contain something that looks like a date and "statement" or "PDF"
      if (!/statement|pdf/i.test(rowText)) return;
      if (!extractDate(rowText)) return;

      const link = row.querySelector('a[href], button[data-href], button[data-url]');
      if (link) {
        const url = link.href || link.getAttribute("data-href") || link.getAttribute("data-url") || "";
        if (url && !seen.has(url)) {
          seen.add(url);
          statements.push({
            url,
            date: extractDate(rowText) || "unknown",
            accountName,
            format: "pdf",
            label: rowText.substring(0, 80),
          });
        }
      }
    });

    // Strategy 3: Look for clickable "PDF" elements that trigger downloads
    // Chime may show "PDF" as a clickable link/button per row
    document.querySelectorAll("a, button, [role='button'], [role='link']").forEach(el => {
      const text = (el.textContent || "").trim();
      if (text.toUpperCase() !== "PDF" && !/download.*pdf/i.test(text)) return;

      const url = el.href || el.getAttribute("data-href") || el.getAttribute("data-url") || "";
      if (!url || seen.has(url)) return;

      // Get date from the parent row
      const row = el.closest("tr, li, [role='row'], [class*='row'], div[class]");
      const rowText = row ? row.textContent.trim() : "";
      const date = extractDate(rowText);
      if (!date) return;

      seen.add(url);
      statements.push({
        url,
        date,
        accountName,
        format: "pdf",
        label: `${accountName} statement ${date}`,
      });
    });

    return statements;
  }

  const scraper = {
    findStatements: async () => {
      const accountName = getAccountName();
      const seen = new Set();
      let allStatements = [];

      // Scan the first page
      allStatements = allStatements.concat(scanCurrentPage(accountName, seen));

      // Check if there's pagination
      const pageInfo = getPaginationInfo();
      if (pageInfo && pageInfo.to < pageInfo.total) {
        // There are more pages -- auto-paginate through all of them
        let maxPages = Math.ceil(pageInfo.total / (pageInfo.to - pageInfo.from + 1)) + 1;
        let pagesVisited = 1;

        while (pagesVisited < maxPages && pagesVisited < 20) {
          const olderBtn = findOlderButton();
          if (!olderBtn) break;

          // Click "Older" to load next page
          olderBtn.click();

          // Wait for the page to update (Chime is a SPA, content changes in-place)
          await sleep(2000);

          // Scan the new page content
          const newStatements = scanCurrentPage(accountName, seen);
          if (newStatements.length === 0) {
            // No new statements found, might still be loading -- wait a bit more
            await sleep(2000);
            const retry = scanCurrentPage(accountName, seen);
            allStatements = allStatements.concat(retry);
            if (retry.length === 0) break;
          } else {
            allStatements = allStatements.concat(newStatements);
          }

          pagesVisited++;

          // Check updated pagination to see if we've reached the end
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
