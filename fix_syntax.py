"""直接修复 L5106 语法错误"""
path = r'c:\Users\姚\Documents\trae_projects\48moniqi\deploy\app.js'
with open(path, encoding='utf-8') as f:
    code = f.read()

# 定位
start_marker = "overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);padding:20px';"
idx = code.find(start_marker)
inner_start = code.find("overlay.innerHTML = `", idx)
template_end = code.find("`;", inner_start)

# 替换整段模板字符串
new_block = '''overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5);padding:20px';
        // 修复：避免模板字符串中嵌套复杂 onclick，改用字符串拼接 + addEventListener
        const safeText = String(event.text || '').replace(/'/g, "\\\\'");
        const safeMember = String(event.member || '').replace(/'/g, "\\\\'");
        const safeEmoji = String(event.emoji || '💬');
        const eventData = { member: safeMember, type: event.type, responded: false, text: safeText, emoji: safeEmoji };
        overlay.innerHTML = '<div style="background:#fff;border-radius:20px;padding:24px;width:100%;max-width:320px;text-align:center">'
            + '<div style="font-size:48px;margin-bottom:12px">' + safeEmoji + '</div>'
            + '<div style="font-weight:600;font-size:16px;color:#333;margin-bottom:4px">' + event.member + ' 主动找你</div>'
            + '<div style="font-size:13px;color:#666;margin-bottom:20px;line-height:1.6">' + event.text + '</div>'
            + '<div style="display:flex;gap:8px">'
            + '<button data-respond="positive" style="flex:1;padding:12px;border:none;background:linear-gradient(135deg,#ff69b4,#ff1493);color:#fff;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer">积极回应</button>'
            + '<button data-respond="negative" style="flex:1;padding:12px;border:1px solid #ddd;background:#fff;color:#666;border-radius:10px;font-size:13px;cursor:pointer">婉拒</button>'
            + '</div></div>' '''

# 替换范围：idx 到 template_end+2
new_code = code[:idx] + new_block + code[template_end+2:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_code)

print(f"原长度: {len(code)}")
print(f"新长度: {len(new_code)}")
print("写入完成")
