let isProcessing = false;

function getInputBox() {
    return document.querySelector('#prompt-textarea') || 
           document.querySelector('textarea') || 
           document.querySelector('[contenteditable="true"]');
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.bottom = '20px';
    toast.style.right = '20px';
    toast.style.backgroundColor = '#10B981';
    toast.style.color = 'white';
    toast.style.padding = '12px 24px';
    toast.style.borderRadius = '8px';
    toast.style.fontFamily = 'sans-serif';
    toast.style.fontWeight = 'bold';
    toast.style.zIndex = '99999';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    document.body.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
}

// This forces React to recognize the text change
function setNativeValue(element, value) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (valueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
        valueSetter.call(element, value);
    } else {
        element.innerText = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
}

document.addEventListener('keydown', async (event) => {
    // 1. If we are already processing, IGNORE this keypress (prevents infinite loop)
    if (isProcessing) return;

    // 2. Catch the user's real Enter key
    if (event.key === 'Enter' && !event.shiftKey) {
        const inputBox = getInputBox();
        if (!inputBox) return;

        const originalText = inputBox.value !== undefined ? inputBox.value : inputBox.innerText;
        if (!originalText || originalText.trim() === '') return;

        chrome.storage.local.get(['firewallEnabled'], async (result) => {
            const isEnabled = result.firewallEnabled !== false;
            if (!isEnabled) return;

            // 3. Stop the original message from sending
            event.preventDefault(); 
            event.stopPropagation();
            
            // 4. Lock the extension
            isProcessing = true;

            try {
                const response = await fetch('http://127.0.0.1:8080/v1/redact', {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'x-api-key': 'sk_test_demo'
                    },
                    body: JSON.stringify({ text: originalText })
                });

                const data = await response.json();
                
                // 5. Put the redacted text into the box
                setNativeValue(inputBox, data.redacted_text);
                
                if (data.entities_found > 0) {
                    showToast(`🛡️ Redacted ${data.entities_found} sensitive items.`);
                }

                // 6. Automatically press Enter for the user to send the safe text
                setTimeout(() => {
                    // First try clicking the send button
                    const sendButton = document.querySelector('button[data-testid="send-button"]') || 
                                       document.querySelector('button[aria-label="Send prompt"]');
                    
                    if (sendButton && !sendButton.disabled) {
                        sendButton.click();
                    } else {
                        // If the button is hidden, simulate an Enter keypress
                        inputBox.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
                        }));
                    }
                    
                    // 7. Unlock the extension after a brief delay so you can type again
                    setTimeout(() => { isProcessing = false; }, 500); 

                }, 100);

            } catch (error) {
                console.error("Firewall Error:", error);
                showToast("❌ Firewall Offline or API Error");
                isProcessing = false; 
            }
        });
    }
}, true);