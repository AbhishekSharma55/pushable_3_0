/**
 * Generates the Python helper module source code that provides
 * bucket access functions inside the Python sandbox.
 *
 * The generated module uses urllib (built-in) to call the backend API,
 * so no extra Python packages are needed.
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

    # Delete a file
    bucket.delete(file_id="uuid-here")
"""

import urllib.request
import urllib.error
import json
import os
import base64

_API_URL = ${JSON.stringify(config.apiUrl)}
_AUTH_TOKEN = ${JSON.stringify(config.authToken)}
_WORKSPACE_ID = ${JSON.stringify(config.workspaceId)}


def _headers():
    return {
        "Authorization": f"Bearer {_AUTH_TOKEN}",
        "x-workspace-id": _WORKSPACE_ID,
    }


def _api_get(path, params=None):
    url = f"{_API_URL}{path}"
    if params:
        qs = "&".join(f"{k}={urllib.request.quote(str(v))}" for k, v in params.items() if v is not None)
        if qs:
            url += f"?{qs}"
    req = urllib.request.Request(url, headers=_headers(), method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            ct = resp.headers.get("Content-Type", "")
            if "application/json" in ct:
                return json.loads(resp.read().decode())
            return resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode() if e.fp else ""
        raise RuntimeError(f"Bucket API error {e.code}: {body}") from e


def _api_post_multipart(path, fields, file_field=None, file_data=None, file_name=None, file_mime=None):
    """Simple multipart/form-data POST using only stdlib."""
    boundary = "----PushableBucketBoundary9876543210"
    body_parts = []

    for key, value in fields.items():
        body_parts.append(f"--{boundary}\\r\\nContent-Disposition: form-data; name=\\"{key}\\"\\r\\n\\r\\n{value}".encode())

    if file_field and file_data is not None:
        if isinstance(file_data, str):
            file_data = file_data.encode("utf-8")
        mime = file_mime or "application/octet-stream"
        header = (
            f"--{boundary}\\r\\n"
            f'Content-Disposition: form-data; name="{file_field}"; filename="{file_name}"\\r\\n'
            f"Content-Type: {mime}\\r\\n\\r\\n"
        )
        body_parts.append(header.encode() + file_data)

    body_parts.append(f"--{boundary}--\\r\\n".encode())
    body = b"\\r\\n".join(body_parts)

    headers = {
        **_headers(),
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }
    req = urllib.request.Request(f"{_API_URL}{path}", data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err_body = e.read().decode() if e.fp else ""
        raise RuntimeError(f"Bucket API error {e.code}: {err_body}") from e


class _Bucket:
    """Workspace file bucket interface."""

    def list(self, folder=None, search=None):
        """List files in the bucket. Returns a list of dicts with id, filename, folder, mimeType, sizeBytes, etc."""
        params = {}
        if folder:
            params["folder"] = folder
        if search:
            params["search"] = search
        return _api_get("/api/bucket/files", params)

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
        return result

    def delete(self, file_id):
        """Delete a file from the bucket by ID."""
        req = urllib.request.Request(
            f"{_API_URL}/api/bucket/files/{file_id}",
            headers=_headers(),
            method="DELETE",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            err_body = e.read().decode() if e.fp else ""
            raise RuntimeError(f"Bucket API error {e.code}: {err_body}") from e

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
