from __future__ import annotations

import hashlib
import shutil
import uuid
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Optional
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse

from .config import ALLOWED_DANGEROUS_EXTENSIONS, APP_NAME, FILES_DIR
from .database import create_session, get_db, init_db, row_to_dict, utc_now
from .security import hash_password, verify_password

app = FastAPI(title=APP_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


def require_user(
    authorization: Optional[str] = Header(None),
    token: Optional[str] = None,
) -> dict:
    if token:
        auth_token = token.strip()
    elif authorization and authorization.startswith("Bearer "):
        auth_token = authorization.removeprefix("Bearer ").strip()
    else:
        raise HTTPException(status_code=401, detail="请先登录")
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT users.*
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ? AND sessions.expires_at > ? AND users.is_active = 1
            """,
            (auth_token, utc_now()),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="登录已过期")
    return dict(row)


def require_admin(user: dict = Depends(require_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="需要管理员权限")
    return user


MODULE_ACCESS_RANK = {"none": 0, "read": 1, "edit": 2, "manage": 3}


def apply_user_module_permissions(
    conn,
    target_user_id: int,
    module_permissions: dict,
    module_keys: set[str],
    now: str,
) -> None:
    modules = conn.execute("SELECT key FROM modules").fetchall()
    for module in modules:
        access_level = module_permissions.get(module["key"])
        if access_level is None:
            access_level = "edit" if module["key"] in module_keys else "none"
        if access_level not in MODULE_ACCESS_RANK:
            access_level = "none"
        conn.execute(
            """
            INSERT INTO user_module_permissions (user_id, module_key, can_view, access_level, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, module_key) DO UPDATE SET
                can_view = excluded.can_view,
                access_level = excluded.access_level,
                updated_at = excluded.updated_at
            """,
            (target_user_id, module["key"], 0 if access_level == "none" else 1, access_level, now, now),
        )


def ensure_not_last_active_admin(conn, target_user_id: int, target_role: str) -> None:
    if target_role != "admin":
        return
    row = conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM users
        WHERE role = 'admin' AND is_active = 1 AND id != ?
        """,
        (target_user_id,),
    ).fetchone()
    if row["count"] <= 0:
        raise HTTPException(status_code=400, detail="至少保留一个启用的管理员")


def get_module_access_level(conn, user: dict, module_key: str) -> str:
    if user["role"] == "admin":
        return "manage"
    row = conn.execute(
        """
        SELECT can_view, access_level FROM user_module_permissions
        WHERE user_id = ? AND module_key = ?
        """,
        (user["id"], module_key),
    ).fetchone()
    if not row or not row["can_view"]:
        return "none"
    return row["access_level"] or "read"


def ensure_module_access(conn, user: dict, module_key: str, level: str = "read") -> None:
    current = get_module_access_level(conn, user, module_key)
    if MODULE_ACCESS_RANK[current] < MODULE_ACCESS_RANK[level]:
        raise HTTPException(status_code=403, detail="没有访问该模块的权限")


def ensure_permission(conn, user: dict, folder_id: int, levels: tuple[str, ...] = ("read",)) -> None:
    if user["role"] == "admin":
        return
    folder = conn.execute(
        "SELECT id FROM folders WHERE id = ? AND is_deleted = 0", (folder_id,)
    ).fetchone()
    if not folder:
        raise HTTPException(status_code=404, detail="目录不存在")
    required_module_level = "read"
    if any(level in ("upload", "write", "admin") for level in levels):
        required_module_level = "edit"
    if MODULE_ACCESS_RANK[get_module_access_level(conn, user, "archive_3d")] >= MODULE_ACCESS_RANK[required_module_level]:
        return
    allowed = conn.execute(
        """
        SELECT permission FROM folder_permissions
        WHERE folder_id = ? AND user_id = ?
        """,
        (folder_id, user["id"]),
    ).fetchone()
    hierarchy = {"read": 1, "upload": 2, "write": 3, "admin": 4}
    needed = min(hierarchy[level] for level in levels)
    if not allowed or hierarchy[allowed["permission"]] < needed:
        raise HTTPException(status_code=403, detail="没有访问该目录的权限")


def extension_of(filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    return suffix[1:] if suffix.startswith(".") else suffix


TEXT_PREVIEW_EXTENSIONS = {
    "txt",
    "md",
    "markdown",
    "sql",
    "json",
    "csv",
    "tsv",
    "xml",
    "yaml",
    "yml",
    "py",
    "js",
    "jsx",
    "ts",
    "tsx",
    "css",
    "html",
    "log",
}

PREVIEW_MEDIA_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
    "gif": "image/gif",
    "svg": "image/svg+xml",
    "pdf": "application/pdf",
    "mp4": "video/mp4",
    "webm": "video/webm",
    "mov": "video/quicktime",
}

ARCHIVE_KIND_GROUPS = {
    "image": {"png", "jpg", "jpeg", "webp", "gif", "svg", "tif", "tiff", "exr", "hdr", "psd"},
    "video": {"mp4", "webm", "mov", "avi"},
    "doc": {"pdf", "txt", "md", "markdown", "docx", "xlsx", "sql", "json", "csv", "tsv"},
    "archive": {"zip", "rar", "7z"},
    "model": {"blend", "max", "ma", "mb", "c4d", "fbx", "obj", "gltf", "glb", "stl", "dae", "abc", "usd", "usdz", "skp", "spp", "sbsar"},
    "cad": {"dwg", "dxf", "step", "stp", "iges", "igs"},
}


def save_upload(upload: UploadFile) -> tuple[str, int, str]:
    ext = extension_of(upload.filename or "")
    if ext in ALLOWED_DANGEROUS_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不允许上传 .{ext} 文件")
    day = datetime.utcnow().strftime("%Y/%m/%d")
    target_dir = FILES_DIR / day
    target_dir.mkdir(parents=True, exist_ok=True)
    storage_name = f"{uuid.uuid4().hex}.{ext}" if ext else uuid.uuid4().hex
    absolute_path = target_dir / storage_name
    sha = hashlib.sha256()
    size = 0
    with absolute_path.open("wb") as out:
        while True:
            chunk = upload.file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            sha.update(chunk)
            out.write(chunk)
    return str(absolute_path.relative_to(FILES_DIR.parent)), size, sha.hexdigest()


