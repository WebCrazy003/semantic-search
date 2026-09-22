"""What PyTorch build is installed, and which GPU it can use.

    python scripts/gpu_report.py           report, for check.bat and troubleshooting
    python scripts/gpu_report.py --build   fail unless torch is a CUDA build with
                                           kernels for every targeted RTX generation

--build is what prepare-offline.bat runs after installing the libraries. It inspects
the build, not the hardware, so it works on a build machine with no GPU at all.
"""

from __future__ import annotations

import shutil
import subprocess
import sys

# Compiled kernels the release must carry: RTX 20 (Turing), RTX 30 (Ampere) and
# RTX 50 (Blackwell). RTX 40 (Ada, sm_89) runs the sm_86 kernels.
REQUIRED_ARCHES = ("sm_75", "sm_86", "sm_120")
TARGETS = {
    "sm_75": "RTX 20 / GTX 16",
    "sm_86": "RTX 30 and RTX 40",
    "sm_120": "RTX 50",
}


def compiled_arches(torch: object) -> list[str]:
    """The kernel architectures compiled into torch, whether or not a GPU is present.

    torch.cuda.get_arch_list() returns nothing without a usable GPU, so read the
    flags it is built on directly.
    """
    read = getattr(getattr(torch, "_C", None), "_cuda_getArchFlags", None)
    flags = read() if callable(read) else None
    return flags.split() if flags else []


def check_build() -> int:
    import torch

    print(f"      torch {torch.__version__}")
    if not torch.version.cuda:
        print("FAIL  this is a CPU-only PyTorch; the GPU would never be used.")
        print("      The CUDA build comes from https://download.pytorch.org/whl/cu130")
        return 1
    arches = compiled_arches(torch)
    print(f"OK    CUDA {torch.version.cuda} build, kernels: {' '.join(arches) or '(unknown)'}")
    missing = [arch for arch in REQUIRED_ARCHES if arch not in arches]
    if missing:
        names = ", ".join(f"{arch} ({TARGETS[arch]})" for arch in missing)
        print(f"FAIL  no kernels for {names}")
        return 1
    if not any(arch.startswith("compute_") for arch in arches):
        print("NOTE  no PTX in this build, so GPUs newer than RTX 50 will fall back to CPU")
    return 0


def report() -> int:
    """Always succeeds: a machine without a GPU is a normal, supported setup."""
    try:
        import torch
    except Exception as exc:  # noqa: BLE001 - shown to the user as is
        print(f"FAIL  PyTorch does not import: {exc}")
        return 1

    build = f"CUDA {torch.version.cuda}" if torch.version.cuda else "CPU only"
    print(f"      torch {torch.__version__} ({build})")
    if torch.version.cuda and torch.cuda.is_available():
        props = torch.cuda.get_device_properties(0)
        print(
            f"OK    GPU: {props.name}, {props.total_memory / 1024**3:.1f} GB, "
            f"compute capability {props.major}.{props.minor}"
        )
    elif torch.version.cuda:
        print("NOTE  no usable NVIDIA GPU; indexing will run on the CPU.")
        print("      With an RTX card, update the NVIDIA driver to 580 or newer.")
    elif torch.backends.mps.is_available():
        print("OK    Apple GPU (MPS)")
    else:
        print("NOTE  this PyTorch has no GPU support; indexing runs on the CPU.")

    driver = _driver_version()
    if driver:
        print(f"      NVIDIA driver {driver}")
    return 0


def _driver_version() -> str | None:
    if shutil.which("nvidia-smi") is None:
        return None
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip().splitlines()[0] if result.stdout.strip() else None


if __name__ == "__main__":
    raise SystemExit(check_build() if "--build" in sys.argv[1:] else report())
