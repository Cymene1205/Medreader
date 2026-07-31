"""Headless-browser smoke test: load the share URL and capture any
console error / worker-related message that appears in the browser.

Usage:
  SHARE_URL="http://localhost:3000/app?paperId=cms8wal9p003zq866exsz2g21" \
  python3 /home/z/my-project/scripts/probe-pdf-render.py
"""
import os
import sys
from playwright.sync_api import sync_playwright

SHARE_URL = os.environ.get(
    "SHARE_URL",
    "http://localhost:3000/app?paperId=cms8wal9p003zq866exsz2g21",
)

console_msgs = []
page_errors = []
worker_msgs = []

def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context()
        page = ctx.new_page()

        page.on("console", lambda msg: console_msgs.append({
            "type": msg.type,
            "text": msg.text,
        }))
        page.on("pageerror", lambda err: page_errors.append(str(err)))

        # Try to capture worker errors specifically.
        def on_worker(worker):
            worker.on("error", lambda e: worker_msgs.append(f"worker error: {e}"))
            worker.on("consoleerror", lambda m: worker_msgs.append(f"worker consoleerror: {m.text}"))
        page.on("worker", on_worker)

        print(f"→ goto {SHARE_URL}")
        try:
            page.goto(SHARE_URL, wait_until="networkidle", timeout=30000)
        except Exception as e:
            print(f"goto/wait failed: {e}")

        # Wait for PdfViewer init + PDF render attempt.
        # Give it 8s after networkidle for pdfjs to load + parse.
        try:
            page.wait_for_function(
                """() => {
                    const el = document.querySelector('.pdf-page canvas');
                    if (el && el.width > 100 && el.height > 100) return true;
                    const err = document.querySelector('.text-red-500');
                    if (err && err.textContent.includes('PDF')) return true;
                    return false;
                }""",
                timeout=15000,
            )
            print("✓ PDF render detected (canvas has content OR error shown)")
        except Exception as e:
            print(f"⚠ no PDF canvas/error after 15s: {e}")

        # Dump console messages related to pdf-viewer or pdfjs.
        print("\n=== pdf-viewer / pdfjs console messages ===")
        for m in console_msgs:
            t = m["text"].lower()
            if "pdf" in t or "worker" in t or "error" in t or "warn" in t:
                print(f"  [{m['type']}] {m['text']}")

        print("\n=== page errors ===")
        for e in page_errors:
            print(f"  {e}")

        print("\n=== worker errors ===")
        for m in worker_msgs:
            print(f"  {m}")

        # Snapshot the PDF area for visual inspection.
        try:
            page.screenshot(path="/home/z/my-project/download/pdf-render-probe.png", full_page=False)
            print("\n📸 screenshot saved: /home/z/my-project/download/pdf-render-probe.png")
        except Exception as e:
            print(f"screenshot failed: {e}")

        # Check polyfill state.
        try:
            poly_state = page.evaluate("""() => ({
                mathSumPrecise: typeof Math.sumPrecise,
                mapGetOrInsertComputed: typeof Map.prototype.getOrInsertComputed,
                iterMap: typeof Iterator.prototype.map,
                iterTake: typeof Iterator.prototype.take,
                pdfjsWorker: typeof globalThis.pdfjsWorker,
            })""")
            print(f"\nPolyfill state: {poly_state}")
        except Exception as e:
            print(f"polyfill evaluate failed: {e}")

        # Check for the error state element.
        try:
            err_text = page.evaluate("""() => {
                const err = document.querySelector('.text-red-500');
                if (err) return err.textContent;
                const canv = document.querySelector('.pdf-page canvas');
                if (canv) return 'canvas: ' + canv.width + 'x' + canv.height;
                return 'no canvas, no error';
            }""")
            print(f"\nPDF area state: {err_text}")
        except Exception as e:
            print(f"evaluate failed: {e}")

        browser.close()

if __name__ == "__main__":
    main()
