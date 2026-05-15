from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from .config import (
    DATA_DIR,
    DB_PATH,
    DEFAULT_ADMIN_PASSWORD,
    DEFAULT_ADMIN_USERNAME,
    FILES_DIR,
    PREVIEWS_DIR,
    SESSION_EXPIRE_HOURS,
)
from .security import hash_password, make_token


def utc_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def ensure_directories() -> None:
    for path in (DATA_DIR, FILES_DIR, PREVIEWS_DIR):
        Path(path).mkdir(parents=True, exist_ok=True)


def get_db() -> sqlite3.Connection:
    ensure_directories()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    ensure_directories()
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                display_name TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'user')),
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS modules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_enabled INTEGER NOT NULL DEFAULT 1,
                is_hidden INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_module_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                module_key TEXT NOT NULL REFERENCES modules(key) ON DELETE CASCADE,
                can_view INTEGER NOT NULL DEFAULT 1,
                access_level TEXT NOT NULL DEFAULT 'read',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(user_id, module_key)
            );

            CREATE TABLE IF NOT EXISTS projects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                client_name TEXT NOT NULL DEFAULT '',
                contact_name TEXT NOT NULL DEFAULT '',
                owner_id INTEGER REFERENCES users(id),
                status TEXT NOT NULL DEFAULT '制作中',
                stage TEXT NOT NULL DEFAULT '建模',
                delivery_date TEXT NOT NULL DEFAULT '',
                delivery_notes TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                is_archived INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                created_by INTEGER REFERENCES users(id),
                is_deleted INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                extension TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size INTEGER NOT NULL,
                current_version_id INTEGER,
                preview_image_path TEXT,
                created_by INTEGER REFERENCES users(id),
                is_deleted INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS file_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                version_no INTEGER NOT NULL,
                storage_path TEXT NOT NULL,
                sha256 TEXT NOT NULL,
                size INTEGER NOT NULL,
                remark TEXT NOT NULL DEFAULT '',
                is_effective INTEGER NOT NULL DEFAULT 1,
                is_final INTEGER NOT NULL DEFAULT 0,
                uploaded_by INTEGER REFERENCES users(id),
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS folder_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                permission TEXT NOT NULL CHECK(permission IN ('read', 'upload', 'write', 'admin')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(folder_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER REFERENCES users(id),
                action TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id INTEGER,
                detail TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS learning_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                parent_id INTEGER,
                item_type TEXT NOT NULL DEFAULT 'doc',
                title TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '大数据',
                tags TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT '计划中',
                priority TEXT NOT NULL DEFAULT '中',
                content TEXT NOT NULL DEFAULT '',
                resource_url TEXT NOT NULL DEFAULT '',
                is_pinned INTEGER NOT NULL DEFAULT 0,
                created_by INTEGER REFERENCES users(id),
                is_deleted INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS learning_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_id INTEGER NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT '计划中',
                priority TEXT NOT NULL DEFAULT '中',
                content TEXT NOT NULL DEFAULT '',
                resource_url TEXT NOT NULL DEFAULT '',
                created_by INTEGER REFERENCES users(id),
                created_at TEXT NOT NULL
            );
            """
        )
        now = utc_now()
        for key, name, description, sort_order in (
            ("archive_3d", "3D 文档归档", "3D 工程文件、贴图、模型和交付文件归档。", 10),
            ("learning", "大数据知识库", "编写大数据文档、SQL 模板、方案和复盘。", 20),
        ):
            conn.execute(
                """
                INSERT INTO modules (key, name, description, sort_order, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(key) DO NOTHING
                """,
                (key, name, description, sort_order, now),
            )
        admin = conn.execute(
            "SELECT id FROM users WHERE username = ?", (DEFAULT_ADMIN_USERNAME,)
        ).fetchone()
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(file_versions)").fetchall()
        }
        if "is_effective" not in columns:
            conn.execute(
                "ALTER TABLE file_versions ADD COLUMN is_effective INTEGER NOT NULL DEFAULT 1"
            )
        permission_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(user_module_permissions)").fetchall()
        }
        if "access_level" not in permission_columns:
            conn.execute(
                "ALTER TABLE user_module_permissions ADD COLUMN access_level TEXT NOT NULL DEFAULT 'edit'"
            )
        module_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(modules)").fetchall()
        }
        if "is_enabled" not in module_columns:
            conn.execute("ALTER TABLE modules ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1")
        if "is_hidden" not in module_columns:
            conn.execute("ALTER TABLE modules ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0")
        project_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(projects)").fetchall()
        }
        if "contact_name" not in project_columns:
            conn.execute("ALTER TABLE projects ADD COLUMN contact_name TEXT NOT NULL DEFAULT ''")
        if "stage" not in project_columns:
            conn.execute("ALTER TABLE projects ADD COLUMN stage TEXT NOT NULL DEFAULT '建模'")
        if "delivery_date" not in project_columns:
            conn.execute("ALTER TABLE projects ADD COLUMN delivery_date TEXT NOT NULL DEFAULT ''")
        if "delivery_notes" not in project_columns:
            conn.execute("ALTER TABLE projects ADD COLUMN delivery_notes TEXT NOT NULL DEFAULT ''")
        if "is_final" not in columns:
            conn.execute(
                "ALTER TABLE file_versions ADD COLUMN is_final INTEGER NOT NULL DEFAULT 0"
            )
        learning_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(learning_items)").fetchall()
        }
        if "parent_id" not in learning_columns:
            conn.execute("ALTER TABLE learning_items ADD COLUMN parent_id INTEGER")
        if "item_type" not in learning_columns:
            conn.execute("ALTER TABLE learning_items ADD COLUMN item_type TEXT NOT NULL DEFAULT 'doc'")
        if "tags" not in learning_columns:
            conn.execute("ALTER TABLE learning_items ADD COLUMN tags TEXT NOT NULL DEFAULT ''")
        if "is_pinned" not in learning_columns:
            conn.execute("ALTER TABLE learning_items ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0")
        learning_version_columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(learning_versions)").fetchall()
        }
        if "tags" not in learning_version_columns:
            conn.execute("ALTER TABLE learning_versions ADD COLUMN tags TEXT NOT NULL DEFAULT ''")
        conn.execute(
            """
            UPDATE learning_items
            SET item_type = 'folder',
                category = '文件夹'
            WHERE is_deleted = 0
              AND category IN ('目录', '文件夹')
              AND COALESCE(content, '') = ''
              AND COALESCE(resource_url, '') = ''
            """
        )
        if not admin:
            conn.execute(
                """
                INSERT INTO users (username, password_hash, display_name, role, is_active, created_at, updated_at)
                VALUES (?, ?, ?, 'admin', 1, ?, ?)
                """,
                (
                    DEFAULT_ADMIN_USERNAME,
                    hash_password(DEFAULT_ADMIN_PASSWORD),
                    "管理员",
                    now,
                    now,
                ),
            )
        admin_id = conn.execute(
            "SELECT id FROM users WHERE username = ?", (DEFAULT_ADMIN_USERNAME,)
        ).fetchone()["id"]
        for module_key in ("archive_3d", "learning"):
            conn.execute(
                """
                INSERT INTO user_module_permissions (user_id, module_key, can_view, access_level, created_at, updated_at)
                VALUES (?, ?, 1, 'manage', ?, ?)
                ON CONFLICT(user_id, module_key) DO UPDATE SET
                    can_view = 1,
                    access_level = 'manage',
                    updated_at = excluded.updated_at
                """,
                (admin_id, module_key, now, now),
            )
        project = conn.execute("SELECT id FROM projects LIMIT 1").fetchone()
        if not project:
            cur = conn.execute(
                """
                INSERT INTO projects (name, client_name, owner_id, status, description, created_at, updated_at)
                VALUES ('示例 3D 项目', '内部', ?, '制作中', '用于体验目录、上传、下载和版本管理。', ?, ?)
                """,
                (admin_id, now, now),
            )
            project_id = cur.lastrowid
            for name in (
                "01_参考资料",
                "02_工程源文件",
                "03_模型",
                "04_贴图材质",
                "05_灯光渲染",
                "06_导出文件",
                "07_交付文件",
                "08_历史版本",
            ):
                conn.execute(
                    """
                    INSERT INTO folders (project_id, parent_id, name, created_by, created_at, updated_at)
                    VALUES (?, NULL, ?, ?, ?, ?)
                    """,
                    (project_id, name, admin_id, now, now),
                )
        learning = conn.execute("SELECT id FROM learning_items LIMIT 1").fetchone()
        if not learning:
            for title, category, status, priority, content in (
                (
                    "梳理大数据开发学习路线",
                    "学习规划",
                    "进行中",
                    "高",
                    "覆盖 SQL、数据仓库、调度、Spark/Flink、数据质量、指标体系和工程化实践。",
                ),
                (
                    "沉淀常用 SQL 和排查模板",
                    "SQL",
                    "计划中",
                    "中",
                    "把日常取数、日期转换、留存、漏斗、分渠道分析等模板归档成自己的知识库。",
                ),
            ):
                conn.execute(
                    """
                    INSERT INTO learning_items
                        (title, category, status, priority, content, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (title, category, status, priority, content, admin_id, now, now),
                )


def create_session(conn: sqlite3.Connection, user_id: int) -> str:
    token = make_token()
    now = datetime.utcnow()
    expires_at = (now + timedelta(hours=SESSION_EXPIRE_HOURS)).replace(microsecond=0).isoformat() + "Z"
    conn.execute(
        "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
        (token, user_id, expires_at, utc_now()),
    )
    return token


def row_to_dict(row: Optional[sqlite3.Row]):
    return dict(row) if row else None
