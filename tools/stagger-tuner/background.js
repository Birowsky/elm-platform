// The toolbar button opens the panel beside the page. The panel injects the page side itself, so nothing runs in a page
// until the panel is open.

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
