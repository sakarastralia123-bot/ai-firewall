document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggleSwitch');
  const statusText = document.getElementById('statusText');

  // Load saved state and stats
  chrome.storage.local.get(['firewallEnabled', 'redactedCount'], (result) => {
    const isEnabled = result.firewallEnabled !== false; 
    toggle.checked = isEnabled;
    
    // Show redacted count if it exists
    if (result.redactedCount) {
        document.getElementById('redactedCount').innerText = result.redactedCount;
    }

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
      statusText.innerHTML = '<span class="dot"></span> Active';
      statusText.style.color = '#10B981';
    } else {
      statusText.innerHTML = '<span class="dot" style="background:#EF4444; box-shadow:none; animation:none;"></span> Disabled';
      statusText.style.color = '#EF4444';
    }
  }
});