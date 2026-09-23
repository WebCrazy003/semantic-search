# backend/tests/api/test_indexing.py
from pathlib import Path

from fastapi.testclient import TestClient

from app.deps import Container


class TestStartIndexing:
    def test_indexing_the_default_directory(
        self, client: TestClient, api_documents_dir: Path
    ) -> None:
        response = client.post("/api/index", json={})
        assert response.status_code == 202
        body = response.json()
        assert body["status"] == "started"
        assert body["directory"] == str(api_documents_dir)

    def test_the_run_completes_and_the_status_reflects_it(self, client: TestClient) -> None:
        client.post("/api/index", json={})
        status = client.get("/api/index/status").json()
        assert status["status"] == "completed"
        assert status["total_documents"] == 4
        assert status["indexed_documents"] == 3
        assert status["unsupported_documents"] == 1
        assert status["failed_documents"] == 0
        assert status["total_chunks"] > 0

    def test_an_explicit_directory_is_used(self, client: TestClient, tmp_path: Path) -> None:
        empty = tmp_path / "empty-corpus"
        empty.mkdir()
        client.post("/api/index", json={"directory": str(empty)})
        status = client.get("/api/index/status").json()
        assert status["directory"] == str(empty)
        assert status["total_documents"] == 0

    def test_a_missing_directory_is_reported_in_the_status(
        self, client: TestClient, tmp_path: Path
    ) -> None:
        client.post("/api/index", json={"directory": str(tmp_path / "ghost")})
        status = client.get("/api/index/status").json()
        assert status["status"] == "failed"
        assert status["failures"][0]["error_type"] == "DirectoryNotFound"

    def test_force_reindexes(self, client: TestClient) -> None:
        client.post("/api/index", json={})
        client.post("/api/index", json={"force": True})
        status = client.get("/api/index/status").json()
        assert status["indexed_documents"] == 3
        assert status["skipped_documents"] == 0

    def test_a_second_run_skips_unchanged_files(self, client: TestClient) -> None:
        client.post("/api/index", json={})
        client.post("/api/index", json={})
        status = client.get("/api/index/status").json()
        assert status["indexed_documents"] == 0
        assert status["skipped_documents"] == 3


class TestAlreadyRunning:
    def test_a_reserved_run_is_reported_rather_than_started_twice(
        self, client: TestClient, container: Container
    ) -> None:
        assert container.indexing.start(None, False) is True  # hold the reservation
        response = client.post("/api/index", json={})
        assert response.status_code == 409
        assert response.json()["status"] == "already_running"
        container.indexing.run(None, False)  # release it


class TestStatusBeforeAnyRun:
    def test_the_status_is_idle(self, client: TestClient) -> None:
        status = client.get("/api/index/status").json()
        assert status["status"] == "idle"
        assert status["total_documents"] == 0
        assert status["failures"] == []


class TestFailureReporting:
    def test_a_corrupt_file_is_listed_with_its_error(
        self, client: TestClient, api_documents_dir: Path
    ) -> None:
        (api_documents_dir / "broken.pdf").write_bytes(b"%PDF-1.7\nnope")
        client.post("/api/index", json={})
        status = client.get("/api/index/status").json()
        assert status["failed_documents"] == 1
        failure = status["failures"][0]
        assert failure["filename"] == "broken.pdf"
        assert failure["error_message"]
        assert failure["timestamp"]


class TestDeviceUsage:
    """While a job runs the status carries what the GPU or CPU is doing."""

    def test_an_idle_status_carries_no_usage(self, client: TestClient) -> None:
        """Nothing is being computed, so there is nothing to report."""
        assert client.get("/api/index/status").json()["device"] is None

    def test_a_finished_status_carries_no_usage(self, client: TestClient) -> None:
        client.post("/api/index", json={})
        status = client.get("/api/index/status").json()
        assert status["status"] == "completed"
        assert status["device"] is None

    def test_a_running_status_names_the_device(
        self, client: TestClient, container: Container
    ) -> None:
        # The run happens in a background thread in production; here the state is set
        # directly so the endpoint can be tested without racing a real job.
        with container.indexing._state_lock:
            container.indexing._state.status = "running"

        device = client.get("/api/index/status").json()["device"]
        assert device is not None
        assert device["device"] == "cpu"
        assert device["name"] == "CPU"
        assert "cpu_percent" in device
        assert "memory_percent" in device

    def test_usage_is_left_out_when_no_monitor_is_configured(
        self, client: TestClient, container: Container
    ) -> None:
        container.device_monitor = None
        with container.indexing._state_lock:
            container.indexing._state.status = "running"

        assert client.get("/api/index/status").json()["device"] is None
