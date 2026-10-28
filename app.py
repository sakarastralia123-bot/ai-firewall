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
            "models": [
                {"lang_code": "en", "model_name": "en_core_web_sm"}
            ],
        }

        provider = NlpEngineProvider(nlp_configuration=configuration)
        nlp_engine = provider.create_engine()
        analyzer = AnalyzerEngine(nlp_engine=nlp_engine)
        anonymizer = AnonymizerEngine()


@app.route("/analyze", methods=["POST"])
@app.route("/v1/redact", methods=["POST"])
def redact():
    data = request.get_json(silent=True) or {}
    text = data.get("text", "")

    if not isinstance(text, str) or not text.strip():
        return jsonify({"error": "No valid text provided"}), 400

    try:
        load_ai()
        processed = text
        entities_found = 0

        secret_pattern = re.compile(
            r"(?i)\b(pass[\s_-]*word|passwd|pwd|api[\s_-]*key|apikey|"
            r"secret|token|authorization|auth)\b"
            r"\s*(?:is\s+|[:=]\s*|\s+)([^\s,;]+)"
        )

        processed, count = secret_pattern.subn(
            lambda m: f"{m.group(1)} [SECRET]",
            processed
        )
        entities_found += count

        patterns = [
            (
                r"\b(?:\d[ -]?){13,19}\b",
                "[CARD_NUMBER]"
            ),
            (
                r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
                "[EMAIL]"
            ),
            (
                r"\b(?:98|97)\d{8}\b",
                "[PHONE_NUMBER]"
            ),
            (
                r"(?<!\d)(?!(?:97|98)\d{8}\b)\d{10}(?!\d)",
                "[CITIZEN_ID]"
            ),
        ]

        for pattern, replacement in patterns:
            processed, count = re.subn(pattern, replacement, processed)
            entities_found += count

        results = analyzer.analyze(
            text=processed,
            language="en",
            entities=["PERSON", "LOCATION", "ORGANIZATION"]
        )

        if results:
            anonymized = anonymizer.anonymize(
                text=processed,
                analyzer_results=results
            )
            processed = anonymized.text
            entities_found += len(results)

        return jsonify({
            "status": "success",
            "redacted_text": processed,
            "entities_found": entities_found
        })

    except Exception:
        app.logger.exception("Redaction failed")
        return jsonify({"error": "Redaction service failed"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port)