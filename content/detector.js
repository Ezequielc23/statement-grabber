(function() {
  "use strict";

  const BANKS = [
    {
      name: "Capital One",
      icon: "🏛️",
      folder: "capital-one",
      match: /capitalone\.com/i,
      statementsHint: /statements|documents|activity/i,
    },
    {
      name: "American Express",
      icon: "💳",
      folder: "amex",
      match: /americanexpress\.com/i,
      statementsHint: /statements|activity/i,
    },
    {
      name: "SoFi",
      icon: "🟣",
      folder: "sofi",
      match: /sofi\.com/i,
      statementsHint: /statements|documents|account/i,
    },
    {
      name: "Chime",
      icon: "💚",
      folder: "chime",
      match: /chime\.com/i,
      statementsHint: /statements|documents/i,
    },
    {
      name: "Empower",
      icon: "⚡",
      folder: "empower",
      match: /empower/i,
      statementsHint: /statements|documents|retirement/i,
    },
    {
      name: "Credit One",
      icon: "🔵",
      folder: "credit-one",
      match: /creditonebank\.com/i,
      statementsHint: /statements|documents/i,
    },
  ];

  function detectBank() {
    const url = window.location.href;
    return BANKS.find(b => b.match.test(url)) || null;
  }

  // Scraper functions keyed by folder name (loaded inline since MV3 content scripts can't dynamic import)
  const scrapers = {};

  window.__registerScraper = function(folder, scraper) {
    scrapers[folder] = scraper;
  };

  // Shared pagination utility available to all scrapers
  window.__pagination = {
    // Find common "next page" / "older" / "load more" buttons
    findNextButton: function() {
      const keywords = ["older", "next", "next page", "load more", "show more", "view more"];
      const allClickables = document.querySelectorAll("a, button, [role='button'], [role='link']");
      for (const el of allClickables) {
        const text = (el.textContent || "").trim().toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").toLowerCase();
        if (keywords.includes(text) || keywords.includes(aria)) {
          if (!el.disabled && el.getAttribute("aria-disabled") !== "true" &&
              !el.classList.contains("disabled")) {
            return el;
          }
        }
      }
      return null;
    },

    // Parse "X to Y of Z" style pagination text
    getPageInfo: function() {
      const text = document.body.innerText || "";
      const m = text.match(/(\d+)\s+to\s+(\d+)\s+of\s+(\d+)/i);
      if (m) return { from: +m[1], to: +m[2], total: +m[3] };
      const m2 = text.match(/showing\s+(\d+)\s*[-–]\s*(\d+)\s+of\s+(\d+)/i);
      if (m2) return { from: +m2[1], to: +m2[2], total: +m2[3] };
      return null;
    },

    sleep: function(ms) { return new Promise(r => setTimeout(r, ms)); },

    // Auto-paginate: calls scanFn on each page, clicking "next" between pages
    // scanFn(seen) should return an array of statements found on the current page
    // Returns all statements across all pages
    autoPageAll: async function(scanFn) {
      const seen = new Set();
      let all = scanFn(seen);

      const info = this.getPageInfo();
      if (!info || info.to >= info.total) return all;

      let pages = 1;
      const maxPages = Math.ceil(info.total / Math.max(info.to - info.from + 1, 1)) + 1;

      while (pages < maxPages && pages < 30) {
        const btn = this.findNextButton();
        if (!btn) break;

        btn.click();
        await this.sleep(2000);

        const found = scanFn(seen);
        if (found.length === 0) {
          await this.sleep(2000);
          const retry = scanFn(seen);
          all = all.concat(retry);
          if (retry.length === 0) break;
        } else {
          all = all.concat(found);
        }

        pages++;
        const newInfo = this.getPageInfo();
        if (newInfo && newInfo.to >= newInfo.total) break;
      }

      return all;
    },
  };

  // Generic fallback scraper that finds PDF links on the page
  function fallbackScraper() {
    const links = [];
    const seen = new Set();

    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.href;
      const text = (a.textContent || "").trim();
      const ariaLabel = a.getAttribute("aria-label") || "";

      const isPdf = /\.pdf/i.test(href) || /pdf/i.test(a.getAttribute("type") || "");
      const isStatement = /statement|document|download/i.test(text + " " + ariaLabel + " " + href);

      if ((isPdf || isStatement) && href && !seen.has(href)) {
        seen.add(href);
        const dateMatch = (text + " " + href).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})|(\w{3,9})\s+(\d{4})|(\d{4})[\/\-](\d{1,2})/);
        let date = "unknown";
        if (dateMatch) {
          if (dateMatch[4] && dateMatch[5]) {
            date = `${dateMatch[5]}-${dateMatch[4]}`;
          } else if (dateMatch[6] && dateMatch[7]) {
            date = `${dateMatch[6]}-${dateMatch[7].padStart(2, "0")}`;
          } else if (dateMatch[1] && dateMatch[2] && dateMatch[3]) {
            const yr = dateMatch[3].length === 2 ? "20" + dateMatch[3] : dateMatch[3];
            date = `${yr}-${dateMatch[1].padStart(2, "0")}`;
          }
        }

        links.push({
          url: href,
          date: date,
          accountName: "account",
          format: isPdf ? "pdf" : "csv",
          label: text.substring(0, 80),
        });
      }
    });

    document.querySelectorAll('button, [role="button"], [data-download], [download]').forEach(el => {
      const text = (el.textContent || "").trim();
      const download = el.getAttribute("download") || el.getAttribute("data-download") || "";
      if (/statement|download|pdf/i.test(text + " " + download)) {
        const href = el.getAttribute("href") || el.getAttribute("data-href") || el.getAttribute("data-url") || "";
        if (href && !seen.has(href)) {
          seen.add(href);
          links.push({
            url: href,
            date: "unknown",
            accountName: "account",
            format: "pdf",
            label: text.substring(0, 80),
          });
        }
      }
    });

    return links;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "scan") {
      const bank = detectBank();
      if (!bank) {
        sendResponse({ bank: null, statements: [] });
        return true;
      }

      const scraper = scrapers[bank.folder];
      if (scraper && typeof scraper.findStatements === "function") {
        Promise.resolve(scraper.findStatements()).then(statements => {
          if (!statements || statements.length === 0) {
            statements = fallbackScraper();
          }
          sendResponse({
            bank: bank.name,
            icon: bank.icon,
            folder: bank.folder,
            statements: statements,
          });
        }).catch(() => {
          sendResponse({
            bank: bank.name,
            icon: bank.icon,
            folder: bank.folder,
            statements: fallbackScraper(),
          });
        });
      } else {
        sendResponse({
          bank: bank.name,
          icon: bank.icon,
          folder: bank.folder,
          statements: fallbackScraper(),
        });
      }
      return true;
    }
  });
})();
