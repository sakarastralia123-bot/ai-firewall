from flask import Flask, request, jsonify
from flask_cors import CORS
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
import re

app = Flask(__name__)
CORS(app)

# Initialize the Microsoft AI Engine
analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    text = data.get('text', '')
    
    if not text:
        return jsonify({'error': 'No text provided'}), 400

    # 1. Pre-process Secrets (Presidio doesn't catch "password is 123" out of the box)
    secret_pattern = r'(?i)(password|passwd|pwd|api_key|apikey|secret|token|auth)(?:\s+is)?[\s:=]+([^\s]+)'
    matches = re.findall(secret_pattern, text)
    for match in matches:
        text = re.sub(re.escape(match[1]), '[SECRET]', text)

    # 2. Run the Microsoft AI Analyzer
    results = analyzer.analyze(
        text=text,
        language='en',
        entities=["PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD", "LOCATION"]
    )

    # 3. Anonymize the text based on the AI's findings
    anonymized_result = anonymizer.anonymize(
        text=text,
        analyzer_results=results
    )

    return jsonify({
        'status': 'success',
        'redacted_text': anonymized_result.text,
        'entities_found': len(results)
    })

if __name__ == '__main__':
    app.run(port=5001, debug=True)