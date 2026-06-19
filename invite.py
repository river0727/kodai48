"""
邀请码系统模块
负责邀请码的生成、验证、使用、统计和管理
"""
import json
import logging
import os
import random
import tempfile
import threading
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger("starlight48.invite")

INVITE_CODE_FILE = "invite_codes.json"
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "SMY980814")
MAX_ADMIN_DEVICES = int(os.getenv("MAX_ADMIN_DEVICES", "20"))  # 管理员密码最多绑定设备数
# 认证版本：修改此值会强制重置所有管理员设备记录
AUTH_VERSION = 4

# 邀请码格式前缀
CODE_PREFIX = "PLAY48-"
# 邀请码随机字符集（去除易混淆字符: 0/O/I/1）
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8

# 线程锁：保护 invite_data 并发读写
_invite_lock = threading.Lock()


def _generate_invite_code() -> str:
    """生成一个邀请码"""
    suffix = ''.join(random.choice(CODE_CHARS) for _ in range(CODE_LENGTH))
    return f"{CODE_PREFIX}{suffix}"


def init_invite_codes(count: int = 2000) -> Dict:
    """
    初始化邀请码系统，强制生成指定数量的邀请码。
    如果已有旧数据，保留已使用的邀请码记录和管理员设备记录。
    线程安全。
    """
    with _invite_lock:
        invite_data = {
            "codes": {},
            "generated_at": datetime.now().isoformat(),
            "total_count": count,
            "used_count": 0,
            "admin_devices": {"max_devices": MAX_ADMIN_DEVICES, "devices": {}}
        }

        # 如果有旧文件，保留已使用的邀请码记录和管理员设备记录
        if os.path.exists(INVITE_CODE_FILE):
            try:
                with open(INVITE_CODE_FILE, 'r', encoding='utf-8') as f:
                    old_data = json.load(f)
                for code, info in old_data.get("codes", {}).items():
                    if info.get("used"):
                        invite_data["codes"][code] = info
                        invite_data["used_count"] += 1
                # 保留管理员设备记录（除非认证版本已更新）
                if "admin_devices" in old_data and old_data.get("auth_version") == AUTH_VERSION:
                    invite_data["admin_devices"] = old_data["admin_devices"]
                else:
                    logger.info("认证版本变更或首次部署: admin_devices 已重置")
                # 标记当前认证版本
                invite_data["auth_version"] = AUTH_VERSION
                logger.info("从旧文件恢复 %d 个已使用邀请码", invite_data["used_count"])
            except (json.JSONDecodeError, IOError) as e:
                logger.warning("读取旧邀请码文件失败: %s，将重新生成", e)
                # 损坏文件备份
                backup_path = INVITE_CODE_FILE + ".corrupted_backup"
                try:
                    os.rename(INVITE_CODE_FILE, backup_path)
                    logger.info("已备份损坏文件到 %s", backup_path)
                except OSError:
                    pass

        # 生成新邀请码，直到达到 count 个
        # 添加最大尝试次数保护，防止极端情况下的无限循环
        max_attempts = count * 10
        attempts = 0
        while len(invite_data["codes"]) < count and attempts < max_attempts:
            code = _generate_invite_code()
            # 碰撞重试（概率极低但安全处理）
            retry = 0
            while code in invite_data["codes"] and retry < 100:
                code = _generate_invite_code()
                retry += 1
            if retry >= 100:
                logger.error("邀请码生成碰撞次数过多，可能字符集过小")
                break
            invite_data["codes"][code] = {
                "used": False,
                "created_at": datetime.now().isoformat(),
                "used_at": None,
                "user_id": None
            }
            attempts += 1

        if attempts >= max_attempts:
            logger.error("邀请码生成达到最大尝试次数 %d，当前数量: %d", max_attempts, len(invite_data["codes"]))

        try:
            _save_invite_data(invite_data)
        except OSError as e:
            logger.critical("无法写入邀请码文件: %s，服务可能无法正常工作", e)

        logger.info("成功生成/更新 %d 个邀请码，其中已使用 %d 个", count, invite_data['used_count'])
        return invite_data


