import argparse
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:3000")
args = parser.parse_args()

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.goto(args.base_url)
    page.wait_for_load_state("networkidle")
    page.get_by_placeholder("Type a message. Jev picks the tier, then that model answers.").fill("Design a retrying queue")
    page.get_by_role("button", name="Send").click()
    page.locator(".tier").wait_for()
    assert page.locator(".tier").inner_text().lower() == "balanced"
    assert "Offline reply" in page.locator(".reply").inner_text()
    assert not errors, errors
    browser.close()
print("router browser flow passed")