def log_action(conn, user_id: int, action: str, target_type: str, target_id: Optional[int], detail: str = "") -> None:
    conn.execute(
        """
        INSERT INTO audit_logs (user_id, action, target_type, target_id, detail, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (user_id, action, target_type, target_id, detail, utc_now()),
    )


def clean_relative_parts(relative_path: str) -> list[str]:
    path = PurePosixPath((relative_path or "").replace("\\", "/"))
    parts = []
    for part in path.parts:
        if part in ("", ".", "..") or "/" in part or "\\" in part:
            continue
        parts.append(part)
    return parts


def get_or_create_child_folder(conn, project_id: int, parent_id: int, name: str, user_id: int) -> int:
    existing = conn.execute(
        """
        SELECT id FROM folders
        WHERE project_id = ? AND parent_id = ? AND name = ? AND is_deleted = 0
        """,
        (project_id, parent_id, name),
    ).fetchone()
    if existing:
        return existing["id"]

    now = utc_now()
    cur = conn.execute(
        """
        INSERT INTO folders (project_id, parent_id, name, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (project_id, parent_id, name, user_id, now, now),
    )
    folder_id = cur.lastrowid
    log_action(conn, user_id, "create_folder_from_upload", "folder", folder_id, name)
    return folder_id


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "name": APP_NAME}


@app.post("/api/auth/login")
def login(payload: dict) -> dict:
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    with get_db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE username = ? AND is_active = 1", (username,)
        ).fetchone()
        if not user or not verify_password(password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="用户名或密码错误")
        token = create_session(conn, user["id"])
        log_action(conn, user["id"], "login", "user", user["id"])
        return {
            "token": token,
            "user": {
                "id": user["id"],
                "username": user["username"],
                "display_name": user["display_name"],
                "role": user["role"],
            },
        }


@app.get("/api/me")
def me(user: dict = Depends(require_user)) -> dict:
    return {
        "id": user["id"],
        "username": user["username"],
        "display_name": user["display_name"],
        "role": user["role"],
    }


@app.get("/api/modules")
def list_modules(user: dict = Depends(require_user)) -> list[dict]:
    with get_db() as conn:
        if user["role"] == "admin":
            rows = conn.execute(
                "SELECT *, 1 AS can_view, 'manage' AS access_level FROM modules ORDER BY sort_order, id"
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT m.*, COALESCE(ump.can_view, 0) AS can_view, COALESCE(ump.access_level, 'none') AS access_level
                FROM modules m
                LEFT JOIN user_module_permissions ump
                    ON ump.module_key = m.key AND ump.user_id = ?
                WHERE COALESCE(ump.can_view, 0) = 1
                ORDER BY m.sort_order, m.id
                """,
                (user["id"],),
            ).fetchall()
    return [dict(row) for row in rows]


@app.get("/api/admin/users")
def admin_list_users(user: dict = Depends(require_admin)) -> dict:
    with get_db() as conn:
        users = conn.execute(
            """
            SELECT id, username, display_name, role, is_active, created_at, updated_at
            FROM users
            ORDER BY role = 'admin' DESC, username
            """
        ).fetchall()
        modules = conn.execute("SELECT * FROM modules ORDER BY sort_order, id").fetchall()
        permissions = conn.execute(
            "SELECT user_id, module_key, can_view, access_level FROM user_module_permissions"
        ).fetchall()
    permission_map = {}
    for row in permissions:
        permission_map.setdefault(row["user_id"], {})[row["module_key"]] = (
            row["access_level"] if row["can_view"] else "none"
        )
    return {
        "users": [
            {**dict(row), "modules": permission_map.get(row["id"], {})}
            for row in users
        ],
        "modules": [dict(row) for row in modules],
    }


@app.post("/api/admin/users")
def admin_create_user(payload: dict, user: dict = Depends(require_admin)) -> dict:
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    display_name = (payload.get("display_name") or username).strip()
    role = payload.get("role") or "user"
    module_permissions = payload.get("module_permissions") or {}
    module_keys = payload.get("module_keys") or []
    for module_key in module_keys:
        module_permissions.setdefault(module_key, "edit")
    if not username or not password:
        raise HTTPException(status_code=400, detail="用户名和密码不能为空")
    if role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="角色不正确")
    now = utc_now()
    with get_db() as conn:
        try:
            cur = conn.execute(
                """
                INSERT INTO users (username, password_hash, display_name, role, is_active, created_at, updated_at)
                VALUES (?, ?, ?, ?, 1, ?, ?)
                """,
                (username, hash_password(password), display_name, role, now, now),
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail="用户名已存在") from exc
        new_user_id = cur.lastrowid
        for module_key, access_level in module_permissions.items():
            if access_level not in MODULE_ACCESS_RANK:
                continue
            conn.execute(
                """
                INSERT INTO user_module_permissions (user_id, module_key, can_view, access_level, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, module_key) DO UPDATE SET
                    can_view = excluded.can_view,
                    access_level = excluded.access_level,
                    updated_at = excluded.updated_at
                """,
                (new_user_id, module_key, 0 if access_level == "none" else 1, access_level, now, now),
            )
        log_action(conn, user["id"], "create_user", "user", new_user_id, username)
        return {"id": new_user_id, "username": username}


@app.patch("/api/admin/users/{target_user_id}/modules")
def admin_update_user_modules(
    target_user_id: int,
    payload: dict,
    user: dict = Depends(require_admin),
) -> dict:
    module_permissions = payload.get("module_permissions") or {}
    module_keys = set(payload.get("module_keys") or [])
    now = utc_now()
    with get_db() as conn:
        target = conn.execute("SELECT * FROM users WHERE id = ?", (target_user_id,)).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="用户不存在")
        apply_user_module_permissions(conn, target_user_id, module_permissions, module_keys, now)
        log_action(conn, user["id"], "update_user_modules", "user", target_user_id, str(module_permissions or sorted(module_keys)))
    return {"ok": True}


@app.patch("/api/admin/users/{target_user_id}")
def admin_update_user(
    target_user_id: int,
    payload: dict,
    user: dict = Depends(require_admin),
) -> dict:
    now = utc_now()
    with get_db() as conn:
        target = conn.execute("SELECT * FROM users WHERE id = ?", (target_user_id,)).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="用户不存在")

        next_role = (payload.get("role") or target["role"]).strip()
        if next_role not in ("admin", "user"):
            raise HTTPException(status_code=400, detail="角色不正确")

        next_active = bool(target["is_active"])
        if "is_active" in payload:
            next_active = bool(payload.get("is_active"))

        if target_user_id == user["id"]:
            if next_role != "admin":
                raise HTTPException(status_code=400, detail="不能取消自己的管理员权限")
            if not next_active:
                raise HTTPException(status_code=400, detail="不能停用当前登录账号")

        if (target["role"] == "admin" and next_role != "admin") or (target["role"] == "admin" and not next_active):
            ensure_not_last_active_admin(conn, target_user_id, target["role"])

        updates = ["updated_at = ?"]
        values: list = [now]

        if "username" in payload:
            username = (payload.get("username") or "").strip()
            if not username:
                raise HTTPException(status_code=400, detail="用户名不能为空")
            updates.append("username = ?")
            values.append(username)
        if "display_name" in payload:
            display_name = (payload.get("display_name") or "").strip()
            if not display_name:
                raise HTTPException(status_code=400, detail="显示名不能为空")
            updates.append("display_name = ?")
            values.append(display_name)
        if "role" in payload:
            updates.append("role = ?")
            values.append(next_role)
        if "is_active" in payload:
            updates.append("is_active = ?")
            values.append(1 if next_active else 0)
        if payload.get("password"):
            password = str(payload.get("password"))
            if len(password) < 4:
                raise HTTPException(status_code=400, detail="密码至少 4 位")
            updates.append("password_hash = ?")
            values.append(hash_password(password))

        values.append(target_user_id)
        try:
            conn.execute(
                f"UPDATE users SET {', '.join(updates)} WHERE id = ?",
                tuple(values),
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail="用户名已存在") from exc

        if "module_permissions" in payload or "module_keys" in payload:
            apply_user_module_permissions(
                conn,
                target_user_id,
                payload.get("module_permissions") or {},
                set(payload.get("module_keys") or []),
                now,
            )
        log_action(conn, user["id"], "update_user", "user", target_user_id, str(payload.keys()))
    return {"ok": True}


@app.delete("/api/admin/users/{target_user_id}")
def admin_delete_user(target_user_id: int, user: dict = Depends(require_admin)) -> dict:
    if target_user_id == user["id"]:
        raise HTTPException(status_code=400, detail="不能删除当前登录账号")
    now = utc_now()
    with get_db() as conn:
        target = conn.execute("SELECT * FROM users WHERE id = ?", (target_user_id,)).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="用户不存在")
        ensure_not_last_active_admin(conn, target_user_id, target["role"])
        conn.execute(
            "UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?",
            (now, target_user_id),
        )
        log_action(conn, user["id"], "delete_user", "user", target_user_id, target["username"])
    return {"ok": True}


@app.patch("/api/admin/modules/{module_key}")
def admin_update_module(
    module_key: str,
    payload: dict,
    user: dict = Depends(require_admin),
) -> dict:
    name = (payload.get("name") or "").strip()
    description = (payload.get("description") or "").strip()
    sort_order = payload.get("sort_order")
    if not name:
        raise HTTPException(status_code=400, detail="模块名称不能为空")
    try:
        sort_order_value = int(sort_order)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="排序必须是数字") from exc
    with get_db() as conn:
        target = conn.execute("SELECT * FROM modules WHERE key = ?", (module_key,)).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="模块不存在")
        conn.execute(
            """
            UPDATE modules
            SET name = ?, description = ?, sort_order = ?
            WHERE key = ?
            """,
            (name, description, sort_order_value, module_key),
        )
        log_action(conn, user["id"], "update_module", "module", target["id"], module_key)
    return {"ok": True}


@app.get("/api/projects")
def list_projects(user: dict = Depends(require_user)) -> list[dict]:
    with get_db() as conn:
        ensure_module_access(conn, user, "archive_3d")
        rows = conn.execute(
            """
            SELECT p.*, u.display_name AS owner_name,
                   COALESCE(SUM(CASE WHEN f.is_deleted = 0 THEN f.size ELSE 0 END), 0) AS total_size,
                   COUNT(DISTINCT CASE WHEN f.is_deleted = 0 THEN f.id END) AS file_count
            FROM projects p
            LEFT JOIN users u ON u.id = p.owner_id
            LEFT JOIN files f ON f.project_id = p.id
            GROUP BY p.id
            ORDER BY p.updated_at DESC
            """
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/projects")
def create_project(payload: dict, user: dict = Depends(require_admin)) -> dict:
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="项目名称不能为空")
    now = utc_now()
    template = payload.get("template", True)
    with get_db() as conn:
        cur = conn.execute(
            """
            INSERT INTO projects (name, client_name, owner_id, status, description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                (payload.get("client_name") or "").strip(),
                user["id"],
                payload.get("status") or "制作中",
                (payload.get("description") or "").strip(),
                now,
                now,
            ),
        )
        project_id = cur.lastrowid
        names = (
            "01_参考资料",
            "02_工程源文件",
            "03_模型",
            "04_贴图材质",
            "05_灯光渲染",
            "06_导出文件",
            "07_交付文件",
            "08_历史版本",
        ) if template else ("根目录",)
        for folder_name in names:
            conn.execute(
                """
                INSERT INTO folders (project_id, parent_id, name, created_by, created_at, updated_at)
                VALUES (?, NULL, ?, ?, ?, ?)
                """,
                (project_id, folder_name, user["id"], now, now),
            )
        log_action(conn, user["id"], "create_project", "project", project_id, name)
        return {"id": project_id, "name": name}


