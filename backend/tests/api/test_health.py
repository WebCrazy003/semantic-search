# backend/tests/api/test_health.py
from fastapi.testclient import TestClient


def test_health_returns_exactly_the_specified_shape(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_needs_no_query_parameters(client: TestClient) -> None:
    assert client.get("/api/health?ignored=1").status_code == 200


def test_readiness_reports_the_collection_and_the_model(client: TestClient) -> None:
    body = client.get("/api/health/ready").json()
    assert body["status"] == "ready"
    assert body["qdrant_reachable"] is True
    assert body["collection"] == "pdf_passages"
    assert body["points"] == 0
    assert body["model_loaded"] is True
    assert body["embedding_dimension"] == 1024


def test_the_openapi_schema_is_served(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    assert "/api/health" in schema["paths"]


def test_an_unknown_path_is_a_404(client: TestClient) -> None:
    assert client.get("/api/nope").status_code == 404
