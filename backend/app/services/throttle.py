# backend/app/services/throttle.py
"""Sliding-window rate limits for logins and password reset requests."""

from __future__ import annotations

import threading
import time
from collections import deque


class Throttle:
    """At most `limit` events per key in a sliding window. In memory: a restart resets
    it, which is acceptable for a tool on a local network."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self._limit = limit
        self._window = window_seconds
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def retry_after(self, key: str) -> int | None:
        """Seconds until the key may try again, or None if it may try now."""
        with self._lock:
            events = self._prune(key)
            if len(events) < self._limit:
                return None
            return max(1, int(events[0] + self._window - time.monotonic()) + 1)

    def hit(self, key: str) -> None:
        with self._lock:
            self._prune(key).append(time.monotonic())

    def clear(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)

    def _prune(self, key: str) -> deque[float]:
        events = self._events.setdefault(key, deque())
        cutoff = time.monotonic() - self._window
        while events and events[0] <= cutoff:
            events.popleft()
        return events


class Throttles:
    def __init__(self, login_failures: int) -> None:
        self.login_by_name = Throttle(login_failures, 15 * 60)
        self.login_by_ip = Throttle(30, 15 * 60)
        self.reset_requests_by_ip = Throttle(5, 60 * 60)
