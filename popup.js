// Load the current state when the popup opens
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggleSwitch');
  const statusText = document.getElementById('statusText');

  chrome.storage.local.get(['firewallEnabled'], (result) => {
    // Default to true if not set
    const isEnabled = result.firewallEnabled !== false; 
    toggle.checked = isEnabled;
    updateUI(isEnabled);
  });

  // Listen for toggle changes
  toggle.addEventListener('change', () => {
    const isEnabled = toggle.checked;
    chrome.storage.local.set({ firewallEnabled: isEnabled });
    updateUI(isEnabled);
  });

  function updateUI(isEnabled) {
    if (isEnabled) {
      statusText.textContent = 'Status: ON';
      statusText.classList.add('active');
    } else {
      statusText.textContent = 'Status: OFF';
      statusText.classList.remove('active');
    }
  }
});