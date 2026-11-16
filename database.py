
import json
import sqlite3
from contextlib import closing

from datetime import datetime
from pathlib import Path


# 資料庫檔案放在目前專案資料夾
DB_PATH = Path(__file__).resolve().parent / "data" / "brand_observations.db"


def get_connection():
    """建立資料庫連線。"""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """建立品牌搜尋觀測資料表。"""
    with closing(get_connection()) as conn, conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS observations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                observed_at TEXT NOT NULL,
                query TEXT NOT NULL,
                brand TEXT NOT NULL,
                relevant INTEGER NOT NULL,
                mentioned INTEGER NOT NULL,
                mention_positions TEXT NOT NULL,
                mention_position INTEGER,
                search_result_count INTEGER NOT NULL,
                competitors TEXT NOT NULL,
                reason TEXT NOT NULL,
                search_results TEXT NOT NULL
            )
        """)

    print(f"[Database] 資料庫已就緒：{DB_PATH}")


def save_observation(observation, search_results=None):
    """儲存一筆品牌搜尋觀測紀錄。"""

    observed_at = datetime.now().astimezone().isoformat(
        timespec="seconds"
    )

    if search_results is None:
        search_results = []

    with closing(get_connection()) as conn, conn:
        conn.execute("""
            INSERT INTO observations (
                observed_at,
                query,
                brand,
                relevant,
                mentioned,
                mention_positions,
                mention_position,
                search_result_count,
                competitors,
                reason,
                search_results
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            observed_at,
            observation["query"],
            observation["brand"],
            int(observation["relevant"]),
            int(observation["mentioned"]),
            json.dumps(
                observation["mention_positions"],
                ensure_ascii=False
            ),
            observation["mention_position"],
            observation["search_result_count"],
            json.dumps(
                observation["competitors"],
                ensure_ascii=False
            ),
            observation["reason"],
            json.dumps(
                search_results,
                ensure_ascii=False
            )
        ))

    print("[Database] 觀測紀錄已儲存。")


def get_recent_observations(limit=10):
    """查詢最近的觀測紀錄。"""

    with closing(get_connection()) as conn, conn:
        rows = conn.execute("""
            SELECT *
            FROM observations
            ORDER BY id DESC
            LIMIT ?
        """, (limit,)).fetchall()

    return [dict(row) for row in rows]