def _save_invite_data(invite_data: Dict) -> None:
    """原子写入：先写临时文件，再重命名，防止崩溃损坏数据"""
    file_path = Path(INVITE_CODE_FILE)
    try:
        # 写入临时文件
        tmp_fd, tmp_path = tempfile.mkstemp(
            suffix=".json",
            prefix=".invite_tmp_",
            dir=file_path.parent or "."
        )
        try:
            with os.fdopen(tmp_fd, 'w', encoding='utf-8') as f:
                json.dump(invite_data, f, ensure_ascii=False, indent=2)
            # 原子重命名（同一文件系统内是原子操作）
            os.replace(tmp_path, INVITE_CODE_FILE)
        except Exception:
            # 清理临时文件
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise
    except OSError as e:
        logger.error("保存邀请码数据失败: %s", e)
        raise


def _find_code_case_insensitive(invite_data: Dict, code: str) -> Optional[str]:
    """不区分大小写查找邀请码，返回原始大小写的 code"""
    code_upper = code.upper()
    for invite_code in invite_data.get("codes", {}):
        if invite_code.upper() == code_upper:
            return invite_code
    return None


def validate_invite_code(invite_data: Dict, code: str, user_id: str = "") -> Dict:
    """
    验证邀请码是否有效（线程安全读）。
    支持重新登录：如果码已被使用但 user_id 匹配，允许重新进入。
    返回: {"valid": bool, "message": str, "is_admin": bool, "code": str, "user_id": str, ...}
    """
    if code.upper() == ADMIN_PASSWORD.upper():
        # 管理员密码：检查设备是否已在白名单中
        with _invite_lock:
            admin_devices = invite_data.get("admin_devices", {}).get("devices", {})
        device_count = len(admin_devices)
        # 如果设备已在列表中，允许重新登录
        if user_id and user_id in admin_devices:
            return {"valid": True, "is_admin": True, "user_id": user_id, "device_count": device_count}
        # 新设备：如果未达上限则允许
        if device_count < MAX_ADMIN_DEVICES:
            return {"valid": True, "is_admin": True, "user_id": "", "device_count": device_count}
        # 已达上限
        return {
            "valid": False,
            "is_admin": True,
            "message": f"管理员密码设备数已达上限({MAX_ADMIN_DEVICES})，请联系群主申请独立邀请码",
            "device_count": device_count
        }

    with _invite_lock:
        found_code = _find_code_case_insensitive(invite_data, code)
        if found_code is None:
            return {"valid": False, "message": "邀请码不存在"}

        code_info = invite_data["codes"][found_code]
        if code_info.get("used"):
            # 已被使用：检查是否为同一用户重新登录
            stored_user_id = code_info.get("user_id", "")
            if user_id and stored_user_id and stored_user_id == user_id:
                return {"valid": True, "is_admin": False, "code": found_code, "user_id": user_id, "relogin": True}
            return {"valid": False, "message": "这个邀请码已经被使用了"}

        return {"valid": True, "is_admin": False, "code": found_code, "user_id": ""}


def use_invite_code(invite_data: Dict, code: str, user_id: str, device_id: str = "") -> Dict:
    """
    使用邀请码（线程安全）。
    管理员密码：追踪设备，限制设备数。
    PLAY48- 码：一人一码，使用后绑定 user_id。
    返回: {"success": bool, "message": str, "relogin": bool, ...}
    """
    if code.upper() == ADMIN_PASSWORD.upper():
        return _use_admin_password(invite_data, user_id, device_id)

    with _invite_lock:
        found_code = _find_code_case_insensitive(invite_data, code)
        if found_code is None:
            return {"success": False, "message": "邀请码不存在"}
        if invite_data["codes"][found_code].get("used"):
            # 检查是否为同一用户重新登录
            if invite_data["codes"][found_code].get("user_id") == user_id:
                return {"success": True, "message": "欢迎回来！", "relogin": True}
            return {"success": False, "message": "这个邀请码已经被其他人使用了"}

        invite_data["codes"][found_code]["used"] = True
        invite_data["codes"][found_code]["used_at"] = datetime.now().isoformat()
        invite_data["codes"][found_code]["user_id"] = user_id
        invite_data["used_count"] = invite_data.get("used_count", 0) + 1

        try:
            _save_invite_data(invite_data)
        except OSError:
            # 写入失败，回滚内存状态
            invite_data["codes"][found_code]["used"] = False
            invite_data["codes"][found_code]["used_at"] = None
            invite_data["codes"][found_code]["user_id"] = None
            invite_data["used_count"] = invite_data.get("used_count", 1) - 1
            raise

        return {"success": True, "message": "邀请码绑定成功！", "relogin": False}


