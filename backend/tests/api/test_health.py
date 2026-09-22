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


def test_readiness_says_which_device_embeds(client: TestClient, container) -> None:
    from app.services.embedding_service import DeviceInfo

    container.embedder.device_info = lambda: DeviceInfo(
        device="cuda",
        name="NVIDIA GeForce RTX 5060",
        precision="fp16",
        batch_size=16,
        memory_gb=8.0,
    )
    body = client.get("/api/health/ready").json()
    assert body["embedding_device"] == "cuda"
    assert body["embedding_device_name"] == "NVIDIA GeForce RTX 5060"
    assert body["embedding_precision"] == "fp16"
    assert body["embedding_batch_size"] == 16
    assert body["embedding_memory_gb"] == 8.0
    assert body["embedding_fallback_reason"] is None


def test_readiness_without_device_details_leaves_them_empty(client: TestClient) -> None:
    body = client.get("/api/health/ready").json()
    assert body["embedding_device"] is None