@app.patch("/api/projects/{project_id}")
def update_project(project_id: int, payload: dict, user: dict = Depends(require_user)) -> dict:
    allowed = {"name", "client_name", "status", "description"}
    updates = []
    values = []
    for key in allowed:
        if key not in payload:
            continue
        value = payload.get(key)
        if isinstance(value, str):
            value = value.strip()
        if key == "name" and not value:
            raise HTTPException(status_code=400, detail="项目名称不能为空")
        updates.append(f"{key} = ?")
        values.append(value or "")
    if not updates:
        raise HTTPException(status_code=400, detail="没有可更新内容")
    values.extend([utc_now(), project_id])
    with get_db() as conn:
        project = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="项目不存在")
        root_folder = conn.execute(
            "SELECT id FROM folders WHERE project_id = ? AND parent_id IS NULL AND is_deleted = 0 ORDER BY id LIMIT 1",
            (project_id,),
        ).fetchone()
        if not root_folder:
            raise HTTPException(status_code=404, detail="项目目录不存在")
        ensure_permission(conn, user, root_folder["id"], ("write",))
        conn.execute(
            f"UPDATE projects SET {', '.join(updates)}, updated_at = ? WHERE id = ?",
            values,
        )
        updated = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        log_action(conn, user["id"], "update_project", "project", project_id, updated["name"])
        return row_to_dict(updated)


@app.get("/api/projects/{project_id}/tree")
def project_tree(project_id: int, user: dict = Depends(require_user)) -> dict:
    with get_db() as conn:
        project = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            raise HTTPException(status_code=404, detail="项目不存在")
        folders = conn.execute(
            """
            SELECT * FROM folders
            WHERE project_id = ? AND is_deleted = 0
            ORDER BY parent_id IS NOT NULL, name COLLATE NOCASE
            """,
            (project_id,),
        ).fetchall()
    return {"project": dict(project), "folders": [dict(row) for row in folders]}


