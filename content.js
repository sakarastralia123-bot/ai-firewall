let isProcessing = false;

function getInputBox() {
    return document.querySelector('#prompt-textarea') || 
           document.querySelector('textarea') || 
           document.querySelector('[contenteditable="true"]');
}

// This forces React (ChatGPT) to recognize the text change instantly
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
    if (isProcessing) return;

    if (event.key === 'Enter' && !event.shiftKey) {
        const inputBox = getInputBox();
        if (!inputBox) return;

        const originalText = inputBox.value !== undefined ? inputBox.value : inputBox.innerText;
        if (!originalText || originalText.trim() === '') return;

        chrome.storage.local.get(['firewallEnabled'], async (result) => {
            const isEnabled = result.firewallEnabled !== false;
            if (!isEnabled) return;

            event.preventDefault(); 
            event.stopPropagation();
            isProcessing = true;

            // ==========================================
            // 1. INSTANT LOCAL REDACTION (0ms Delay)
            // ==========================================
            let instantRedacted = originalText
                .replace(/\b(98\d{8}|97\d{8})\b/g, '[PHONE_NUMBER]')
                .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
                // FIXED REGEX HERE: The 'i' flag is at the end, not inside the pattern
                .replace(/(password|passwd|pwd|api_key|apikey|secret|token|auth)(?:\s+is)?[\s:=]+([^\s]+)/gi, (match, p1, p2) => {
                    return match.replace(p2, '[SECRET]');
                });
            
            setNativeValue(inputBox, instantRedacted);

            // ==========================================
            // 2. BACKGROUND AI REDACTION
            // ==========================================
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
                
                // If the AI found MORE things to redact, update the box again
                if (data.redacted_text && data.redacted_text !== instantRedacted) {
                    setNativeValue(inputBox, data.redacted_text);
                }

                // Send the message
                const sendButton = document.querySelector('button[data-testid="send-button"]') || 
                                   document.querySelector('button[aria-label="Send prompt"]');
                
                if (sendButton) {
                    sendButton.click();
                } else {
                    inputBox.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
                    }));
                }
                
                setTimeout(() => { isProcessing = false; }, 500); 

            } catch (error) {
                console.error("Firewall Error:", error);
                // Even if the server fails, the instant redaction already happened.
                const sendButton = document.querySelector('button[data-testid="send-button"]');
                if (sendButton) sendButton.click();
                setTimeout(() => { isProcessing = false; }, 500); 
            }
        });
    }
}, true);