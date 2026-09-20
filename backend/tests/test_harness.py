"""Proves the toolchain is installed and importable before real work starts."""

import sys


def test_python_version_is_supported() -> None:
    assert (3, 11) <= sys.version_info < (3, 13)


def test_heavy_dependencies_import() -> None:
    import fitz  # PyMuPDF
    import qdrant_client
    import transformers

    assert hasattr(fitz, "open")
    assert hasattr(qdrant_client, "QdrantClient")
    assert hasattr(transformers, "AutoTokenizer")
