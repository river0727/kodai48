
"""
极简版 AI 聊天后端（部署版）
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import random
from openai import AsyncOpenAI

# 加载配置
API_KEY = os.getenv("AI_API_KEY", "")
BASE_URL = os.getenv("AI_BASE_URL", "https://api.deepseek.com/v1")
MODEL = os.getenv("AI_MODEL", "deepseek-chat")

app = FastAPI()

# 允许跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 初始化 OpenAI 客户端
client = AsyncOpenAI(api_key=API_KEY, base_url=BASE_URL)

# ---------------------- 数据模型 ----------------------

class ChatMessage(BaseModel):
    npcId: str
    message: str
    playerName: str = ""
    context: dict = {}

# ---------------------- NPC 性格映射 ----------------------

def get_npc_prompt(npc_id: str, context: dict = None) -> str:
    """根据 NPC 名字和类型生成系统提示词"""
    
    context = context or {}
    npc_type = context.get("npcType", "member")
    personality = context.get("personality", "")
    
    # 根据类型生成提示词
    type_prompts = {
        "agent": f"你是{npc_id}，一个{personality or '专业'}的经纪人。你关心艺人的工作和生活。",
        "sweet": f"你是{npc_id}，一个甜美可爱的偶像成员。说话活泼，喜欢用表情符号！",
        "sister": f"你是{npc_id}，一个温柔体贴的姐姐型偶像。会照顾人，说话亲切。",
        "rival": f"你是{npc_id}，一个有实力的竞争对手。有点傲气，但也很努力。",
        "teammate": f"你是{npc_id}，一个友善的队友。喜欢和队友互动。",
        "member": f"你是{npc_id}，一个偶像团体成员。性格随和友善。"
    }
    
    return type_prompts.get(npc_type, f"你是{npc_id}，一个偶像团体成员。请用简短、自然的语言回复。")

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
    return {"status": "ok", "message": "AI 聊天后端运行中！"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.post("/api/chat")
async def chat(data: ChatMessage):
    # 获取系统提示词
    system_prompt = get_npc_prompt(data.npcId, data.context)
    
    try:
        # 尝试调用 AI
        print(f"[REQUEST] npcId={data.npcId}, message={data.message[:30]}...")
        
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
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
