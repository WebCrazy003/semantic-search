# backend/tests/test_device_usage.py
"""The device usage sampler: it must be cheap, and it must never raise."""

from __future__ import annotations

import pytest

from app.services.device_usage import DeviceUsageMonitor, usage_as_dict


class TestCpuPercent:
    def test_the_first_sample_has_nothing_to_compare_against(self) -> None:
        monitor = DeviceUsageMonitor(device="cpu")
        assert monitor.sample().cpu_percent is None

    def test_a_later_sample_reports_a_percentage(self) -> None:
        monitor = DeviceUsageMonitor(device="cpu")
        monitor.sample()
        # Burn a little CPU so the second sample has something to measure.
        sum(range(200_000))
        usage = monitor.sample()

        assert usage.cpu_percent is not None
        assert usage.cpu_percent >= 0

    def test_it_reports_how_many_cores_that_is_out_of(self) -> None:
        usage = DeviceUsageMonitor(device="cpu").sample()
        assert usage.cpu_cores is None or usage.cpu_cores >= 1


class TestDevice:
    def test_it_names_the_device_it_was_built_for(self) -> None:
        usage = DeviceUsageMonitor(device="cuda", name="NVIDIA GeForce RTX 5060").sample()
        assert usage.device == "cuda"
        assert usage.name == "NVIDIA GeForce RTX 5060"

    def test_a_cpu_device_reports_no_device_memory(self) -> None:
        usage = DeviceUsageMonitor(device="cpu").sample()
        assert usage.memory_used_gb is None
        assert usage.memory_total_gb is None
        assert usage.gpu_percent is None

    def test_an_unreadable_device_still_returns_a_sample(self, monkeypatch) -> None:
        """A machine that cannot answer must not fail the status endpoint."""
        monitor = DeviceUsageMonitor(device="cuda")
        monkeypatch.setattr(
            DeviceUsageMonitor,
            "_cuda",
            staticmethod(lambda: (_ for _ in ()).throw(RuntimeError("no driver"))),
        )
        usage = monitor.sample()

        assert usage.device == "cuda"
        assert usage.memory_used_gb is None

    def test_memory_percent_is_derived_from_used_and_total(self, monkeypatch) -> None:
        monitor = DeviceUsageMonitor(device="cuda")
        monkeypatch.setattr(DeviceUsageMonitor, "_cuda", staticmethod(lambda: (3.0, 12.0, 47.0)))
        usage = monitor.sample()

        assert usage.memory_used_gb == 3.0
        assert usage.memory_total_gb == 12.0
        assert usage.memory_percent == 25.0
        assert usage.gpu_percent == 47.0

    def test_a_zero_total_does_not_divide_by_zero(self, monkeypatch) -> None:
        monitor = DeviceUsageMonitor(device="cuda")
        monkeypatch.setattr(DeviceUsageMonitor, "_cuda", staticmethod(lambda: (1.0, 0.0, None)))
        assert monitor.sample().memory_percent is None


class TestSerialisation:
    def test_every_field_survives_the_dict(self) -> None:
        monitor = DeviceUsageMonitor(device="mps", name="Apple GPU")
        payload = usage_as_dict(monitor.sample())
        assert set(payload) == {
            "device",
            "name",
            "memory_used_gb",
            "memory_total_gb",
            "memory_percent",
            "cpu_percent",
            "cpu_cores",
            "gpu_percent",
        }
        assert payload["device"] == "mps"


@pytest.mark.parametrize("device", ["cuda", "mps", "cpu"])
def test_sampling_any_device_on_this_machine_never_raises(device: str) -> None:
    """Most of these are the wrong device for the machine running the tests.

    That is the point: asking a machine about a device it does not have is exactly the
    case that must degrade to "no reading" rather than to an exception.
    """
    DeviceUsageMonitor(device=device).sample()
