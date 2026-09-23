# backend/app/services/device_usage.py
"""How hard the machine is working while a job runs.

Reported from torch and the standard library only. psutil and pynvml would give more —
whole-machine CPU load, real GPU utilisation — but both are new dependencies in an
install that ships offline, and neither is needed to answer the question this is for:
"is the GPU being used, and how much of it".

Nothing here may raise. A usage reading that fails is worth losing; an indexing run is
not, and neither is the status endpoint the UI polls twice a second.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any

from app.logging_config import get_logger

logger = get_logger("device")

_BYTES_PER_GB = 1024**3


@dataclass(frozen=True, slots=True)
class DeviceUsage:
    device: str  # cuda | mps | cpu
    name: str | None = None
    memory_used_gb: float | None = None
    memory_total_gb: float | None = None
    memory_percent: float | None = None
    # Percent of one core. A process using three cores fully reads 300.
    cpu_percent: float | None = None
    cpu_cores: int | None = None
    # Real GPU utilisation, when the platform can tell us. CUDA only.
    gpu_percent: float | None = None


class DeviceUsageMonitor:
    """Samples the device on demand, cheaply enough to poll twice a second.

    CPU is measured from this process's own CPU time between two samples, so the first
    reading after a pause covers that whole pause. That is what the UI wants: the share
    of wall-clock time indexing has actually been computing.
    """

    def __init__(self, device: str, name: str | None = None) -> None:
        self._device = device
        self._name = name
        self._last_wall: float | None = None
        self._last_cpu: float | None = None

    @staticmethod
    def _process_cpu_seconds() -> float:
        """System plus user CPU time for this whole process, across every thread.

        time.process_time rather than resource.getrusage: `resource` is Unix-only and
        the Windows release would fail to import it at all. This is the same figure,
        via GetProcessTimes on Windows and clock_gettime elsewhere, and it counts the
        worker thread indexing runs on.
        """
        return time.process_time()

    def _cpu_percent(self) -> float | None:
        now = time.monotonic()
        cpu = self._process_cpu_seconds()
        previous_wall, previous_cpu = self._last_wall, self._last_cpu
        self._last_wall, self._last_cpu = now, cpu

        if previous_wall is None or previous_cpu is None:
            return None  # the first sample has nothing to compare against
        elapsed = now - previous_wall
        if elapsed <= 0:
            return None
        return round((cpu - previous_cpu) / elapsed * 100, 1)

    def sample(self) -> DeviceUsage:
        cpu_percent = self._cpu_percent()
        cores = os.cpu_count()

        used = total = utilisation = None
        try:
            if self._device == "cuda":
                used, total, utilisation = self._cuda()
            elif self._device == "mps":
                used, total = self._mps()
        except Exception as exc:  # a usage reading is never worth failing a request
            logger.debug("could not read %s usage: %s", self._device, exc)

        percent = (
            round(used / total * 100, 1) if used is not None and total else None
        )
        return DeviceUsage(
            device=self._device,
            name=self._name,
            memory_used_gb=round(used, 2) if used is not None else None,
            memory_total_gb=round(total, 2) if total is not None else None,
            memory_percent=percent,
            cpu_percent=cpu_percent,
            cpu_cores=cores,
            gpu_percent=utilisation,
        )

    @staticmethod
    def _cuda() -> tuple[float | None, float | None, float | None]:
        import torch

        free, total = torch.cuda.mem_get_info()
        used_gb = (total - free) / _BYTES_PER_GB
        total_gb = total / _BYTES_PER_GB
        utilisation: float | None = None
        try:
            # Needs pynvml, which the torch wheel may or may not bring with it.
            utilisation = float(torch.cuda.utilization())
        except Exception:
            utilisation = None
        return used_gb, total_gb, utilisation

    @staticmethod
    def _mps() -> tuple[float | None, float | None]:
        import torch

        # Apple GPUs share system memory; "total" is what torch is willing to use.
        used = torch.mps.driver_allocated_memory() / _BYTES_PER_GB
        recommended = torch.mps.recommended_max_memory() / _BYTES_PER_GB
        return used, (recommended or None)


def usage_as_dict(usage: DeviceUsage) -> dict[str, Any]:
    return {
        "device": usage.device,
        "name": usage.name,
        "memory_used_gb": usage.memory_used_gb,
        "memory_total_gb": usage.memory_total_gb,
        "memory_percent": usage.memory_percent,
        "cpu_percent": usage.cpu_percent,
        "cpu_cores": usage.cpu_cores,
        "gpu_percent": usage.gpu_percent,
    }
