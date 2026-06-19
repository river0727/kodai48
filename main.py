"""
星光48·爱豆模拟器 - 后端服务
提供 AI 聊天 API、邀请码管理、静态文件托管
"""
import json
import logging
import os
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI
from pydantic import BaseModel

from invite import (
    ADMIN_PASSWORD,
    get_all_codes,
    get_auth_version,
    get_invite_stats,
    get_unused_codes,
    get_used_codes,
    init_invite_codes,
    use_invite_code,
    validate_invite_code,
    verify_admin,
)

# ======================== 日志配置 ========================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
)
logger = logging.getLogger("starlight48")

# ======================== 配置加载 ========================
API_KEY = os.getenv("AI_API_KEY", "")
BASE_URL = os.getenv("AI_BASE_URL", "https://api.deepseek.com/v1")
MODEL = os.getenv("AI_MODEL", "deepseek-chat")

# CORS 白名单（可通过环境变量扩展，逗号分隔）
CORS_ORIGINS_STR = os.getenv("CORS_ORIGINS", "*")
if CORS_ORIGINS_STR == "*":
    CORS_ORIGINS = ["*"]
else:
    CORS_ORIGINS = [o.strip() for o in CORS_ORIGINS_STR.split(",") if o.strip()]

# API Token 验证（可选，通过环境变量启用）
API_TOKEN = os.getenv("API_TOKEN", "")

# 速率限制：每个 IP 每分钟最大请求数
RATE_LIMIT_PER_MINUTE = int(os.getenv("RATE_LIMIT_PER_MINUTE", "30"))

# ======================== 应用初始化 ========================
app = FastAPI(title="星光48 API", version="2.0")

# CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# 静态文件
app.mount("/static", StaticFiles(directory="."), name="static")

# 顶层静态资源（让 index.html 的相对路径 app.js / style.css / app_diag.js 能找到）
@app.get("/app.js", include_in_schema=False)
async def _serve_app_js():
    return FileResponse("app.js", media_type="application/javascript")

@app.get("/style.css", include_in_schema=False)
async def _serve_style_css():
    return FileResponse("style.css", media_type="text/css")

@app.get("/app_diag.js", include_in_schema=False)
async def _serve_app_diag():
    return FileResponse("app_diag.js", media_type="application/javascript")

@app.get("/48mgmt.html", include_in_schema=False)
async def _serve_48mgmt():
    return FileResponse("48mgmt.html", media_type="text/html")

@app.get("/shop_card.jpg", include_in_schema=False)
async def _serve_shop_card():
    return FileResponse("shop_card.jpg", media_type="image/jpeg")

# AI 客户端
client = AsyncOpenAI(api_key=API_KEY, base_url=BASE_URL) if API_KEY else None

# 初始化邀请码系统
invite_data = init_invite_codes(2000)

# ======================== 速率限制 ========================
# 简单的内存速率限制器
_rate_limit_store: dict[str, list[float]] = {}

import time


def check_rate_limit(ip: str) -> bool:
    """检查 IP 是否超过速率限制，返回 True 表示未超限"""
    now = time.time()
    if ip not in _rate_limit_store:
        _rate_limit_store[ip] = []
    # 清理过期记录
    _rate_limit_store[ip] = [t for t in _rate_limit_store[ip] if now - t < 60]
    if len(_rate_limit_store[ip]) >= RATE_LIMIT_PER_MINUTE:
        return False
    _rate_limit_store[ip].append(now)
    return True


# ======================== 鉴权依赖 ========================
def verify_api_token(request: Request) -> None:
    """验证 API Token（如果配置了的话）"""
    if not API_TOKEN:
        return  # 未配置 Token，跳过验证
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer ") or auth_header[7:] != API_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized: invalid API token")


# ======================== 数据模型 ========================
class ChatMessage(BaseModel):
    npcId: str
    message: str
    playerName: str = ""
    context: dict = {}
    rolePrompt: str = ""
    inviteCode: str = ""


class InviteValidateRequest(BaseModel):
    code: str
    userId: str = ""


class InviteUseRequest(BaseModel):
    code: str
    userId: str
    deviceId: str = ""


class CloudSaveRequest(BaseModel):
    userId: str
    saveData: dict
    playerName: str = ""
    gameDay: int = 1

# 云存档存储目录
CLOUD_SAVE_DIR = Path("cloud_saves")
CLOUD_SAVE_DIR.mkdir(exist_ok=True)
MAX_SAVE_SIZE = 500 * 1024  # 500KB 上限


