"""Background jobs of the screen: at most one per tenant (the monthly cycle or a new store's history load)."""
from __future__ import annotations

import logging
import threading
import time
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

from .. import tenants

log = logging.getLogger("engine.ui")


@dataclass
class Job:
    tenant_id: int
    kind: str                                   # 'cycle' or 'history'
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    state: str = "running"                      # running, done, failed
    message: str | None = None                  # failure (redacted) or summary
    stages: dict[str, dict] = field(default_factory=dict)     # history: name -> {status, seconds, error}
    thread: threading.Thread | None = None

    def stage_wrapper(self, name: str, fn: Callable) -> Callable:
        """fn recorded in self.stages (status running, then done or failed with its seconds)."""
        def run():
            start = time.monotonic()
            self.stages[name] = {"status": "running", "seconds": None}
            try:
                out = fn()
            except Exception as e:
                self.stages[name] = {"status": "failed", "seconds": round(time.monotonic() - start, 3),
                                     "error": tenants.redact(f"{type(e).__name__}: {e}")}
                raise
            self.stages[name] = {"status": "done", "seconds": round(time.monotonic() - start, 3)}
            return out
        return run

    def public(self) -> dict:
        return {"kind": self.kind, "state": self.state, "message": self.message,
                "started_at": self.started_at.isoformat(),
                "stages": [{"name": n, **s} for n, s in self.stages.items()]}


class Jobs:
    def __init__(self):
        self._lock = threading.Lock()
        self._jobs: dict[int, Job] = {}

    def get(self, tenant_id: int) -> Job | None:
        return self._jobs.get(tenant_id)

    def running(self, tenant_id: int) -> Job | None:
        j = self._jobs.get(tenant_id)
        return j if j is not None and j.state == "running" else None

    def start(self, tenant_id: int, kind: str, target: Callable[[Job], tuple[bool, str | None]]) -> tuple[Job, bool]:
        """Start target(job) -> (ok, message) in a thread unless a job of the tenant is running; returns (job,
        started). The running job is returned when one is already going."""
        with self._lock:
            cur = self.running(tenant_id)
            if cur is not None:
                return cur, False
            job = Job(tenant_id, kind)
            job.thread = threading.Thread(target=self._run, args=(job, target), daemon=True,
                                          name=f"engine-{kind}-{tenant_id}")
            self._jobs[tenant_id] = job
            job.thread.start()
            return job, True

    @staticmethod
    def _run(job: Job, target) -> None:
        try:
            ok, msg = target(job)
            job.message = tenants.redact(msg) if msg else None
            job.state = "done" if ok else "failed"
        except Exception as e:                      # noqa: BLE001  shown on the screen, redacted
            log.error("tenant %s %s job crashed: %s", job.tenant_id, job.kind,
                      tenants.redact(traceback.format_exc()))
            job.message = tenants.redact(f"{type(e).__name__}: {e}")
            job.state = "failed"

    def wait(self, tenant_id: int, timeout: float = 60) -> Job | None:
        j = self._jobs.get(tenant_id)
        if j is not None and j.thread is not None:
            j.thread.join(timeout)
        return j
