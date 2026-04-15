// Background service worker for Statement Grabber

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "-").toLowerCase();
}

function buildFilename(bankFolder, accountName, date, format) {
  const account = sanitizeFilename(accountName || "statement");
  const dateStr = sanitizeFilename(date || "unknown-date");
  const ext = (format || "pdf").toLowerCase();
  return `statements/${bankFolder}/${account}_${dateStr}.${ext}`;
}

function downloadOne(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename, saveAs: false, conflictAction: "uniquify" },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!downloadId) {
          reject(new Error("Download failed - no download ID returned"));
          return;
        }

        let settled = false;
        const timeoutId = setTimeout(() => {
          if (settled) return;
          settled = true;
          chrome.downloads.onChanged.removeListener(onChanged);
          reject(new Error("Download timed out"));
        }, 60000);

        function onChanged(delta) {
          if (delta.id !== downloadId) return;
          if (delta.state) {
            if (delta.state.current === "complete") {
              if (settled) return;
              settled = true;
              clearTimeout(timeoutId);
              chrome.downloads.onChanged.removeListener(onChanged);
              resolve(filename);
            } else if (delta.state.current === "interrupted") {
              if (settled) return;
              settled = true;
              clearTimeout(timeoutId);
              chrome.downloads.onChanged.removeListener(onChanged);
              reject(new Error(delta.error?.current || "Download interrupted"));
            }
          }
        }
        chrome.downloads.onChanged.addListener(onChanged);
      }
    );
  });
}

// --- Download redirect for click-based banks (e.g. Chime) ---
// When a bank uses JS buttons instead of <a href> links, the browser
// initiates the download itself. We intercept via onDeterminingFilename
// to reroute the file into statements/{bankFolder}/.
let redirectFolder = null;
let redirectActive = false;

function startRedirect(folder) {
  redirectFolder = sanitizeFilename(folder || "unknown-bank");
  redirectActive = true;
}

function stopRedirect() {
  redirectActive = false;
  redirectFolder = null;
}

// Always-registered listener; only acts when redirect is active
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!redirectActive || !redirectFolder) {
    suggest();
    return;
  }
  // item.filename is the suggested filename (e.g. "Chime-Checking-Statement-March-2026.pdf")
  const originalName = item.filename || "statement.pdf";
  suggest({
    filename: `statements/${redirectFolder}/${originalName}`,
    conflictAction: "uniquify",
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg.action === "startRedirect") {
    startRedirect(msg.folder);
    sendResponse({ ok: true });
    return;
  }

  if (msg.action === "stopRedirect") {
    stopRedirect();
    sendResponse({ ok: true });
    return;
  }

  // URL-based batch download (for banks with real links)
  if (msg.action === "downloadStatements") {
    const { statements } = msg;
    const bankFolder = sanitizeFilename(msg.folder || msg.bank || "unknown-bank");

    (async () => {
      let completed = 0;
      const total = statements.length;

      for (const stmt of statements) {
        const filename = buildFilename(
          bankFolder,
          stmt.accountName,
          stmt.date,
          stmt.format
        );

        try {
          await downloadOne(stmt.url, filename);
          completed++;
          chrome.runtime.sendMessage({
            action: "downloadProgress",
            completed, total, filename,
          }).catch(() => {});
        } catch (err) {
          completed++;
          chrome.runtime.sendMessage({
            action: "downloadError",
            completed, total, filename,
            error: err.message,
          }).catch(() => {});
        }

        if (completed < total) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      chrome.runtime.sendMessage({
        action: "downloadComplete",
        completed: total,
        bankFolder,
      }).catch(() => {});
    })();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("Statement Grabber installed");
});