# ======================== NPC 性格映射 ========================
def get_npc_prompt(npc_id: str, role_prompt: str = "", context: Optional[dict] = None) -> str:
    """根据 NPC 名字和类型生成系统提示词，优先使用客户端传来的增强提示词"""
    # 如果客户端传了增强的 rolePrompt，直接使用（包含人设、OOC禁令、上下文）
    if role_prompt and len(role_prompt) > 50:
        return role_prompt
    
    # 降级：使用简单的人设提示
    context = context or {}
    npc_type = context.get("npcType", "member")
    personality = context.get("personality", "")

    type_prompts = {
        "agent": f"你是{npc_id}，一位{personality or '专业'}的女性经纪人。你关心艺人的工作和生活。",
        "sweet": f"你是{npc_id}，一位甜美可爱的女性偶像成员。你和玩家是好朋友，说话活泼亲切，像闺蜜一样聊天。",
        "sister": f"你是{npc_id}，一位温柔体贴的姐姐型女性偶像。你和玩家是好朋友，会照顾人，说话亲切自然。",
        "rival": f"你是{npc_id}，一位有实力的女性竞争对手。你和玩家既是朋友也是对手，有点傲气但也很努力。",
        "teammate": f"你是{npc_id}，一位友善的女性队友。你和玩家是好朋友，喜欢和队友互动聊天。",
        "member": f"你是{npc_id}，一位女性偶像团体成员。你和玩家是好朋友，性格随和友善，像闺蜜一样相处。"
    }

    return type_prompts.get(
        npc_type,
        f"你是{npc_id}，一位女性偶像团体成员。你和玩家是好朋友，请用简短、自然、亲切的语言回复。"
    )


def get_local_reply(npc_id: str, context: Optional[dict] = None) -> str:
    """获取本地回复（当 AI 调用失败时）"""
    context = context or {}
    npc_type = context.get("npcType", "member")

    replies_by_type = {
        "agent": [
            "明天有通告，早点休息。", "行程已经安排好了。",
            "最近状态不错，继续保持。", "有事随时找我。", "身体要紧，别太拼了。",
            "今天的排练效果不错。", "记得保持微笑。", "台风还需要再练练。",
            "明天的服装已经准备好了。", "粉丝们的反馈很好，继续加油。"
        ],
        "sweet": [
            "哇！太棒了！加油加油！", "你今天也好厉害呀！",
            "支持你！永远支持你！", "嘿嘿，看到你就开心！", "今天也要元气满满哦！",
            "姐姐最棒啦~", "一起努力变得更好吧！", "好开心能和你聊天！",
            "你的笑容最治愈了~", "最喜欢看你表演了！"
        ],
        "sister": [
            "做得不错，继续加油！", "有什么不懂的尽管问我。",
            "你今天辛苦了！", "休息一下，别太累。", "我相信你可以的！",
            "需要帮忙的话随时开口。", "你最近进步很大呢。", "记得按时吃饭。",
            "不要给自己太大压力。", "你已经做得很好了。"
        ],
        "rival": [
            "哼，这次还算凑合吧...", "你行不行啊？算了，加油吧。",
            "别得意，下次我不会输的。", "虽然不想承认...但你今天还行。", "继续努力吧。",
            "我今天状态不好而已。", "别以为这样就赢了。", "下次一定是我的表现更好。",
            "你也没那么差啦...", "我会追上你的，等着吧。"
        ],
        "teammate": [
            "明天一起练舞吧！", "今天表现好帅！",
            "一起去吃饭吗？", "加油加油！", "我们一定可以的！",
            "今天的排练辛苦了！", "团队配合越来越默契了。",
            "你那个动作可以再酷一点。", "一起加油拿第一！", "演出大成功！"
        ],
        "member": [
            "好的，我知道了！", "加油！一起努力！",
            "今天也辛苦了！", "嗯嗯，没问题！", "谢谢你的消息！",
            "有什么我能帮忙的吗？", "你也是我最喜欢的队友！",
            "下次公演一起加油吧。", "今天的舞蹈练得怎么样？", "好期待下次演出啊。"
        ]
    }

    return random.choice(replies_by_type.get(npc_type, replies_by_type["member"]))


# ======================== API 端点 ========================

@app.get("/")
async def read_root():
    return FileResponse("index.html")


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "ai_configured": bool(API_KEY),
        "model": MODEL if API_KEY else None,
        "cloud_saves_count": len(list(CLOUD_SAVE_DIR.glob("*.json"))) if CLOUD_SAVE_DIR.exists() else 0,
        "server_time": datetime.now(timezone.utc).isoformat()
    }