@app.post("/api/folders")
def create_folder(payload: dict, user: dict = Depends(require_user)) -> dict:
    project_id = int(payload.get("project_id") or 0)
    parent_id = payload.get("parent_id")
    name = (payload.get("name") or "").strip()
    if not project_id or not name:
        raise HTTPException(status_code=400, detail="项目和目录名不能为空")
    now = utc_now()
    with get_db() as conn:
        if parent_id:
            ensure_permission(conn, user, int(parent_id), ("write",))
        cur = conn.execute(
            """
            INSERT INTO folders (project_id, parent_id, name, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (project_id, parent_id, name, user["id"], now, now),
        )
        folder_id = cur.lastrowid
        log_action(conn, user["id"], "create_folder", "folder", folder_id, name)
        return row_to_dict(conn.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone())


@app.patch("/api/folders/{folder_id}")
def rename_folder(folder_id: int, payload: dict, user: dict = Depends(require_user)) -> dict:
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="目录名不能为空")
    with get_db() as conn:
        ensure_permission(conn, user, folder_id, ("write",))
        conn.execute(
            "UPDATE folders SET name = ?, updated_at = ? WHERE id = ?",
            (name, utc_now(), folder_id),
        )
        log_action(conn, user["id"], "rename_folder", "folder", folder_id, name)
        return row_to_dict(conn.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone())


@app.patch("/api/folders/{folder_id}/move")
def move_folder(folder_id: int, payload: dict, user: dict = Depends(require_user)) -> dict:
    target_parent_id = payload.get("parent_id")
    if target_parent_id is not None:
        target_parent_id = int(target_parent_id)
    if target_parent_id == folder_id:
        raise HTTPException(status_code=400, detail="不能把目录移动到自己下面")

    with get_db() as conn:
        folder = conn.execute(
            "SELECT * FROM folders WHERE id = ? AND is_deleted = 0", (folder_id,)
        ).fetchone()
        if not folder:
            raise HTTPException(status_code=404, detail="目录不存在")
        ensure_permission(conn, user, folder_id, ("write",))

        if target_parent_id is not None:
            target = conn.execute(
                "SELECT * FROM folders WHERE id = ? AND is_deleted = 0", (target_parent_id,)
            ).fetchone()
            if not target:
                raise HTTPException(status_code=404, detail="目标目录不存在")
            if target["project_id"] != folder["project_id"]:
                raise HTTPException(status_code=400, detail="不能跨项目移动目录")
            ensure_permission(conn, user, target_parent_id, ("write",))

            current = target
            while current:
                if current["id"] == folder_id:
                    raise HTTPException(status_code=400, detail="不能把目录移动到自己的子目录里")
                if current["parent_id"] is None:
                    break
                current = conn.execute(
                    "SELECT * FROM folders WHERE id = ?", (current["parent_id"],)
                ).fetchone()

        duplicate = conn.execute(
            """
            SELECT id FROM folders
            WHERE project_id = ?
              AND ((? IS NULL AND parent_id IS NULL) OR parent_id = ?)
              AND name = ?
              AND id != ?
              AND is_deleted = 0
            """,
            (folder["project_id"], target_parent_id, target_parent_id, folder["name"], folder_id),
        ).fetchone()
        if duplicate:
            raise HTTPException(status_code=400, detail="目标目录下已有同名目录")

        conn.execute(
            "UPDATE folders SET parent_id = ?, updated_at = ? WHERE id = ?",
            (target_parent_id, utc_now(), folder_id),
        )
        log_action(conn, user["id"], "move_folder", "folder", folder_id, str(target_parent_id or "root"))
        return row_to_dict(conn.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone())


@app.delete("/api/folders/{folder_id}")
def delete_folder(folder_id: int, user: dict = Depends(require_user)) -> dict:
    with get_db() as conn:
        ensure_permission(conn, user, folder_id, ("write",))
        child_count = conn.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM folders WHERE parent_id = ? AND is_deleted = 0) +
              (SELECT COUNT(*) FROM files WHERE folder_id = ? AND is_deleted = 0) AS count
            """,
            (folder_id, folder_id),
        ).fetchone()["count"]
        if child_count:
            raise HTTPException(status_code=400, detail="目录不为空，不能删除")
        conn.execute("UPDATE folders SET is_deleted = 1, updated_at = ? WHERE id = ?", (utc_now(), folder_id))
        log_action(conn, user["id"], "delete_folder", "folder", folder_id)
        return {"ok": True}


@app.get("/api/folders/{folder_id}/items")
def folder_items(
    folder_id: int,
    q: str = "",
    kind: str = "",
    scope: str = "folder",
    user: dict = Depends(require_user),
) -> dict:
    with get_db() as conn:
        ensure_permission(conn, user, folder_id, ("read",))
        current_folder = conn.execute(
            "SELECT * FROM folders WHERE id = ? AND is_deleted = 0",
            (folder_id,),
        ).fetchone()
        if not current_folder:
            raise HTTPException(status_code=404, detail="目录不存在")

        folders = []
        filters = ["f.is_deleted = 0"]
        params: list = []
        if scope == "project":
            filters.append("f.project_id = ?")
            params.append(current_folder["project_id"])
        else:
            folders = conn.execute(
                """
                SELECT * FROM folders
                WHERE parent_id = ? AND is_deleted = 0
                ORDER BY name COLLATE NOCASE
                """,
                (folder_id,),
            ).fetchall()
            filters.append("f.folder_id = ?")
            params.append(folder_id)
        if q:
            filters.append("f.name LIKE ?")
            params.append(f"%{q}%")
        if kind:
            normalized_kind = kind.lower().lstrip(".")
            group = ARCHIVE_KIND_GROUPS.get(normalized_kind)
            if group:
                placeholders = ", ".join("?" for _ in group)
                filters.append(f"f.extension IN ({placeholders})")
                params.extend(sorted(group))
            elif normalized_kind != "all":
                filters.append("f.extension = ?")
                params.append(normalized_kind)
        files = conn.execute(
            f"""
            SELECT f.*, u.display_name AS created_by_name, fv.version_no, fo.name AS folder_name
            FROM files f
            LEFT JOIN users u ON u.id = f.created_by
            LEFT JOIN file_versions fv ON fv.id = f.current_version_id
            LEFT JOIN folders fo ON fo.id = f.folder_id
            WHERE {' AND '.join(filters)}
            ORDER BY f.updated_at DESC
            """,
            params,
        ).fetchall()
    return {"folders": [dict(row) for row in folders], "files": [dict(row) for row in files]}


