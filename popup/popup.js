document.addEventListener("DOMContentLoaded", async () => {
  const bankStatus = document.getElementById("bank-status");
  const bankInfo = document.getElementById("bank-info");
  const bankIcon = document.getElementById("bank-icon");
  const bankName = document.getElementById("bank-name");
  const stmtCount = document.getElementById("statement-count");
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
  let currentBank = null;
  let currentFolder = null;

  // Quick links
  document.querySelectorAll(".bank-link").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: link.dataset.url });
    });
  });

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
          <div class="stmt-date">${s.url ? new URL(s.url, "https://example.com").pathname.split("/").pop() || "" : ""}</div>
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
    stmtsContainer.classList.add("hidden");
    actions.classList.add("hidden");
    noBank.classList.add("hidden");

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab");

      // Send scan request -- scrapers with pagination may take a while
      bankStatus.textContent = "Scanning for statements (may take a moment if paginated)...";
      const response = await chrome.tabs.sendMessage(tab.id, { action: "scan" }).catch(() => null);

      if (response && response.bank) {
        currentBank = response.bank;
        currentFolder = response.folder || null;
        statements = response.statements || [];

        bankStatus.textContent = `Connected to ${response.bank}`;
        bankStatus.className = "status found";
        bankIcon.textContent = response.icon || "🏦";
        bankName.textContent = response.bank;
        stmtCount.textContent = statements.length;

        bankInfo.classList.remove("hidden");

        if (statements.length > 0) {
          renderStatements(statements);
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

  // Check all toggle
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
    const checked = [...stmtList.querySelectorAll("input:checked")].map(cb => statements[cb.dataset.index]);
    if (checked.length === 0) return;

    actions.classList.add("hidden");
    progressSection.classList.remove("hidden");
    logContainer.classList.remove("hidden");
    log.innerHTML = "";
    progressBar.style.width = "0%";
    progressText.textContent = `Downloading 0 / ${checked.length}...`;

    addLog(`Starting download of ${checked.length} statements...`, "info");

    // Send to background worker
    chrome.runtime.sendMessage({
      action: "downloadStatements",
      bank: currentBank,
      folder: currentFolder,
      statements: checked,
    });
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
      progressBar.style.width = "100%";
      progressText.textContent = `Done! ${msg.completed} files downloaded.`;
      addLog(`All done! Files saved to Downloads/statements/${msg.bankFolder}/`, "success");
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
