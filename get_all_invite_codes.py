
import urllib.request
import json
import os

API_URL = "https://kodai48-production.up.railway.app"
ADMIN_PASSWORD = "admin48"
OUTPUT_FILE = "all_invite_codes.txt"

def make_get_request(url):
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"    ❌ 错误: {str(e)}")
        return None

print("=" * 70)
print("🎯 开始获取所有2000个邀请码")
print("=" * 70)

# 1. 先获取统计信息
print("\n1️⃣  获取服务器邀请码统计...")
stats = make_get_request(f"{API_URL}/api/invite/stats?password={ADMIN_PASSWORD}")
if stats:
    print(f"    ✅ 统计: 总数={stats['total']}, 已用={stats['used']}, 可用={stats['unused']}")

# 2. 获取所有2000个邀请码
print("\n2️⃣  获取完整邀请码列表...")
all_codes_data = make_get_request(f"{API_URL}/api/invite/list?password={ADMIN_PASSWORD}&limit=2000")

if all_codes_data and 'codes' in all_codes_data:
    codes_list = all_codes_data['codes']
    print(f"    ✅ 成功获取 {len(codes_list)} 个邀请码！")
    
    # 3. 保存到文件
    print(f"\n3️⃣  保存到文件 {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        for code in codes_list:
            f.write(code + '\n')
    
    print(f"    ✅ 文件已保存: {os.path.abspath(OUTPUT_FILE)}")
    
    # 4. 显示前10个和后10个
    print("\n4️⃣  验证码预览:")
    print("    ─────────────────────────")
    for i, code in enumerate(codes_list[:10]):
        print(f"    {i+1:2d}. {code}")
    if len(codes_list) &gt; 20:
        print("      ...")
        for i, code in enumerate(codes_list[-10:], len(codes_list)-9):
            print(f"    {i:2d}. {code}")
    print("    ─────────────────────────")
    
    print(f"\n🎉 成功获取全部 {len(codes_list)} 个邀请码！")
    print(f"📝 完整列表请查看: {os.path.abspath(OUTPUT_FILE)}")
    
else:
    print("\n❌ 无法获取邀请码列表！")

print("\n" + "=" * 70)
print("✅ 操作完成")
print("=" * 70)