@app.post("/api/folders/{folder_id}/upload")
def upload_files(
    folder_id: int,
    files: list[UploadFile] = File(...),
    relative_paths: list[str] = Form([]),
    remark: str = Form(""),
    user: dict = Depends(require_user),
) -> list[dict]:
    saved: list[dict] = []
    with get_db() as conn:
        ensure_permission(conn, user, folder_id, ("upload",))
        folder = conn.execute("SELECT project_id FROM folders WHERE id = ?", (folder_id,)).fetchone()
        if not folder:
            raise HTTPException(status_code=404, detail="目录不存在")
        project_id = folder["project_id"]
        now = utc_now()
        for index, upload in enumerate(files):
            relative_path = relative_paths[index] if index < len(relative_paths) else upload.filename or ""
            parts = clean_relative_parts(relative_path)
            if not parts:
                parts = [Path(upload.filename or "未命名文件").name]
            original_name = parts[-1] or Path(upload.filename or "未命名文件").name
            destination_folder_id = folder_id
            for folder_name in parts[:-1]:
                destination_folder_id = get_or_create_child_folder(
                    conn, project_id, destination_folder_id, folder_name, user["id"]
                )
            ext = extension_of(original_name)
            storage_path, size, sha = save_upload(upload)
            existing = conn.execute(
                """
                SELECT * FROM files
                WHERE folder_id = ? AND name = ? AND is_deleted = 0
                """,
                (destination_folder_id, original_name),
            ).fetchone()
            if existing:
                next_version = conn.execute(
                    "SELECT COALESCE(MAX(version_no), 0) + 1 AS no FROM file_versions WHERE file_id = ?",
                    (existing["id"],),
                ).fetchone()["no"]
                cur = conn.execute(
                    """
                    INSERT INTO file_versions (file_id, version_no, storage_path, sha256, size, remark, uploaded_by, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (existing["id"], next_version, storage_path, sha, size, remark, user["id"], now),
                )
                version_id = cur.lastrowid
                conn.execute(
                    """
                    UPDATE files
                    SET extension = ?, mime_type = ?, size = ?, current_version_id = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (ext, upload.content_type or "", size, version_id, now, existing["id"]),
                )
                file_id = existing["id"]
            else:
                cur = conn.execute(
                    """
                    INSERT INTO files (project_id, folder_id, name, extension, mime_type, size, created_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        project_id,
                        destination_folder_id,
                        original_name,
                        ext,
                        upload.content_type or "",
                        size,
                        user["id"],
                        now,
                        now,
                    ),
                )
                file_id = cur.lastrowid
                version = conn.execute(
                    """
                    INSERT INTO file_versions (file_id, version_no, storage_path, sha256, size, remark, uploaded_by, created_at)
                    VALUES (?, 1, ?, ?, ?, ?, ?, ?)
                    """,
                    (file_id, storage_path, sha, size, remark, user["id"], now),
                )
                conn.execute("UPDATE files SET current_version_id = ? WHERE id = ?", (version.lastrowid, file_id))
            log_action(conn, user["id"], "upload_file", "file", file_id, original_name)
            saved.append(row_to_dict(conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()))
    return saved


@app.get("/api/files/{file_id}")
def file_detail(file_id: int, user: dict = Depends(require_user)) -> dict:
    with get_db() as conn:
        file_row = conn.execute(
            """
            SELECT f.*, u.display_name AS created_by_name
            FROM files f
            LEFT JOIN users u ON u.id = f.created_by
            WHERE f.id = ?
            """,
            (file_id,),
        ).fetchone()
        if not file_row:
            raise HTTPException(status_code=404, detail="文件不存在")
        ensure_permission(conn, user, file_row["folder_id"], ("read",))
        versions = conn.execute(
            """
            SELECT fv.*, u.display_name AS uploaded_by_name
            FROM file_versions fv
            LEFT JOIN users u ON u.id = fv.uploaded_by
            WHERE fv.file_id = ?
            ORDER BY fv.version_no DESC
            """,
            (file_id,),
        ).fetchall()
    return {"file": dict(file_row), "versions": [dict(row) for row in versions]}


@app.get("/api/files/{file_id}/preview")
def preview_file(file_id: int, user: dict = Depends(require_user)):
    with get_db() as conn:
        file_row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
        if not file_row:
            raise HTTPException(status_code=404, detail="文件不存在")
        ensure_permission(conn, user, file_row["folder_id"], ("read",))
        version = conn.execute(
            "SELECT * FROM file_versions WHERE id = ?", (file_row["current_version_id"],)
        ).fetchone()
        if not version:
            raise HTTPException(status_code=404, detail="版本不存在")

    absolute_path = FILES_DIR.parent / version["storage_path"]
    if not absolute_path.exists():
        raise HTTPException(status_code=404, detail="文件已丢失")

    ext = (file_row["extension"] or "").lower()
    if ext in TEXT_PREVIEW_EXTENSIONS:
        if version["size"] > 1024 * 1024:
            raise HTTPException(status_code=413, detail="文本文件超过 1MB，请下载后查看")
        content = absolute_path.read_text(encoding="utf-8", errors="replace")
        return PlainTextResponse(content)

    media_type = PREVIEW_MEDIA_TYPES.get(ext)
    if not media_type:
        raise HTTPException(status_code=415, detail="该文件类型暂不支持在线预览")

    return FileResponse(
        absolute_path,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{file_row["name"]}"'},
    )


@app.patch("/api/file-versions/{version_id}/effectiveness")
def update_version_effectiveness(
    version_id: int,
    payload: dict,
    user: dict = Depends(require_user),
) -> dict:
    is_effective = 1 if payload.get("is_effective") else 0
    with get_db() as conn:
        version = conn.execute(
            """
            SELECT fv.*, f.folder_id, f.current_version_id, f.name AS file_name
            FROM file_versions fv
            JOIN files f ON f.id = fv.file_id
            WHERE fv.id = ?
            """,
            (version_id,),
        ).fetchone()
        if not version:
            raise HTTPException(status_code=404, detail="版本不存在")
        ensure_permission(conn, user, version["folder_id"], ("write",))
        if not is_effective and version["current_version_id"] == version_id:
            raise HTTPException(status_code=400, detail="当前版本不能标记为失效")
        conn.execute(
            "UPDATE file_versions SET is_effective = ? WHERE id = ?",
            (is_effective, version_id),
        )
        log_action(
            conn,
            user["id"],
            "update_version_effectiveness",
            "file_version",
            version_id,
            f"{version['file_name']} v{version['version_no']} -> {'effective' if is_effective else 'ineffective'}",
        )
        updated = conn.execute(
            """
            SELECT fv.*, u.display_name AS uploaded_by_name
            FROM file_versions fv
            LEFT JOIN users u ON u.id = fv.uploaded_by
            WHERE fv.id = ?
            """,
            (version_id,),
        ).fetchone()
        return dict(updated)


@app.get("/api/files/{file_id}/download")
def download_file(file_id: int, version_id: Optional[int] = None, user: dict = Depends(require_user)):
    with get_db() as conn:
        file_row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
        if not file_row:
            raise HTTPException(status_code=404, detail="文件不存在")
        ensure_permission(conn, user, file_row["folder_id"], ("read",))
        if version_id:
            version = conn.execute(
                "SELECT * FROM file_versions WHERE id = ? AND file_id = ?", (version_id, file_id)
            ).fetchone()
        else:
            version = conn.execute(
                "SELECT * FROM file_versions WHERE id = ?", (file_row["current_version_id"],)
            ).fetchone()
        if not version:
            raise HTTPException(status_code=404, detail="版本不存在")
    absolute_path = FILES_DIR.parent / version["storage_path"]
    if not absolute_path.exists():
        raise HTTPException(status_code=404, detail="文件已丢失")
    return FileResponse(absolute_path, filename=file_row["name"], media_type="application/octet-stream")


@app.get("/api/files/batch-download")
def batch_download_files(file_ids: str, user: dict = Depends(require_user)):
    raw_ids = [item.strip() for item in (file_ids or "").split(",") if item.strip()]
    if not raw_ids:
        raise HTTPException(status_code=400, detail="请选择需要下载的文件")
    try:
        ids = [int(item) for item in raw_ids]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="文件参数不正确") from exc

    with get_db() as conn:
        placeholders = ", ".join("?" for _ in ids)
        rows = conn.execute(
            f"""
            SELECT f.*, fo.name AS folder_name, fv.storage_path
            FROM files f
            JOIN folders fo ON fo.id = f.folder_id
            JOIN file_versions fv ON fv.id = f.current_version_id
            WHERE f.id IN ({placeholders}) AND f.is_deleted = 0
            ORDER BY f.updated_at DESC
            """,
            ids,
        ).fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail="文件不存在")
        folder_ids = {row["folder_id"] for row in rows}
        for folder_id in folder_ids:
            ensure_permission(conn, user, folder_id, ("read",))

    zip_dir = FILES_DIR.parent / "tmp"
    zip_dir.mkdir(parents=True, exist_ok=True)
    zip_path = zip_dir / f"{uuid.uuid4().hex}.zip"
    with ZipFile(zip_path, "w", ZIP_DEFLATED) as archive:
        for row in rows:
            source = FILES_DIR.parent / row["storage_path"]
            if not source.exists():
                continue
            archive_name = f"{row['folder_name']}/{row['name']}" if row["folder_name"] else row["name"]
            archive.write(source, arcname=archive_name)
    return FileResponse(zip_path, filename="selected-files.zip", media_type="application/zip")


@app.get("/api/folders/{folder_id}/download")
def download_folder(folder_id: int, user: dict = Depends(require_user)):
    with get_db() as conn:
        ensure_permission(conn, user, folder_id, ("read",))
        folder = conn.execute("SELECT * FROM folders WHERE id = ?", (folder_id,)).fetchone()
        if not folder:
            raise HTTPException(status_code=404, detail="目录不存在")
        files = conn.execute(
            """
            SELECT f.name, fv.storage_path
            FROM files f
            JOIN file_versions fv ON fv.id = f.current_version_id
            WHERE f.folder_id = ? AND f.is_deleted = 0
            """,
            (folder_id,),
        ).fetchall()
    zip_dir = FILES_DIR.parent / "tmp"
    zip_dir.mkdir(parents=True, exist_ok=True)
    zip_path = zip_dir / f"{uuid.uuid4().hex}.zip"
    with ZipFile(zip_path, "w", ZIP_DEFLATED) as archive:
        for row in files:
            source = FILES_DIR.parent / row["storage_path"]
            if source.exists():
                archive.write(source, arcname=row["name"])
    return FileResponse(zip_path, filename=f"{folder['name']}.zip", media_type="application/zip")


@app.patch("/api/files/{file_id}")
def rename_file(file_id: int, payload: dict, user: dict = Depends(require_user)) -> dict:
    name = (payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="文件名不能为空")
    with get_db() as conn:
        file_row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
        if not file_row:
            raise HTTPException(status_code=404, detail="文件不存在")
        ensure_permission(conn, user, file_row["folder_id"], ("write",))
        conn.execute(
            "UPDATE files SET name = ?, extension = ?, updated_at = ? WHERE id = ?",
            (name, extension_of(name), utc_now(), file_id),
        )
        log_action(conn, user["id"], "rename_file", "file", file_id, name)
        return row_to_dict(conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone())


@app.patch("/api/files/{file_id}/move")
def move_file(file_id: int, payload: dict, user: dict = Depends(require_user)) -> dict:
    target_folder_id = int(payload.get("folder_id") or 0)
    if not target_folder_id:
        raise HTTPException(status_code=400, detail="目标目录不能为空")

    with get_db() as conn:
        file_row = conn.execute(
            "SELECT * FROM files WHERE id = ? AND is_deleted = 0", (file_id,)
        ).fetchone()
        if not file_row:
            raise HTTPException(status_code=404, detail="文件不存在")
        target = conn.execute(
            "SELECT * FROM folders WHERE id = ? AND is_deleted = 0", (target_folder_id,)
        ).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="目标目录不存在")
        if target["project_id"] != file_row["project_id"]:
            raise HTTPException(status_code=400, detail="不能跨项目移动文件")

        ensure_permission(conn, user, file_row["folder_id"], ("write",))
        ensure_permission(conn, user, target_folder_id, ("write",))

        duplicate = conn.execute(
            """
            SELECT id FROM files
            WHERE folder_id = ? AND name = ? AND id != ? AND is_deleted = 0
            """,
            (target_folder_id, file_row["name"], file_id),
        ).fetchone()
        if duplicate:
            raise HTTPException(status_code=400, detail="目标目录下已有同名文件")

        conn.execute(
            "UPDATE files SET folder_id = ?, updated_at = ? WHERE id = ?",
            (target_folder_id, utc_now(), file_id),
        )
        log_action(conn, user["id"], "move_file", "file", file_id, str(target_folder_id))
        return row_to_dict(conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone())


@app.post("/api/files/batch-delete")
def batch_delete_files(payload: dict, user: dict = Depends(require_user)) -> dict:
    file_ids = payload.get("file_ids") or []
    if not file_ids:
        raise HTTPException(status_code=400, detail="请选择需要删除的文件")
    try:
        ids = [int(item) for item in file_ids]
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="文件参数不正确") from exc

    now = utc_now()
    with get_db() as conn:
        placeholders = ", ".join("?" for _ in ids)
        rows = conn.execute(
            f"SELECT * FROM files WHERE id IN ({placeholders}) AND is_deleted = 0",
            ids,
        ).fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail="文件不存在")
        for row in rows:
            ensure_permission(conn, user, row["folder_id"], ("write",))
            conn.execute("UPDATE files SET is_deleted = 1, updated_at = ? WHERE id = ?", (now, row["id"]))
            log_action(conn, user["id"], "delete_file", "file", row["id"], row["name"])
    return {"ok": True, "count": len(rows)}


@app.delete("/api/files/{file_id}")
def delete_file(file_id: int, user: dict = Depends(require_user)) -> dict:
    with get_db() as conn:
        file_row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
        if not file_row:
            raise HTTPException(status_code=404, detail="文件不存在")
        ensure_permission(conn, user, file_row["folder_id"], ("write",))
        conn.execute("UPDATE files SET is_deleted = 1, updated_at = ? WHERE id = ?", (utc_now(), file_id))
        log_action(conn, user["id"], "delete_file", "file", file_id, file_row["name"])
        return {"ok": True}


@app.get("/api/trash")
def trash(user: dict = Depends(require_user)) -> dict:
    with get_db() as conn:
        ensure_module_access(conn, user, "archive_3d")
        files = conn.execute(
            """
            SELECT f.*, p.name AS project_name, fo.name AS folder_name
            FROM files f
            JOIN projects p ON p.id = f.project_id
            JOIN folders fo ON fo.id = f.folder_id
            WHERE f.is_deleted = 1
            ORDER BY f.updated_at DESC
            """
        ).fetchall()
    return {"files": [dict(row) for row in files]}


@app.get("/api/learning/items")
def list_learning_items(user: dict = Depends(require_user)) -> list[dict]:
    with get_db() as conn:
        ensure_module_access(conn, user, "learning", "read")
        rows = conn.execute(
            """
            SELECT li.*, u.display_name AS created_by_name
            FROM learning_items li
            LEFT JOIN users u ON u.id = li.created_by
            WHERE li.is_deleted = 0
            ORDER BY
                COALESCE(li.parent_id, 0),
                CASE li.item_type
                    WHEN 'folder' THEN 1
                    ELSE 2
                END,
                CASE li.status
                    WHEN '进行中' THEN 1
                    WHEN '计划中' THEN 2
                    WHEN '已完成' THEN 3
                    ELSE 4
                END,
                li.updated_at DESC
            """
        ).fetchall()
    return [dict(row) for row in rows]


def is_learning_folder(item) -> bool:
    return item["item_type"] == "folder" or (
        item["category"] in ("目录", "文件夹")
        and not (item["content"] or "").strip()
        and not (item["resource_url"] or "").strip()
    )


def repair_learning_folder(conn, item_id: int) -> None:
    conn.execute(
        """
        UPDATE learning_items
        SET item_type = 'folder',
            category = '文件夹',
            content = '',
            resource_url = '',
            updated_at = ?
        WHERE id = ?
        """,
        (utc_now(), item_id),
    )


def save_learning_version(conn, item_row, user_id: int) -> None:
    conn.execute(
        """
        INSERT INTO learning_versions
            (item_id, title, category, status, priority, content, resource_url, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            item_row["id"],
            item_row["title"],
            item_row["category"] or "",
            item_row["status"] or "计划中",
            item_row["priority"] or "中",
            item_row["content"] or "",
            item_row["resource_url"] or "",
            user_id,
            utc_now(),
        ),
    )


