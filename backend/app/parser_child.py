"""One-shot extraction entry point executed in a killable child process."""

import json
import sys
from contextlib import redirect_stdout

from app.registry import PARSER_ADAPTERS


def main() -> int:
    parser_id, file_path = sys.argv[1], sys.argv[2]
    if parser_id not in PARSER_ADAPTERS:
        print(json.dumps({"error": "Unknown parser."}))
        return 2
    try:
        from app.utils.pdf_extractors import get_extractor

        # Third-party parsers may print notices to stdout. Keep the parent
        # worker's stdout channel reserved for the JSON result payload.
        with redirect_stdout(sys.stderr):
            extracted = get_extractor(parser_id).extract(file_path)
        print(json.dumps({"text": extracted}, ensure_ascii=False))
        return 0
    except BaseException as exc:
        message = " ".join(str(exc).split())[:400]
        print(json.dumps({"error": f"{type(exc).__name__}: {message}"}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
