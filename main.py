"""Minimal App Engine entrypoint: serves the built React SPA.

Static assets are served directly by App Engine via handlers in app.yaml.
This only handles the HTML shell so client-side routes resolve.
"""
import os
from flask import Flask, send_from_directory, make_response

DIST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dist")

app = Flask(__name__, static_folder=None)


@app.route("/healthz")
def healthz():
    return {"status": "ok"}, 200


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def spa(path):
    # Serve a real file if it exists, otherwise fall through to the SPA shell
    candidate = os.path.join(DIST, path)
    if path and os.path.isfile(candidate):
        return send_from_directory(DIST, path)

    resp = make_response(send_from_directory(DIST, "index.html"))
    # Never cache the shell, so new deploys are picked up immediately
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 8080)), debug=True)
