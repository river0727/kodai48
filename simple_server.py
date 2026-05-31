
"""
极简版 AI 聊天后端
只需要 fastapi, uvicorn, openai 三个包
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import random
import json
import uuid
from datetime import datetime
from dotenv import load_dotenv
from openai import AsyncOpenAI

# 邀请码数据存储文件
INVITE_CODE_FILE = "invite_codes.json"

# 管理员密码
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin48")

# 加载配置
load_dotenv()

app = FastAPI()

# 允许跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------- 邀请码系统 ----------------------

def generate_invite_code():
    """生成一个邀请码"""
    return f"PLAY48-{''.join([random.choice('ABCDEFGHJKLMNPQRSTUVWXYZ23456789') for _ in range(8)])}"

def init_invite_codes(count: int = 2000):
    """初始化邀请码系统"""
    if not os.path.exists(INVITE_CODE_FILE):
        invite_data = {
            "codes": {},
            "generated_at": datetime.now().isoformat(),
            "total_count": count,
            "used_count": 0
        }
        for i in range(count):
            code = generate_invite_code()
            invite_data["codes"][code] = {
                "used": False,
                "created_at": datetime.now().isoformat(),
                "used_at": None,
                "user_id": None
            }
        with open(INVITE_CODE_FILE, 'w', encoding='utf-8') as f:
            json.dump(invite_data, f, ensure_ascii=False, indent=2)
        print(f"[INIT] 成功生成 {count} 个邀请码！")
        return invite_data
    else:
        with open(INVITE_CODE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)

# 初始化邀请码
invite_data = init_invite_codes(2000)

def save_invite_data():
    """保存邀请码数据"""
    with open(INVITE_CODE_FILE, 'w', encoding='utf-8') as f:
        json.dump(invite_data, f, ensure_ascii=False, indent=2)

def validate_invite_code(code: str):
    """验证邀请码是否有效"""
    if code == ADMIN_PASSWORD:
        return {"valid": True, "is_admin": True, "user_id": "admin"}
    
    if code not in invite_data["codes"]:
        return {"valid": False, "message": "邀请码不存在"}
    
    code_data = invite_data["codes"][code]
    if code_data["used"]:
        return {"valid": False, "message": "这个邀请码已经被使用了"}
    
    return {"valid": True, "is_admin": False, "code": code}

def use_invite_code(code: str, user_id: str):
    """使用邀请码"""
    if code not in invite_data["codes"]:
        return False
    
    code_data = invite_data["codes"][code]
    if code_data["used"]:
        return False
    
    code_data["used"] = True
    code_data["used_at"] = datetime.now().isoformat()
    code_data["user_id"] = user_id
    invite_data["used_count"] += 1
    save_invite_data()
    
    return True

def get_invite_stats():
    """获取邀请码统计"""
    return {
        "total": invite_data["total_count"],
        "used": invite_data["used_count"],
        "remaining": invite_data["total_count"] - invite_data["used_count"],
        "generated_at": invite_data["generated_at"]
    }

# ---------------------- 数据模型 ----------------------

class ChatMessage(BaseModel):
    npcId: str
    message: str
    playerName: str = ""
    context: dict = {}
    inviteCode: str = ""  # 添加邀请码字段

class InviteValidateRequest(BaseModel):
    code: str

class InviteUseRequest(BaseModel):
    code: str
    userId: str

# 初始化 OpenAI 客户端（兼容 DeepSeek）
client = AsyncOpenAI(
    api_key=os.getenv("AI_API_KEY", ""),
    base_url=os.getenv("AI_BASE_URL", "https://api.deepseek.com/v1")
)

# ---------------------- 数据模型 ----------------------

class ChatMessage(BaseModel):
    npcId: str
    message: str
    playerName: str = ""
    context: dict = {}

# ---------------------- NPC 性格映射 ----------------------

def get_npc_prompt(npc_id: str, context: dict = None) -> str:
    """根据 NPC 名字和类型生成系统提示词"""
    
    # 预定义的 NPC - 更自然化
    npc_prompts = {
        "元气小粉": """你是一个阳光开朗的粉丝，对偶像超级痴迷！
你超级热情，说话自然不做作，像朋友聊天一样。
回复要简短自然，偶尔用 "~" 或 emoji，但不要太多。
绝对不要用"首先""其次""综上所述"这种正式表达！""",
        "毒舌前辈": """你是一个表面毒舌但内心温暖的偶像前辈。
说话带刺但不过分，像朋友间的互怼。
回复简短自然，偶尔流露温暖，但不会太刻意。
不要用太正式的表达。""",
        "温柔后辈": """你是一个谦虚有礼貌的后辈，对前辈很崇拜。
说话温柔但自然，不会太客气或疏远。
回复自然亲切，像真的在和朋友聊天。
可以偶尔有点小害羞，但不会刻意装可爱。""",
        "经纪人王姐": """你是一个精明干练的经纪人，说话直接但有分寸。
关心艺人的事业和生活，但表达方式很务实。
说话简洁明了，像职场中的前辈。
不会用太温柔或太严肃的表达。"""
    }
    
    # 如果是预定义的 NPC，直接返回
    if npc_id in npc_prompts:
        return npc_prompts[npc_id]
    
    # 否则根据 context 中的 npcType 和 personality 生成
    context = context or {}
    npc_type = context.get("npcType", "member")
    personality = context.get("personality", "")
    
    # 根据类型生成提示词 - 更自然化
    type_prompts = {
        "agent": f"""你是{npc_id}，一个{personality or '专业'}的经纪人。