@app.post("/api/learning/items")
def create_learning_item(payload: dict, user: dict = Depends(require_user)) -> dict:
    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="标题不能为空")
    item_type = payload.get("item_type") or "doc"
    if item_type not in {"doc", "folder"}:
        raise HTTPException(status_code=400, detail="条目类型不正确")
    parent_id = payload.get("parent_id")
    now = utc_now()
    with get_db() as conn:
        ensure_module_access(conn, user, "learning", "edit")
        if parent_id:
            parent = conn.execute(
                "SELECT * FROM learning_items WHERE id = ? AND is_deleted = 0",
                (parent_id,),
            ).fetchone()
            if not parent:
                raise HTTPException(status_code=404, detail="上级目录不存在")
            if not is_learning_folder(parent):
                raise HTTPException(status_code=400, detail="只能在目录下创建内容")
            if parent["item_type"] != "folder":
                repair_learning_folder(conn, parent["id"])
        cur = conn.execute(
            """
            INSERT INTO learning_items
                (parent_id, item_type, title, category, status, priority, content, resource_url, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                parent_id,
                item_type,
                title,
                "文件夹" if item_type == "folder" else (payload.get("category") or "大数据").strip(),
                payload.get("status") or "计划中",
                payload.get("priority") or "中",
                "" if item_type == "folder" else (payload.get("content") or "").strip(),
                "" if item_type == "folder" else (payload.get("resource_url") or "").strip(),
                user["id"],
                now,
                now,
            ),
        )
        item_id = cur.lastrowid
        created = conn.execute("SELECT * FROM learning_items WHERE id = ?", (item_id,)).fetchone()
        if created and created["item_type"] == "doc":
            save_learning_version(conn, created, user["id"])
        log_action(conn, user["id"], "create_learning_item", "learning_item", item_id, title)
        return row_to_dict(created)


@app.patch("/api/learning/items/{item_id}")
def update_learning_item(item_id: int, payload: dict, user: dict = Depends(require_user)) -> dict:
    allowed = {"title", "category", "status", "priority", "content", "resource_url", "parent_id"}
    updates = []
    values = []
    for key in allowed:
        if key in payload:
            updates.append(f"{key} = ?")
            values.append((payload.get(key) or "").strip() if isinstance(payload.get(key), str) else payload.get(key))
    if not updates:
        raise HTTPException(status_code=400, detail="没有可更新内容")
    updates.append("updated_at = ?")
    values.append(utc_now())
    values.append(item_id)
    with get_db() as conn:
        ensure_module_access(conn, user, "learning", "edit")
        existing = conn.execute("SELECT * FROM learning_items WHERE id = ? AND is_deleted = 0", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="学习条目不存在")
        if "parent_id" in payload:
            parent_id = payload.get("parent_id")
            if parent_id == item_id:
                raise HTTPException(status_code=400, detail="不能移动到自身下面")
            if parent_id:
                parent = conn.execute(
                    "SELECT * FROM learning_items WHERE id = ? AND is_deleted = 0",
                    (parent_id,),
                ).fetchone()
                if not parent:
                    raise HTTPException(status_code=404, detail="目标目录不存在")
                if not is_learning_folder(parent):
                    raise HTTPException(status_code=400, detail="目标必须是目录")
                if parent["item_type"] != "folder":
                    repair_learning_folder(conn, parent["id"])
                if is_learning_folder(existing):
                    current = parent_id
                    while current:
                        if current == item_id:
                            raise HTTPException(status_code=400, detail="不能移动到自己的子目录")
                        row = conn.execute(
                            "SELECT parent_id FROM learning_items WHERE id = ? AND is_deleted = 0",
                            (current,),
                        ).fetchone()
                        current = row["parent_id"] if row else None
        conn.execute(f"UPDATE learning_items SET {', '.join(updates)} WHERE id = ?", values)
        updated = conn.execute("SELECT * FROM learning_items WHERE id = ?", (item_id,)).fetchone()
        tracked_fields = ("title", "category", "status", "priority", "content", "resource_url")
        if (
            existing["item_type"] == "doc"
            and updated
            and any(existing[field] != updated[field] for field in tracked_fields)
        ):
            save_learning_version(conn, updated, user["id"])
        log_action(conn, user["id"], "update_learning_item", "learning_item", item_id)
        return row_to_dict(updated)


@app.delete("/api/learning/items/{item_id}")
def delete_learning_item(item_id: int, user: dict = Depends(require_user)) -> dict:
    with get_db() as conn:
        ensure_module_access(conn, user, "learning", "edit")
        existing = conn.execute("SELECT * FROM learning_items WHERE id = ? AND is_deleted = 0", (item_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="学习条目不存在")
        if is_learning_folder(existing):
            if existing["item_type"] != "folder":
                repair_learning_folder(conn, existing["id"])
            conn.execute(
                """
                WITH RECURSIVE subtree(id) AS (
                    SELECT id FROM learning_items WHERE id = ?
                    UNION ALL
                    SELECT li.id
                    FROM learning_items li
                    JOIN subtree s ON li.parent_id = s.id
                    WHERE li.is_deleted = 0
                )
                UPDATE learning_items
                SET is_deleted = 1, updated_at = ?
                WHERE id IN (SELECT id FROM subtree)
                """,
                (item_id, utc_now()),
            )
        else:
            conn.execute("UPDATE learning_items SET is_deleted = 1, updated_at = ? WHERE id = ?", (utc_now(), item_id))
        log_action(conn, user["id"], "delete_learning_item", "learning_item", item_id, existing["title"])
    return {"ok": True}


@app.get("/api/learning/items/{item_id}/versions")
def list_learning_versions(item_id: int, user: dict = Depends(require_user)) -> list[dict]:
    with get_db() as conn:
        ensure_module_access(conn, user, "learning", "read")
        item = conn.execute(
            "SELECT * FROM learning_items WHERE id = ? AND is_deleted = 0",
            (item_id,),
        ).fetchone()
        if not item:
            raise HTTPException(status_code=404, detail="学习条目不存在")
        rows = conn.execute(
            """
            SELECT lv.*, u.display_name AS created_by_name
            FROM learning_versions lv
            LEFT JOIN users u ON u.id = lv.created_by
            WHERE lv.item_id = ?
            ORDER BY lv.id DESC
            """,
            (item_id,),
        ).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/learning/versions/{version_id}/restore")
def restore_learning_version(version_id: int, user: dict = Depends(require_user)) -> dict:
    with get_db() as conn:
        ensure_module_access(conn, user, "learning", "edit")
        version = conn.execute(
            """
            SELECT lv.*, li.item_type, li.is_deleted
            FROM learning_versions lv
            JOIN learning_items li ON li.id = lv.item_id
            WHERE lv.id = ?
            """,
            (version_id,),
        ).fetchone()
        if not version or version["is_deleted"]:
            raise HTTPException(status_code=404, detail="版本不存在")
        if version["item_type"] != "doc":
            raise HTTPException(status_code=400, detail="只有文档支持恢复历史版本")
        conn.execute(
            """
            UPDATE learning_items
            SET title = ?, category = ?, status = ?, priority = ?, content = ?, resource_url = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                version["title"],
                version["category"],
                version["status"],
                version["priority"],
                version["content"],
                version["resource_url"],
                utc_now(),
                version["item_id"],
            ),
        )
        restored = conn.execute(
            "SELECT * FROM learning_items WHERE id = ?",
            (version["item_id"],),
        ).fetchone()
        save_learning_version(conn, restored, user["id"])
        log_action(conn, user["id"], "restore_learning_version", "learning_item", version["item_id"], version["title"])
        return row_to_dict(restored)


