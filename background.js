// Background service worker for Statement Grabber
//
// chrome.downloads.download `filename` is relative to the browser's download directory (Chrome
// defaults to the user's Downloads folder). Paths with subdirectories such as
// `statements/capital-one/account_2024-01.pdf` create those folders under Downloads automatically;
// Chrome does not require you to create `statements/` or `statements/capital-one/` beforehand.

// Sanitize filename - remove invalid characters
function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "-").toLowerCase();
}

// Build path: Downloads/statements/{bank-folder}/{account}_{date}.{ext}
function buildFilename(bankFolder, accountName, date, format) {
  const account = sanitizeFilename(accountName || "statement");
  const dateStr = sanitizeFilename(date || "unknown-date");
  const ext = (format || "pdf").toLowerCase();
  return `statements/${bankFolder}/${account}_${dateStr}.${ext}`;
}

// Download a single statement
function downloadOne(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: url,
        filename: filename,
        saveAs: false,
        conflictAction: "uniquify",
      },
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

// Handle messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "downloadStatements") {
    const { statements } = msg;
    // Prefer detector slug (e.g. "capital-one"); fall back to sanitized display bank name
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

          chrome.runtime
            .sendMessage({
              action: "downloadProgress",
              completed,
              total,
              filename,
            })
            .catch(() => {});
        } catch (err) {
          completed++;
          chrome.runtime
            .sendMessage({
              action: "downloadError",
              completed,
              total,
              filename,
              error: err.message,
            })
            .catch(() => {});
        }

        if (completed < total) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      chrome.runtime
        .sendMessage({
          action: "downloadComplete",
          completed: total,
          bankFolder,
        })
        .catch(() => {});
    })();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("Statement Grabber installed");
});