@app.get("/api/network-test")
def network_test():
    """网络连通性测试端点，返回延迟和状态信息"""
    return {
        "status": "ok",
        "server_time": datetime.now(timezone.utc).isoformat(),
        "message": "API server is reachable"
    }


@app.post("/api/chat")
async def chat(data: ChatMessage, request: Request):
    """AI 聊天接口"""
    # API Token 验证（如果配置了的话）
    verify_api_token(request)
    # 速率限制
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

    system_prompt = get_npc_prompt(data.npcId, data.rolePrompt, data.context)
    logger.info("Chat request: npcId=%s, message=%.30s...", data.npcId, data.message)

    try:
        if client is None:
            raise ValueError("AI API Key 未配置")

        response = await client.chat.completions.create(
            model=MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": data.message}
            ],
            temperature=0.8,
            max_tokens=500
        )

        ai_reply = response.choices[0].message.content
        logger.info("AI reply: %.50s...", ai_reply)

        return {"status": "success", "reply": ai_reply}

    except Exception as e:
        logger.warning("AI call failed: %s: %s", type(e).__name__, e)
        local_reply = get_local_reply(data.npcId, data.context)
        logger.info("Fallback to local reply: %s", local_reply)

        return {"status": "success", "reply": local_reply}


# ======================== 认证版本 API ========================

@app.get("/api/auth/version")
async def api_auth_version():
    """获取当前服务端认证版本号（公开接口，无需认证）
    客户端通过轮询此接口检测版本变化，变化时强制弹出邀请码验证
    """
    try:
        version = get_auth_version()
        return {"version": version}
    except Exception as e:
        logger.error("获取认证版本异常: %s", e)
        raise HTTPException(status_code=500, detail="服务器内部错误")


# ======================== 邀请码 API ========================

@app.post("/api/invite/validate")
async def api_validate_invite(data: InviteValidateRequest, request: Request):
    """验证邀请码是否有效"""
    # 速率限制
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

    try:
        result = validate_invite_code(invite_data, data.code, data.userId)
        return result
    except Exception as e:
        logger.error("邀请码验证异常: %s", e)
        raise HTTPException(status_code=500, detail="服务器内部错误，请稍后重试")


@app.post("/api/invite/use")
async def api_use_invite(data: InviteUseRequest, request: Request):
    """使用邀请码"""
    # 速率限制
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

    try:
        result = use_invite_code(invite_data, data.code, data.userId, data.deviceId)
        if result.get("success"):
            logger.info("Invite code used: user=%s device=%s", data.userId, data.deviceId)
            return {"success": True, "message": result.get("message", "成功"), "relogin": result.get("relogin", False), "device_count": result.get("device_count")}
        else:
            return {"success": False, "message": result.get("message", "邀请码无效或已被使用")}
    except OSError as e:
        logger.critical("邀请码存储写入失败: %s", e)
        raise HTTPException(status_code=500, detail="邀请码系统存储异常，请联系管理员")
    except Exception as e:
        logger.error("邀请码使用异常: %s", e)
        raise HTTPException(status_code=500, detail="服务器内部错误，请稍后重试")


@app.get("/api/invite/stats")
async def api_get_stats(password: str):
    """获取邀请码统计（需要管理员密码）"""
    if not verify_admin(password):
        raise HTTPException(status_code=403, detail="密码错误")
    return get_invite_stats(invite_data)


@app.get("/api/invite/list")
async def api_list_unused(password: str, limit: int = 100):
    """获取未使用的邀请码列表（需要管理员密码）"""
    if not verify_admin(password):
        raise HTTPException(status_code=403, detail="密码错误")

    codes = get_unused_codes(invite_data, limit)
    total_unused = sum(1 for cd in invite_data.get("codes", {}).values() if not cd.get("used"))

    return {"codes": codes, "total_remaining": total_unused}


@app.get("/api/invite/used-list")
async def api_list_used(password: str, limit: int = 100):
    """获取已使用的邀请码列表（需要管理员密码）"""
    if not verify_admin(password):
        raise HTTPException(status_code=403, detail="密码错误")

    codes = get_used_codes(invite_data, limit)
    total_used = sum(1 for cd in invite_data.get("codes", {}).values() if cd.get("used"))

    return {"codes": codes, "total_used": total_used}


@app.get("/api/invite/all-list")
async def api_list_all(password: str, limit: int = 100):
    """获取所有邀请码列表（需要管理员密码）"""
    if not verify_admin(password):
        raise HTTPException(status_code=403, detail="密码错误")

    codes = get_all_codes(invite_data, limit)
    stats = get_invite_stats(invite_data)

    return {
        "codes": codes,
        "total": stats["total"],
        "used": stats["used"],
        "unused": stats["unused"]
    }