@app.post("/api/files/{file_id}/restore")
def restore_file(file_id: int, user: dict = Depends(require_user)) -> dict:
    with get_db() as conn:
        file_row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
        if not file_row:
            raise HTTPException(status_code=404, detail="文件不存在")
        ensure_permission(conn, user, file_row["folder_id"], ("write",))
        conn.execute("UPDATE files SET is_deleted = 0, updated_at = ? WHERE id = ?", (utc_now(), file_id))
        log_action(conn, user["id"], "restore_file", "file", file_id, file_row["name"])
    return {"ok": True}


@app.post("/api/trash/batch-restore")
def batch_restore_files(payload: dict, user: dict = Depends(require_user)) -> dict:
    file_ids = payload.get("file_ids") or []
    if not file_ids:
        raise HTTPException(status_code=400, detail="请选择需要恢复的文件")
    try:
        parsed_ids = [int(item) for item in file_ids]
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="文件参数不正确") from exc
    placeholders = ",".join("?" for _ in parsed_ids)
    now = utc_now()
    restored = 0
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT * FROM files WHERE id IN ({placeholders}) AND is_deleted = 1",
            parsed_ids,
        ).fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail="文件不存在")
        for row in rows:
            ensure_permission(conn, user, row["folder_id"], ("write",))
            conn.execute("UPDATE files SET is_deleted = 0, updated_at = ? WHERE id = ?", (now, row["id"]))
            log_action(conn, user["id"], "restore_file", "file", row["id"], row["name"])
            restored += 1
    return {"ok": True, "count": restored}


