document.addEventListener("DOMContentLoaded", async () => {
  const bankStatus = document.getElementById("bank-status");
  const bankInfo = document.getElementById("bank-info");
  const bankIcon = document.getElementById("bank-icon");
  const bankName = document.getElementById("bank-name");
  const stmtCount = document.getElementById("statement-count");
  const accountFilter = document.getElementById("account-filter");
  const accountButtons = document.getElementById("account-buttons");
  const stmtsContainer = document.getElementById("statements-container");
  const stmtList = document.getElementById("statement-list");
  const actions = document.getElementById("actions");
  const downloadBtn = document.getElementById("download-btn");
  const scanBtn = document.getElementById("scan-btn");
  const progressSection = document.getElementById("progress-section");
  const progressBar = document.getElementById("progress-bar");
  const progressText = document.getElementById("progress-text");
  const logContainer = document.getElementById("log-container");
  const log = document.getElementById("log");
  const noBank = document.getElementById("no-bank");
  const checkAll = document.getElementById("check-all");
  const selectedCount = document.getElementById("selected-count");

  let statements = [];
  let filteredStatements = [];
  let currentBank = null;
  let currentFolder = null;
  let activeAccounts = new Set(); // which account filters are active

  // Quick links
  document.querySelectorAll(".bank-link").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: link.dataset.url });
    });
  });

  function getUniqueAccounts(stmts) {
    const counts = {};
    stmts.forEach(s => {
      const name = s.accountName || "Unknown";
      counts[name] = (counts[name] || 0) + 1;
    });
    return counts;
  }

  function applyFilter() {
    if (activeAccounts.size === 0) {
      filteredStatements = [...statements];
    } else {
      filteredStatements = statements.filter(s => activeAccounts.has(s.accountName || "Unknown"));
    }
    renderStatements(filteredStatements);
    stmtCount.textContent = filteredStatements.length;
  }

  function renderAccountFilter(stmts) {
    const accounts = getUniqueAccounts(stmts);
    const names = Object.keys(accounts).sort();

    if (names.length <= 1) {
      accountFilter.classList.add("hidden");
      return;
    }

    accountButtons.innerHTML = "";

    // "All" button
    const allBtn = document.createElement("button");
    allBtn.className = "account-btn active";
    allBtn.innerHTML = `All <span class="acct-count">${stmts.length}</span>`;
    allBtn.addEventListener("click", () => {
      activeAccounts.clear();
      accountButtons.querySelectorAll(".account-btn").forEach(b => b.classList.remove("active"));
      allBtn.classList.add("active");
      applyFilter();
    });
    accountButtons.appendChild(allBtn);

    // Per-account buttons
    names.forEach(name => {
      const btn = document.createElement("button");
      btn.className = "account-btn";
      btn.innerHTML = `${name} <span class="acct-count">${accounts[name]}</span>`;
      btn.addEventListener("click", () => {
        // Toggle this account
        if (activeAccounts.has(name)) {
          activeAccounts.delete(name);
          btn.classList.remove("active");
        } else {
          activeAccounts.add(name);
          btn.classList.add("active");
        }
        // Deactivate "All" if any specific account is selected
        if (activeAccounts.size > 0) {
          allBtn.classList.remove("active");
        } else {
          allBtn.classList.add("active");
        }
        applyFilter();
      });
      accountButtons.appendChild(btn);
    });

    accountFilter.classList.remove("hidden");
  }

  function updateSelectedCount() {
    const checked = stmtList.querySelectorAll("input:checked").length;
    selectedCount.textContent = `${checked} selected`;
    downloadBtn.disabled = checked === 0;
  }

  function renderStatements(stmts) {
    stmtList.innerHTML = "";
    stmts.forEach((s, i) => {
      const item = document.createElement("div");
      item.className = "statement-item";
      item.innerHTML = `
        <input type="checkbox" checked data-index="${i}">
        <div class="stmt-info">
          <div class="stmt-name">${s.accountName || "Statement"} - ${s.date || "Unknown"}</div>
          <div class="stmt-date">${s.label || ""}</div>
        </div>
        <span class="stmt-format">${s.format || "pdf"}</span>
      `;
      item.querySelector("input").addEventListener("change", updateSelectedCount);
      item.addEventListener("click", (e) => {
        if (e.target.tagName !== "INPUT") {
          const cb = item.querySelector("input");
          cb.checked = !cb.checked;
          updateSelectedCount();
        }
      });
      stmtList.appendChild(item);
    });
    updateSelectedCount();
  }

  function addLog(text, type = "") {
    const entry = document.createElement("div");
    entry.className = `log-entry ${type}`;
    entry.textContent = text;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  async function scanPage() {
    bankStatus.textContent = "Scanning page...";
    bankStatus.className = "status detecting";
    bankInfo.classList.add("hidden");
    accountFilter.classList.add("hidden");
    stmtsContainer.classList.add("hidden");
    actions.classList.add("hidden");
    noBank.classList.add("hidden");
    activeAccounts.clear();

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab");

      bankStatus.textContent = "Scanning for statements (paginated banks take longer)...";
      const response = await chrome.tabs.sendMessage(tab.id, { action: "scan" }).catch(() => null);

      if (response && response.bank) {
        currentBank = response.bank;
        currentFolder = response.folder || null;
        statements = response.statements || [];
        filteredStatements = [...statements];

        bankStatus.textContent = `Connected to ${response.bank}`;
        bankStatus.className = "status found";
        bankIcon.textContent = response.icon || "🏦";
        bankName.textContent = response.bank;
        stmtCount.textContent = statements.length;

        bankInfo.classList.remove("hidden");

        if (statements.length > 0) {
          renderAccountFilter(statements);
          renderStatements(filteredStatements);
          stmtsContainer.classList.remove("hidden");
          actions.classList.remove("hidden");
        } else {
          addLog("No statements found on this page. Navigate to the statements/documents section.", "info");
          logContainer.classList.remove("hidden");
          actions.classList.remove("hidden");
        }
      } else {
        bankStatus.textContent = "Not a supported bank";
        bankStatus.className = "status not-found";
        noBank.classList.remove("hidden");
      }
    } catch (err) {
      bankStatus.textContent = "Error detecting bank";
      bankStatus.className = "status not-found";
      noBank.classList.remove("hidden");
      console.error(err);
    }
  }

  // Check all toggle (only affects visible/filtered statements)
  checkAll.addEventListener("change", () => {
    stmtList.querySelectorAll("input").forEach(cb => { cb.checked = checkAll.checked; });
    updateSelectedCount();
  });

  // Scan button
  scanBtn.addEventListener("click", () => {
    log.innerHTML = "";
    logContainer.classList.add("hidden");
    progressSection.classList.add("hidden");
    scanPage();
  });

  // Download button
  downloadBtn.addEventListener("click", async () => {
    const checked = [...stmtList.querySelectorAll("input:checked")].map(cb => filteredStatements[cb.dataset.index]);
    if (checked.length === 0) return;

    actions.classList.add("hidden");
    progressSection.classList.remove("hidden");
    logContainer.classList.remove("hidden");
    log.innerHTML = "";
    progressBar.style.width = "0%";
    progressText.textContent = `Downloading 0 / ${checked.length}...`;

    addLog(`Starting download of ${checked.length} statements...`, "info");

    // Check if these are click-based downloads (buttons, not links)
    const clickBased = checked.some(s => s.clickDownload);

    if (clickBased) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        // Tell background to redirect downloads into statements/{bank}/
        await chrome.runtime.sendMessage({
          action: "startRedirect",
          folder: currentFolder,
        });

        chrome.tabs.sendMessage(tab.id, {
          action: "clickDownload",
          items: checked.map(s => ({
            accountName: s.accountName,
            date: s.date,
            label: s.label,
          })),
        }).catch(() => {});
      }
    } else {
      chrome.runtime.sendMessage({
        action: "downloadStatements",
        bank: currentBank,
        folder: currentFolder,
        statements: checked,
      });
    }
  });

  // Listen for progress updates from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "downloadProgress") {
      const pct = Math.round((msg.completed / msg.total) * 100);
      progressBar.style.width = `${pct}%`;
      progressText.textContent = `Downloading ${msg.completed} / ${msg.total}...`;
      addLog(`✓ ${msg.filename}`, "success");
    } else if (msg.action === "downloadError") {
      addLog(`✗ ${msg.filename}: ${msg.error}`, "error");
    } else if (msg.action === "downloadComplete") {
      // Wait for any in-flight downloads to finish before stopping redirect
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: "stopRedirect" }).catch(() => {});
      }, 10000);

      progressBar.style.width = "100%";
      progressText.textContent = `Done! ${msg.completed} files downloaded.`;
      addLog(`All done! Files saved to Downloads/statements/${msg.bankFolder}/[account]/`, "success");
      actions.classList.remove("hidden");
      downloadBtn.textContent = "✓ Complete";
      downloadBtn.disabled = true;
      setTimeout(() => {
        downloadBtn.innerHTML = '<span class="btn-icon">↓</span> Download Selected';
        downloadBtn.disabled = false;
      }, 3000);
    }
  });

  // Initial scan
  scanPage();
});
