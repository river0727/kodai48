"""
邀请码系统模块
负责邀请码的生成、验证、使用、统计和管理
"""
import json
import logging
import os
import random
from datetime import datetime
from typing import Dict, Optional

logger = logging.getLogger("starlight48.invite")

INVITE_CODE_FILE = "invite_codes.json"
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin48")

# 邀请码格式前缀
CODE_PREFIX = "PLAY48-"
# 邀请码随机字符集（去除易混淆字符: 0/O/I/1）
CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8


def _generate_invite_code() -> str:
    """生成一个邀请码"""
    suffix = ''.join(random.choice(CODE_CHARS) for _ in range(CODE_LENGTH))
    return f"{CODE_PREFIX}{suffix}"


def init_invite_codes(count: int = 2000) -> Dict:
    """
    初始化邀请码系统，强制生成指定数量的邀请码。
    如果已有旧数据，保留已使用的邀请码记录。
    """
    invite_data = {
        "codes": {},
        "generated_at": datetime.now().isoformat(),
        "total_count": count,
        "used_count": 0
    }

    # 如果有旧文件，保留已使用的邀请码记录
    if os.path.exists(INVITE_CODE_FILE):
        try:
            with open(INVITE_CODE_FILE, 'r', encoding='utf-8') as f:
                old_data = json.load(f)
            for code, info in old_data.get("codes", {}).items():
                if info.get("used"):
                    invite_data["codes"][code] = info
                    invite_data["used_count"] += 1
        except (json.JSONDecodeError, IOError):
            pass

    # 生成新邀请码，直到达到 count 个
    while len(invite_data["codes"]) < count:
        code = _generate_invite_code()
        while code in invite_data["codes"]:
            code = _generate_invite_code()
        invite_data["codes"][code] = {
            "used": False,
            "created_at": datetime.now().isoformat(),
            "used_at": None,
            "user_id": None
        }

    with open(INVITE_CODE_FILE, 'w', encoding='utf-8') as f:
        json.dump(invite_data, f, ensure_ascii=False, indent=2)

    logger.info("成功生成/更新 %d 个邀请码，其中已使用 %d 个", count, invite_data['used_count'])
    return invite_data


def _save_invite_data(invite_data: Dict) -> None:
    """保存邀请码数据到文件"""
    with open(INVITE_CODE_FILE, 'w', encoding='utf-8') as f:
        json.dump(invite_data, f, ensure_ascii=False, indent=2)


def _find_code_case_insensitive(invite_data: Dict, code: str) -> Optional[str]:
    """不区分大小写查找邀请码，返回原始大小写的 code"""
    code_upper = code.upper()
    for invite_code in invite_data.get("codes", {}):
        if invite_code.upper() == code_upper:
            return invite_code
    return None


def validate_invite_code(invite_data: Dict, code: str) -> Dict:
    """
    验证邀请码是否有效。
    返回: {"valid": bool, "message": str, ...}
    """
    if code.upper() == ADMIN_PASSWORD.upper():
        return {"valid": True, "is_admin": True, "user_id": "admin"}

    found_code = _find_code_case_insensitive(invite_data, code)
    if found_code is None:
        return {"valid": False, "message": "邀请码不存在"}

    if invite_data["codes"][found_code].get("used"):
        return {"valid": False, "message": "这个邀请码已经被使用了"}

    return {"valid": True, "is_admin": False, "code": found_code}


def use_invite_code(invite_data: Dict, code: str, user_id: str) -> bool:
    """
    使用邀请码。
    返回: True 表示使用成功，False 表示失败。
    """
    if code.upper() == ADMIN_PASSWORD.upper():
        return True

    found_code = _find_code_case_insensitive(invite_data, code)
    if found_code is not None and not invite_data["codes"][found_code].get("used"):
        invite_data["codes"][found_code]["used"] = True
        invite_data["codes"][found_code]["used_at"] = datetime.now().isoformat()
        invite_data["codes"][found_code]["user_id"] = user_id
        invite_data["used_count"] = invite_data.get("used_count", 0) + 1
        _save_invite_data(invite_data)
        return True
    return False


def get_invite_stats(invite_data: Dict) -> Dict:
    """获取邀请码统计数据"""
    total = len(invite_data.get("codes", {}))
    used = sum(1 for cd in invite_data.get("codes", {}).values() if cd.get("used"))
    return {
        "total": total,
        "used": used,
        "unused": total - used
    }


def get_unused_codes(invite_data: Dict, limit: int = 100) -> list:
    """获取未使用的邀请码列表"""
    unused = []
    for code, data in invite_data.get("codes", {}).items():
        if not data.get("used"):
            unused.append(code)
            if len(unused) >= limit:
                break
    return unused


def get_used_codes(invite_data: Dict, limit: int = 100) -> list:
    """获取已使用的邀请码列表（含详细信息）"""
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
    """获取所有邀请码列表（含状态信息）"""
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
