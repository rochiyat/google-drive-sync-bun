/**
 * Native OS Folder Picker Dialog
 * Spawns native OS dialogs:
 * - Windows: PowerShell FolderBrowserDialog (TopMost)
 * - macOS: AppleScript (osascript choose folder)
 * - Linux: zenity or kdialog
 */

interface PickFolderResult {
  path: string | null;
  canceled: boolean;
}

/**
 * Windows Folder Picker via PowerShell FolderBrowserDialog
 */
async function pickFolderWindows(initialPath?: string): Promise<string | null> {
  const validInitial = initialPath && !initialPath.startsWith(".") ? initialPath : "";
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Pilih Folder Tujuan Penyimpanan'
$dialog.ShowNewFolderButton = $true
${
  validInitial
    ? `if (Test-Path '${validInitial.replace(/'/g, "''")}') { $dialog.SelectedPath = '${validInitial.replace(/'/g, "''")}' }`
    : ""
}
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$result = $dialog.ShowDialog($owner)
$owner.Dispose()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialog.SelectedPath)
}
`;

  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const proc = Bun.spawn(
    ["powershell", "-NoProfile", "-STA", "-EncodedCommand", encoded],
    { stdout: "pipe", stderr: "ignore" }
  );

  const output = await new Response(proc.stdout).text();
  await proc.exited;
  const trimmed = output.trim();
  return trimmed || null;
}

/**
 * macOS Folder Picker via AppleScript (choose folder)
 */
async function pickFolderMacOS(initialPath?: string): Promise<string | null> {
  const prompt = "Pilih Folder Tujuan Penyimpanan:";
  const defaultLoc =
    initialPath && !initialPath.startsWith(".")
      ? `default location "${initialPath.replace(/"/g, '\\"')}"`
      : "";

  const script = `POSIX path of (choose folder with prompt "${prompt}" ${defaultLoc})`;

  const proc = Bun.spawn(["osascript", "-e", script], {
    stdout: "pipe",
    stderr: "ignore",
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    // User pressed Cancel (AppleScript error -128)
    return null;
  }

  const trimmed = output.trim();
  return trimmed.replace(/\/$/, "") || null;
}

/**
 * Linux Folder Picker via zenity / kdialog
 */
async function pickFolderLinux(initialPath?: string): Promise<string | null> {
  // Try zenity
  try {
    const zenityArgs = [
      "zenity",
      "--file-selection",
      "--directory",
      "--title=Pilih Folder Tujuan Penyimpanan",
    ];
    if (initialPath && !initialPath.startsWith(".")) {
      zenityArgs.push(`--filename=${initialPath}`);
    }
    const proc = Bun.spawn(zenityArgs, { stdout: "pipe", stderr: "ignore" });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0 && output.trim()) {
      return output.trim();
    }
  } catch {
    // Fallback to kdialog
  }

  try {
    const kdialogArgs = ["kdialog", "--getexistingdirectory"];
    if (initialPath && !initialPath.startsWith(".")) {
      kdialogArgs.push(initialPath);
    }
    const proc = Bun.spawn(kdialogArgs, { stdout: "pipe", stderr: "ignore" });
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    if (exitCode === 0 && output.trim()) {
      return output.trim();
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Open native OS folder browser dialog
 */
export async function pickFolder(initialPath?: string): Promise<PickFolderResult> {
  let selected: string | null = null;
  const platform = process.platform;

  try {
    if (platform === "win32") {
      selected = await pickFolderWindows(initialPath);
    } else if (platform === "darwin") {
      selected = await pickFolderMacOS(initialPath);
    } else {
      selected = await pickFolderLinux(initialPath);
    }
  } catch (err) {
    console.error("Error opening folder picker dialog:", err);
    return { path: null, canceled: true };
  }

  return {
    path: selected,
    canceled: !selected,
  };
}
