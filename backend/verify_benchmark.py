"""Manual smoke check for the queued extraction API (requires root Compose stack)."""

import os
import time
from urllib.parse import urlsplit

import pymupdf as fitz
import requests


def run_verification():
    base_url = os.environ.get("PDF_API_URL", "http://localhost:8000").rstrip("/")
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), "PDF queue smoke check. Expected reference text.")
    pdf_bytes = document.tobytes()
    document.close()

    print(f"Submitting a queued comparison to {base_url}…")
    response = requests.post(
        f"{base_url}/api/v1/benchmark",
        params=[("tools", "pymupdf"), ("tools", "pypdf")],
        files={"file": ("queue-smoke.pdf", pdf_bytes, "application/pdf")},
        data={"ground_truth": "PDF queue smoke check. Expected reference text."},
        timeout=30,
    )
    if response.status_code != 202:
        raise RuntimeError(f"Expected 202, got {response.status_code}: {response.text}")
    receipt = response.json()
    parts = urlsplit(receipt["result_url"])
    token = parts.fragment
    job_url = f"{base_url}/api/v1/jobs/{receipt['job_id']}"
    headers = {"Authorization": f"Bearer {token}"}
    print(f"Accepted job {receipt['job_id']} with status {receipt['status']}")

    deadline = time.monotonic() + 300
    while time.monotonic() < deadline:
        status_response = requests.get(job_url, headers=headers, timeout=15)
        if status_response.status_code != 200:
            raise RuntimeError(f"Could not retrieve private job: {status_response.status_code} {status_response.text}")
        job = status_response.json()
        print(f"{job['status']}: {job['completed_work']}/{job['total_work']} items")
        if job["status"] not in ("queued", "running"):
            print(f"Final status: {job['status']}; failures: {job['failed_work']}")
            for result in job["results"]:
                print(f"{result['parser_id']} v{result['parser_version']}: {result['status']}, {result['elapsed_ms']} ms")
            return
        time.sleep(2)
    raise TimeoutError("Job did not reach a terminal state within five minutes.")


if __name__ == "__main__":
    run_verification()
