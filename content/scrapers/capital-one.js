(function() {
  "use strict";

  const MONTHS = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
    jan: "01", feb: "02", mar: "03", apr: "04",
    jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function getButtonLabel(btn) {
    return btn.getAttribute("aria-label")
      || btn.getAttribute("title")
      || btn.innerText?.trim()
      || btn.textContent?.trim()
      || "";
  }

  // Extract account name from the statement dialog heading
  function getAccountName() {
    // Look for headings like "Auto Loan" or "Platinum Card"
    const headings = document.querySelectorAll("h2, h1, h3");
    for (const h of headings) {
      const text = h.textContent.trim();
      if (/auto\s*loan|credit\s*card|platinum|venture|quicksilver|savor|spark/i.test(text)) {
        return text;
      }
    }
    // Look for text near the dialog like "Auto Loan0957"
    const allText = document.body.innerText || "";
    const m = allText.match(/(Auto\s*Loan\d*|Platinum\s*Card\d*|Venture\s*\w*\d*|Quicksilver\s*\w*\d*|Savor\s*\w*\d*)/i);
    if (m) return m[1].trim();

    // Check URL for clues
    const url = window.location.href;
    if (/AutoLoan/i.test(url)) return "Auto Loan";
    if (/Card/i.test(url)) return "Credit Card";

    return "Capital One Account";
  }

  // Find the statement picker open/close button
  function findPickerButton() {
    for (const btn of document.querySelectorAll("button")) {
      const label = getButtonLabel(btn).toLowerCase();
      if (label.includes("open statement picker") || label.includes("statement picker")) {
        return btn;
      }
    }
    return null;
  }

  // Find the Download button
  function findDownloadButton() {
    for (const btn of document.querySelectorAll("button, a")) {
      const label = getButtonLabel(btn).toLowerCase();
      if (label === "download") return btn;
    }
    return null;
  }

  // Find Previous Year button
  function findPrevYearButton() {
    for (const btn of document.querySelectorAll("button")) {
      const label = getButtonLabel(btn).toLowerCase();
      if (label === "previous year" || label === "prev year") {
        if (!btn.disabled && btn.getAttribute("aria-disabled") !== "true") return btn;
      }
    }
    return null;
  }

  // Scan the currently visible year in the picker for available statement months
  // Available months have names like "January 7, 2026" (with a day number)
  // Future/empty months are just "May 2026" (no day)
  function scanPickerMonths(seen) {
    const statements = [];
    document.querySelectorAll("button").forEach(btn => {
      const label = getButtonLabel(btn);
      // Match "Month Day, Year" pattern (e.g. "January 7, 2026", "March 7, 2026")
      const m = label.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
      if (!m) return;

      const monthName = m[1].toLowerCase();
      const mo = MONTHS[monthName];
      if (!mo) return;

      const year = m[3];
      const date = `${year}-${mo}`;
      if (seen.has(date)) return;
      seen.add(date);

      statements.push({
        date,
        pickerLabel: label,
        format: "pdf",
        clickDownload: true,
      });
    });
    return statements;
  }

  const scraper = {
    findStatements: async () => {
      const accountName = getAccountName();
      const seen = new Set();
      let allStatements = [];

      try {
        // Open the statement picker
        const pickerBtn = findPickerButton();
        if (pickerBtn) {
          const isExpanded = pickerBtn.getAttribute("aria-expanded") === "true";
          if (!isExpanded) {
            pickerBtn.click();
            await sleep(800);
          }
        }

        // Scan current year
        allStatements = allStatements.concat(scanPickerMonths(seen));

        // Navigate to previous years and scan those
        let yearAttempts = 0;
        while (yearAttempts < 10) {
          const prevBtn = findPrevYearButton();
          if (!prevBtn) break;

          prevBtn.click();
          await sleep(800);

          const found = scanPickerMonths(seen);
          if (found.length === 0) break; // no statements in this year
          allStatements = allStatements.concat(found);
          yearAttempts++;
        }

        // Close the picker
        if (pickerBtn) {
          const isExpanded = pickerBtn.getAttribute("aria-expanded") === "true";
          if (isExpanded) {
            pickerBtn.click();
            await sleep(300);
          }
        }
      } catch (e) {
        console.error("Statement Grabber: Capital One scan error", e);
      }

      // Tag all statements with the account name
      allStatements.forEach(s => {
        s.accountName = accountName;
        s.label = `${accountName} ${s.date}`;
      });

      return allStatements;
    },

    // Download statements by cycling through the picker:
    // select month → click Download → wait → next month
    clickDownloadBulk: async (items, progressCallback) => {
      const wanted = new Map();
      for (const item of items) {
        wanted.set(item.date, item);
      }
      if (wanted.size === 0) return 0;

      let totalClicked = 0;

      try {
        // Open the picker
        const pickerBtn = findPickerButton();
        if (pickerBtn) {
          const isExpanded = pickerBtn.getAttribute("aria-expanded") === "true";
          if (!isExpanded) {
            pickerBtn.click();
            await sleep(800);
          }
        }

        // Navigate to the earliest year first by clicking Previous Year
        let prevBtn = findPrevYearButton();
        while (prevBtn) {
          prevBtn.click();
          await sleep(600);
          prevBtn = findPrevYearButton();
        }

        // Now walk forward year by year, clicking matching months
        let yearPasses = 0;
        while (wanted.size > 0 && yearPasses < 15) {
          // Click all matching months in this year
          const monthButtons = [];
          document.querySelectorAll("button").forEach(btn => {
            const label = getButtonLabel(btn);
            const m = label.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
            if (!m) return;
            const mo = MONTHS[m[1].toLowerCase()];
            if (!mo) return;
            const date = `${m[3]}-${mo}`;
            if (wanted.has(date)) {
              monthButtons.push({ btn, date, label });
            }
          });

          for (const { btn, date, label } of monthButtons) {
            // Click the month in the picker
            btn.click();
            await sleep(1500);

            // Close picker so Download button is accessible
            const pickerToggle = findPickerButton();
            if (pickerToggle && pickerToggle.getAttribute("aria-expanded") === "true") {
              pickerToggle.click();
              await sleep(500);
            }

            // Click Download
            const dlBtn = findDownloadButton();
            if (dlBtn) {
              dlBtn.click();
              totalClicked++;
              wanted.delete(date);
              if (progressCallback) progressCallback(label);
              await sleep(2500);
            }

            // Re-open picker for next month
            if (pickerToggle && pickerToggle.getAttribute("aria-expanded") !== "true") {
              pickerToggle.click();
              await sleep(800);
            }
          }

          // Go to next year
          let nextYearBtn = null;
          for (const btn of document.querySelectorAll("button")) {
            const label = getButtonLabel(btn).toLowerCase();
            if (label === "next year") {
              if (!btn.disabled && btn.getAttribute("aria-disabled") !== "true") {
                nextYearBtn = btn;
              }
            }
          }
          if (!nextYearBtn) break;
          nextYearBtn.click();
          await sleep(600);
          yearPasses++;
        }

        // Close picker
        const pickerToggle = findPickerButton();
        if (pickerToggle && pickerToggle.getAttribute("aria-expanded") === "true") {
          pickerToggle.click();
        }
      } catch (e) {
        console.error("Statement Grabber: Capital One download error", e);
      }

      await sleep(5000);
      return totalClicked;
    },
  };

  if (window.__registerScraper) {
    window.__registerScraper("capital-one", scraper);
  }
})();
