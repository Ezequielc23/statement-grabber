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
    const m = text.match(/(\w{3,9})\s+(\d{4})/i);
    if (m) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo) return `${m[2]}-${mo}`;
    }
    return null;
  }

  function extractAccountType(text) {
    const lower = text.toLowerCase();
    if (lower.includes("checking")) return "Checking";
    if (lower.includes("savings")) return "Savings";
    if (lower.includes("credit")) return "Credit";
    return "Account";
  }

  // Get the button's accessible name from any source
  function getButtonLabel(btn) {
    return btn.getAttribute("aria-label")
      || btn.getAttribute("title")
      || btn.innerText?.trim()
      || btn.textContent?.trim()
      || "";
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function findNextPageButton() {
    for (const el of document.querySelectorAll("button, [role='button']")) {
      const label = getButtonLabel(el).toLowerCase();
      if (label === "show next page" || label === "older" || label === "next page" || label === "next") {
        if (!el.disabled && el.getAttribute("aria-disabled") !== "true") return el;
      }
    }
    return null;
  }

  function findPrevPageButton() {
    for (const el of document.querySelectorAll("button, [role='button']")) {
      const label = getButtonLabel(el).toLowerCase();
      if (label === "show previous page" || label === "newer" || label === "previous page" || label === "previous") {
        if (!el.disabled && el.getAttribute("aria-disabled") !== "true") return el;
      }
    }
    return null;
  }

  // Scan the page by finding <li> elements that contain statement info + a button
  function scanCurrentPage(seen) {
    const statements = [];

    // Strategy 1: Find list items whose text matches "Month Year ... account statement PDF"
    document.querySelectorAll("li, [role='listitem']").forEach(li => {
      const text = (li.textContent || "").trim();
      if (!/account\s+statement/i.test(text)) return;
      if (!/pdf/i.test(text)) return;

      const date = extractDate(text);
      if (!date) return;

      const key = `${extractAccountType(text)}_${date}`;
      if (seen.has(key)) return;

      // Find the clickable button inside this list item
      const btn = li.querySelector("button, [role='button']");
      if (!btn) return;

      seen.add(key);
      statements.push({
        // Store enough info to re-find this button later
        accountName: extractAccountType(text),
        date,
        format: "pdf",
        label: `${extractAccountType(text)} statement ${date}`,
        clickDownload: true,
        // Unique selector to re-find: the nth statement button in the list
        rowText: text.substring(0, 100),
      });
    });

    // Strategy 2: Find buttons whose accessible label contains "Download...statement...PDF"
    document.querySelectorAll("button, [role='button']").forEach(btn => {
      const label = getButtonLabel(btn);
      if (!/download.*statement.*pdf/i.test(label)) return;

      const date = extractDate(label);
      if (!date) return;

      const acct = extractAccountType(label);
      const key = `${acct}_${date}`;
      if (seen.has(key)) return;
      seen.add(key);

      statements.push({
        buttonLabel: label,
        accountName: acct,
        date,
        format: "pdf",
        label: `${acct} statement ${date}`,
        clickDownload: true,
        rowText: label.substring(0, 100),
      });
    });

    return statements;
  }

  // Get a signature of current page content for change detection
  function getPageSignature() {
    const items = [];
    document.querySelectorAll("li, [role='listitem']").forEach(li => {
      const text = (li.textContent || "").trim();
      if (/account\s+statement/i.test(text) && /pdf/i.test(text)) {
        items.push(text.substring(0, 50));
      }
    });
    return items.join("|");
  }

  async function waitForPageChange(beforeSig, maxWait = 10000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      const current = getPageSignature();
      if (current !== beforeSig && current.length > 0) return true;
      await sleep(400);
    }
    return false;
  }

  // Find and click the download button for a given statement
  function clickStatementButton(accountName, date) {
    // Try to find by list item text content
    const items = document.querySelectorAll("li, [role='listitem']");
    for (const li of items) {
      const text = (li.textContent || "").trim();
      if (!/account\s+statement/i.test(text)) continue;
      if (!text.toLowerCase().includes(accountName.toLowerCase())) continue;
      if (!extractDate(text) || extractDate(text) !== date) continue;

      const btn = li.querySelector("button, [role='button']");
      if (btn) {
        btn.click();
        return true;
      }
    }

    // Fallback: find button by accessible label
    for (const btn of document.querySelectorAll("button, [role='button']")) {
      const label = getButtonLabel(btn);
      if (/download.*statement.*pdf/i.test(label) &&
          label.toLowerCase().includes(accountName.toLowerCase()) &&
          extractDate(label) === date) {
        btn.click();
        return true;
      }
    }
    return false;
  }

  const scraper = {
    findStatements: async () => {
      const seen = new Set();
      let allStatements = [];

      try {
        allStatements = scanCurrentPage(seen);

        let pages = 1;
        while (pages < 30) {
          const nextBtn = findNextPageButton();
          if (!nextBtn) break;

          const beforeSig = getPageSignature();
          nextBtn.click();
          await sleep(2000);
          const changed = await waitForPageChange(beforeSig);
          if (!changed) break;

          const found = scanCurrentPage(seen);
          allStatements = allStatements.concat(found);
          if (found.length === 0) break;
          pages++;
        }
      } catch (e) {
        console.error("Statement Grabber: scan error", e);
      }

      return allStatements;
    },

    // Bulk download: navigate through all pages clicking matching buttons
    clickDownloadBulk: async (buttonLabels, progressCallback) => {
      // Build a set of {accountName, date} pairs to download
      const wanted = new Map();
      for (const lbl of buttonLabels) {
        // Parse from the label we stored: "Checking statement 2026-03" format
        // Or from the buttonLabel/rowText
        const dateMatch = lbl.match(/(\d{4}-\d{2})/);
        const acctMatch = lbl.match(/(Checking|Savings|Credit)/i);
        if (dateMatch && acctMatch) {
          const key = `${acctMatch[1]}_${dateMatch[1]}`;
          wanted.set(key, { accountName: acctMatch[1], date: dateMatch[1], label: lbl });
        }
      }

      if (wanted.size === 0) return 0;

      // Go to first page
      let prevBtn = findPrevPageButton();
      while (prevBtn) {
        const sig = getPageSignature();
        prevBtn.click();
        await sleep(1500);
        await waitForPageChange(sig);
        prevBtn = findPrevPageButton();
      }

      let totalClicked = 0;
      let pages = 0;

      while (wanted.size > 0 && pages < 30) {
        // Click all matching statements on this page
        for (const [key, info] of [...wanted.entries()]) {
          const clicked = clickStatementButton(info.accountName, info.date);
          if (clicked) {
            totalClicked++;
            wanted.delete(key);
            if (progressCallback) progressCallback(info.label);
            await sleep(2000); // generous delay so Chime's server can respond
          }
        }

        const nextBtn = findNextPageButton();
        if (!nextBtn) break;

        const beforeSig = getPageSignature();
        nextBtn.click();
        await sleep(2000);
        const changed = await waitForPageChange(beforeSig);
        if (!changed) break;
        pages++;
      }

      // Check last page
      for (const [key, info] of [...wanted.entries()]) {
        const clicked = clickStatementButton(info.accountName, info.date);
        if (clicked) {
          totalClicked++;
          wanted.delete(key);
          if (progressCallback) progressCallback(info.label);
          await sleep(2000);
        }
      }

      // Wait for the last downloads to finish before signaling completion
      await sleep(5000);

      return totalClicked;
    },
  };

  if (window.__registerScraper) {
    window.__registerScraper("chime", scraper);
  }
})();