@app.delete("/api/files/{file_id}/purge")
def purge_file(file_id: int, user: dict = Depends(require_admin)) -> dict:
    with get_db() as conn:
        versions = conn.execute("SELECT storage_path FROM file_versions WHERE file_id = ?", (file_id,)).fetchall()
        file_row = conn.execute("SELECT name FROM files WHERE id = ?", (file_id,)).fetchone()
        conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
        log_action(conn, user["id"], "purge_file", "file", file_id, file_row["name"] if file_row else "")
    for version in versions:
        path = FILES_DIR.parent / version["storage_path"]
        if path.exists():
            path.unlink()
    return {"ok": True}


@app.delete("/api/trash/batch-purge")
def batch_purge_files(payload: dict, user: dict = Depends(require_admin)) -> dict:
    file_ids = payload.get("file_ids") or []
    if not file_ids:
        raise HTTPException(status_code=400, detail="请选择需要彻底删除的文件")
    try:
        parsed_ids = [int(item) for item in file_ids]
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail="文件参数不正确") from exc
    placeholders = ",".join("?" for _ in parsed_ids)
    deleted_paths = []
    purged = 0
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT id, name FROM files WHERE id IN ({placeholders}) AND is_deleted = 1",
            parsed_ids,
        ).fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail="文件不存在")
        for row in rows:
            versions = conn.execute(
                "SELECT storage_path FROM file_versions WHERE file_id = ?",
                (row["id"],),
            ).fetchall()
            deleted_paths.extend(version["storage_path"] for version in versions)
            conn.execute("DELETE FROM files WHERE id = ?", (row["id"],))
            log_action(conn, user["id"], "purge_file", "file", row["id"], row["name"])
            purged += 1
    for path_value in deleted_paths:
        path = FILES_DIR.parent / path_value
        if path.exists():
            path.unlink()
    return {"ok": True, "count": purged}


@app.post("/api/backup")
def create_backup(user: dict = Depends(require_admin)) -> dict:
    backup_dir = FILES_DIR.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    db_source = FILES_DIR.parents[1] / "work_file_archive.db"
    db_backup = backup_dir / f"work_file_archive_{timestamp}.db"
    if db_source.exists():
        shutil.copy2(db_source, db_backup)
    return {"ok": True, "path": str(db_backup)}
