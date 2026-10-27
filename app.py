from flask import Flask, request, jsonify
from flask_cors import CORS
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from presidio_analyzer.nlp_engine import NlpEngineProvider
import re
import os

app = Flask(__name__)
CORS(app)

analyzer = None
anonymizer = None

def load_ai():
    global analyzer, anonymizer
    if analyzer is None:
        configuration = {
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
        }
        provider = NlpEngineProvider(nlp_configuration=configuration)
        nlp_engine = provider.create_engine()
        analyzer = AnalyzerEngine(nlp_engine=nlp_engine)
        anonymizer = AnonymizerEngine()

@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    text = data.get('text', '')
    
    if not text:
        return jsonify({'error': 'No text provided'}), 400

    load_ai() # Load the AI model safely
    entities_found = 0
    processed_text = text

    # --- LAYER 1: SECRETS (PASSWORDS, API KEYS) ---
    # Catches: password=123, api_key: sk_123, token is abc123
    secret_pattern = r'(?i)(password|passwd|pwd|api_key|apikey|secret|token|auth)(?:\s+is)?[\s:=]+([^\s]+)'
    matches = re.findall(secret_pattern, processed_text)
    for match in matches:
        processed_text = re.sub(re.escape(match[1]), '[SECRET]', processed_text)
        entities_found += 1

    # --- LAYER 2: FINANCIAL DATA ---
    # Credit Cards (16 digits)
    card_pattern = r'\b(?:\d[ -]*?){13,16}\b'
    for card in re.findall(card_pattern, processed_text):
        processed_text = processed_text.replace(card, '[CARD_NUMBER]')
        entities_found += 1
        
    # Citizen IDs (Nepali 10-digit format, careful not to catch phones)
    id_pattern = r'(?<!9[78])\b\d{10}\b' 
    for cid in re.findall(id_pattern, processed_text):
        processed_text = processed_text.replace(cid, '[CITIZEN_ID]')
        entities_found += 1

    # --- LAYER 3: CONTACT INFO ---
    # Emails
    email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
    for email in re.findall(email_pattern, processed_text):
        processed_text = processed_text.replace(email, '[EMAIL]')
        entities_found += 1
        
    # Nepali Phones (98/97)
    phone_pattern = r'\b(98\d{8}|97\d{8})\b'
    for phone in re.findall(phone_pattern, processed_text):
        processed_text = processed_text.replace(phone, '[PHONE_NUMBER]')
        entities_found += 1

    # --- LAYER 4: AI NAMES & LOCATIONS ---
    # Run the small AI model
    results = analyzer.analyze(
        text=processed_text,
        language='en',
        entities=["PERSON", "LOCATION", "ORGANIZATION"]
    )

    # Replace what the AI found
    if results:
        anonymized = anonymizer.anonymize(text=processed_text, analyzer_results=results)
        processed_text = anonymized.text
        entities_found += len(results)

    # --- LAYER 5: FALLBACK NAMES ---
    # If the user typed a name the small AI missed (e.g., "Sujal"),
    # we catch any capitalized word that is not at the start of a sentence.
    words = processed_text.split()
    final_words = []
    for i, word in enumerate(words):
        clean = re.sub(r'[^a-zA-Z]', '', word)
        # Check if it starts with a capital, is longer than 2 letters, and has no placeholders/numbers
        if len(clean) > 2 and clean[0].isupper() and i > 0 and '[' not in word and not any(c.isdigit() for c in word):
            # Ensure previous word is lowercase (rules out "My Name")
            prev = re.sub(r'[^a-zA-Z]', '', words[i-1])
            if prev and prev[0].islower():
                final_words.append(word.replace(clean, '[PERSON_NAME]'))
                entities_found += 1
                continue
        final_words.append(word)

    return jsonify({
        'status': 'success',
        'redacted_text': ' '.join(final_words),
        'entities_found': entities_found
    })

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port)