你关心艺人的工作和生活，说话直接但有分寸。
回复要自然简洁，像正常聊天，不要太正式。
不要用"首先""其次""总之"这种书面语。""",
        "sweet": f"""你是{npc_id}，一个甜美可爱的偶像。
你很热情开朗，但说话自然不会太刻意。
回复简短亲切，像朋友聊天一样自然。
可以适当用 "~" 或 emoji，但不要太多太刻意。""",
        "sister": f"""你是{npc_id}，一个温柔体贴的姐姐型偶像。
你很会照顾人，但不会太刻意或做作。
说话亲切自然，像真正的朋友在聊天。
可以偶尔关心对方，但不会太啰嗦。""",
        "rival": f"""你是{npc_id}，一个既有实力又有点傲气的竞争对手。
你说话带点傲气但不过分，会暗暗较劲但也欣赏对方。
回复自然，有点个性，不会一直夸人或一直怼人。
像真正的竞争对手之间的关系。""",
        "teammate": f"""你是{npc_id}，一个友善的队友。
你们关系很好，像真正的朋友。
说话轻松随意，可以开玩笑，互相关心。
回复自然简短，像朋友日常聊天。""",
        "member": f"""你是{npc_id}，一个偶像团体成员。
你性格随和，说话自然不做作。
回复简短亲切，像和普通朋友聊天一样。
不要用太正式或太客气的表达。"""
    }
    
    return type_prompts.get(npc_type, f"""你是{npc_id}，一个偶像团体成员。
请用简短、自然的语言回复，像真正的朋友聊天。
不要用"首先""其次""综上所述"。""")

def get_local_reply(npc_id: str, context: dict = None) -> str:
    """获取本地回复（当 AI 调用失败时）"""
    
    context = context or {}
    npc_type = context.get("npcType", "member")
    
    replies_by_type = {
        "agent": [
            "明天有通告，早点休息。",
            "行程已经安排好了。",
            "最近状态不错，继续保持。",
            "有事随时找我。",
            "身体要紧，别太拼了。"
        ],
        "sweet": [
            "哇！太棒了！加油加油！",
            "你今天也好厉害呀！",
            "支持你！永远支持你！",
            "嘿嘿，看到你就开心！",
            "今天也要元气满满哦！"
        ],
        "sister": [
            "做得不错，继续加油！",
            "有什么不懂的尽管问我。",
            "你今天辛苦了！",
            "休息一下，别太累。",
            "我相信你可以的！"
        ],
        "rival": [
            "哼，这次还算凑合吧...",
            "你行不行啊？算了，加油吧。",
            "别得意，下次我不会输的。",
            "虽然不想承认...但你今天还行。",
            "继续努力吧。"
        ],
        "teammate": [
            "明天一起练舞吧！",
            "今天表现好帅！",
            "一起去吃饭吗？",
            "加油加油！",
            "我们一定可以的！"
        ],
        "member": [
            "好的，我知道了！",
            "加油！一起努力！",
            "今天也辛苦了！",
            "嗯嗯，没问题！",
            "谢谢你的消息！"
        ]
    }
    
    return random.choice(replies_by_type.get(npc_type, replies_by_type["member"]))

# ---------------------- API 端点 ----------------------

@app.get("/")
def read_root():
    return {"status": "ok", "message": "AI 聊天后端运行中！", "invite_stats": get_invite_stats()}

# 邀请码验证接口
@app.post("/api/invite/validate")
async def validate_invite(data: InviteValidateRequest):
    result = validate_invite_code(data.code)
    return result

# 邀请码使用接口
@app.post("/api/invite/use")
async def use_invite(data: InviteUseRequest):
    success = use_invite_code(data.code, data.userId)
    if success:
        return {"success": True, "message": "邀请码使用成功！"}
    else:
        return {"success": False, "message": "邀请码无效或已被使用"}

# 获取邀请码统计（仅管理员）
@app.get("/api/invite/stats")
async def get_stats(password: str):
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="密码错误")
    return get_invite_stats()

# 获取未使用的邀请码列表（仅管理员，前100个）
@app.get("/api/invite/list")
async def list_invite_codes(password: str, limit: int = 100):
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=403, detail="密码错误")
    
    unused_codes = []
    for code, data in invite_data["codes"].items():
        if not data["used"]:
            unused_codes.append(code)
            if len(unused_codes) >= limit:
                break
    
    return {
        "codes": unused_codes,
        "total_remaining": len(unused_codes)
    }

@app.post("/api/chat")
async def chat(data: ChatMessage):
    # 验证邀请码（管理员密码或有效邀请码都可以）
    if data.inviteCode:
        validate_result = validate_invite_code(data.inviteCode)
        if not validate_result["valid"]:
            raise HTTPException(status_code=403, detail=validate_result.get("message", "邀请码无效"))
    
    # 获取系统提示词
    system_prompt = get_npc_prompt(data.npcId, data.context)
    
    try:
        # 尝试调用 AI
        print(f"[REQUEST] npcId={data.npcId}, message={data.message[:30]}...")
        
        response = await client.chat.completions.create(
            model=os.getenv("AI_MODEL", "deepseek-chat"),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": data.message}
            ],
            temperature=1.0,
            max_tokens=200
        )
        
        ai_reply = response.choices[0].message.content
        print(f"[SUCCESS] AI reply: {ai_reply[:50]}...")
        
        return {
            "status": "success",
            "reply": ai_reply
        }
    except Exception as e:
        # AI 调用失败，使用本地回复
        print(f"[ERROR] AI call failed: {type(e).__name__}: {e}")
        
        # 获取本地回复
        local_reply = get_local_reply(data.npcId, data.context)
        
        print(f"[FALLBACK] Using local reply: {local_reply}")
        
        return {
            "status": "success",
            "reply": local_reply
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