# ======================== 云存档 API ========================

def _get_save_path(user_id: str) -> Path:
    """获取用户存档文件路径（防止路径遍历）"""
    safe_name = "".join(c for c in user_id if c.isalnum() or c in "_-")
    if not safe_name:
        raise HTTPException(status_code=400, detail="无效的用户 ID")
    return CLOUD_SAVE_DIR / f"{safe_name}.json"


@app.post("/api/save/upload")
async def cloud_save_upload(data: CloudSaveRequest, request: Request):
    """上传存档到云端"""
    # 速率限制
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

    # 大小检查
    save_json = json.dumps(data.saveData, ensure_ascii=False)
    if len(save_json.encode('utf-8')) > MAX_SAVE_SIZE:
        raise HTTPException(status_code=400, detail="存档过大，请清理后重试")

    save_path = _get_save_path(data.userId)
    save_entry = {
        "user_id": data.userId,
        "player_name": data.playerName,
        "game_day": data.gameDay,
        "saved_at": datetime.now(timezone.utc).isoformat(),
        "save_data": data.saveData
    }

    try:
        with open(save_path, 'w', encoding='utf-8') as f:
            json.dump(save_entry, f, ensure_ascii=False, indent=2)
    except IOError as e:
        logger.error("Cloud save write error: user=%s, error=%s", data.userId, e)
        raise HTTPException(status_code=500, detail=f"存档写入失败: {e}")

    logger.info("Cloud save: user=%s, day=%d, size=%d bytes",
                data.userId, data.gameDay, len(save_json.encode('utf-8')))

    return {
        "success": True,
        "message": "存档已上传至云端",
        "saved_at": save_entry["saved_at"],
        "game_day": data.gameDay
    }


@app.get("/api/save/download")
async def cloud_save_download(userId: str):
    """从云端下载存档"""
    save_path = _get_save_path(userId)

    if not save_path.exists():
        raise HTTPException(status_code=404, detail="未找到云端存档")

    try:
        with open(save_path, 'r', encoding='utf-8') as f:
            save_entry = json.load(f)
    except json.JSONDecodeError as e:
        logger.error("Cloud save JSON corrupt: user=%s, error=%s", userId, e)
        raise HTTPException(status_code=500, detail="云端存档数据损坏")
    except IOError as e:
        logger.error("Cloud save read error: user=%s, error=%s", userId, e)
        raise HTTPException(status_code=500, detail=f"存档读取失败: {e}")

    logger.info("Cloud download: user=%s, day=%d", userId, save_entry.get("game_day", 0))

    return {
        "success": True,
        "player_name": save_entry.get("player_name", ""),
        "game_day": save_entry.get("game_day", 1),
        "saved_at": save_entry.get("saved_at", ""),
        "save_data": save_entry.get("save_data", {})
    }


@app.get("/api/save/info")
async def cloud_save_info(userId: str):
    """获取云端存档信息（不含完整数据）"""
    save_path = _get_save_path(userId)

    if not save_path.exists():
        return {"exists": False, "message": "暂无云端存档"}

    try:
        with open(save_path, 'r', encoding='utf-8') as f:
            save_entry = json.load(f)
    except json.JSONDecodeError:
        logger.warning("Cloud save info: corrupt file for user=%s", userId)
        return {"exists": False, "message": "云端存档损坏"}
    except IOError as e:
        logger.warning("Cloud save info: read error for user=%s: %s", userId, e)
        return {"exists": False, "message": "无法读取云端存档"}

    return {
        "exists": True,
        "player_name": save_entry.get("player_name", ""),
        "game_day": save_entry.get("game_day", 1),
        "saved_at": save_entry.get("saved_at", ""),
        "size": save_path.stat().st_size
    }


@app.delete("/api/save/delete")
async def cloud_save_delete(userId: str, request: Request):
    """删除云端存档"""
    # 速率限制
    client_ip = request.client.host if request.client else "unknown"
    if not check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="请求过于频繁，请稍后再试")

    save_path = _get_save_path(userId)
    if save_path.exists():
        try:
            save_path.unlink()
            logger.info("Cloud save deleted: user=%s", userId)
            return {"success": True, "message": "云端存档已删除"}
        except IOError as e:
            logger.error("Cloud save delete error: user=%s, error=%s", userId, e)
            raise HTTPException(status_code=500, detail=f"删除失败: {e}")
    return {"success": True, "message": "没有找到云端存档"}


# ======================== 启动入口 ========================
if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8000"))
    logger.info("Starting server on port %d...", port)
    uvicorn.run(app, host="0.0.0.0", port=port)
