import fs from "fs";
import path from "path";

/**
 * Searches for a Chromium-based browser (Edge, Chrome, Brave)
 * that supports standalone PWA/App mode (--app=URL)
 */
export function findAppBrowser(): string | null {
  const platform = process.platform;

  if (platform === "win32") {
    const programFilesX86 =
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const localAppData = process.env.LOCALAPPDATA || "";

    const candidates = [
      path.join(programFilesX86, "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(programFiles, "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(localAppData, "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(programFiles, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(programFilesX86, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(localAppData, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(
        programFiles,
        "BraveSoftware\\Brave-Browser\\Application\\brave.exe"
      ),
    ];

    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c;
    }
  } else if (platform === "darwin") {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];

    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }

  return null;
}

/**
 * Launches the app in a dedicated frameless desktop window.
 * If no Chromium browser is found, falls back to the default system browser.
 */
export function launchAppWindow(url: string, width = 860, height = 860) {
  const browserPath = findAppBrowser();

  if (browserPath) {
    try {
      Bun.spawn([
        browserPath,
        `--app=${url}`,
        `--window-size=${width},${height}`,
      ]);
      return;
    } catch {
      // Fallback
    }
  }

  // Fallback to default browser
  if (process.platform === "win32") {
    Bun.spawn(["cmd", "/c", "start", url]);
  } else if (process.platform === "darwin") {
    Bun.spawn(["open", url]);
  } else {
    Bun.spawn(["xdg-open", url]);
  }
}