def _use_admin_password(invite_data: Dict, user_id: str, device_id: str) -> Dict:
    """管理员密码使用逻辑：设备追踪 + 数量限制"""
    with _invite_lock:
        if "admin_devices" not in invite_data:
            invite_data["admin_devices"] = {"max_devices": MAX_ADMIN_DEVICES, "devices": {}}

        admin_devices = invite_data["admin_devices"]["devices"]
        now = datetime.now().isoformat()

        # 设备已存在 → 重新登录
        if device_id and device_id in admin_devices:
            admin_devices[device_id]["last_used"] = now
            admin_devices[device_id]["use_count"] += 1
            try:
                _save_invite_data(invite_data)
            except OSError:
                pass
            return {"success": True, "message": "欢迎回来！", "relogin": True, "device_count": len(admin_devices)}

        # 新设备：检查上限
        if len(admin_devices) >= MAX_ADMIN_DEVICES:
            return {
                "success": False,
                "message": f"管理员密码设备数已达上限({MAX_ADMIN_DEVICES})，请联系群主申请独立邀请码",
                "device_count": len(admin_devices)
            }

        # 记录新设备
        admin_devices[device_id] = {
            "user_id": user_id,
            "first_used": now,
            "last_used": now,
            "use_count": 1
        }
        try:
            _save_invite_data(invite_data)
        except OSError:
            del admin_devices[device_id]
            raise

        return {"success": True, "message": "管理员密码绑定成功！", "relogin": False, "device_count": len(admin_devices)}


def get_invite_stats(invite_data: Dict) -> Dict:
    """获取邀请码统计数据（线程安全）"""
    with _invite_lock:
        total = len(invite_data.get("codes", {}))
        used = sum(1 for cd in invite_data.get("codes", {}).values() if cd.get("used"))
        return {
            "total": total,
            "used": used,
            "unused": total - used
        }


def get_unused_codes(invite_data: Dict, limit: int = 100) -> list:
    """获取未使用的邀请码列表（线程安全）"""
    with _invite_lock:
        unused = []
        for code, data in invite_data.get("codes", {}).items():
            if not data.get("used"):
                unused.append(code)
                if len(unused) >= limit:
                    break
        return unused


def get_used_codes(invite_data: Dict, limit: int = 100) -> list:
    """获取已使用的邀请码列表（含详细信息，线程安全）"""
    with _invite_lock:
        used = []
        for code, data in invite_data.get("codes", {}).items():
            if data.get("used"):
                used.append({
                    "code": code,
                    "user_id": data.get("user_id"),
                    "used_at": data.get("used_at"),
                    "created_at": data.get("created_at")
                })
                if len(used) >= limit:
                    break
        return used


def get_all_codes(invite_data: Dict, limit: int = 100) -> list:
    """获取所有邀请码列表（含状态信息，线程安全）"""
    with _invite_lock:
        all_codes = []
        for code, data in invite_data.get("codes", {}).items():
            all_codes.append({
                "code": code,
                "used": data.get("used", False),
                "user_id": data.get("user_id"),
                "used_at": data.get("used_at"),
                "created_at": data.get("created_at")
            })
            if len(all_codes) >= limit:
                break
        return all_codes


def verify_admin(password: str) -> bool:
    """验证管理员密码"""
    return password == ADMIN_PASSWORD


def get_auth_version() -> int:
    """获取当前服务端认证版本号（公开接口，无需密码）"""
    return AUTH_VERSION
