async function openSidePanel(tab) {
  try {
    await chrome.sidePanel.setOptions({
      tabId: tab?.id,
      path: `sidepanel.html${tab?.id ? `?tab=${tab.id}` : ""}`,
      enabled: true,
    });
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
      return;
    }
    if (tab?.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.warn("[HivemindOS Browser] Side panel open failed:", error);
    await chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel.html") });
  }
}

chrome.action.onClicked.addListener(openSidePanel);
