// Relay the keyboard command to the active new-tab page.
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle_game") return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "toggle_game" });
    } catch (_) {
      // Tab isn't our new-tab page — ignore.
    }
  }
});
