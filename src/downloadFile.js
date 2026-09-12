// ---- Trigger a browser file download from in-memory content ----
// Shared by ExportMenu (Ledger/Budget CSVs, the full JSON backup) and
// ImportCSV (the pre-restore safety-net backup) — one place for this so
// both stay byte-identical.
export function downloadFile(filename, contentString, mimeType) {
  const blob = new Blob(["﻿" + contentString], { type: mimeType }); // BOM so Excel opens CSV as UTF-8
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
