/**
 * Generates the Python helper module source code that provides
 * bucket access functions inside the Python sandbox.
 *
 * The generated module uses the `requests` library to call the backend API.
 */
export function generatePythonBucketHelper(config: {
    apiUrl: string;
    authToken: string;
    workspaceId: string;
}): string {
    return `"""
Pushable AI Bucket Helper — access workspace files from Python.

Usage:
    from _pushable_bucket import bucket

    # List files
    files = bucket.list()
    files = bucket.list(folder="/reports", search="quarterly")

    # Read a file (returns bytes for binary, str for text)
    content = bucket.read(filename="report.csv")
    content = bucket.read(file_id="uuid-here")

    # Read raw bytes (always returns bytes)
    raw = bucket.read_bytes(filename="image.png")

    # Save a file to the bucket
    bucket.save("output.csv", "col1,col2\\n1,2\\n3,4")
    bucket.save("chart.png", png_bytes, folder="/charts")

    # Update an existing text file's content
    bucket.update(filename="data.csv", content="new,csv\\n1,2")
    bucket.update(file_id="uuid-here", content="updated content")

    # Delete a file
    bucket.delete(file_id="uuid-here")
"""

import requests as _req_lib
import json
import os
import base64

_API_URL = ${JSON.stringify(config.apiUrl)}
_AUTH_TOKEN = ${JSON.stringify(config.authToken)}
_WORKSPACE_ID = ${JSON.stringify(config.workspaceId)}

_SESSION = _req_lib.Session()
_SESSION.headers.update({
    "Authorization": f"Bearer {_AUTH_TOKEN}",
    "x-workspace-id": _WORKSPACE_ID,
})


def _unwrap(result):
    """Unwrap API responses that wrap data in {"data": ...}."""
    if isinstance(result, dict) and "data" in result and len(result) == 1:
        return result["data"]
    return result


def _api_get(path, params=None):
    resp = _SESSION.get(f"{_API_URL}{path}", params=params, timeout=15)
    if resp.status_code >= 400:
        raise RuntimeError(f"Bucket API error {resp.status_code}: {resp.text[:500]}")
    ct = resp.headers.get("Content-Type", "")
    if "application/json" in ct:
        return resp.json()
    return resp.content


def _api_put_json(path, body):
    resp = _SESSION.put(f"{_API_URL}{path}", json=body, timeout=15)
    if resp.status_code >= 400:
        raise RuntimeError(f"Bucket API error {resp.status_code}: {resp.text[:500]}")
    return _unwrap(resp.json())


def _api_post_multipart(path, fields, file_field=None, file_data=None, file_name=None, file_mime=None):
    files = None
    if file_field and file_data is not None:
        if isinstance(file_data, str):
            file_data = file_data.encode("utf-8")
        mime = file_mime or "application/octet-stream"
        files = {file_field: (file_name, file_data, mime)}
    resp = _SESSION.post(f"{_API_URL}{path}", data=fields, files=files, timeout=30)
    if resp.status_code >= 400:
        raise RuntimeError(f"Bucket API error {resp.status_code}: {resp.text[:500]}")
    return resp.json()


class _Bucket:
    """Workspace file bucket interface."""

    def list(self, folder=None, search=None):
        """List files in the bucket. Returns a list of dicts with id, filename, folder, mimeType, sizeBytes, etc."""
        params = {}
        if folder:
            params["folder"] = folder
        if search:
            params["search"] = search
        result = _api_get("/api/bucket/files", params)
        return _unwrap(result)

    def read(self, file_id=None, filename=None):
        """Read a file's content. Returns str for text files, bytes for binary files."""
        if not file_id and not filename:
            raise ValueError("Provide either file_id or filename")

        # Resolve filename to file_id if needed
        if not file_id:
            files = self.list(search=filename)
            match = None
            for f in files:
                if f["filename"] == filename:
                    match = f
                    break
            if not match and files:
                match = files[0]
            if not match:
                raise FileNotFoundError(f"File not found: {filename}")
            file_id = match["id"]

        data = _api_get(f"/api/bucket/files/{file_id}/download")
        if isinstance(data, bytes):
            # Try to decode as text
            try:
                return data.decode("utf-8")
            except UnicodeDecodeError:
                return data
        return data

    def read_bytes(self, file_id=None, filename=None):
        """Read a file as raw bytes (always returns bytes)."""
        if not file_id and not filename:
            raise ValueError("Provide either file_id or filename")

        if not file_id:
            files = self.list(search=filename)
            match = None
            for f in files:
                if f["filename"] == filename:
                    match = f
                    break
            if not match and files:
                match = files[0]
            if not match:
                raise FileNotFoundError(f"File not found: {filename}")
            file_id = match["id"]

        data = _api_get(f"/api/bucket/files/{file_id}/download")
        if isinstance(data, str):
            return data.encode("utf-8")
        return data

    def save(self, filename, content, folder="/python-output"):
        """Save a file to the bucket. Content can be str or bytes."""
        if isinstance(content, str):
            content = content.encode("utf-8")

        # Infer MIME type from extension
        ext = os.path.splitext(filename)[1].lower()
        mime_map = {
            ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
            ".json": "application/json", ".html": "text/html", ".xml": "application/xml",
            ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
            ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }
        mime = mime_map.get(ext, "application/octet-stream")

        result = _api_post_multipart(
            "/api/bucket/files/upload",
            fields={"folder": folder},
            file_field="file",
            file_data=content,
            file_name=filename,
            file_mime=mime,
        )
        files = _unwrap(result)
        return files[0] if isinstance(files, list) and files else files

    def update(self, content, file_id=None, filename=None):
        """Update the content of an existing text file in the bucket.
        Works for text-based files (txt, md, csv, json, html, xml, etc.).
        Content replaces the entire file."""
        if not file_id and not filename:
            raise ValueError("Provide either file_id or filename")

        # Resolve filename to file_id if needed
        if not file_id:
            files = self.list(search=filename)
            match = None
            for f in files:
                if f["filename"] == filename:
                    match = f
                    break
            if not match and files:
                match = files[0]
            if not match:
                raise FileNotFoundError(f"File not found: {filename}")
            file_id = match["id"]

        return _api_put_json(f"/api/bucket/files/{file_id}/content", {"content": content})

    def delete(self, file_id):
        """Delete a file from the bucket by ID."""
        resp = _SESSION.delete(f"{_API_URL}/api/bucket/files/{file_id}", timeout=15)
        if resp.status_code >= 400:
            raise RuntimeError(f"Bucket API error {resp.status_code}: {resp.text[:500]}")
        return resp.json()

    def download_to(self, local_path, file_id=None, filename=None):
        """Download a bucket file to a local path in the sandbox."""
        data = self.read_bytes(file_id=file_id, filename=filename)
        with open(local_path, "wb") as f:
            f.write(data)
        return local_path

    def upload_from(self, local_path, filename=None, folder="/python-output"):
        """Upload a local file from the sandbox to the bucket."""
        if not filename:
            filename = os.path.basename(local_path)
        with open(local_path, "rb") as f:
            content = f.read()
        return self.save(filename, content, folder=folder)


bucket = _Bucket()
`;
}
