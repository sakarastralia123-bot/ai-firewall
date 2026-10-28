(() => {
    "use strict";

    const API_URL = "https://sovereign-api-pepf.onrender.com/v1/redact";
    const FAIL_CLOSED = false;

    let isProcessing = false;
    let bypassNextClick = false;

    // 1. LOCAL REDACTION
    function redactLocally(text) {
        if (typeof text !== "string" || !text) return text;
        let result = text;
        result = result.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL]");
        result = result.replace(/(?<!\w)(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)\d{3,4}[\s.-]?\d{3,4}(?!\w)/g, "[PHONE]");
        const credentialPattern = /\b(pass[\s_-]*word|passwd|pwd|api[\s_-]*key|secret|token|authorization|auth)\b\s*(?:(?:is|are)\s+|[:=]\s*|\s+)([^\s,;]+)/gi;
        result = result.replace(credentialPattern, (match, label) => `${label} [SECRET]`);
        result = result.replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) => {
            const digits = match.replace(/\D/g, "");
            return digits.length >= 13 && digits.length <= 19 ? "[CARD NUMBER]" : match;
        });
        return result;
    }

    // 2. HELPERS
    function getMessageElement(target) {
        if (!(target instanceof Element)) return null;
        const editable = target.closest('textarea, input:not([type="button"]):not([type="submit"]), [contenteditable="true"], [role="textbox"]');
        if (!editable || editable.matches('input[type="password"]')) return null;
        return editable;
    }

    function getText(element) {
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value;
        return element.innerText || element.textContent || "";
    }

    function setText(element, text) {
        if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
            if (setter) setter.call(element, text);
            else element.value = text;
        } else {
            element.textContent = text;
        }
        element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function findSendButton(element) {
        const form = element?.closest("form");
        if (form) {
            const formButton = form.querySelector('button[type="submit"], input[type="submit"]');
            if (formButton && !formButton.disabled) return formButton;
        }
        const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));
        const candidates = buttons.filter((button) => {
            if (button.disabled) return false;
            const label = [button.innerText, button.getAttribute("aria-label"), button.getAttribute("data-testid"), button.getAttribute("title"), button.value].filter(Boolean).join(" ").toLowerCase();
            return /\b(send|submit|send message)\b/.test(label);
        });
        return candidates.find((button) => {
            const rect = button.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }) || null;
    }

    // 3. REMOTE REDACTION WITH 60s TIMEOUT
    async function redactWithAPI(locallyRedactedText) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); 

        try {
            showNotice("Waking up security gateway...");
            const response = await fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": "sk_test_demo"
                },
                body: JSON.stringify({ text: locallyRedactedText }),
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            
            // UPDATE THE POPUP COUNTER
            if (data.entities_found > 0) {
                chrome.storage.local.get(['redactedCount'], (res) => {
                    const newCount = (res.redactedCount || 0) + data.entities_found;
                    chrome.storage.local.set({ redactedCount: newCount });
                });
            }

            return data.redacted_text ?? data.text ?? locallyRedactedText;
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }

    // 4. FIREWALL SUBMISSION
    async function processSubmission(element, sendButton) {
        if (isProcessing || !element || !document.contains(element)) return;
        const originalText = getText(element);
        if (!originalText.trim()) return;

        isProcessing = true;

        try {
            const locallyRedacted = redactLocally(originalText);
            setText(element, locallyRedacted);

            let finalText = locallyRedacted;

            try {
                finalText = await redactWithAPI(locallyRedacted);
                showNotice("🛡️ Privacy check complete.");
            } catch (apiError) {
                console.error("[Privacy Firewall] API error:", apiError.message);
                if (FAIL_CLOSED) {
                    showNotice("Message blocked: API failed to respond.");
                    return;
                }
                showNotice("Sending locally redacted text (AI offline).");
            }

            setText(element, finalText);

            if (!sendButton || !document.contains(sendButton)) {
                sendButton = findSendButton(element);
            }

            if (!sendButton || sendButton.disabled) {
                showNotice("Send button not found.");
                return;
            }

            bypassNextClick = true;
            sendButton.click();
            queueMicrotask(() => { bypassNextClick = false; });

        } catch (error) {
            console.error("[Privacy Firewall] Submission error:", error);
            showNotice("The firewall encountered an error.");
        } finally {
            isProcessing = false;
        }
    }

    // 5. NOTICE UI
    function showNotice(message) {
        let notice = document.getElementById("privacy-firewall-notice");
        if (!notice) {
            notice = document.createElement("div");
            notice.id = "privacy-firewall-notice";
            Object.assign(notice.style, {
                position: "fixed", bottom: "20px", right: "20px", zIndex: "2147483647",
                maxWidth: "360px", padding: "12px 16px", background: "#0F172A",
                color: "#ffffff", border: "1px solid #334155", borderRadius: "8px",
                fontSize: "14px", fontFamily: "sans-serif", fontWeight: "500",
                boxShadow: "0 4px 14px rgba(0,0,0,0.25)"
            });
            document.body.appendChild(notice);
        }
        notice.textContent = message;
        notice.style.display = "block";
        window.clearTimeout(notice._hideTimer);
        notice._hideTimer = window.setTimeout(() => { notice.style.display = "none"; }, 6000);
    }

    // 6. EVENT LISTENERS
    document.addEventListener("click", (event) => {
        if (bypassNextClick) { bypassNextClick = false; return; }
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest('button, [role="button"], input[type="submit"]');
        if (!button) return;
        const label = [button.innerText, button.getAttribute("aria-label"), button.getAttribute("data-testid"), button.getAttribute("title"), button.value].filter(Boolean).join(" ").toLowerCase();
        const looksLikeSend = /\b(send|submit|send message)\b/.test(label) || button.matches('button[type="submit"], input[type="submit"]');
        if (!looksLikeSend) return;

        const form = button.closest("form");
        const activeElement = document.activeElement;
        const input = getMessageElement(activeElement) || (form ? form.querySelector('textarea, [contenteditable="true"], [role="textbox"], input:not([type="button"]):not([type="submit"])') : null) || document.querySelector('textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"], [role="textbox"]');
        if (!input) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        processSubmission(input, button);
    }, true);

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
        const input = getMessageElement(event.target);
        if (!input) return;
        const isMessageInput = input.matches("textarea, [contenteditable='true'], [role='textbox']");
        if (!isMessageInput) return;
        const sendButton = findSendButton(input);
        if (!sendButton) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        processSubmission(input, sendButton);
    }, true);

})();