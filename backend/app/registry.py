"""Canonical parser registry shared by the API validator and worker runner."""

PARSER_ADAPTERS = {
    "pymupdf": ("app.utils.pdf_extractors", "PyMuPDFExtractor"),
    "pdfplumber": ("app.utils.pdf_extractors", "PDFPlumberExtractor"),
    "pypdf": ("app.utils.pdf_extractors", "PyPDFExtractor"),
    "pdfminer": ("app.utils.pdf_extractors", "PDFMinerExtractor"),
}


def validate_parser_catalog(db) -> None:
    enabled = {parser["_id"] for parser in db.parsers.find({"enabled": True})}
    unknown = enabled - PARSER_ADAPTERS.keys()
    if unknown:
        raise RuntimeError(f"Enabled catalog parsers have no executable adapter: {sorted(unknown)}")
