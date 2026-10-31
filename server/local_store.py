"""
Local stand-in for the Supabase client, used in demonstration mode (DEMO_MODE=1).

It supports the small subset of the Supabase query interface that the server uses
(table().select().eq().execute() and table().upsert().execute()) and stores each
table as a JSON file under server/demo_data/, so the full pipeline can be run and
inspected without a database or credentials.
"""
import json
import threading
from datetime import datetime, timezone
from pathlib import Path

# Columns that identify a row in each table (used to decide insert vs. update).
PRIMARY_KEYS = {
    "Usernames": ["UUID"],
    "UserActivity": ["SessionID (UUIDxStartTime)"],
    "CombinedActivity": ["PostID", "SessionID", "UUID"],
    "User Preferences": ["PreferenceID"],
}

_lock = threading.Lock()


class _Response:
    """Mimics the Supabase response: has .data and unpacks into two items."""

    def __init__(self, data):
        self.data = data
        self.count = None

    def __iter__(self):
        yield ("data", self.data)
        yield ("count", self.count)

    def __repr__(self):
        return f"LocalResponse(data={self.data!r})"


class _Query:
    def __init__(self, store, table):
        self.store, self.table = store, table
        self.filters, self.columns, self.row = [], "*", None

    def select(self, columns="*"):
        self.columns = columns
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def upsert(self, row):
        self.row = row
        return self

    def execute(self):
        with _lock:
            rows = self.store._load(self.table)
            if self.row is not None:
                keys = PRIMARY_KEYS.get(self.table, [])
                row = dict(self.row)
                for i, existing in enumerate(rows):
                    if keys and all(existing.get(k) == row.get(k) for k in keys):
                        rows[i] = {**existing, **row}
                        result = [rows[i]]
                        break
                else:
                    row.setdefault("Entry Timestamp", datetime.now(timezone.utc).isoformat())
                    rows.append(row)
                    result = [row]
                self.store._save(self.table, rows)
                return _Response(result)
            out = [r for r in rows if all(r.get(c) == v for c, v in self.filters)]
            if self.columns != "*":
                cols = [c.strip() for c in self.columns.split(",")]
                out = [{c: r.get(c) for c in cols} for r in out]
            return _Response(out)


class LocalStore:
    def __init__(self, folder):
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True)

    def _path(self, table):
        return self.folder / (table.replace(" ", "_") + ".json")

    def _load(self, table):
        p = self._path(table)
        return json.loads(p.read_text()) if p.exists() else []

    def _save(self, table, rows):
        self._path(table).write_text(json.dumps(rows, indent=2, default=str))

    def table(self, name):
        return _Query(self, name)
